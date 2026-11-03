// Port van TextEvidence (tekst-tweede-bewijs + naamstrip met case-correctie).
// APK: ML Kit (Latijns + ja/zh/ko gebundeld). Browser: geen ML Kit — de
// OCR-engine is vervangen door Tesseract.js (WASM, lokaal, offline via
// public/tessdata). ALLE logica erachter (regio's, 2x-upscale, vocab-fuzzy,
// drempels 0.85/0.08, case-correctie op inkt-hoogte, ster-IoU, symbol-merge)
// is 1:1 overgenomen; alleen de engine die tekst+boxen levert verschilt.
// Dat is de bewuste, gedocumenteerde pariteitsafwijking (zie rapport).
import { cv } from './cv';
import { matchName, nameSimilarity, normalizeName, scriptForLocale as sharedScriptForLocale } from '../../../../packages/icon-matcher/ts/sharedNameMatch';

export const FUZZY_MIN = 0.85;
export const MARGIN_MIN = 0.08;
// zh_tw (traditional Chinese) and ru (Cyrillic) are Web additions: the browser has
// Tesseract data for them, ML Kit on Android has no Cyrillic recognizer.
export const SCRIPTS = ['latin', 'ja', 'zh', 'ko', 'zh_tw', 'ru'] as const;
export type Script = (typeof SCRIPTS)[number];

/** The reader that prints a game locale's names; null for an unknown locale (central sharedNameMatch). */
export function scriptForLocale(locale: string | null): Script | null {
  return sharedScriptForLocale(locale) as Script | null;
}

/** Herkenner-interface (ML Kit Text-equivalent): regels -> elementen (woorden) met box. */
export interface OcrElement {
  text: string;
  /** bbox in pixels van het aangeboden beeld: [left, top, right, bottom] */
  box: [number, number, number, number] | null;
}

export interface OcrLine {
  text: string;
  elements: OcrElement[];
}

export interface OcrResult {
  text: string;
  lines: OcrLine[];
}

export interface TextRecognizer {
  /** Beschikbare scripts (latin altijd; ja/zh/ko alleen als de taaldata lokaal staat). */
  available(script: Script): boolean;
  /** Scripts die voor de rijtekst-taalkeuze mogen meedoen. */
  availableForRows(script: Script): boolean;
  recognize(rgba: Uint8ClampedArray, width: number, height: number, script: Script, variant?: string): Promise<OcrResult | null>;
  /** Voorbewerkingsvarianten die voor rijtekst met woordenlijst geprobeerd mogen worden (in volgorde). */
  rowVariants?(): string[];
}

/** Engine-adapter (gedocumenteerde OCR-normalisatie): ML Kit leest een rij in één
 *  keer; Tesseract krijgt dezelfde crop in meerdere renderingen en de rendering
 *  met de beste woordenlijst-fit wint. Stoppen zodra de fit >= FUZZY_MIN (0.85)
 *  is — dezelfde grens die de beslislogica hanteert. */
const OCR_VARIANT_STOP = 0.85;

const CASE_AMBIGUOUS = 'ckosuvwxz';
const TALL_REF = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789bdfhlt';
const CASE_RATIO_MAX_LOWER = 0.90;
const STAR_IOU_MIN = 0.60;
const NARROW_CHARS = "iljI1!.,'";
const WIDE_CHARS = 'mwMW';

function charWeight(c: string): number {
  if (NARROW_CHARS.includes(c)) return 0.5;
  if (WIDE_CHARS.includes(c)) return 1.25;
  return 1.0;
}

function isLetter(ch: string): boolean {
  return /\p{L}/u.test(ch);
}

function isLetterOrDigit(ch: string): boolean {
  return /[\p{L}\p{Nd}]/u.test(ch);
}

function isWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}

export class VocabMatch {
  id: string | null = null;
  name = '';
  fuzzy = 0.0;
  margin = 0.0;

