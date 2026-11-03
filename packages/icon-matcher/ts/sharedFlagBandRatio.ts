/** NL/LU decision from the tone of the blue band relative to the red band.
 *
 * NL and LU share the red band (assets 194,57,55 and 200,59,45); only the blue
 * differs (4,89,164 against 55,148,213). The green of the blue band over the
 * red band's red is a self-calibrating tone: assets 0.46 / 0.74, measured
 * 2026-10-23 NL 0.27-0.58 on 300+ photo and HDMI crops, LU 0.73-0.77.
 * Python counterpart: flag_rank.flag_band_ratio.
 */
export const BAND_RATIO_NL_MAX = 0.62;
export const BAND_RATIO_LU_MIN = 0.68;
export const BAND_RATIO_MIN_PIXELS = 15;

export interface FlagBandRatio {
  schema: 'mk8dx.flag-band-ratio.v1';
  status: 'measured' | 'unavailable';
  reason: 'nl_tone' | 'lu_tone' | 'between' | 'bands_not_found';
  redPixels: number;
  bluePixels: number;
  nlMax: number;
  luMin: number;
  ratio: number | null;
  decisionId: 'country.nl' | 'country.lu' | null;
}

const median = (values: number[]): number => {
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
};

/** `query` is normalized RGB in 0..1, row-major with three channels per pixel. */
export function flagBandRatio(query: Float32Array): FlagBandRatio {
  if (query.length === 0 || query.length % 3 !== 0) throw new Error('Expected normalized RGB');
  const redR: number[] = [];
  const blueG: number[] = [];
  for (let i = 0; i < query.length; i += 3) {
    const r = query[i], g = query[i + 1], b = query[i + 2];
    const top = Math.max(r, g, b), delta = top - Math.min(r, g, b);
    if (!(delta > 0)) continue;
    const sat = top > 0 ? delta / top : 0;
    let hue: number;
    if (top === r) hue = (((60 * (g - b)) / delta) % 360 + 360) % 360;
    else if (top === g) hue = (60 * (b - r)) / delta + 120;
    else hue = (60 * (r - g)) / delta + 240;
    if ((hue <= 16 || hue >= 340) && sat >= 0.35 && top >= 0.24) redR.push(r);
    if (hue >= 190 && hue <= 250 && sat >= 0.35 && top >= 0.16) blueG.push(g);
  }
  const base = { schema: 'mk8dx.flag-band-ratio.v1' as const, redPixels: redR.length, bluePixels: blueG.length,
    nlMax: BAND_RATIO_NL_MAX, luMin: BAND_RATIO_LU_MIN };
  if (redR.length < BAND_RATIO_MIN_PIXELS || blueG.length < BAND_RATIO_MIN_PIXELS) {
    return { ...base, status: 'unavailable', reason: 'bands_not_found', ratio: null, decisionId: null };
  }
  const ratio = median(blueG) / Math.max(median(redR), 0.05);
  const decisionId = ratio <= BAND_RATIO_NL_MAX ? 'country.nl' : ratio >= BAND_RATIO_LU_MIN ? 'country.lu' : null;
  return { ...base, status: 'measured', reason: decisionId === 'country.nl' ? 'nl_tone' : decisionId ? 'lu_tone' : 'between',
    ratio, decisionId };
}
