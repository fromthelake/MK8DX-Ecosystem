// The central card-detector post-processing (CENTRAL_RECOGNITION section 8.6, phase 5): the
// TypeScript port of python/mk8dx_icon_matcher/detections.py (the reference) and Detections.java,
// kept equal by the parity vectors (tooling/recognition/detections_vectors.py). Running the model
// stays with the product; parse_detections decides what its raw output means (float32 arithmetic
// as Java's float, via Math.fround) and cleanLapIndex removes at most one weak extra badge per
// rule (duplicate, then outlier, then off-lattice) on an otherwise complete end screen.

export const DETECT_THRESHOLD = 0.2;
export const CLASS_NAMES = ['ghost_timetrail_box', 'player_timetrail_box', 'lap_index', 'background'] as const;
const MAX_DETECTIONS = 40;
const f32 = Math.fround;

export interface DetectionBox {
  label: string;
  score: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function parseDetections(boxes: ArrayLike<number>, logits: ArrayLike<number>, count: number, numClasses: number,
  width: number, height: number): DetectionBox[] {
  const out: DetectionBox[] = [];
  const nCls = Math.min(3, numClasses);
  for (let i = 0; i < count; i++) {
    for (let cls = 0; cls < nCls; cls++) {
      const score = f32(1.0 / (1.0 + Math.exp(-logits[i * numClasses + cls])));
      if (score < DETECT_THRESHOLD) continue;
      const cx = f32(boxes[i * 4]);
      const cy = f32(boxes[i * 4 + 1]);
      const bw = f32(boxes[i * 4 + 2]);
      const bh = f32(boxes[i * 4 + 3]);
      const left = clamp(f32(f32(cx - f32(bw / 2.0)) * width), 0, width);
      const top = clamp(f32(f32(cy - f32(bh / 2.0)) * height), 0, height);
      const right = clamp(f32(f32(cx + f32(bw / 2.0)) * width), 0, width);
      const bottom = clamp(f32(f32(cy + f32(bh / 2.0)) * height), 0, height);
      out.push({ label: CLASS_NAMES[cls], score, left: f32(left / width), top: f32(top / height),
        right: f32(right / width), bottom: f32(bottom / height) });
    }
  }
  out.sort((a, b) => (b.score > a.score ? 1 : b.score < a.score ? -1 : 0));
  return out.length > MAX_DETECTIONS ? out.slice(0, MAX_DETECTIONS) : out;
}

const upperMedian = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const centerX = (d: DetectionBox): number => (d.left + d.right) / 2;
const centerY = (d: DetectionBox): number => (d.top + d.bottom) / 2;
const badges = <T extends DetectionBox>(ds: T[]): T[] => ds.filter((d) => d.label === 'lap_index');
const inside = (d: DetectionBox, box: DetectionBox): boolean => centerY(d) >= box.top && centerY(d) <= box.bottom;

function bestOwner<T extends DetectionBox>(ds: T[], label: string): T | undefined {
  return ds.filter((d) => d.label === label && d.score >= 0.8).sort((a, b) => b.score - a.score)[0];
}

function overlap(a: DetectionBox, b: DetectionBox): number {
  const area = (d: DetectionBox) => Math.max(0, d.right - d.left) * Math.max(0, d.bottom - d.top);
  const inter = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}

/** One weak off-column badge beside six strong ones in one column; null when the rule does not apply. */
export function weakLapIndexOutlier<T extends DetectionBox>(ds: T[]): T | null {
  const bs = badges(ds);
  if (bs.length !== 7) return null;
  const strong = bs.filter((d) => d.score >= 0.85);
  const weak = bs.filter((d) => d.score <= 0.45);
  if (strong.length !== 6 || weak.length !== 1) return null;
  const columnX = upperMedian(strong.map(centerX));
  const badgeWidth = upperMedian(strong.map((d) => d.right - d.left));
  if (badgeWidth <= 0 || strong.some((d) => Math.abs(centerX(d) - columnX) > badgeWidth * 0.25)) return null;
  if (Math.abs(centerX(weak[0]) - columnX) <= badgeWidth * 0.4) return null;
  return weak[0];
}

/** One weak badge duplicating a stronger one, when both three-row cards stay supported. */
export function weakDuplicateLapIndex<T extends DetectionBox>(ds: T[]): T | null {
  const bs = badges(ds);
  if (bs.length !== 7) return null;
  const player = bestOwner(ds, 'player_timetrail_box');
  const ghost = bestOwner(ds, 'ghost_timetrail_box');
  if (!player || !ghost || centerY(ghost) >= centerY(player)) return null;
  const duplicates: T[] = [];
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i];
      const b = bs[j];
      const weaker = a.score <= b.score ? a : b;
      const stronger = weaker === a ? b : a;
      if (overlap(a, b) >= 0.9 && weaker.score <= 0.5 && stronger.score >= 0.65) duplicates.push(weaker);
    }
  }
  if (duplicates.length !== 1) return null;
  const remaining = bs.filter((d) => d !== duplicates[0]);
  if (remaining.filter((d) => inside(d, ghost)).length !== 3 || remaining.filter((d) => inside(d, player)).length !== 3 ||
      remaining.some((d) => inside(d, ghost) === inside(d, player))) return null;
  return duplicates[0];
}

/** One weak extra badge when both owners keep a complete three-row badge lattice. */
export function weakOffLatticeLapIndex<T extends DetectionBox>(ds: T[]): T | null {
  const bs = badges(ds);
  if (bs.length !== 7) return null;
  const weak = bs.filter((d) => d.score <= 0.55);
  const strong = bs.filter((d) => d.score >= 0.8);
  if (weak.length !== 1 || strong.length !== 6) return null;
  const player = bestOwner(ds, 'player_timetrail_box');
  const ghost = bestOwner(ds, 'ghost_timetrail_box');
  if (!player || !ghost) return null;
  const owners = [player, ghost];
  if (strong.some((d) => owners.filter((box) => inside(d, box)).length !== 1)) return null;
  for (const box of owners) {
    const rows = strong.filter((d) => inside(d, box)).map(centerY).sort((a, b) => a - b);
    const height = box.bottom - box.top;
    if (rows.length !== 3 || height <= 0 ||
        (rows[1] - rows[0]) / height < 0.16 || (rows[1] - rows[0]) / height > 0.23 ||
        (rows[2] - rows[1]) / height < 0.16 || (rows[2] - rows[1]) / height > 0.23) return null;
  }
  const columnX = upperMedian(strong.map(centerX));
  const badgeWidth = upperMedian(strong.map((d) => d.right - d.left));
  if (badgeWidth <= 0 || strong.some((d) => Math.abs(centerX(d) - columnX) > badgeWidth * 0.3)) return null;
  return weak[0];
}

/** Duplicate, then outlier, then off-lattice (both scanners' order). */
export function cleanLapIndex<T extends DetectionBox>(ds: T[]): T[] {
  let out = ds;
  for (const rule of [weakDuplicateLapIndex, weakLapIndexOutlier, weakOffLatticeLapIndex]) {
    const removed = rule(out);
    if (removed) out = out.filter((d) => d !== removed);
  }
  return out;
}
