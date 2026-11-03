/** Result-flag evidence for the easily confused NL/LU/PY tricolours.
 *
 * The two stripe regions and pairwise difference masks come from the pinned
 * result-profile references. This is opt-in QA evidence, never a country label.
 * The ordinary 110-flag rank and its crop remain available separately.
 */
import type { IconTensorGroup } from './sharedIconScorer';
import type { ShapeRank } from './sharedShapeRank';

const NL = 'country.nl';
const LU = 'country.lu';
const PY = 'country.py';

export interface FlagTricolorEvidence {
  schema: 'mk8dx.flag-tricolor-evidence.v1';
  status: 'measured' | 'unavailable';
  reason: string;
  acceptedId: string | null;
  stripeContrast: number | null;
  stripeBoundary: number | null;
  pairAdvantages: { id: string; advantage: number; referenceSeparation: number }[];
  /** A first choice only; never an automatic acceptance. */
  proposalId?: 'country.lu';
  proposalShapeScore?: number;
}

const median = (values: number[]): number => {
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
};

export function flagTricolorEvidence(query: Float32Array, group: IconTensorGroup,
  rawTopIds: string[], distinctiveTopId: string,
  shapeRank?: ShapeRank): FlagTricolorEvidence {
  const unavailable = (reason: string): FlagTricolorEvidence => ({
    schema: 'mk8dx.flag-tricolor-evidence.v1', status: 'unavailable', reason,
    acceptedId: null, stripeContrast: null, stripeBoundary: null, pairAdvantages: [],
  });
  const { width, height } = group;
  const channels = width * height * 3;
  if (width !== 55 || height !== 38 || query.length !== channels
      || group.rgb.length !== channels * group.ids.length || group.ids.length !== 110
      || rawTopIds.length < 3 || new Set(rawTopIds).size !== rawTopIds.length) {
    throw new Error('Expected one result-profile crop and 110 flag references');
  }
  if (rawTopIds[0] !== NL) return unavailable('different_first_flag');
  if (distinctiveTopId !== NL) return unavailable('distinctive_disagreement');
  const index = new Map(group.ids.map((id, position) => [id, position]));
  if (![NL, LU, PY, ...rawTopIds].every((id) => index.has(id))) {
    throw new Error('Missing result flag reference');
  }
  const ref = (id: string): Float32Array => group.rgb.subarray(index.get(id)! * channels,
    (index.get(id)! + 1) * channels);
  const sample = (rgb: Float32Array, y0: number, y1: number,
    channel: number): number => {
    const values: number[] = [];
    for (let y = y0; y < y1; y++) for (let x = 12; x < 43; x++) {
      values.push(rgb[(y * width + x) * 3 + channel]);
    }
    return median(values);
  };
  // The red stripe can sit higher in an aligned camera crop and blue-channel
  // gain can make the NL blue band brighter than the red one. Relative green
  // in the blue band separates the dark NL blue from LU's light blue while
  // the centre white band supplies a per-frame exposure reference.
  const stripe = (rgb: Float32Array): number => 1 - sample(rgb, 25, 30, 1)
    / Math.max(.1, sample(rgb, 16, 22, 1));
  const nlStripe = stripe(ref(NL));
  const luStripe = stripe(ref(LU));
  if (!(luStripe < nlStripe)) return unavailable('incompatible_reference_stripes');
  const stripeBoundary = (nlStripe + luStripe) / 2;
  const stripeContrast = stripe(query);
  const white = (rgb: Float32Array): number[] => [0, 1, 2]
    .map((channel) => sample(rgb, 16, 22, channel));
  const queryWhite = white(query);
  const nl = ref(NL);
  const nlWhite = white(nl);
  const pairAdvantages: FlagTricolorEvidence['pairAdvantages'] = [];
  for (const id of new Set([...rawTopIds.slice(1), PY])) {
    if (id === LU || id === NL) continue; // NL/LU is checked by stripe order.
    const other = ref(id);
    const otherWhite = white(other);
    const different = new Uint8Array(width * height);
    for (let y = 4; y < 34; y++) for (let x = 8; x < 47; x++) {
      const at = (y * width + x) * 3;
      different[y * width + x] = Math.max(...[0, 1, 2]
        .map((channel) => Math.abs(nl[at + channel] - other[at + channel]))) > .055 ? 1 : 0;
    }
    let advantage = 0;
    let separation = 0;
    let pixels = 0;
    for (let y = 5; y < 33; y++) for (let x = 9; x < 46; x++) {
      let eroded = true;
      for (let dy = -1; dy <= 1 && eroded; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!different[(y + dy) * width + x + dx]) { eroded = false; break; }
      }
      if (!eroded) continue;
      const at = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel++) {
        const q = Math.min(1.2, query[at + channel] / Math.max(.1, queryWhite[channel]));
        const a = Math.min(1.2, nl[at + channel] / Math.max(.1, nlWhite[channel]));
        const b = Math.min(1.2, other[at + channel] / Math.max(.1, otherWhite[channel]));
        advantage += Math.abs(q - b) - Math.abs(q - a);
        separation += Math.abs(a - b);
      }
      pixels++;
    }
    if (pixels < 20) return unavailable('insufficient_distinctive_pixels');
    pairAdvantages.push({ id, advantage: advantage / (pixels * 3),
      referenceSeparation: separation / (pixels * 3) });
  }
  const supported = stripeContrast > stripeBoundary
    && pairAdvantages.length > 0
    && pairAdvantages.every((item) => item.advantage > .2 * item.referenceSeparation);
  // Require two independent, same-crop indications before replacing an
  // uncertain NL first choice. The LU-side quarter of the clean-asset stripe
  // interval is deliberately stricter than merely crossing the midpoint.
  const luPattern = !supported && stripeContrast <= luStripe + (nlStripe - luStripe) / 4
    && shapeRank?.mode === 'full_rgb_ncc' && shapeRank.top[0]?.id === LU
    && Number.isFinite(shapeRank.top[0].score) && shapeRank.top[0].score > 0;
  return { schema: 'mk8dx.flag-tricolor-evidence.v1', status: 'measured',
    reason: supported ? 'reference_stripes_and_pairwise_agree'
      : luPattern ? 'lu_pattern_and_stripe_agree' : 'insufficient_separation',
    acceptedId: supported ? NL : null, stripeContrast, stripeBoundary,
    pairAdvantages,
    ...(luPattern ? { proposalId: LU, proposalShapeScore: shapeRank.top[0].score } : {}) };
}
