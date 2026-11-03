/** Image-only tone evidence for an already located Ghost total and icon crop.
 * No label, paired HDMI result or predicted asset is used to set the gains.
 */
export interface GhostToneWhite {
  whiteLevel: number;
  gainsBgr: [number, number, number];
  contrastSpan: number;
  brightClipFraction: number;
}

const median = (sorted: number[]): number => {
  const n = sorted.length;
  if (!n) throw new Error('Empty tone anchor');
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
};

/** Match NumPy's linear 85th percentile and per-channel median of bright pixels. */
export function ghostTotalWhite(cv: any, canonicalBgr: any,
  box: [number, number, number, number]): GhostToneWhite {
  if (!canonicalBgr || canonicalBgr.empty() || canonicalBgr.channels() !== 3
      || !Array.isArray(box) || box.length !== 4 || !box.every(Number.isInteger)) {
    throw new Error('Expected canonical BGR frame and integer total-time box');
  }
  const [x1, y1, x2, y2] = box;
  if (x1 < 0 || y1 < 0 || x2 <= x1 || y2 <= y1
      || x2 > canonicalBgr.cols || y2 > canonicalBgr.rows) {
    throw new Error('Ghost total-time box outside canonical frame');
  }
  const roi = canonicalBgr.roi(new cv.Rect(x1, y1, x2 - x1, y2 - y1));
  const dense = roi.clone();
  roi.delete();
  try {
    const pixels = dense.data as Uint8Array;
    const n = dense.rows * dense.cols;
    if (pixels.length !== n * 3) throw new Error('Unexpected total-time channels');
    const maxChannel = Array.from({ length: n }, (_, i) =>
      Math.max(pixels[i * 3], pixels[i * 3 + 1], pixels[i * 3 + 2])).sort((a, b) => a - b);
    const position = (n - 1) * .85;
    const lower = Math.floor(position);
    const threshold = maxChannel[lower] + (maxChannel[Math.ceil(position)] - maxChannel[lower])
      * (position - lower);
    const channels: [number[], number[], number[]] = [[], [], []];
    for (let i = 0; i < n; i++) {
      const offset = i * 3;
      if (Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) >= threshold) {
        for (let channel = 0; channel < 3; channel++) channels[channel].push(pixels[offset + channel]);
      }
    }
    const levels = channels.map((values) => median(values.sort((a, b) => a - b)));
    const whiteLevel = (levels[0] + levels[1] + levels[2]) / 3;
    const gainsBgr = levels.map((level) =>
      Math.max(.75, Math.min(1.35, whiteLevel / Math.max(level, 1)))) as [number, number, number];
    const percentile = (fraction: number): number => {
      const at = (n - 1) * fraction;
      const from = Math.floor(at);
      return maxChannel[from] + (maxChannel[Math.ceil(at)] - maxChannel[from]) * (at - from);
    };
    const brightClipFraction = maxChannel.filter((value) => value >= 250).length / n;
    return { whiteLevel, gainsBgr,
      contrastSpan: percentile(.90) - percentile(.10), brightClipFraction };
  } finally {
    dense.delete();
  }
}

/** Exploratory Ghost QA gate. The 100 span is tuned on exposed paired frames. */
export function ghostToneMode(tone: GhostToneWhite):
  'raw' | 'bounded_luminance' | 'digit_neutral_clahe_low_contrast' {
  if (!Number.isFinite(tone.whiteLevel) || !Number.isFinite(tone.contrastSpan)) {
    throw new Error('Expected finite Ghost tone measurement');
  }
  if (tone.whiteLevel >= 210) return 'raw';
  return tone.contrastSpan < 100
    ? 'digit_neutral_clahe_low_contrast' : 'bounded_luminance';
}

/** BGR gains followed by LAB-L CLAHE (clip 1.5, 4x4), matching the Python probe. */
export function correctedGhostCrop(cv: any, cropBgr: any,
  gainsBgr: [number, number, number]): any {
  if (!cropBgr || cropBgr.empty() || cropBgr.channels() !== 3
      || gainsBgr.length !== 3 || !gainsBgr.every(Number.isFinite)) {
    throw new Error('Expected BGR icon crop and three finite gains');
  }
  const neutral = cropBgr.clone();
  const lab = new cv.Mat();
  const light = new cv.Mat(cropBgr.rows, cropBgr.cols, cv.CV_8UC1);
  const equalized = new cv.Mat();
  const corrected = new cv.Mat();
  let clahe: any = null;
  try {
    const source = neutral.data as Uint8Array;
    for (let i = 0; i < source.length; i++) {
      source[i] = Math.max(0, Math.min(255, Math.trunc(source[i] * gainsBgr[i % 3])));
    }
    cv.cvtColor(neutral, lab, cv.COLOR_BGR2Lab);
    const labPixels = lab.data as Uint8Array;
    const lightPixels = light.data as Uint8Array;
    for (let i = 0; i < lightPixels.length; i++) lightPixels[i] = labPixels[i * 3];
    clahe = new cv.CLAHE(1.5, new cv.Size(4, 4));
    clahe.apply(light, equalized);
    const contrastPixels = equalized.data as Uint8Array;
    for (let i = 0; i < contrastPixels.length; i++) labPixels[i * 3] = contrastPixels[i];
    cv.cvtColor(lab, corrected, cv.COLOR_Lab2BGR);
    return corrected;
  } catch (error) {
    corrected.delete();
    throw error;
  } finally {
    clahe?.delete();
    equalized.delete();
    light.delete();
    lab.delete();
    neutral.delete();
  }
}
