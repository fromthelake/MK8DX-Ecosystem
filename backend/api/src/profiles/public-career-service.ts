// Public Player career read model: Time Trial career facts plus the
// rating trajectory, derived on demand from canonical tables. Mu/Sigma
// never leave the backend; only the derived conservative score does.

export type CareerTimeTrials = Readonly<{
  published: number;
  published150: number;
  published200: number;
  tracks150: number;
  tracks200: number;
  firsts: number;
  firsts150: number;
  firsts200: number;
  podiums: number;
  podiums150: number;
  podiums200: number;
  mostPlayed?: Readonly<{
    trackId: string; count: number; count150: number; count200: number;
  }>;
  latestResultAtMs?: number;
}>;

export type CareerRatingEvent = Readonly<{
  sequence: number;
  eventType: "seed" | "race";
  occurredAtMs: number;
  score: number;
  delta?: number;
}>;

export type CareerRating = Readonly<{
  score: number;
  rank: number;
  peakScore: number;
  history: readonly CareerRatingEvent[];
}>;

export type PublicPlayerCareer = Readonly<{
  playerId: string;
  timeTrials: CareerTimeTrials;
  rating?: CareerRating;
}>;

export class PublicCareerError extends Error {
  public constructor(
    public readonly code: "invalid_input" | "not_found" | "unavailable",
  ) {
    super("The public Player career could not be loaded.");
    this.name = "PublicCareerError";
  }
}

export interface PublicCareerRepository {
  loadCareer(playerId: string): Promise<PublicPlayerCareer | null>;
}

const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export class PublicCareerService {
  public constructor(private readonly repository: PublicCareerRepository) {}

  public async loadCareer(playerId: string): Promise<PublicPlayerCareer> {
    if (!playerIdPattern.test(playerId) || playerId.length > 135) {
      throw new PublicCareerError("invalid_input");
    }
    let career: PublicPlayerCareer | null;
    try {
      career = await this.repository.loadCareer(playerId);
    } catch {
      throw new PublicCareerError("unavailable");
    }
    if (career === null) {
      throw new PublicCareerError("not_found");
    }
    return career;
  }
}
