// Canonical MK8DX rating engine: Microsoft TrueSkill, restricted to the
// exact recovered legacy semantics (ADR-0154): free-for-all races, one
// single-player team per participant, no draws (draw probability 0),
// mu0 = 25, sigma0 = 25/3, beta = 25/6, tau = 25/300, per-race dynamics.
// The factor-graph schedule mirrors the reference implementation that the
// exact 865-race replay proved bit-compatible with the legacy system.

export type Rating = Readonly<{ mu: number; sigma: number }>;

export const RATING_INITIAL_MU = 25;
export const RATING_INITIAL_SIGMA = 25 / 3;
export const RATING_BETA = 25 / 6;
export const RATING_TAU = 25 / 300;
export const RATING_SCORE_MULTIPLIER = 3;

// How noisy one race is, and how fast we are allowed to forget. ADR-0154
// recovered these from the legacy system, which had inherited the library
// defaults; ADR-0189 measured them on the 9,828-placement history and found
// beta twice as large and tau four times. The measured pair barely changes
// the order it produces - it changes how certain the model claims to be, and
// so how much the `- 3*sigma` in a published Score actually means.
//
// Both live here as named sets rather than as a swapped constant, because the
// legacy pair must stay exactly reproducible: it is the thing ADR-0154 proved.
export type RatingParameters = Readonly<{ beta: number; tau: number }>;

export const LEGACY_RATING_PARAMETERS: RatingParameters = {
  beta: RATING_BETA, tau: RATING_TAU,
};

export const MEASURED_RATING_PARAMETERS: RatingParameters = {
  beta: 25 / 3, tau: 1 / 3,
};

const SCHEDULE_MIN_DELTA = 1e-4;

export function initialRating(): Rating {
  return { mu: RATING_INITIAL_MU, sigma: RATING_INITIAL_SIGMA };
}

export function conservativeScore(rating: Rating): number {
  return rating.mu - RATING_SCORE_MULTIPLIER * rating.sigma;
}

export class RatingEngineError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RatingEngineError";
  }
}

// ---------------------------------------------------------------------------
// double-precision normal helpers (erfc via W. J. Cody-style approximation)
// ---------------------------------------------------------------------------

// Complementary error function — deliberately the same Numerical-Recipes
// approximation the proven reference implementation uses (ADR-0154): the
// exact 865-race legacy replay is bit-compatible with THIS approximation,
// so behavioral replacement requires reproducing it rather than a more
// precise erfc.
function erfcReference(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + z / 2);
  const r = t * Math.exp(
    -z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
    t * (-0.82215223 + t * 0.17087277)))))))));
  return x < 0 ? 2 - r : r;
}

function normalPdf(x: number): number {
  return Math.exp(-(x * x) / 2) / Math.sqrt(2 * Math.PI);
}

function normalCdf(x: number): number {
  return erfcReference(-x / Math.SQRT2) / 2;
}

// The reference implementation derives its draw margin numerically even for
// draw probability 0: its erfc-inverse returns ppf(0.5) ~= 3.76e-8 instead
// of exactly zero, so a tiny positive margin is baked into every legacy
// update. Behavioral replacement reproduces that computation verbatim.
function erfcInverseReference(y: number): number {
  if (y >= 2) { return -100; }
  if (y <= 0) { return 100; }
  const zeroPoint = y < 1;
  const flipped = zeroPoint ? y : 2 - y;
  const t = Math.sqrt(-2 * Math.log(flipped / 2));
  let x = -0.70711 *
    ((2.30753 + t * 0.27061) / (1 + t * (0.99229 + t * 0.04481)) - t);
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const error = erfcReference(x) - flipped;
    x += error / (1.12837916709551257 * Math.exp(-(x * x)) - x * error);
  }
  return zeroPoint ? x : -x;
}

function ppfReference(x: number): number {
  return -Math.SQRT2 * erfcInverseReference(2 * x);
}

// draw margin between two adjacent single-player teams (size 2) at the
// recovered draw probability 0 — a constant of the proven legacy behavior.
export const RATING_REFERENCE_DRAW_MARGIN =
  ppfReference((0 + 1) / 2) * Math.sqrt(2) * (25 / 6);

// win-case truncation moments with the reference draw margin
function vWin(t: number, margin: number): number {
  const x = t - margin;
  const denominator = normalCdf(x);
  if (denominator < 1e-300) {
    return -x;
  }
  return normalPdf(x) / denominator;
}

function wWin(t: number, margin: number): number {
  const v = vWin(t, margin);
  return v * (v + t - margin);
}

