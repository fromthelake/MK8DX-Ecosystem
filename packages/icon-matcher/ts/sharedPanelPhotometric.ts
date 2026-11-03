// TypeScript counterpart of Python mk8dx_icon_matcher.panel_photometric and Java PanelPhotometric:
// the Select-a-Ghost panel's constant elements (X button, magnifier, white name and total
// time, cream lap times, dark lap discs and lap box) taken from fixed boxes of the registered
// ghost canonical by rank, their median colour fitted per channel to the HDMI colour.
// Pixels are packed RGB, row-major. PANEL_PHOTOMETRY equals
// python/mk8dx_icon_matcher/references/panel-photometry-v1.json (sharedPanelPhotometric.test.mjs).

const MIN_ELEMENTS = 4;
const MIN_SPAN = 40;
const GAIN_MIN = 0.5;
const GAIN_MAX = 4.0;
const MAX_RESIDUAL = 60;
const CLIP = 250;

export type PanelElement = { name: string; box: [number, number, number, number];
  kind: 'bright' | 'dark' | 'yellow'; fraction: number; hdmi: [number, number, number] };
export type PanelPhotometry = { canonical: [number, number]; elements: PanelElement[] };

export const PANEL_PHOTOMETRY: PanelPhotometry = { canonical: [1280, 720], elements: [
  { name: 'x_button_fill', box: [826, 106, 856, 136], kind: 'yellow', fraction: 0.15, hdmi: [213.0, 194.0, 15.0] },
  { name: 'x_button_glyph', box: [830, 113, 853, 133], kind: 'dark', fraction: 0.25, hdmi: [39.0, 32.0, 7.0] },
  { name: 'magnifier', box: [857, 105, 890, 137], kind: 'bright', fraction: 0.12, hdmi: [243.0, 245.0, 245.0] },
  { name: 'name_text', box: [521, 89, 730, 118], kind: 'bright', fraction: 0.12, hdmi: [239.0, 242.0, 243.0] },
  { name: 'total_time', box: [664, 123, 804, 164], kind: 'bright', fraction: 0.12, hdmi: [244.0, 246.0, 246.2] },
  { name: 'lap_times', box: [641, 193, 763, 311], kind: 'bright', fraction: 0.12, hdmi: [253.0, 248.0, 153.0] },
  { name: 'lap_discs', box: [564, 197, 598, 311], kind: 'dark', fraction: 0.08, hdmi: [55.0, 55.0, 58.0] },
  { name: 'lap_box', box: [767, 193, 846, 308], kind: 'dark', fraction: 0.5, hdmi: [64.0, 84.0, 87.0] },
] };

export type PanelMeasured = { status: 'measured'; elements: Record<string, number[] | null> }
  | { status: 'not_canonical' };
export type PanelCorrection = { status: 'corrected'; gain: number[]; offset: number[]; residual: number;
  blueClipped: boolean } | { status: 'not_corrected'; reason: string; residual?: number };
export type PanelPhotometricRecord = PanelCorrection & { schema: 'mk8dx.panel-photometric.v1';
  measured: PanelMeasured };

/** Python round(value, 3) for the reported residual. */
function round3(value: number): number {
  const scaled = value * 1000;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  const rounded = diff > 0.5 ? floor + 1 : diff < 0.5 ? floor : (floor % 2 === 0 ? floor : floor + 1);
  return rounded / 1000;
}

/** Per-channel median; an even count averages the two middle values. */
function median(values: number[][]): number[] {
  return [0, 1, 2].map((c) => {
    const ordered = values.map((v) => v[c]).sort((a, b) => a - b);
    const n = ordered.length;
    return n % 2 ? ordered[(n - 1) / 2] : (ordered[n / 2 - 1] + ordered[n / 2]) / 2;
  });
}

function score(r: number, g: number, b: number, kind: PanelElement['kind']): number {
  if (kind === 'bright') return 0.299 * r + 0.587 * g + 0.114 * b;
  if (kind === 'dark') return -(0.299 * r + 0.587 * g + 0.114 * b);
  return r + g - 2.0 * b;
}