  strong(): boolean {
    if (this.id === null) return false;
    return (this.fuzzy >= FUZZY_MIN && this.margin >= MARGIN_MIN) || (this.fuzzy >= 0.78 && this.margin >= 0.25);
  }
}

export interface OcrCropDebug {
  label: string;
  script: string;
  text: string;
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

export class TextEvidence {
  lastNameDebug = '';
  private lastRatioDebug = '';
  /** debug: laatste naamstrip-crop als RGBA (voor de verificatieweergave) */
  lastNameStrip: { rgba: Uint8ClampedArray; width: number; height: number } | null = null;
  /** diagnostiek: alle OCR-crops + ruwe tekst van het laatste frame (parity-analyse) */
  captureCrops = false;
  /** Select-a-Ghost panel rows: also try the 'textcolour' variant (yellow names; result cards print white). */
  panelTextColour = false;
  crops: OcrCropDebug[] = [];
  private cropLabel = '';

  constructor(private readonly recognizer: TextRecognizer | null) {}

  /** label voor de volgende OCR-aanroepen (owner/rij), alleen diagnostiek */
  setCropLabel(label: string): void {
    this.cropLabel = label;
  }

  get enabled(): boolean {
    return this.recognizer !== null;
  }

  scriptAvailable(script: Script): boolean {
    return this.recognizer ? this.recognizer.availableForRows(script) : false;
  }

  /** OCR van één rij-crop (BGR-canoniek) naar platte tekst; "" bij falen. */
  async ocrRegion(canonicalBgr: any, x: number, y: number, w: number, h: number, script: Script = 'latin', vocab: Record<string, string> | null = null): Promise<string> {
    if (!this.recognizer) return '';
    try {
      const scaled = regionScaled(canonicalBgr, x, y, w, h);
      if (!scaled) return '';
      const img = bgrToRgba(scaled);
      scaled.delete();
      const variants = (vocab && this.recognizer.rowVariants ? this.recognizer.rowVariants() : [])
        .filter((variant) => this.panelTextColour || variant !== 'textcolour');
      let text = '';
      let bestFuzzy = -1;
      let variantUsed = '';
      const tried: string[] = [];
      if (variants.length > 1) {
        for (const variant of variants) {
          const result = await this.recognizer.recognize(img.rgba, img.width, img.height, script, variant);
          const t = result ? result.text.replace(/\n/g, ' ').trim() : '';
          const fuzzy = matchVocab(t, vocab).fuzzy;
          if (this.captureCrops) tried.push(`${variant}='${t}' ${fuzzy.toFixed(2)}`);
          if (fuzzy > bestFuzzy) {
            bestFuzzy = fuzzy;
            text = t;
            variantUsed = variant;
          }
          if (fuzzy >= OCR_VARIANT_STOP) break;
        }
      } else {
        const result = await this.recognizer.recognize(img.rgba, img.width, img.height, script);
        text = result ? result.text.replace(/\n/g, ' ').trim() : '';
      }
      if (this.captureCrops) this.crops.push({ label: this.cropLabel, script, text: variantUsed ? `${text} [${variantUsed}] | ${tried.join(' | ')}` : text, rgba: img.rgba, width: img.width, height: img.height });
      return text;
    } catch {
      return '';
    }
  }

