/** Opt-in optical QA: fit all four boundaries of the yellow in-game player card. */
import { cv } from './cv';

export type OpticalQuad = [number, number][];
export type OpticalBox = [number, number, number, number];

interface Sample { axis: number; position: number; contrast: number }
interface Line { slope: number; intercept: number; count: number; medianError: number }
export interface YellowCardFit {
  status: 'candidate' | 'insufficient_edges' | 'parallel_edges' | 'out_of_card_box';
  quad?: OpticalQuad;
  samples: Record<string, number>;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function sampleEdge(mask: Uint8Array, width: number, height: number, box: OpticalBox,
  side: 'top' | 'bottom' | 'left' | 'right'): Sample[] {
  const [left, top, right, bottom] = box;
  const horizontal = side === 'top' || side === 'bottom';
  const span = horizontal ? right - left : bottom - top;
  const depth = horizontal ? bottom - top : right - left;
  const reference = { top, bottom, left, right }[side];
  const start = (horizontal ? left : top) + 0.1 * span;
  const stop = (horizontal ? right : bottom) - 0.1 * span;
  const halfSearch = Math.min(42, Math.max(8, Math.round(0.09 * depth)));
  const step = Math.max(4, Math.round(span / 80));
  const inward = side === 'top' || side === 'left' ? 1 : -1;
  const samples: Sample[] = [];
  for (let axis = start; axis < stop; axis += step) {
    const anchor = Math.round(axis);
    let best = -1;
    let bestPosition = 0;
    for (let position = Math.round(reference) - halfSearch;
      position <= Math.round(reference) + halfSearch; position++) {
      if (horizontal ? !(9 <= position && position < height - 9 && 2 <= anchor && anchor < width - 2)
        : !(9 <= position && position < width - 9 && 2 <= anchor && anchor < height - 2)) continue;
      let inner = 0;
      let outer = 0;
      for (let depthPixel = 3; depthPixel < 9; depthPixel++) {
        for (let cross = -2; cross <= 2; cross++) {
          if (horizontal) {
            inner += mask[(position + inward * depthPixel) * width + anchor + cross];
            outer += mask[(position - inward * depthPixel) * width + anchor + cross];
          } else {
            inner += mask[(anchor + cross) * width + position + inward * depthPixel];
            outer += mask[(anchor + cross) * width + position - inward * depthPixel];
          }
        }
      }
      const contrast = (inner - outer) / 30;
      if (contrast > best) { best = contrast; bestPosition = position; }
    }
    if (best >= 0.55) samples.push({ axis, position: bestPosition, contrast: best });
  }
  return samples;
}

function leastSquares(samples: Sample[]): [number, number] {
  const n = samples.length;
  const meanX = samples.reduce((v, s) => v + s.axis, 0) / n;
  const meanY = samples.reduce((v, s) => v + s.position, 0) / n;
  const denominator = samples.reduce((v, s) => v + (s.axis - meanX) ** 2, 0);
  const slope = samples.reduce((v, s) => v + (s.axis - meanX) * (s.position - meanY), 0) / denominator;
  return [slope, meanY - slope * meanX];
}

function fitEdge(samples: Sample[], span: number): Line | null {
  if (samples.length < Math.max(8, span / 25)) return null;
  const range = (items: Sample[]) => Math.max(...items.map((s) => s.axis)) - Math.min(...items.map((s) => s.axis));
  if (range(samples) < 0.55 * span) return null;
  const [slope, intercept] = leastSquares(samples);
  const errors = samples.map((s) => Math.abs(s.position - slope * s.axis - intercept));
  const threshold = Math.max(3, 2.5 * median(errors));
  const kept = samples.filter((_, i) => errors[i] <= threshold);
  if (kept.length < 8 || range(kept) < 0.55 * span) return null;
  const [refinedSlope, refinedIntercept] = leastSquares(kept);
  const medianError = median(kept.map((s) => Math.abs(s.position - refinedSlope * s.axis - refinedIntercept)));
  if (medianError > Math.max(3, 0.007 * span)) return null;
  return { slope: refinedSlope, intercept: refinedIntercept, count: kept.length, medianError };
}

function cross(horizontal: Line, vertical: Line): [number, number] | null {
  const denominator = 1 - horizontal.slope * vertical.slope;
  if (Math.abs(denominator) < 0.1) return null;
  const x = (vertical.slope * horizontal.intercept + vertical.intercept) / denominator;
  return [x, horizontal.slope * x + horizontal.intercept];
}

/** The box is the independently detected player-card box in full input pixels. */
export function fitYellowPlayerCardEdge(bgr: any, box: OpticalBox): YellowCardFit {
  const c = cv();
  const hsv = new c.Mat();
  try {
    c.cvtColor(bgr, hsv, c.COLOR_BGR2HSV);
    const width = hsv.cols;
    const height = hsv.rows;
    const data: Uint8Array = hsv.data;
    const mask = new Uint8Array(width * height);
    for (let i = 0, pixel = 0; pixel < mask.length; i += 3, pixel++) {
      mask[pixel] = +(data[i] >= 12 && data[i] <= 40 && data[i + 1] >= 110 && data[i + 2] >= 120);
    }
    const [left, top, right, bottom] = box;
    const sides = ['top', 'bottom', 'left', 'right'] as const;
    const samples = Object.fromEntries(sides.map((side) => [side, sampleEdge(mask, width, height, box, side)])) as
      Record<typeof sides[number], Sample[]>;
    const counts = Object.fromEntries(sides.map((side) => [side, samples[side].length]));
    const lines = Object.fromEntries(sides.map((side) => [side,
      fitEdge(samples[side], side === 'top' || side === 'bottom' ? right - left : bottom - top)])) as
      Record<typeof sides[number], Line | null>;
    if (sides.some((side) => !lines[side])) return { status: 'insufficient_edges', samples: counts };
    const quad = [cross(lines.top!, lines.left!), cross(lines.top!, lines.right!),
      cross(lines.bottom!, lines.right!), cross(lines.bottom!, lines.left!)];
    if (quad.some((point) => !point)) return { status: 'parallel_edges', samples: counts };
    const corners = quad as [number, number][];
    const expected: OpticalQuad = [[left, top], [right, top], [right, bottom], [left, bottom]];
    if (corners.some((point, i) => Math.abs(point[0] - expected[i][0]) > 0.1 * (right - left)
      || Math.abs(point[1] - expected[i][1]) > 0.1 * (bottom - top))) {
      return { status: 'out_of_card_box', samples: counts, quad: corners };
    }
    return { status: 'candidate', samples: counts, quad: corners };
  } finally { hsv.delete(); }
}

/** Compare two independent game-card observations, without labels or outside-screen pixels. */
export function opticalBoxConflict(box: OpticalBox, ordinary: OpticalQuad, edge: OpticalQuad): {
  ordinaryOutsideMax: number; edgeBoxGapMax: number; edgeFirst: boolean;
} {
  const bounds = (points: OpticalQuad): OpticalBox => [
    Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1])),
  ];
  const first = bounds(ordinary);
  const second = bounds(edge);
  const scale = [box[2] - box[0], box[3] - box[1], box[2] - box[0], box[3] - box[1]];
  const ordinaryOutsideMax = Math.max(...[
    box[0] - first[0], box[1] - first[1], first[2] - box[2], first[3] - box[3],
  ].map((value, i) => value / scale[i]));
  const edgeBoxGapMax = Math.max(...second.map((value, i) => Math.abs(value - box[i]) / scale[i]));
  return { ordinaryOutsideMax, edgeBoxGapMax,
    edgeFirst: ordinaryOutsideMax > 0.035 && edgeBoxGapMax < 0.025 };
}