/** Median RGB of the box pixels that rank highest for the element (ties keep row-major order). */
export function elementColour(rgb: Uint8Array | Uint8ClampedArray, width: number, height: number,
  element: PanelElement): number[] | null {
  const [x0, y0, x1, y1] = element.box;
  if (x0 < 0 || y0 < 0 || x1 > width || y1 > height || x1 - x0 < 2 || y1 - y0 < 2) return null;
  const pixels: number[][] = [];
  const scores: number[] = [];
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const at = (y * width + x) * 3;
      pixels.push([rgb[at], rgb[at + 1], rgb[at + 2]]);
      scores.push(score(rgb[at], rgb[at + 1], rgb[at + 2], element.kind));
    }
  }
  const count = Math.max(1, Math.floor(pixels.length * element.fraction));
  const order = pixels.map((_, i) => i).sort((a, b) => (scores[b] - scores[a]) || (a - b)).slice(0, count);
  return median(order.map((i) => pixels[i]));
}

export function fitPanelCorrection(measured: PanelMeasured, photometry: PanelPhotometry): PanelCorrection {
  if (measured.status !== 'measured') return { status: 'not_corrected', reason: measured.status };
  const pairs = photometry.elements.map((e) => [measured.elements[e.name], e.hdmi] as const)
    .filter((pair): pair is readonly [number[], [number, number, number]] => pair[0] != null);
  if (pairs.length < MIN_ELEMENTS) return { status: 'not_corrected', reason: 'too_few_elements' };
  // Plain sequential sums, as in Python, so the three implementations agree to the bit.
  const n = pairs.length;
  const gain: number[] = [];
  const offset: number[] = [];
  let residual = 0;
  for (let c = 0; c < 3; c += 1) {
    const x = pairs.map(([o]) => o[c]);
    const y = pairs.map(([, h]) => h[c]);
    if (Math.max(...x) - Math.min(...x) < MIN_SPAN) return { status: 'not_corrected', reason: 'anchor_span' };
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i += 1) { sx += x[i]; sy += y[i]; }
    const mx = sx / n;
    const my = sy / n;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < n; i += 1) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
    const g = sxy / sxx;
    if (g < GAIN_MIN || g > GAIN_MAX) return { status: 'not_corrected', reason: 'gain_range' };
    const o = my - g * mx;
    let se = 0;
    for (let i = 0; i < n; i += 1) se += (g * x[i] + o - y[i]) ** 2;
    residual = Math.max(residual, Math.sqrt(se / n));
    gain.push(g);
    offset.push(o);
  }
  if (residual > MAX_RESIDUAL) return { status: 'not_corrected', reason: 'fit_residual', residual: round3(residual) };
  return { status: 'corrected', gain, offset, residual: round3(residual),
    blueClipped: Math.max(...pairs.map(([o]) => o[2])) >= CLIP };
}

/** floor(value * gain + offset + 0.5) per channel, clipped to 0..255; a copy, unchanged when not corrected. */
export function applyPanelCorrection(rgb: Uint8Array | Uint8ClampedArray, correction: PanelCorrection): Uint8Array {
  const out = Uint8Array.from(rgb);
  if (correction.status !== 'corrected') return out;
  for (let i = 0; i < out.length; i += 1) {
    const c = i % 3;
    out[i] = Math.min(255, Math.max(0, Math.floor(rgb[i] * correction.gain[c] + correction.offset[c] + 0.5)));
  }
  return out;
}

export function correctPanel(rgb: Uint8Array | Uint8ClampedArray, width: number, height: number,
  photometry: PanelPhotometry = PANEL_PHOTOMETRY): { rgb: Uint8Array; record: PanelPhotometricRecord } {
  let measured: PanelMeasured;
  let correction: PanelCorrection;
  if (width !== photometry.canonical[0] || height !== photometry.canonical[1] || rgb.length !== width * height * 3) {
    measured = { status: 'not_canonical' };
    correction = { status: 'not_corrected', reason: 'not_canonical' };
  } else {
    const elements: Record<string, number[] | null> = {};
    for (const element of photometry.elements) elements[element.name] = elementColour(rgb, width, height, element);
    measured = { status: 'measured', elements };
    correction = fitPanelCorrection(measured, photometry);
  }
  const record = { schema: 'mk8dx.panel-photometric.v1', ...correction, measured } as PanelPhotometricRecord;
  return { rgb: applyPanelCorrection(rgb, correction), record };
}