  /** Naamstrip-OCR met case-correctie op glyph-hoogte (pixels, niet OCR-boxen). */
  async ocrNameCaseAware(canonicalBgr: any, x: number, y: number, w: number, h: number, script: Script): Promise<string> {
    this.lastNameDebug = '';
    if (!this.recognizer) return '';
    const c = cv();
    let scaled: any = null;
    let ink: any = null;
    try {
      scaled = regionScaled(canonicalBgr, x, y, w, h);
      if (!scaled) return '';
      const img = bgrToRgba(scaled);
      this.lastNameStrip = img;
      const result = await this.recognizer.recognize(img.rgba, img.width, img.height, script);
      let jaText = '';
      if (script === 'latin' && this.recognizer.available('ja')) {
        try {
          const jaResult = await this.recognizer.recognize(img.rgba, img.width, img.height, 'ja');
          jaText = jaResult ? jaResult.text.replace(/\n/g, ' ').trim() : '';
        } catch {
          jaText = '';
        }
      }
      if (!result) return '';
      const plain = result.text.replace(/\n/g, ' ').trim();
      if (this.captureCrops) this.crops.push({ label: `${this.cropLabel}/name`, script, text: `${plain} | ja='${jaText}'`, rgba: img.rgba, width: img.width, height: img.height });
      const probePrefix = jaText.length === 0 ? '' : `ja='${jaText}' `;
      if (script !== 'latin' || plain.length === 0) return plain;
      let bestLine: OcrLine | null = null;
      let bestLetters = -1;
      for (const line of result.lines) {
        let letters = 0;
        for (const ch of line.text) if (isLetter(ch)) letters++;
        if (letters > bestLetters) {
          bestLetters = letters;
          bestLine = line;
        }
      }
      if (!bestLine) return plain;
      ink = inkMask(scaled);
      const corrected = this.caseCorrectLine(bestLine, ink);
      if (corrected.length === 0) {
        const merged = mergeSymbolEvidence(plain, jaText);
        this.lastNameDebug = `${probePrefix}raw='${plain}' -> '${merged}' (geen kaphoogte-referentie)`;
        return merged;
      }
      const merged = mergeSymbolEvidence(corrected, jaText);
      this.lastNameDebug = `${probePrefix}raw='${bestLine.text}' -> '${merged}'${this.lastRatioDebug}`;
      return merged;
    } catch {
      return '';
    } finally {
      if (scaled) scaled.delete();
      if (ink) ink.delete();
    }
  }

