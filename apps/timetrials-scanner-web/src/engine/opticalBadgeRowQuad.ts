/** Opt-in optical QA: a player-card quad from in-game badges, part rows and card rails. */
import { cv } from './cv';
import type { Detection } from './types';
import type { OpticalBox, OpticalQuad } from './opticalCardEdge';

type Point = [number, number];
type Side = 'left' | 'right';
type Rail = { a: Point; b: Point; overlap: number; midX: number };
type Row = { slope: number; length: number; y: number };
export interface BadgeRowFit {
  status: string;
  quad?: OpticalQuad;
  badgeCount?: number;
  rowCount?: number;
  sideSources?: Record<Side, string>;
}

function boxOf(detection: Detection, width: number, height: number): OpticalBox {
  return [detection.left * width, detection.top * height,
    detection.right * width, detection.bottom * height];
}

function hough(gray: any, x: number, y: number, width: number, height: number,
  cannyLow: number, cannyHigh: number, minimum: number, gap: number): [number, number, number, number][] {
  const c = cv();
  const roi = gray.roi(new c.Rect(x, y, width, height));
  const edges = new c.Mat();
  const raw = new c.Mat();
  try {
    c.Canny(roi, edges, cannyLow, cannyHigh);
    c.HoughLinesP(edges, raw, 1, Math.PI / 180, 30, minimum, gap);
    const values = raw.data32S as Int32Array;
    return Array.from({ length: raw.rows }, (_, i) => [values[i * 4] + x, values[i * 4 + 1] + y,
      values[i * 4 + 2] + x, values[i * 4 + 3] + y]);
  } finally {
    raw.delete(); edges.delete(); roi.delete();
  }
}

function rowsAt(gray: any, box: OpticalBox): { status: string; slope?: number; count?: number } {
  const [left, top, right, bottom] = box;
  const width = right - left;
  const height = bottom - top;
  const x0 = Math.max(0, Math.floor(left + .025 * width));
  const x1 = Math.min(gray.cols, Math.floor(left + .67 * width));
  const y0 = Math.max(0, Math.floor(top + .07 * height));
  const y1 = Math.min(gray.rows, Math.floor(bottom - .07 * height));
  if (x1 <= x0 || y1 <= y0) return { status: 'invalid_player_box' };
  const segments: Row[] = [];
  for (const [ax, ay, bx, by] of hough(gray, x0, y0, x1 - x0, y1 - y0,
    60, 170, Math.floor(width * .18), 20)) {
    const dx = bx - ax;
    const dy = by - ay;
    if (Math.abs(dx) < width * .20 || Math.abs(dy) > Math.abs(dx) * .20) continue;
    segments.push({ slope: dy / dx, length: Math.abs(dx), y: (ay + by) / 2 });
  }
  let chosen: Row[] = [];
  let bestWeight = -1;
  for (const seed of segments) {
    const close = segments.filter((line) => Math.abs(line.slope - seed.slope) <= .022)
      .sort((a, b) => b.length - a.length);
    const distinct: Row[] = [];
    for (const line of close) {
      if (distinct.every((known) => Math.abs(line.y - known.y) > Math.max(5, .015 * height)))
        distinct.push(line);
    }
    if (distinct.length < 3 || Math.max(...distinct.map((line) => line.y))
      - Math.min(...distinct.map((line) => line.y)) < .14 * height) continue;
    const weight = distinct.reduce((sum, line) => sum + line.length, 0);
    if (weight > bestWeight) { chosen = distinct; bestWeight = weight; }
  }
  if (!chosen.length) return { status: 'no_three_consistent_part_rows' };
  const sum = chosen.reduce((acc, line) => acc + line.slope * line.length, 0);
  return { status: 'candidate', slope: sum / bestWeight, count: chosen.length };
}

function railX(line: Rail, y: number): number {
  return line.a[0] + (line.b[0] - line.a[0]) * (y - line.a[1]) / (line.b[1] - line.a[1]);
}

function sideRail(gray: any, box: OpticalBox, side: Side): Rail | null {
  const [left, top, right, bottom] = box;
  const width = right - left;
  const height = bottom - top;
  const seed = side === 'left' ? left : right;
  const x0 = Math.max(0, Math.floor(seed - 65));
  const x1 = Math.min(gray.cols, Math.floor(seed + 65));
  const y0 = Math.max(0, Math.floor(top - 25));
  const y1 = Math.min(gray.rows, Math.floor(bottom + 25));
  if (x1 <= x0 || y1 <= y0) return null;
  const candidates: Rail[] = [];
  for (const [ax, ay, bx, by] of hough(gray, x0, y0, x1 - x0, y1 - y0,
    70, 180, Math.floor(height * .48), 25)) {
    const length = Math.abs(by - ay);
    const overlap = Math.max(0, Math.min(Math.max(ay, by), bottom)
      - Math.max(Math.min(ay, by), top));
    if (length < height * .55 || overlap < height * .65
      || Math.abs(bx - ax) > length * .11) continue;
    const line: Rail = { a: [ax, ay], b: [bx, by], overlap, midX: (ax + bx) / 2 };
    if (Math.abs(railX(line, (top + bottom) / 2) - seed) <= .025 * width)
      candidates.push(line);
  }
  candidates.sort((a, b) => Math.abs(railX(a, (top + bottom) / 2) - seed)
    - Math.abs(railX(b, (top + bottom) / 2) - seed) || b.overlap - a.overlap);
  return candidates[0] ?? null;
}