// ---------------------------------------------------------------------------
// Gaussian in natural parameters (pi = 1/variance, tau = mu/variance)
// ---------------------------------------------------------------------------

class Gaussian {
  public constructor(public pi = 0, public tau = 0) {}

  public static fromMuSigma(mu: number, sigma: number): Gaussian {
    const pi = 1 / (sigma * sigma);
    return new Gaussian(pi, pi * mu);
  }

  public get mu(): number {
    return this.pi === 0 ? 0 : this.tau / this.pi;
  }

  public get sigma(): number {
    return this.pi === 0 ? Number.POSITIVE_INFINITY : Math.sqrt(1 / this.pi);
  }

  public multiply(other: Gaussian): Gaussian {
    return new Gaussian(this.pi + other.pi, this.tau + other.tau);
  }

  public divide(other: Gaussian): Gaussian {
    return new Gaussian(this.pi - other.pi, this.tau - other.tau);
  }
}

class Variable {
  public value = new Gaussian();
  public readonly messages = new Map<object, Gaussian>();

  public messageOf(factor: object): Gaussian {
    let message = this.messages.get(factor);
    if (message === undefined) {
      message = new Gaussian();
      this.messages.set(factor, message);
    }
    return message;
  }

  public updateMessage(factor: object, message: Gaussian): number {
    const old = this.messageOf(factor);
    this.value = this.value.divide(old).multiply(message);
    this.messages.set(factor, message);
    return deltaOf(old, message);
  }

  public updateValue(factor: object, value: Gaussian): number {
    const old = this.value;
    const oldMessage = this.messageOf(factor);
    this.messages.set(
      factor,
      value.multiply(oldMessage).divide(old),
    );
    this.value = value;
    return deltaOf(old, value);
  }
}

function deltaOf(a: Gaussian, b: Gaussian): number {
  return Math.max(
    Math.abs(a.tau - b.tau),
    Math.sqrt(Math.abs(a.pi - b.pi)),
  );
}

// ---------------------------------------------------------------------------
// rate: one free-for-all race
// ---------------------------------------------------------------------------

