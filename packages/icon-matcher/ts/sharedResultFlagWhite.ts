/** Experimental result-card flag correction. The name glyphs are measured on
 * the same frame; the correction is applied to a separate copy of the flag
 * crop only. It never changes the uncorrected read or another icon field.
 */
export interface ResultFlagWhiteAnchor {
  medianBgr: [number, number, number];
  gainsBgr: [number, number, number];
  neutralPixels: number;
  selectedPixels: number;
  nameRowXywh: [number, number, number, number];
}

const median = (values: number[]): number => {
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
};

/** BGR pixels are dense, with no Mat row stride. The slot is the located ghost
 * flag slot in 1280x720 canonical game coordinates, not a guessed label.
 */
export function resultGhostNameWhite(bgr: Uint8Array, width: number, height: number,
  ghostFlagSlot: [number, number, number, number]): ResultFlagWhiteAnchor | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
      || bgr.length !== width * height * 3 || ghostFlagSlot.length !== 4
      || !ghostFlagSlot.every(Number.isInteger)) return null;
  const [slotX, slotY] = ghostFlagSlot;
  const x = slotX - 300;
  const y = slotY + 4;
  const w = 235;
  const h = 45;
  if (x < 0 || y < 0 || x + w > width || y + h > height) return null;
  const candidates: { b: number; g: number; r: number; value: number }[] = [];
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      const at = (row * width + col) * 3;
      const b = bgr[at], g = bgr[at + 1], r = bgr[at + 2];
      const value = Math.max(b, g, r);
      const saturation = value ? 255 * (value - Math.min(b, g, r)) / value : 0;
      if (saturation < 95 && value >= 145) candidates.push({ b, g, r, value });
    }
  }
  if (candidates.length < 100) return null;
  const values = candidates.map((pixel) => pixel.value).sort((a, b) => a - b);
  const position = (values.length - 1) * .75;
  const lower = Math.floor(position);
  const threshold = values[lower]
    + (values[Math.ceil(position)] - values[lower]) * (position - lower);
  const selected = candidates.filter((pixel) => pixel.value >= threshold);
  if (selected.length < 30) return null;
  const medianBgr = (['b', 'g', 'r'] as const)
    .map((channel) => median(selected.map((pixel) => pixel[channel]))) as [number, number, number];
  const gainsBgr = medianBgr.map((level) =>
    Math.max(.75, Math.min(1.1, 255 / Math.max(level, 1)))) as [number, number, number];
  return { medianBgr, gainsBgr, neutralPixels: candidates.length,
    selectedPixels: selected.length, nameRowXywh: [x, y, w, h] };
}

/** Match OpenCV's/NumPy's uint8 truncation after per-channel multiplication. */
export function correctResultFlagBgr(bgr: Uint8Array,
  gainsBgr: [number, number, number]): Uint8Array {
  if (bgr.length % 3 || gainsBgr.length !== 3 || !gainsBgr.every(Number.isFinite)) {
    throw new Error('Expected dense BGR pixels and three finite gains');
  }
  const corrected = new Uint8Array(bgr.length);
  for (let i = 0; i < bgr.length; i++) {
    corrected[i] = Math.max(0, Math.min(255, Math.trunc(bgr[i] * gainsBgr[i % 3])));
  }
  return corrected;
}
