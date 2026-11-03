// Is an owner's result card at one of the fixed slots? Evidence from lap circles 1, 2, 3.
// TypeScript counterpart of Python mk8dx_icon_matcher.card_presence and Java
// CardPresence; the same anchors file (mk8dx.card-anchors.v1) and arithmetic,
// checked against shared vectors. The screen is the 1280x720 result grid (HDMI
// as captured, or a photo registered onto it), packed RGB, row-major.

export type CardAnchorsDocument = {
  schema: 'mk8dx.card-anchors.v1';
  x: number; size: number; search: number; threshold: number;
  pitch: Record<string, number>;
  slots: Record<string, Record<string, number>>;
  offsets: number[];
  templates: Record<string, string[]>;
};

export type CardAnchors = {
  x: number; size: number; search: number; threshold: number;
  pitch: Record<number, number>;
  slots: Record<number, [string, number][]>;
  offsets: number[];
  templates: Record<string, Float64Array[]>;
  rawTemplates: Record<string, Uint8Array[]>;
  sha256: string | null;
};

export type CardPosition = { slot: string; offset: number; y: number; circleY: number;
  scores: number[]; weakest: number };

export type CardPresence = {
  schema: 'mk8dx.card-presence.v1'; owner: string; lapCount: 3 | 7; present: boolean;
  slot: string | null; y: number | null; circleY: number | null; best: CardPosition | null;
  threshold: number; anchorsSha256: string | null;
};

function decodeBase64(text: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  return Uint8Array.from((globalThis as { Buffer?: { from(s: string, e: string): Uint8Array } })
    .Buffer!.from(text, 'base64'));
}

