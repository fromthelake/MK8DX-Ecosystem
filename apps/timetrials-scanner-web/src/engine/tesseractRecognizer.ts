// TextRecognizer op Tesseract.js (WASM, lokaal gehost: /tess + /tessdata).
// Levert wat TextEvidence van ML Kit kreeg: platte tekst + regels met
// woord-elementen en boxen. PSM 7 (single line) voor rijteksten/naamstrip.
import { createWorker, PSM, type Worker } from 'tesseract.js';
import type { OcrLine, OcrResult, Script, TextRecognizer } from './textEvidence';

const LANG_FOR_SCRIPT: Record<Script, string> = { latin: 'eng', ja: 'jpn', zh: 'chi_sim', ko: 'kor', zh_tw: 'chi_tra', ru: 'rus' };

export type OcrPreprocess = 'raw' | 'gray' | 'grayinv' | 'bin' | 'textcolour';

export interface TesseractConfig {
  workerPath: string;
  corePath: string;
  langPath: string;
  /** welke scripts lokaal beschikbaar zijn (taaldata gehost) */
  scripts: Script[];
  /** scripts die als RIJTEKST-kandidaat mogen dienen (ML Kit-ja leest Latijn; Tesseract-jpn niet) */
  rowScripts?: Script[];
  /** scripts whose language data loads at start; the others load on first use */
  warmupScripts?: Script[];
  /** engine-adapter-voorbewerking van de crop vóór herkenning (naamstrip, rijen zonder woordenlijst) */
  preprocess?: OcrPreprocess;
  /** renderingen die voor rijtekst met woordenlijst in volgorde geprobeerd worden */
  rowVariants?: OcrPreprocess[];
}

/** Engine-adapter: Tesseract-LSTM leest donkere tekst op lichte achtergrond
 *  het best. 'gray' = grijswaarden + contrastspreiding; 'grayinv' = idem en
 *  inverteren als de achtergrond donker is (witte tekst op de ghostkaart);
 *  'bin' = Otsu-binarisatie na 'grayinv'. Alleen de OCR-invoer verandert. */
export function preprocessForOcr(rgba: Uint8ClampedArray, width: number, height: number, mode: OcrPreprocess): Uint8ClampedArray {
  if (mode === 'raw') return rgba;
  if (mode === 'textcolour') return textColourMask(rgba, width, height);
  const n = width * height;
  const gray = new Float32Array(n);
  let min = 255;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const g = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    gray[i] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < n; i++) gray[i] = ((gray[i] - min) / range) * 255;
  if (mode === 'grayinv' || mode === 'bin') {
    // achtergrond = mediaan van de randpixels; donker -> inverteren
    const border: number[] = [];
    for (let x = 0; x < width; x++) {
      border.push(gray[x], gray[(height - 1) * width + x]);
    }
    for (let y = 0; y < height; y++) {
      border.push(gray[y * width], gray[y * width + width - 1]);
    }
    border.sort((a, b) => a - b);
    const bg = border[Math.trunc(border.length / 2)];
    if (bg < 128) for (let i = 0; i < n; i++) gray[i] = 255 - gray[i];
  }
  if (mode === 'bin') {
    // Otsu
    const hist = new Int32Array(256);
    for (let i = 0; i < n; i++) hist[Math.min(255, Math.max(0, Math.round(gray[i])))]++;
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0;
    let wB = 0;
    let best = 0;
    let thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = n - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) {
        best = between;
        thr = t;
      }
    }
    for (let i = 0; i < n; i++) gray[i] = gray[i] > thr ? 255 : 0;
  }
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const v = Math.round(gray[i]);
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * 'textcolour': the Select-a-Ghost panel prints the part names in one light
 * yellow. Keep only the row's brightest yellows (hue within 7 degrees and value
 * at least 0.8 of theirs), dark on white, so a character badge shining through
 * the translucent panel (more orange, darker) drops out. Measured per crop, so a
 * phone's colour cast moves the text colour with it. A row without yellow comes
 * back blank (nothing to read).
 */