  private caseCorrectLine(line: OcrLine, ink: any): string {
    const texts: string[] = [];
    const cellStats: (CellStats | null)[] = [];
    const tall: number[] = [];
    for (const element of line.elements) {
      const text = element.text;
      const stats = element.box === null || text.length === 0 ? null : measureCells(ink, element.box, text);
      texts.push(text);
      cellStats.push(stats);
      if (stats) {
        for (let i = 0; i < text.length; i++) {
          if (stats.heights[i] > 0 && stats.starIou[i] < STAR_IOU_MIN && TALL_REF.includes(text.charAt(i))) {
            tall.push(stats.heights[i]);
          }
        }
      }
    }
    if (tall.length < 2) return '';
    tall.sort((a, b) => a - b);
    const capHeight = tall[Math.trunc(tall.length / 2)];
    if (capHeight < 8) return '';
    let out = '';
    let ratios = '';
    for (let e = 0; e < texts.length; e++) {
      if (e > 0) out += ' ';
      const text = texts[e];
      const stats = cellStats[e];
      for (let i = 0; i < text.length; i++) {
        const ch = text.charAt(i);
        const ih = stats ? stats.heights[i] : -1;
        const star = stats ? stats.starIou[i] : 0.0;
        if (ih > 0 && star >= STAR_IOU_MIN && ih >= 0.95 * capHeight) {
          ratios += ` ${ch}=star${star.toFixed(2)}->★`;
          out += '★';
        } else if (ih > 0 && CASE_AMBIGUOUS.includes(ch.toLowerCase())) {
          const ratio = ih / capHeight;
          const corrected = ratio < CASE_RATIO_MAX_LOWER ? ch.toLowerCase() : ch.toUpperCase();
          ratios += ` ${ch}=${ratio.toFixed(2)}->${corrected}`;
          out += corrected;
        } else {
          out += ch;
        }
      }
    }
    this.lastRatioDebug = ratios.length === 0 ? '' : ` | capH=${Math.trunc(capHeight)} ratios:${ratios}`;
    return out.trim();
  }
}

interface CellStats {
  heights: number[];
  starIou: number[];
}

// Engine-adapter-framing voor Tesseract (gedocumenteerde afwijking van de
// ML Kit-route): de APK-regio begint 6 px na het icoon, waardoor de eerste
// glyph de linkerrand raakt/afsnijdt. ML Kit leest dat nog ("BAwSer"),
// Tesseract niet ("3AwSer", "Fornado", "dout"). Daarom krijgt de OCR-engine
// OCR_EXTEND_LEFT_PX extra canonieke pixels links en OCR_EXTEND_Y_PX boven/
// onder, plus een gerepliceerde rand na de 2x-upscale. De vocab-matching,
// drempels (0.85/0.08), case-correctie en alle beslislogica blijven identiek.
export const OCR_EXTEND_LEFT_PX = 8;
export const OCR_EXTEND_Y_PX = 2;
export const OCR_BORDER_PX = 12;

/** 2x-opgeschaalde BGR-crop van de regio (null bij te klein). */
function regionScaled(canonicalBgr: any, x: number, y: number, w: number, h: number): any | null {
  const c = cv();
  const x0 = x - OCR_EXTEND_LEFT_PX;
  const y0 = y - OCR_EXTEND_Y_PX;
  const w0 = w + (x - Math.max(0, x0));
  const h0 = h + 2 * OCR_EXTEND_Y_PX;
  const cx = Math.max(0, Math.min(canonicalBgr.cols - 2, x0));
  const cy = Math.max(0, Math.min(canonicalBgr.rows - 2, y0));
  const cw = Math.min(w0, canonicalBgr.cols - cx);
  const ch = Math.min(h0, canonicalBgr.rows - cy);
  if (cw < 12 || ch < 8) return null;
  const crop = canonicalBgr.roi(new c.Rect(cx, cy, cw, ch));
  const scaled = new c.Mat();
  c.resize(crop, scaled, new c.Size(cw * 2, ch * 2), 0, 0, c.INTER_CUBIC);
  crop.delete();
  const padded = new c.Mat();
  c.copyMakeBorder(scaled, padded, OCR_BORDER_PX, OCR_BORDER_PX, OCR_BORDER_PX, OCR_BORDER_PX, c.BORDER_REPLICATE);
  scaled.delete();
  return padded;
}

function bgrToRgba(bgr: any): { rgba: Uint8ClampedArray; width: number; height: number } {
  const c = cv();
  const rgba = new c.Mat();
  c.cvtColor(bgr, rgba, c.COLOR_BGR2RGBA);
  const out = new Uint8ClampedArray(rgba.data);
  const w = rgba.cols;
  const h = rgba.rows;
  rgba.delete();
  return { rgba: out, width: w, height: h };
}

/** Merge: letters uit de latin-lezing, symbolen (★ e.d.) uit de ja-lezing. */
export function mergeSymbolEvidence(latinText: string, jaText: string): string {
  if (!jaText || !latinText) return latinText ?? '';
  let jaHasSymbol = false;
  for (const ch of jaText) {
    if (!isLetterOrDigit(ch) && !isWhitespace(ch)) {
      jaHasSymbol = true;
      break;
    }
  }
  if (!jaHasSymbol) return latinText;
  const latinAlnum = [...alnumSkeleton(latinText)];
  const jaAlnum = alnumSkeleton(jaText);
  let li = 0;
  let jaRemaining = [...jaAlnum].length;
  let out = '';
  for (const ch of jaText) {
    if (isLetterOrDigit(ch)) {
      if (li >= latinAlnum.length || latinAlnum[li].toLowerCase() !== ch.toLowerCase()) return latinText;
      out += latinAlnum[li];
      li++;
      jaRemaining--;
    } else if (isWhitespace(ch)) {
      out += ch;
    } else {
      out += ch;
      if (latinAlnum.length - li > jaRemaining) li++;
    }
  }
  if (li !== latinAlnum.length) return latinText;
  return out.trim();
}

function alnumSkeleton(text: string): string {
  let sb = '';
  for (const ch of text) if (isLetterOrDigit(ch)) sb += ch;
  return sb;
}

/** Binaire inkt-mask van de strip (tekst = 255): Otsu, inkt = minderheid. */
function inkMask(bgr: any): any {
  const c = cv();
  const gray = new c.Mat();
  c.cvtColor(bgr, gray, c.COLOR_BGR2GRAY);
  const bin = new c.Mat();
  c.threshold(gray, bin, 0, 255, c.THRESH_BINARY + c.THRESH_OTSU);
  gray.delete();
  if (c.countNonZero(bin) > Math.trunc((bin.rows * bin.cols) / 2)) {
    c.bitwise_not(bin, bin);
  }
  return bin;
}

function countNonZeroRect(ink: any, x0: number, x1: number, y0: number, y1: number): number {
  const data = ink.data as Uint8Array;
  const cols = ink.cols;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    const row = y * cols;
    for (let x = x0; x < x1; x++) if (data[row + x] !== 0) n++;
  }
  return n;
}