function unit(values: Uint8Array): Float64Array {
  let mean = 0;
  for (const value of values) mean += value;
  mean /= values.length;
  const out = new Float64Array(values.length);
  let norm = 0;
  for (let i = 0; i < values.length; i += 1) {
    out[i] = values[i] - mean;
    norm += out[i] * out[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < out.length; i += 1) out[i] /= norm;
  return out;
}

export function parseCardAnchors(document: CardAnchorsDocument, sha256: string | null = null): CardAnchors {
  if (document?.schema !== 'mk8dx.card-anchors.v1') throw new Error('Expected a mk8dx.card-anchors.v1 document');
  const templates: Record<string, Float64Array[]> = {};
  const rawTemplates: Record<string, Uint8Array[]> = {};
  for (const [owner, circles] of Object.entries(document.templates)) {
    rawTemplates[owner] = circles.map((circle) => decodeBase64(circle));
    templates[owner] = rawTemplates[owner].map((raw) => unit(raw));
  }
  const slots: Record<number, [string, number][]> = {};
  for (const [laps, bySlot] of Object.entries(document.slots)) slots[Number(laps)] = Object.entries(bySlot);
  const pitch: Record<number, number> = {};
  for (const [laps, value] of Object.entries(document.pitch)) pitch[Number(laps)] = value;
  return { x: document.x, size: document.size, search: document.search, threshold: document.threshold,
    pitch, slots, offsets: [...document.offsets], templates, rawTemplates, sha256 };
}

/** [score, dx, dy] of the best patch; the first maximum in dy-then-dx order wins. */
export function circleMatch(rgb: Uint8Array | Uint8ClampedArray, width: number, height: number,
  template: Float64Array, x: number, y: number, size: number, search: number): [number, number, number] {
  let best = -1; let bestDx = 0; let bestDy = 0;
  const n = size * size * 3;
  const patch = new Float64Array(n);
  for (let dy = -search; dy <= search; dy += 1) {
    for (let dx = -search; dx <= search; dx += 1) {
      const px = x + dx; const py = y + dy;
      if (px < 0 || py < 0 || px + size > width || py + size > height) continue;
      let mean = 0; let k = 0;
      for (let row = 0; row < size; row += 1) {
        const base = ((py + row) * width + px) * 3;
        for (let i = 0; i < size * 3; i += 1) {
          patch[k] = rgb[base + i];
          mean += patch[k];
          k += 1;
        }
      }
      mean /= n;
      let dot = 0; let norm = 0;
      for (let i = 0; i < n; i += 1) {
        const value = patch[i] - mean;
        dot += template[i] * value;
        norm += value * value;
      }
      norm = Math.sqrt(norm);
      if (norm < 1e-6) continue;
      const score = dot / norm;
      if (score > best) { best = score; bestDx = dx; bestDy = dy; }
    }
  }
  return [best, bestDx, bestDy];
}

export function cardPresence(rgb: Uint8Array | Uint8ClampedArray, width: number, height: number,
  anchors: CardAnchors, owner: string, lapCount: number, excludeSlot: string | null = null): CardPresence {
  if (rgb.length !== width * height * 3) throw new Error('Expected packed RGB pixels');
  const laps = lapCount === 7 ? 7 : 3;
  const templates = anchors.templates[owner];
  let best: CardPosition | null = null;
  for (const [slot, base] of anchors.slots[laps]) {
    if (slot === excludeSlot) continue;
    for (const offset of anchors.offsets) {
      const y = base + offset;
      const matches = templates.map((template, k) => circleMatch(rgb, width, height, template, anchors.x,
        y + k * anchors.pitch[laps], anchors.size, anchors.search));
      const scores = matches.map((match) => match[0]);
      const position = { slot, offset, y, circleY: y + matches[0][2], scores, weakest: Math.min(...scores) };
      if (best === null || position.weakest > best.weakest) best = position;
    }
  }
  const present = best !== null && best.weakest >= anchors.threshold;
  return { schema: 'mk8dx.card-presence.v1', owner, lapCount: laps, present,
    slot: present ? best!.slot : null, y: present ? best!.y : null, circleY: present ? best!.circleY : null,
    best, threshold: anchors.threshold, anchorsSha256: anchors.sha256 };
}

// ---------------------------------------------------------------------------
// Bring a photographed result card back to HDMI exposure and colour, from the card itself.
// TypeScript counterpart of Python mk8dx_icon_matcher.photometric and Java Photometric:
// lap circles 1-3 found from the character slot, median disc and digit colour through
// masks derived from the circle templates, per-channel line to the HDMI anchors.
// Pixels are packed RGB, row-major.

const DISC_LUMA_MAX = 80;
const DIGIT_LUMA_MIN = 200;
const DISC_RADIUS = 12;
const DIGIT_RADIUS = 10;
const SEARCH = 6;
const MIN_SPAN = 40;
const GAIN_MIN = 0.5;
const GAIN_MAX = 3.0;
const CLIP = 250;

export type CardPhotometryDocument = { schema: 'mk8dx.card-photometry.v1';
  layouts: Record<string, { fromCharacter: number[]; pitch: number; disc: number[]; digit: number[] }> };
export type CardPhotometry = { layouts: Record<number, { fromCharacter: [number, number]; pitch: number;
  disc: number[]; digit: number[] }>; sha256: string | null };

export type Measured = { status: 'measured'; circles: [number, number, number][]; disc: number[]; digit: number[] }
  | { status: 'circles_not_found'; circleScores: number[] };
export type Correction = { status: 'corrected'; gain: number[]; offset: number[]; blueClipped: boolean }
  | { status: 'not_corrected'; reason: string };
export type PhotometricRecord = Correction & { schema: 'mk8dx.card-photometric.v1';
  source: 'own_card' | 'other_card'; measured: Measured; photometrySha256: string | null };

export function parseCardPhotometry(document: CardPhotometryDocument, sha256: string | null = null): CardPhotometry {
  if (document?.schema !== 'mk8dx.card-photometry.v1') throw new Error('Expected a mk8dx.card-photometry.v1 document');
  const layouts: CardPhotometry['layouts'] = {};
  for (const [laps, layout] of Object.entries(document.layouts)) {
    layouts[Number(laps)] = { fromCharacter: [Number(layout.fromCharacter[0]), Number(layout.fromCharacter[1])],
      pitch: Number(layout.pitch), disc: layout.disc.map(Number), digit: layout.digit.map(Number) };
  }
  return { layouts, sha256 };
}

/** Python round(): halves go to the even neighbour. */
function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

function masks(anchors: CardAnchors, owner: string): [Uint8Array, Uint8Array][] {
  const size = anchors.size;
  const centre = (size - 1) / 2;
  return anchors.rawTemplates[owner].map((raw) => {
    const disc = new Uint8Array(size * size);
    const digit = new Uint8Array(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = y * size + x;
        const luma = 0.299 * raw[i * 3] + 0.587 * raw[i * 3 + 1] + 0.114 * raw[i * 3 + 2];
        const radius = Math.sqrt((x - centre) ** 2 + (y - centre) ** 2);
        disc[i] = luma < DISC_LUMA_MAX && radius <= DISC_RADIUS ? 1 : 0;
        digit[i] = luma > DIGIT_LUMA_MIN && radius <= DIGIT_RADIUS ? 1 : 0;
      }
    }
    return [disc, digit] as [Uint8Array, Uint8Array];
  });
}

/** Per-channel median; an even count averages the two middle values. */
function median(values: number[][]): number[] {
  return [0, 1, 2].map((c) => {
    const ordered = values.map((v) => v[c]).sort((a, b) => a - b);
    const n = ordered.length;
    return n % 2 ? ordered[(n - 1) / 2] : (ordered[n / 2 - 1] + ordered[n / 2]) / 2;
  });
}

