// The central frame geometry (CENTRAL_RECOGNITION section 8.6, phase 5): the TypeScript port of
// python/mk8dx_icon_matcher/frame_geometry.py (the reference) and FrameGeometry.java, kept equal by
// the parity vectors (tooling/recognition/frame_geometry_vectors.py). Where a Time Trial card's
// fields lie on the canonical frame, from the pack's frame-definitions-v1.json. Rounding is half up
// (Math.round); the registration window truncates toward zero.

export interface FrameDefinitions {
  schema: string;
  canonical: number[];
  endScreen: {
    panels: Record<string, Record<string, number[]>>;
    panelRels: Record<string, Record<string, number[]>> | null;
    slots: Record<string, { rel_xywh: number[] }>;
  };
  registration: {
    pad: number[];
    offsets: Record<string, Record<string, number[]>>;
    boxSizes: Record<string, number[]>;
    deployCard: Record<string, number[]>;
    scoreMin: number;
    half: number;
  };
  timeGrids: { endScreen: unknown; ghostDetail: unknown };
  matcher: { searchPad: { icon: number; flag: number } };
  textStrip: { rightRatio: { card: number; ghostDetail: number }; gap: number; top: number; heightPad: number;
    ghostNameRightRatio: number };
}

export interface PanelBox { x: number; y: number; w: number; h: number; source: 'lap_index_anchor' | 'static_canonical' }

const GHOST_DETAIL_KEYS = ['ghost_detail', 'ghost_detail7'];
export const REG_GROUP: Record<string, string> = {
  character_icon: 'characters', kart_icon: 'bodies', wheel_icon: 'tires', glider_icon: 'gliders', flag_icon: 'flags',
};

const round = (x: number): number => Math.floor(x + 0.5);

/** [race, laps, ghostDetail] for an engine race key. */
export function raceAndLaps(raceKey: string): [string, string, boolean] {
  if (GHOST_DETAIL_KEYS.includes(raceKey)) return [raceKey, raceKey, true];
  const race = raceKey === 'race7' ? 'race7' : 'race3';
  return [race, race === 'race7' ? '7laps' : '3laps', false];
}

/** The owner's card, or null when the frame has no such panel. */
export function panelBox(defs: FrameDefinitions, raceKey: string, owner: string, anchor: number[] | null): PanelBox | null {
  const [race] = raceAndLaps(raceKey);
  const rel = defs.endScreen.panelRels?.[race]?.[owner];
  if (anchor && rel) {
    return { x: anchor[0] + rel[0], y: anchor[1] + rel[1], w: rel[2] - rel[0], h: rel[3] - rel[1], source: 'lap_index_anchor' };
  }
  const panel = defs.endScreen.panels[race]?.[owner];
  if (!panel) return null;
  return { x: panel[0], y: panel[1], w: panel[2] - panel[0], h: panel[3] - panel[1], source: 'static_canonical' };
}

/** [x1, y1, x2, y2] the card registration searches. */
export function registerWindow(defs: FrameDefinitions, panel: PanelBox, imageW: number, imageH: number): number[] {
  const [side, top, bottom] = defs.registration.pad;
  return [Math.max(0, Math.trunc(panel.x - side)), Math.max(0, Math.trunc(panel.y - top)),
    Math.min(imageW, Math.trunc(panel.x + panel.w + side)), Math.min(imageH, Math.trunc(panel.y + panel.h + bottom))];
}

/** A field's [x, y, w, h] on the deploy card, scaled to the panel; null without data. */
export function deployBox(defs: FrameDefinitions, iconKind: string, laps: string, panelW: number, panelH: number): number[] | null {
  const reg = defs.registration;
  const group = REG_GROUP[iconKind];
  const off = reg.offsets?.[laps === '7laps' ? '7lap' : '3lap']?.[group];
  const size = reg.boxSizes?.[group];
  const card = reg.deployCard?.[laps];
  if (!off || !size || !card) return null;
  const [dw, dh] = card;
  return [off[0] / dw * panelW, off[1] / dh * panelH, size[0] / dw * panelW, size[1] / dh * panelH];
}

export function slotRel(defs: FrameDefinitions, owner: string, iconKind: string, laps: string): number[] | null {
  const slots = defs.endScreen.slots;
  const slot = slots[`${owner}_${iconKind}_${laps}`] ?? slots[`player_${iconKind}_${laps}`];
  return slot ? slot.rel_xywh : null;
}

/** The field's rough slot [x, y, w, h]; registration: [dx, dy, sx, sy] of a registered card, else null. */
export function slotBox(defs: FrameDefinitions, owner: string, iconKind: string, laps: string, panel: PanelBox,
  registration: number[] | null): number[] | null {
  const rel = slotRel(defs, owner, iconKind, laps);
  if (!rel) return null;
  const box = registration ? deployBox(defs, iconKind, laps, panel.w, panel.h) : null;
  if (box && registration) {
    const [dx, dy, sx, sy] = registration;
    return [round(panel.x + dx + sx * (box[0] + box[2] / 2.0) - box[2] / 2.0),
      round(panel.y + dy + sy * (box[1] + box[3] / 2.0) - box[3] / 2.0), round(box[2]), round(box[3])];
  }
  return [round(panel.x + rel[0] * panel.w), round(panel.y + rel[1] * panel.h), round(rel[2] * panel.w), round(rel[3] * panel.h)];
}

