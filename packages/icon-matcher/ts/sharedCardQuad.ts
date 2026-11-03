// The central card quad (CENTRAL_RECOGNITION section 8.6, phase 5): the TypeScript port of
// python/mk8dx_icon_matcher/card_quad.py (the reference) and CardQuad.java, kept equal by the parity
// vectors (tooling/recognition/card_quad_vectors.py, vectors/card-quad-v1.json). Which four card
// edges the photographed result card has, from the Hough segments the product found in its mask; and
// the Select-a-Ghost deskew seed from the lap-index badge column. Angles are atan2 * 180 / PI.

export const HOUGH_MIN_LINE_LENGTH_PX = 45.0;
const SHORT_LINE_MIN_LENGTH_PX = 70.0;
const AXIS_TOLERANCE_DEGREES = 14.0;
const CLUSTER_DISTANCE_PX = 12.0;
const CLUSTER_ANGLE_DEGREES = 6.0;
const DESKEW_MIN_DEGREES = 0.2;
const DESKEW_MAX_DEGREES = 8.0;

export interface QuadPoint { x: number; y: number }
/** tl, tr, br, bl. */
export type CardQuad = [QuadPoint, QuadPoint, QuadPoint, QuadPoint];

/** A segment, or a cluster's weighted line (workflowLength: its longest member). */
export class QuadLine {
  workflowLength = Number.NaN;
  angle = Number.NaN;
  support = 0.0;
  count = 1.0;
  keyName = '';
  keyValue = Number.NaN;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;

  constructor(x1: number, y1: number, x2: number, y2: number) {
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
  }

  angleDeg(): number {
    return (Math.atan2(this.y2 - this.y1, this.x2 - this.x1) * 180.0) / Math.PI;
  }

  length(): number {
    return Math.hypot(this.x2 - this.x1, this.y2 - this.y1);
  }

  workflowLen(): number {
    return Number.isNaN(this.workflowLength) ? this.length() : this.workflowLength;
  }

  centerX(): number {
    return (this.x1 + this.x2) * 0.5;
  }

  centerY(): number {
    return (this.y1 + this.y2) * 0.5;
  }
}

export function folded(line: QuadLine): number {
  const angle = Math.abs(line.angleDeg());
  return Math.min(angle, Math.abs(180.0 - angle));
}

export function filterAngles(lines: QuadLine[]): QuadLine[] {
  return lines.filter((line) => {
    const f = folded(line);
    return f <= AXIS_TOLERANCE_DEGREES || Math.abs(f - 90.0) <= AXIS_TOLERANCE_DEGREES;
  });
}

export interface ShortLineGuard { lines: QuadLine[]; guardUsed: boolean; fallbackUsed: boolean }

export function shortLineGuard(axisLines: QuadLine[]): ShortLineGuard {
  const guarded = axisLines.filter((l) => l.workflowLen() >= SHORT_LINE_MIN_LENGTH_PX);
  if (hasEnoughClusterSupport(guarded)) return { lines: guarded, guardUsed: true, fallbackUsed: false };
  return { lines: axisLines, guardUsed: false, fallbackUsed: true };
}

export function hasEnoughClusterSupport(lines: QuadLine[]): boolean {
  return countOrientationClusters(lines, true) >= 2 && countOrientationClusters(lines, false) >= 2;
}

export function countOrientationClusters(lines: QuadLine[], horizontal: boolean): number {
  let count = 0;
  for (const line of clusterLines(lines)) if ((folded(line) <= 45.0) === horizontal) count++;
  return count;
}

export function clusterLines(lines: QuadLine[]): QuadLine[] {
  const horizontal: QuadLine[] = [];
  const vertical: QuadLine[] = [];
  for (const line of lines) (folded(line) <= 45.0 ? horizontal : vertical).push(line);
  return [...clusterOrientation(horizontal, true), ...clusterOrientation(vertical, false)];
}

const coord = (line: QuadLine, horizontal: boolean): number => (horizontal ? line.centerY() : line.centerX());