export function measureAnchors(rgb: Uint8Array | Uint8ClampedArray, width: number, height: number,
  characterXy: [number, number], laps: number, owner: string, anchors: CardAnchors,
  photometry: CardPhotometry): Measured {
  const layout = photometry.layouts[laps === 7 ? 7 : 3];
  const [fx, fy] = layout.fromCharacter;
  const templates = anchors.templates[owner];
  const mask = masks(anchors, owner);
  const size = anchors.size;
  const disc: number[][] = [];
  const digit: number[][] = [];
  const circles: [number, number, number][] = [];
  for (let k = 0; k < templates.length; k += 1) {
    // circle 1 from the character slot; each next one from where the previous
    // was found, so a slightly scaled registration does not accumulate
    const x = k === 0 ? roundHalfEven(characterXy[0] + fx) : circles[k - 1][0];
    const y = k === 0 ? roundHalfEven(characterXy[1] + fy) : circles[k - 1][1] + layout.pitch;
    const [score, dx, dy] = circleMatch(rgb, width, height, templates[k], x, y, size, SEARCH);
    const left = x + dx;
    const top = y + dy;
    if (score < 0.5 || left < 0 || top < 0 || left + size > width || top + size > height) {
      return { status: 'circles_not_found', circleScores: [Math.round(score * 1000) / 1000] };
    }
    circles.push([left, top, Math.round(score * 1000) / 1000]);
    for (let yy = 0; yy < size; yy += 1) {
      for (let xx = 0; xx < size; xx += 1) {
        const i = yy * size + xx;
        const at = ((top + yy) * width + left + xx) * 3;
        if (mask[k][0][i]) disc.push([rgb[at], rgb[at + 1], rgb[at + 2]]);
        if (mask[k][1][i]) digit.push([rgb[at], rgb[at + 1], rgb[at + 2]]);
      }
    }
  }
  return { status: 'measured', circles, disc: median(disc), digit: median(digit) };
}

export function fitCorrection(measured: Measured, laps: number, photometry: CardPhotometry): Correction {
  if (measured.status !== 'measured') return { status: 'not_corrected', reason: measured.status };
  const layout = photometry.layouts[laps === 7 ? 7 : 3];
  const gain: number[] = [];
  const offset: number[] = [];
  for (let c = 0; c < 3; c += 1) {
    const span = measured.digit[c] - measured.disc[c];
    if (span < MIN_SPAN) return { status: 'not_corrected', reason: 'anchor_span' };
    const g = (layout.digit[c] - layout.disc[c]) / span;
    if (g < GAIN_MIN || g > GAIN_MAX) return { status: 'not_corrected', reason: 'gain_range' };
    gain.push(g);
    offset.push(layout.disc[c] - g * measured.disc[c]);
  }
  return { status: 'corrected', gain, offset, blueClipped: measured.digit[2] >= CLIP };
}

/** round(value * gain + offset) per channel, clipped to 0..255; a copy, unchanged when not corrected. */
export function applyCorrection(rgb: Uint8Array | Uint8ClampedArray, correction: Correction): Uint8Array {
  const out = Uint8Array.from(rgb);
  if (correction.status !== 'corrected') return out;
  for (let i = 0; i < out.length; i += 1) {
    const c = i % 3;
    out[i] = Math.min(255, Math.max(0, Math.floor(rgb[i] * correction.gain[c] + correction.offset[c] + 0.5)));
  }
  return out;
}

export function correctCard(rgb: Uint8Array | Uint8ClampedArray, width: number, height: number,
  characterXy: [number, number], laps: number, owner: string, anchors: CardAnchors, photometry: CardPhotometry,
  otherCard: PhotometricRecord | null = null): { rgb: Uint8Array; record: PhotometricRecord } {
  const measured = measureAnchors(rgb, width, height, characterXy, laps, owner, anchors, photometry);
  let correction = fitCorrection(measured, laps, photometry);
  let source: 'own_card' | 'other_card' = 'own_card';
  if (correction.status !== 'corrected' && otherCard?.status === 'corrected' && otherCard.source === 'own_card') {
    correction = { status: 'corrected', gain: otherCard.gain, offset: otherCard.offset, blueClipped: otherCard.blueClipped };
    source = 'other_card';
  }
  const record = { schema: 'mk8dx.card-photometric.v1', ...correction, source, measured,
    photometrySha256: photometry.sha256 } as PhotometricRecord;
  return { rgb: applyCorrection(rgb, correction), record };
}