/** [x1, y1, x2, y2]: the slot widened by the matcher's search pad (smaller for flags). */
export function searchWindow(defs: FrameDefinitions, iconKind: string, slot: number[], imageW: number, imageH: number): number[] {
  const pad = iconKind === 'flag_icon' ? defs.matcher.searchPad.flag : defs.matcher.searchPad.icon;
  return [Math.max(0, slot[0] - pad), Math.max(0, slot[1] - pad), Math.min(imageW, slot[0] + slot[2] + pad),
    Math.min(imageH, slot[1] + slot[3] + pad)];
}

/** Where printed row text ends (x). */
export function textRight(defs: FrameDefinitions, panel: PanelBox, ghostDetail: boolean): number {
  const ratios = defs.textStrip.rightRatio;
  return round(panel.x + (ghostDetail ? ratios.ghostDetail : ratios.card) * panel.w);
}

/** [x, y, w, h] of the printed name right of a slot, up to `right`. */
export function textStrip(defs: FrameDefinitions, slot: number[], right: number): number[] {
  const strip = defs.textStrip;
  const x = slot[0] + slot[2] + strip.gap;
  return [x, slot[1] + strip.top, right - x, slot[3] + strip.heightPad];
}

/** Where the rider name ends on the Select-a-Ghost panel (x). */
export function ghostNameRight(defs: FrameDefinitions, panel: PanelBox): number {
  return round(panel.x + defs.textStrip.ghostNameRightRatio * panel.w);
}

const REGISTER_SCALES_Y = [0.94, 0.96, 0.98, 1.00, 1.02, 1.04];
const REGISTER_SCALES_X = [0.97, 1.00, 1.03];
const REGISTER_SCALE_PENALTY = 0.25;
const REGISTER_MIN_WINDOW = 32;
const REGISTER_MIN_TEMPLATE = 8;
const REGISTER_REFINE_MARGIN = 5;
const REGISTER_REFINE_TOLERANCE = 0.05;

/** [score, x, y] of a template match (TM_CCOEFF_NORMED on the edge magnitude). */
export type RegisterMatch = [number, number, number];

export interface RegisterMatcher {
  /** The template resized to tw x th on the edge map reduced to registerCoarseSize. */
  coarse(tw: number, th: number): RegisterMatch;
  /** The full-size template inside [x1, y1, x2, y2] of the full edge map; x, y relative to it. */
  fine(x1: number, y1: number, x2: number, y2: number, tw: number, th: number): RegisterMatch;
}

/** [w, h] of the reduced edge map the coarse search runs on. */
export function registerCoarseSize(defs: Pick<FrameDefinitions, 'registration'>, window: number[]): number[] {
  const half = defs.registration.half;
  return [round((window[2] - window[0]) * half), round((window[3] - window[1]) * half)];
}

/**
 * Where the card's edge template fits: [dx, dy, sx, sy, raw, failed] (offset from the panel's
 * corner, scales, match score, 1 when the card did not register). The product does the pixel work
 * through `matcher`.
 */
export function registerCard(defs: Pick<FrameDefinitions, 'registration'>, panel: { x: number; y: number; w: number; h: number },
  window: number[], matcher: RegisterMatcher): number[] {
  const { half, scoreMin } = defs.registration;
  const ww = window[2] - window[0];
  const wh = window[3] - window[1];
  if (ww < REGISTER_MIN_WINDOW || wh < REGISTER_MIN_WINDOW) return [0, 0, 1, 1, 0, 1];
  const [cw, ch] = registerCoarseSize(defs, window);
  let best: { score: number; x: number; y: number; sx: number; sy: number; raw: number } | null = null;
  for (const sy of REGISTER_SCALES_Y) {
    for (const sx of REGISTER_SCALES_X) {
      const tw = round(panel.w * half * sx);
      const th = round(panel.h * half * sy);
      if (tw < REGISTER_MIN_TEMPLATE || th < REGISTER_MIN_TEMPLATE || tw > cw || th > ch) continue;
      const [raw, x, y] = matcher.coarse(tw, th);
      const score = raw - REGISTER_SCALE_PENALTY * (Math.abs(sy - 1.0) + Math.abs(sx - 1.0));
      if (!best || score > best.score) best = { score, x, y, sx, sy, raw };
    }
  }
  if (!best) return [0, 0, 1, 1, 0, 1];
  if (best.raw < scoreMin) return [0, 0, 1, 1, best.raw, 1];
  const tw = round(panel.w * best.sx);
  const th = round(panel.h * best.sy);
  let fx = round(best.x / half);
  let fy = round(best.y / half);
  let raw = best.raw;
  const m = REGISTER_REFINE_MARGIN;
  const x1 = Math.max(0, fx - m);
  const y1 = Math.max(0, fy - m);
  const x2 = Math.min(ww, fx + tw + m);
  const y2 = Math.min(wh, fy + th + m);
  if (y2 - y1 >= th && x2 - x1 >= tw) {
    const [fineRaw, x, y] = matcher.fine(x1, y1, x2, y2, tw, th);
    if (fineRaw >= best.raw - REGISTER_REFINE_TOLERANCE) {
      fx = x1 + x;
      fy = y1 + y;
      raw = fineRaw;
    }
  }
  return [window[0] + fx - panel.x, window[1] + fy - panel.y, best.sx, best.sy, raw, 0];
}