function clusterOrientation(lines: QuadLine[], horizontal: boolean): QuadLine[] {
  const sorted = [...lines].sort((a, b) => {
    const ca = coord(a, horizontal);
    const cb = coord(b, horizontal);
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });
  const clusters: QuadLine[][] = [];
  for (const line of sorted) {
    const c = coord(line, horizontal);
    const angle = line.angleDeg();
    let placed = false;
    for (const cluster of clusters) {
      let cCoord = 0.0;
      let cAngle = 0.0;
      for (const l of cluster) {
        cCoord += coord(l, horizontal);
        cAngle += l.angleDeg();
      }
      cCoord /= cluster.length;
      cAngle /= cluster.length;
      if (Math.abs(c - cCoord) <= CLUSTER_DISTANCE_PX && Math.abs(angle - cAngle) <= CLUSTER_ANGLE_DEGREES) {
        cluster.push(line);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([line]);
  }
  return clusters.map((cluster) => {
    const line = weightedLine(cluster);
    line.keyName = horizontal ? 'y' : 'x';
    line.keyValue = coord(line, horizontal);
    return line;
  });
}

function weightedLine(lines: QuadLine[]): QuadLine {
  let weight = 0.0;
  let x1 = 0.0;
  let y1 = 0.0;
  let x2 = 0.0;
  let y2 = 0.0;
  let maxLength = 0.0;
  let support = 0.0;
  for (const line of lines) {
    const len = Math.max(1.0, line.length());
    weight += len;
    x1 += line.x1 * len;
    y1 += line.y1 * len;
    x2 += line.x2 * len;
    y2 += line.y2 * len;
    maxLength = Math.max(maxLength, line.workflowLen());
    support += line.support * len;
  }
  const denom = Math.max(1.0, weight);
  const out = new QuadLine(x1 / denom, y1 / denom, x2 / denom, y2 / denom);
  out.workflowLength = maxLength;
  out.angle = 0.0;
  for (const line of lines) {
    const len = Math.max(1.0, line.length());
    out.angle += (line.angleDeg() * len) / denom;
  }
  out.support = support / denom;
  out.count = lines.length;
  return out;
}

export function lineIntersection(a: QuadLine, b: QuadLine): QuadPoint | null {
  const den = (a.x1 - a.x2) * (b.y1 - b.y2) - (a.y1 - a.y2) * (b.x1 - b.x2);
  if (Math.abs(den) < 1e-4) return null;
  const leftCross = a.x1 * a.y2 - a.y1 * a.x2;
  const rightCross = b.x1 * b.y2 - b.y1 * b.x2;
  return {
    x: (leftCross * (b.x1 - b.x2) - (a.x1 - a.x2) * rightCross) / den,
    y: (leftCross * (b.y1 - b.y2) - (a.y1 - a.y2) * rightCross) / den,
  };
}

const dist = (a: QuadPoint, b: QuadPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

export function quadAspect(quad: CardQuad): number {
  const width = Math.max(dist(quad[1], quad[0]), dist(quad[2], quad[3]));
  const height = Math.max(dist(quad[3], quad[0]), dist(quad[2], quad[1]));
  return width / Math.max(1.0, height);
}

export function quadArea(quad: CardQuad): number {
  let total = 0.0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    total += a.x * b.y - b.x * a.y;
  }
  return total * 0.5;
}

/** The best card quad from the clustered lines, or null. */
export function selectQuad(maskW: number, maskH: number, clusters: QuadLine[]): CardQuad | null {
  const hClusters: QuadLine[] = [];
  const vClusters: QuadLine[] = [];
  for (const line of clusters) {
    if (folded(line) <= 45.0) {
      line.keyName = 'y';
      line.keyValue = line.centerY();
      hClusters.push(line);
    } else {
      line.keyName = 'x';
      line.keyValue = line.centerX();
      vClusters.push(line);
    }
  }
  if (hClusters.length < 2 || vClusters.length < 2) return null;
  const byLenDesc = (a: QuadLine, b: QuadLine) => {
    const la = a.workflowLen();
    const lb = b.workflowLen();
    return lb < la ? -1 : lb > la ? 1 : 0;
  };
  hClusters.sort(byLenDesc);
  vClusters.sort(byLenDesc);
  const hLimit = Math.min(14, hClusters.length);
  const vLimit = Math.min(12, vClusters.length);
  const h = maskH;
  const w = maskW;
  const expectedAspect = w / Math.max(1.0, h);
  let bestScore = -Infinity;
  let bestQuad: CardQuad | null = null;
  for (let hi = 0; hi < hLimit; hi++) {
    const topA = hClusters[hi];
    for (let hj = hi + 1; hj < hLimit; hj++) {
      const bottomA = hClusters[hj];
      const top = topA.centerY() <= bottomA.centerY() ? topA : bottomA;
      const bottom = top === topA ? bottomA : topA;
      if (Math.abs(bottom.centerY() - top.centerY()) < h * 0.16) continue;
      for (let vi = 0; vi < vLimit; vi++) {
        const leftA = vClusters[vi];
        for (let vj = vi + 1; vj < vLimit; vj++) {
          const rightA = vClusters[vj];
          const left = leftA.centerX() <= rightA.centerX() ? leftA : rightA;
          const right = left === leftA ? rightA : leftA;
          if (Math.abs(right.centerX() - left.centerX()) < w * 0.16) continue;
          const tl = lineIntersection(top, left);
          const tr = lineIntersection(top, right);
          const br = lineIntersection(bottom, right);
          const bl = lineIntersection(bottom, left);
          if (!tl || !tr || !br || !bl) continue;
          const quad: CardQuad = [tl, tr, br, bl];
          const aspect = quadAspect(quad);
          if (aspect <= 0.0) continue;
          const ratio = aspect / Math.max(0.001, expectedAspect);
          if (ratio < 0.45 || ratio > 2.2) continue;
          let lengthScore = Math.min(1.0, (0.5 * (top.workflowLen() + bottom.workflowLen())) / Math.max(1.0, w));
          lengthScore += Math.min(1.0, (0.5 * (left.workflowLen() + right.workflowLen())) / Math.max(1.0, h));
          const aspectScore = Math.max(0.0, 1.0 - Math.abs(Math.log(Math.max(0.05, ratio))) / Math.log(2.0));
          const areaScore = Math.min(1.0, Math.abs(quadArea(quad)) / Math.max(1.0, w * h * 0.45));
          const score = 1.5 * lengthScore + aspectScore + 0.7 * areaScore;
          if (score > bestScore) {
            bestScore = score;
            bestQuad = quad;
          }
        }
      }
    }
  }
  return bestQuad;
}

export interface DeskewDetection { label: string; left: number; top: number; right: number; bottom: number }

/** The ROI seed turned with the Select-a-Ghost panel, in ROI-crop coordinates, or null. */
export function ghostDetailDeskewSeed(detections: DeskewDetection[], frameW: number, frameH: number, roiLeft: number,
  roiTop: number, cropW: number, cropH: number): { quad: CardQuad; degrees: number } | null {
  if (!frameW || !frameH) return null;
  const boxes: { cx: number; cy: number; w: number }[] = [];
  for (const d of detections) {
    if (d.label !== 'lap_index') continue;
    const w = (d.right - d.left) * frameW;
    if (w < 2.0) continue;
    boxes.push({ cx: ((d.left + d.right) / 2) * frameW, cy: ((d.top + d.bottom) / 2) * frameH, w });
  }
  if (boxes.length < 3) return null;
  const medCx = boxes.map((b) => b.cx).sort((a, b) => a - b)[Math.floor(boxes.length / 2)];
  const medW = boxes.map((b) => b.w).sort((a, b) => a - b)[Math.floor(boxes.length / 2)];
  const column = boxes.filter((b) => Math.abs(b.cx - medCx) < 1.5 * medW);
  if (column.length < 3) return null;
  let meanY = 0.0;
  let meanX = 0.0;
  for (const b of column) meanY += b.cy;
  for (const b of column) meanX += b.cx;
  meanY /= column.length;
  meanX /= column.length;
  let sxy = 0.0;
  let syy = 0.0;
  for (const b of column) {
    sxy += (b.cy - meanY) * (b.cx - meanX);
    syy += (b.cy - meanY) * (b.cy - meanY);
  }
  if (syy <= 0) return null;
  const k = sxy / syy;
  let residual = 0.0;
  for (const b of column) {
    const off = b.cx - (meanX + k * (b.cy - meanY));
    residual += off * off;
  }
  if (Math.sqrt(residual / column.length) > 0.2 * medW) return null;
  const degrees = (Math.atan(k) * 180.0) / Math.PI;
  if (Math.abs(degrees) < DESKEW_MIN_DEGREES || Math.abs(degrees) > DESKEW_MAX_DEGREES) return null;
  const n = Math.hypot(1.0, k);
  const ux = 1.0 / n;
  const uy = -k / n;
  const vx = k / n;
  const vy = 1.0 / n;
  const px = meanX - roiLeft;
  const py = meanY - roiTop;
  const turn = (x: number, y: number): QuadPoint => {
    const dx = x - px;
    const dy = y - py;
    return { x: px + dx * ux + dy * vx, y: py + dx * uy + dy * vy };
  };
  return { quad: [turn(0, 0), turn(cropW - 1, 0), turn(cropW - 1, cropH - 1), turn(0, cropH - 1)], degrees };
}