function rowSide(yAtBadge: number, slope: number, badgeX: number,
  side: number | Rail): Point {
  if (typeof side === 'number') return [side, yAtBadge + slope * (side - badgeX)];
  const [ax, ay] = side.a;
  const [bx, by] = side.b;
  const verticalSlope = (bx - ax) / (by - ay);
  const verticalIntercept = ax - verticalSlope * ay;
  const y = (yAtBadge + slope * (verticalIntercept - badgeX)) / (1 - slope * verticalSlope);
  return [verticalSlope * y + verticalIntercept, y];
}

/** A new quad is only a proposal; the caller must still require a closed read. */
export function fitOpticalBadgeRowQuad(bgr: any, detections: Detection[]): BadgeRowFit {
  const c = cv();
  if (bgr.cols * 9 !== bgr.rows * 16) return { status: 'unsupported_aspect' };
  const playerDetection = detections.filter((item) => item.label === 'player_timetrail_box')
    .sort((a, b) => b.score - a.score)[0];
  if (!playerDetection) return { status: 'no_player_card' };
  const ghostDetection = detections.filter((item) => item.label === 'ghost_timetrail_box')
    .sort((a, b) => b.score - a.score)[0];
  const player = boxOf(playerDetection, bgr.cols, bgr.rows);
  const ghost = ghostDetection ? boxOf(ghostDetection, bgr.cols, bgr.rows) : null;
  const badges = detections.filter((item) => item.label === 'lap_index')
    .map((item): Point => [(item.left + item.right) * bgr.cols / 2,
      (item.top + item.bottom) * bgr.rows / 2])
    .filter(([x, y]) => player[0] <= x && x <= player[2] && player[1] <= y && y <= player[3])
    .sort((a, b) => a[1] - b[1]);
  if (badges.length !== 3 && badges.length !== 7) return { status: 'incomplete_badge_column' };
  const gaps = badges.slice(1).map((point, index) => point[1] - badges[index][1]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const pitch = (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2;
  if (pitch <= 0 || Math.max(...gaps) - Math.min(...gaps) > .12 * pitch)
    return { status: 'irregular_badge_pitch' };
  const referencePitch = badges.length === 3 ? 44 : 32;
  const scale = 1280 / bgr.cols;
  const scaledPlayer = player.map((v) => v * scale) as OpticalBox;
  const [left, top, right, bottom] = scaledPlayer;
  const scaledPitch = pitch * scale;
  if ((right - left) / (684 * scaledPitch / referencePitch) < .78
    || (right - left) / (684 * scaledPitch / referencePitch) > 1.22)
    return { status: 'card_width_conflicts_with_badges' };
  const resized = new c.Mat();
  const gray = new c.Mat();
  try {
    c.resize(bgr, resized, new c.Size(1280, 720));
    c.cvtColor(resized, gray, c.COLOR_BGR2GRAY);
    const rows = rowsAt(gray, scaledPlayer);
    if (rows.status !== 'candidate') return { status: rows.status, badgeCount: badges.length };
    const slope = rows.slope!;
    const badgeX = badges[0][0] * scale;
    const firstRef = badges.length === 3 ? 93 : 77;
    const cardHeight = badges.length === 3 ? 227 : 299;
    const topAtBadge = badges[0][1] * scale - firstRef * scaledPitch / referencePitch;
    const bottomAtBadge = topAtBadge + cardHeight * scaledPitch / referencePitch;
    if (Math.abs(topAtBadge - top) > .17 * (bottom - top)
      || Math.abs(bottomAtBadge - bottom) > .17 * (bottom - top))
      return { status: 'badge_height_conflicts_with_card_box', badgeCount: badges.length };
    const sides = {} as Record<Side, number | Rail>;
    const sources = {} as Record<Side, string>;
    for (const side of ['left', 'right'] as const) {
      const playerRail = sideRail(gray, scaledPlayer, side);
      const ghostRail = ghost ? sideRail(gray, ghost.map((v) => v * scale) as OpticalBox, side) : null;
      const selected = playerRail ?? ghostRail;
      const detectorEdge = side === 'left' ? left : right;
      if (playerRail && ghostRail) {
        const midY = (top + bottom) / 2;
        if (Math.abs(railX(playerRail, midY) - railX(ghostRail, midY)) > .02 * (right - left))
          return { status: 'player_ghost_rails_conflict', badgeCount: badges.length };
      }
      if (selected && [topAtBadge, bottomAtBadge].every((y) => Math.abs(railX(selected, y) - detectorEdge)
        <= .035 * (right - left))) {
        sides[side] = selected;
        sources[side] = playerRail ? 'player_rail' : 'ghost_rail';
      } else {
        sides[side] = detectorEdge;
        sources[side] = 'detector';
      }
    }
    if (sources.left === 'detector' && sources.right === 'detector')
      return { status: 'no_card_rail', badgeCount: badges.length, rowCount: rows.count };
    const quad = [rowSide(topAtBadge, slope, badgeX, sides.left),
      rowSide(topAtBadge, slope, badgeX, sides.right),
      rowSide(bottomAtBadge, slope, badgeX, sides.right),
      rowSide(bottomAtBadge, slope, badgeX, sides.left)] as OpticalQuad;
    if (quad.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y)
      || x < 0 || x > 1280 || y < 0 || y > 720))
      return { status: 'quad_outside_image', badgeCount: badges.length };
    return { status: 'candidate', quad: quad.map(([x, y]) => [x / scale, y / scale]),
      badgeCount: badges.length, rowCount: rows.count, sideSources: sources };
  } finally {
    gray.delete(); resized.delete();
  }
}