export function rateFreeForAllRace(
  participants: readonly Rating[],
  ranks: readonly number[],
  parameters: RatingParameters = LEGACY_RATING_PARAMETERS,
): Rating[] {
  const size = participants.length;
  if (size < 2 || ranks.length !== size) {
    throw new RatingEngineError("a rated race needs two or more participants");
  }
  const uniqueRanks = new Set(ranks);
  if (uniqueRanks.size !== size ||
    [...uniqueRanks].some((rank) => !Number.isSafeInteger(rank) ||
      rank < 1 || rank > size)) {
    throw new RatingEngineError(
      "ranks must be the unique finishing positions 1..N (no ties)",
    );
  }
  for (const rating of participants) {
    if (!Number.isFinite(rating.mu) || !Number.isFinite(rating.sigma) ||
      rating.sigma <= 0) {
      throw new RatingEngineError("participant rating is invalid");
    }
  }

  // sort by rank; remember original order
  const order = ranks.map((rank, index) => ({ rank, index }))
    .sort((a, b) => a.rank - b.rank);

  const ratingVariables: Variable[] = order.map(() => new Variable());
  const performanceVariables: Variable[] = order.map(() => new Variable());
  const differenceVariables: Variable[] = order.slice(1).map(() => new Variable());

  type PriorFactor = { kind: "prior"; variable: Variable; prior: Gaussian };
  const priorFactors: PriorFactor[] = order.map(({ index }, position) => {
    const rating = participants[index]!;
    const sigmaWithDynamics = Math.sqrt(
      rating.sigma * rating.sigma + parameters.tau * parameters.tau,
    );
    return {
      kind: "prior",
      variable: ratingVariables[position]!,
      prior: Gaussian.fromMuSigma(rating.mu, sigmaWithDynamics),
    };
  });

  // prior down
  for (const factor of priorFactors) {
    factor.variable.updateValue(factor, factor.prior);
  }

  type LikelihoodFactor = {
    kind: "likelihood"; rating: Variable; performance: Variable;
  };
  const likelihoodFactors: LikelihoodFactor[] = order.map((_, position) => ({
    kind: "likelihood",
    rating: ratingVariables[position]!,
    performance: performanceVariables[position]!,
  }));

  const betaSquared = parameters.beta * parameters.beta;

  const likelihoodDown = (factor: LikelihoodFactor): void => {
    const message = factor.rating.value.divide(factor.rating.messageOf(factor));
    const a = 1 / (1 + betaSquared * message.pi);
    factor.performance.updateMessage(
      factor,
      new Gaussian(a * message.pi, a * message.tau),
    );
  };
  const likelihoodUp = (factor: LikelihoodFactor): void => {
    const message = factor.performance.value
      .divide(factor.performance.messageOf(factor));
    const a = 1 / (1 + betaSquared * message.pi);
    factor.rating.updateMessage(
      factor,
      new Gaussian(a * message.pi, a * message.tau),
    );
  };
  for (const factor of likelihoodFactors) {
    likelihoodDown(factor);
  }

  // difference factors between adjacent performances: d = p[i] - p[i+1]
  type DifferenceFactor = {
    kind: "difference"; left: Variable; right: Variable; difference: Variable;
  };
  const differenceFactors: DifferenceFactor[] = differenceVariables.map(
    (difference, position) => ({
      kind: "difference",
      left: performanceVariables[position]!,
      right: performanceVariables[position + 1]!,
      difference,
    }),
  );

  const sumUpdate = (
    factor: DifferenceFactor,
    target: Variable,
    coefficients: readonly [number, number],
    sources: readonly Variable[],
  ): number => {
    let piInverse = 0;
    let mu = 0;
    for (const [position, source] of sources.entries()) {
      const message = source.value.divide(source.messageOf(factor));
      const coefficient = coefficients[position]!;
      mu += coefficient * message.mu;
      if (message.pi === 0) {
        piInverse = Number.POSITIVE_INFINITY;
      } else {
        piInverse += (coefficient * coefficient) / message.pi;
      }
    }
    const pi = 1 / piInverse;
    return target.updateMessage(factor, new Gaussian(pi, pi * mu));
  };

  const differenceDown = (factor: DifferenceFactor): number =>
    sumUpdate(factor, factor.difference, [1, -1], [factor.left, factor.right]);
  const differenceLeft = (factor: DifferenceFactor): number =>
    sumUpdate(factor, factor.left, [1, 1], [factor.difference, factor.right]);
  const differenceRight = (factor: DifferenceFactor): number =>
    sumUpdate(factor, factor.right, [-1, 1], [factor.difference, factor.left]);

  type TruncateFactor = { kind: "truncate"; variable: Variable };
  const truncateFactors: TruncateFactor[] = differenceVariables.map(
    (variable) => ({ kind: "truncate", variable }),
  );

  const truncateUp = (factor: TruncateFactor): number => {
    const message = factor.variable.value
      .divide(factor.variable.messageOf(factor));
    const sqrtPi = Math.sqrt(message.pi);
    const t = message.tau / sqrtPi;
    const margin = RATING_REFERENCE_DRAW_MARGIN * sqrtPi;
    const v = vWin(t, margin);
    const w = wWin(t, margin);
    const denominator = 1 - w;
    const pi = message.pi / denominator;
    const tau = (message.tau + sqrtPi * v) / denominator;
    return factor.variable.updateValue(factor, new Gaussian(pi, tau));
  };

  // schedule: exactly the reference implementation's iteration order —
  // forward pass propagates only rightward, backward pass only leftward,
  // at most ten sweeps, then both chain ends push their remaining message.
  const chainLength = differenceFactors.length;
  for (let iteration = 0; iteration < 10; iteration += 1) {
    let delta = 0;
    if (chainLength === 1) {
      differenceDown(differenceFactors[0]!);
      delta = truncateUp(truncateFactors[0]!);
    } else {
      for (let position = 0; position < chainLength - 1; position += 1) {
        const factor = differenceFactors[position]!;
        differenceDown(factor);
        delta = Math.max(delta, truncateUp(truncateFactors[position]!));
        differenceRight(factor);
      }
      for (let position = chainLength - 1; position > 0; position -= 1) {
        const factor = differenceFactors[position]!;
        differenceDown(factor);
        delta = Math.max(delta, truncateUp(truncateFactors[position]!));
        differenceLeft(factor);
      }
    }
    if (delta <= SCHEDULE_MIN_DELTA) {
      break;
    }
  }
  differenceLeft(differenceFactors[0]!);
  differenceRight(differenceFactors[chainLength - 1]!);

  for (const factor of likelihoodFactors) {
    likelihoodUp(factor);
  }

  const results: Rating[] = new Array(size);
  for (const [position, { index }] of order.entries()) {
    const variable = ratingVariables[position]!;
    results[index] = { mu: variable.value.mu, sigma: variable.value.sigma };
  }
  return results;
}