function textColourMask(rgba: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const n = width * height;
  const hue = new Float32Array(n);
  const val = new Float32Array(n);
  const yellow = new Uint8Array(n);
  const values: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4] / 255;
    const g = rgba[i * 4 + 1] / 255;
    const b = rgba[i * 4 + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d > 0) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    const s = max > 0 ? d / max : 0;
    hue[i] = h;
    val[i] = max;
    if (h >= 30 && h <= 70 && s >= 0.25) {
      yellow[i] = 1;
      values.push(max);
    }
  }
  const out = new Uint8ClampedArray(n * 4).fill(255);
  if (values.length < 50) return out;
  values.sort((a, b) => a - b);
  const cut = values[Math.min(values.length - 1, Math.floor(values.length * 0.9))];
  const coreHue: number[] = [];
  const coreVal: number[] = [];
  for (let i = 0; i < n; i++) {
    if (yellow[i] && val[i] >= cut) {
      coreHue.push(hue[i]);
      coreVal.push(val[i]);
    }
  }
  const median = (list: number[]): number => {
    list.sort((a, b) => a - b);
    return list[Math.floor(list.length / 2)];
  };
  const hueText = median(coreHue);
  const valText = median(coreVal);
  for (let i = 0; i < n; i++) {
    if (yellow[i] && Math.abs(hue[i] - hueText) <= 7 && val[i] >= 0.8 * valText) {
      out[i * 4] = 0;
      out[i * 4 + 1] = 0;
      out[i * 4 + 2] = 0;
    }
  }
  return out;
}

export class TesseractRecognizer implements TextRecognizer {
  private readonly workers = new Map<Script, Promise<Worker>>();

  constructor(private readonly config: TesseractConfig) {}

  available(script: Script): boolean {
    return this.config.scripts.includes(script);
  }

  availableForRows(script: Script): boolean {
    return (this.config.rowScripts ?? this.config.scripts).includes(script) && this.available(script);
  }

  private worker(script: Script): Promise<Worker> {
    let w = this.workers.get(script);
    if (!w) {
      w = (async () => {
        const worker = await createWorker(LANG_FOR_SCRIPT[script], 1, {
          workerPath: this.config.workerPath,
          corePath: this.config.corePath,
          langPath: this.config.langPath,
          gzip: false,
          cacheMethod: 'none',
          workerBlobURL: false,
          logger: () => undefined,
        });
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_LINE,
          preserve_interword_spaces: '1',
        });
        return worker;
      })();
      this.workers.set(script, w);
    }
    return w;
  }

  /** Warm-up: laad de taaldata alvast (eerste scan zonder wachttijd). */
  async warmup(): Promise<void> {
    for (const s of this.config.warmupScripts ?? this.config.scripts) await this.worker(s);
  }

  rowVariants(): string[] {
    return this.config.rowVariants ?? [this.config.preprocess ?? 'raw'];
  }

  async recognize(rgba: Uint8ClampedArray, width: number, height: number, script: Script, variant?: string): Promise<OcrResult | null> {
    if (!this.available(script)) return null;
    const worker = await this.worker(script);
    // ImageData wordt door de Tesseract-worker niet gelezen ("Error attempting
    // to read image"); een PNG-blob wel — kleine crops, verwaarloosbare kosten
    const pixels = preprocessForOcr(rgba, width, height, (variant as OcrPreprocess | undefined) ?? this.config.preprocess ?? 'raw');
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const { data } = await worker.recognize(blob, {}, { text: true, blocks: true });
    const lines: OcrLine[] = [];
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          lines.push({
            text: line.text.replace(/\n/g, ' ').trim(),
            elements: line.words.map((w) => ({
              text: w.text,
              box: w.bbox ? [w.bbox.x0, w.bbox.y0, w.bbox.x1, w.bbox.y1] : null,
            })),
          });
        }
      }
    }
    return { text: data.text ?? '', lines };
  }

  async terminate(): Promise<void> {
    for (const w of this.workers.values()) {
      try {
        await (await w).terminate();
      } catch {
        /* al gestopt */
      }
    }
    this.workers.clear();
  }
}