function measureCells(ink: any, ebox: [number, number, number, number], text: string): CellStats | null {
  const n = text.length;
  const band0 = Math.max(0, ebox[1] - 2);
  const band1 = Math.min(ink.rows, ebox[3] + 2);
  if (band1 - band0 < 8) return null;
  const ew = Math.max(1, ebox[2] - ebox[0]);
  const x0 = Math.max(0, ebox[0] - Math.round(0.2 * ew));
  const x1 = Math.min(ink.cols, ebox[2] + Math.round(0.2 * ew));
  if (x1 - x0 < n * 4) return null;
  const col = new Int32Array(x1 - x0);
  for (let x = x0; x < x1; x++) col[x - x0] = countNonZeroRect(ink, x, x + 1, band0, band1);
  const segs: [number, number][] = [];
  let runStart = -1;
  let runInk = 0;
  for (let i = 0; i <= col.length; i++) {
    const on = i < col.length && col[i] >= 1;
    if (on && runStart < 0) {
      runStart = i;
      runInk = 0;
    }
    if (on) runInk += col[i];
    if (!on && runStart >= 0) {
      if (i - runStart >= 3 && runInk >= 20) segs.push([runStart, i]);
      runStart = -1;
    }
  }
  const bounds = new Int32Array(n + 1);
  if (segs.length === n) {
    bounds[0] = segs[0][0];
    bounds[n] = segs[n - 1][1];
    for (let i = 1; i < n; i++) bounds[i] = Math.trunc((segs[i - 1][1] + segs[i][0]) / 2);
  } else {
    let s0 = -1;
    let s1 = -1;
    for (let i = 0; i < col.length; i++) {
      if (col[i] >= 2) {
        if (s0 < 0) s0 = i;
        s1 = i + 1;
      }
    }
    if (s0 < 0 || s1 - s0 < n * 4) return null;
    let total = 0.0;
    for (let i = 0; i < n; i++) total += charWeight(text.charAt(i));
    const span = s1 - s0;
    bounds[0] = s0;
    bounds[n] = s1;
    let acc = 0.0;
    for (let i = 1; i < n; i++) {
      acc += charWeight(text.charAt(i - 1));
      const expected = s0 + Math.round((span * acc) / total);
      const cellLocal = (span * charWeight(text.charAt(i - 1))) / total;
      const lo = Math.max(bounds[i - 1] + 2, expected - Math.round(cellLocal * 0.4));
      const hi = Math.min(s1 - 1, expected + Math.round(cellLocal * 0.4));
      let best = Math.min(lo, hi);
      for (let x = best; x <= hi; x++) if (col[x] < col[best]) best = x;
      bounds[i] = best;
    }
  }
  const stats: CellStats = { heights: new Array(n).fill(-1), starIou: new Array(n).fill(0) };
  for (let i = 0; i < n; i++) {
    const l = bounds[i];
    const r = Math.max(l + 1, bounds[i + 1]);
    const w = r - l;
    let l2 = l + Math.round(0.25 * w);
    let r2 = r - Math.round(0.25 * w);
    if (r2 <= l2) {
      l2 = l;
      r2 = r;
    }
    const need = Math.max(2, Math.round((r2 - l2) * 0.2));
    let top = -1;
    let bottom = -1;
    for (let y = band0; y < band1; y++) {
      const count = countNonZeroRect(ink, x0 + l2, x0 + r2, y, y + 1);
      if (count >= need) {
        if (top < 0) top = y;
        bottom = y;
      }
    }
    stats.heights[i] = top < 0 ? -1 : bottom - top + 1;
    stats.starIou[i] = glyphStarIou(ink, band0, band1, x0 + l, x0 + r);
  }
  return stats;
}

