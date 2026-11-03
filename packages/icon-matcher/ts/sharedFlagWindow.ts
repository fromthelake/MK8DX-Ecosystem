// Where inside its fixed slot does the flag sit? TypeScript counterpart of
// Python mk8dx_icon_matcher.flag_window and Java FlagWindow: the same search,
// each language scoring a position with its centre-only tensor match.

export const FLAG_WINDOW_PAD = 5;
const INSET_RATIO = 0.055;
const POSITION_PENALTY = 0.01;
const STEP = 2;

export type FlagWindowRead = {
  schema: 'mk8dx.flag-window.v1';
  cropXywh: [number, number, number, number];
  basis: 'fixed_slot' | 'window_search';
  score: number; slotScore: number; evaluated: number;
};

/** Python round(): halves go to the even neighbour. */
function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function flagInset(height: number): number {
  return Math.max(2, roundHalfEven(INSET_RATIO * height));
}

export function searchFlagWindow(windowWidth: number, windowHeight: number,
  slotXywh: [number, number, number, number],
  scoreAt: (left: number, top: number, width: number, height: number) => number): FlagWindowRead {
  const [x, y, width, height] = slotXywh;
  if (x < 0 || y < 0 || x + width > windowWidth || y + height > windowHeight) {
    throw new Error('Flag slot must fit its window');
  }
  const inset = flagInset(height);
  // Two crop sizes compete, the full slot first (see the Python module doc).
  const sizes: [number, number, number, number][] = [[width, height, x, y],
    [width - 2 * inset, height - 2 * inset, x + inset, y + inset]];
  const cache = new Map<string, number>();
  const score = (left: number, top: number, cw: number, ch: number): number => {
    const key = `${left},${top},${cw},${ch}`;
    if (!cache.has(key)) cache.set(key, scoreAt(left, top, cw, ch));
    return cache.get(key)!;
  };
  let best: [number, number, number, number, number] | null = null;
  for (const [cw, ch, cx, cy] of sizes) {
    const penalised = (left: number, top: number): number =>
      score(left, top, cw, ch) - POSITION_PENALTY * (Math.abs(left - cx) + Math.abs(top - cy));
    let sizeBest: [number, number, number] = [penalised(cx, cy), cx, cy];
    for (let top = 0; top <= windowHeight - ch; top += STEP) {
      for (let left = 0; left <= windowWidth - cw; left += STEP) {
        const value = penalised(left, top);
        if (value > sizeBest[0]) sizeBest = [value, left, top];
      }
    }
    const [, gx, gy] = sizeBest;
    for (let top = gy - 1; top <= gy + 1; top += 1) {
      for (let left = gx - 1; left <= gx + 1; left += 1) {
        if (left >= 0 && left <= windowWidth - cw && top >= 0 && top <= windowHeight - ch) {
          const value = penalised(left, top);
          if (value > sizeBest[0]) sizeBest = [value, left, top];
        }
      }
    }
    if (best === null || sizeBest[0] > best[0]) best = [sizeBest[0], sizeBest[1], sizeBest[2], cw, ch];
  }
  const [, bx, by, bw, bh] = best!;
  const full = bx === x && by === y && bw === width && bh === height;
  return { schema: 'mk8dx.flag-window.v1', cropXywh: [bx, by, bw, bh],
    basis: full ? 'fixed_slot' : 'window_search',
    score: score(bx, by, bw, bh), slotScore: score(x, y, width, height), evaluated: cache.size };
}