/** IoU van de glyph-inkt (bbox binnen de cel) met een 5-punts-sterpolygon. */
function glyphStarIou(ink: any, band0: number, band1: number, cellL: number, cellR: number): number {
  const c = cv();
  const cl = Math.max(0, cellL);
  const cr = Math.min(ink.cols, Math.max(cellL + 1, cellR));
  const cell = ink.roi(new c.Rect(cl, band0, cr - cl, band1 - band0));
  try {
    if (c.countNonZero(cell) < 30) return 0.0;
    const data = cell.data as Uint8Array;
    const rows = cell.rows;
    const cols = cell.cols;
    let gy0 = -1;
    let gy1 = -1;
    for (let y = 0; y < rows; y++) {
      let any = false;
      for (let x = 0; x < cols; x++) if (data[y * cols + x] !== 0) { any = true; break; }
      if (any) {
        if (gy0 < 0) gy0 = y;
        gy1 = y + 1;
      }
    }
    let gx0 = -1;
    let gx1 = -1;
    for (let x = 0; x < cols; x++) {
      let any = false;
      for (let y = 0; y < rows; y++) if (data[y * cols + x] !== 0) { any = true; break; }
      if (any) {
        if (gx0 < 0) gx0 = x;
        gx1 = x + 1;
      }
    }
    if (gy0 < 0 || gx0 < 0 || gy1 - gy0 < 8 || gx1 - gx0 < 8) return 0.0;
    const glyph = cell.roi(new c.Rect(gx0, gy0, gx1 - gx0, gy1 - gy0));
    const w = glyph.cols;
    const h = glyph.rows;
    const tpl = c.Mat.zeros(h, w, c.CV_8UC1);
    const pts: number[] = [];
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      const radius = i % 2 === 0 ? 1.0 : 0.42;
      // OpenCV Point(double) -> fillPoly gebruikt gehele coördinaten (int-cast in Java-binding)
      pts.push(Math.trunc(w / 2.0 + radius * (w / 2.0) * Math.cos(ang)), Math.trunc(h / 2.0 + radius * (h / 2.0) * Math.sin(ang)));
    }
    const poly = c.matFromArray(10, 1, c.CV_32SC2, pts);
    const vec = new c.MatVector();
    vec.push_back(poly);
    c.fillPoly(tpl, vec, new c.Scalar(255));
    vec.delete();
    poly.delete();
    const andM = new c.Mat();
    const orM = new c.Mat();
    c.bitwise_and(glyph, tpl, andM);
    c.bitwise_or(glyph, tpl, orM);
    const iou = c.countNonZero(andM) / Math.max(1, c.countNonZero(orM));
    glyph.delete();
    tpl.delete();
    andM.delete();
    orM.delete();
    return iou;
  } finally {
    cell.delete();
  }
}

/** The central name matcher (packages/icon-matcher sharedNameMatch, the same rules as Android
 * and Python), wrapped in this engine's VocabMatch. */
export function matchVocab(ocrText: string, vocab: Record<string, string> | null): VocabMatch {
  const out = new VocabMatch();
  const shared = matchName(ocrText, vocab);
  out.id = shared.key;
  out.name = shared.name ?? '';
  out.fuzzy = shared.fuzzy;
  out.margin = shared.margin;
  return out;
}

export function normalize(text: string | null): string {
  return normalizeName(text);
}

/** 1 - levenshtein/maxlen (op UTF-16 code units, zoals Java). */
export function similarity(a: string, b: string): number {
  return nameSimilarity(a, b);
}
