// Richtgids: port van MainActivity.DetectionOverlay.drawRichGuide/
// drawFieldCorners — CARD3/CARD7 (acht witte L-hoeken, twee kaarten) en
// GHOSTCARD3/GHOSTCARD7 (één paneelkader), bron-ruimte 1280x720, 7-laps
// guideScale 0.9 om het midden; alleen tekenen, geen crop/ROI. Staand: zie guideRects.
import type { LayoutProfile } from '../engine/types';

const CARD3: number[][] = [[218, 77, 844, 276], [218, 368, 844, 275]];
const CARD7: number[][] = [[276, 41, 724, 313], [276, 366, 724, 313]];
const GHOSTCARD3: number[][] = [[314, 60, 653, 600]];
const GHOSTCARD7: number[][] = [[365, 50, 551, 620]];

export interface Mapping {
  srcW: number;
  srcH: number;
  scale: number;
  dx: number;
  dy: number;
}

export function guideCards(layout: LayoutProfile, lapMode: 3 | 7): number[][] {
  return layout === 'ghost_detail' ? (lapMode === 7 ? GHOSTCARD7 : GHOSTCARD3) : (lapMode === 7 ? CARD7 : CARD3);
}

/**
 * Hoeveel van het staande leesvak de kaarten van de gids vullen. Rechtop stonden de kaarten in een
 * platte 16:9-strook op tweederde van de breedte, dus de tijden kwamen klein binnen; de eigenaar
 * vroeg het scherm te benutten (2026-09-17). Gelijk aan de APK (PORTRAIT_GUIDE_FILL), gemeten met
 * een webcam: kaarten op ~78% van de breedte lezen, op 87% niet meer.
 */
export const PORTRAIT_GUIDE_FILL = 0.8;
/** Hoog mag verder: de randproblemen zaten in de breedte, en het hoge ghostpaneel haalt anders de breedte niet. */
export const PORTRAIT_GUIDE_FILL_HEIGHT = 0.86;

/**
 * Waar elke kaart van de gids komt, als [left, top, right, bottom] in stage-pixels, plus de schaal
 * vanuit de 1280x720-bronruimte. Landschap houdt de geometrie van de engine in het ingeschreven
 * 16:9-kader; een staande stream tekent in het gecentreerde 4:3-vak over de volle breedte, precies
 * het deel dat captureFrame aan de engine geeft, met de kaarten samen op PORTRAIT_GUIDE_FILL.
 */
export function guideRects(m: Mapping, layout: LayoutProfile, lapMode: 3 | 7): { rects: number[][]; scale: number } {
  const cards = guideCards(layout, lapMode);
  const dispW = m.srcW * m.scale;
  const dispH = m.srcH * m.scale;
  if (m.srcH <= m.srcW) {
    const guideScale = lapMode === 7 ? 0.9 : 1.0;
    const boxW = Math.min(dispW, (dispH * 16) / 9);
    const boxH = (boxW * 9) / 16;
    const boxX = m.dx + (dispW - boxW) / 2;
    const boxY = m.dy + (dispH - boxH) / 2;
    const gx = (x: number) => boxX + ((640 + (x - 640) * guideScale) / 1280) * boxW;
    const gy = (y: number) => boxY + ((360 + (y - 360) * guideScale) / 720) * boxH;
    return { rects: cards.map((c) => [gx(c[0]), gy(c[1]), gx(c[0] + c[2]), gy(c[1] + c[3])]), scale: boxW / 1280 };
  }
  const boxW = Math.min(dispW, (dispH * 4) / 3);
  const boxH = (boxW * 3) / 4;
  const left = Math.min(...cards.map((c) => c[0]));
  const top = Math.min(...cards.map((c) => c[1]));
  const right = Math.max(...cards.map((c) => c[0] + c[2]));
  const bottom = Math.max(...cards.map((c) => c[1] + c[3]));
  const scale = Math.min((PORTRAIT_GUIDE_FILL * boxW) / (right - left), (PORTRAIT_GUIDE_FILL_HEIGHT * boxH) / (bottom - top));
  const cx = m.dx + dispW / 2;
  const cy = m.dy + dispH / 2;
  const gx = (x: number) => cx + (x - (left + right) / 2) * scale;
  const gy = (y: number) => cy + (y - (top + bottom) / 2) * scale;
  return { rects: cards.map((c) => [gx(c[0]), gy(c[1]), gx(c[0] + c[2]), gy(c[1] + c[3])]), scale };
}

export function drawGuide(ctx: CanvasRenderingContext2D, m: Mapping, layout: LayoutProfile, lapMode: 3 | 7, debugLabels: boolean): void {
  const { rects, scale } = guideRects(m, layout, lapMode);
  const armX = 48 * scale;
  const armY = 48 * scale;
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 12 * scale;
  ctx.lineCap = 'square';
  for (const [l, t, r, b] of rects) {
    const seg = (x1: number, y1: number, x2: number, y2: number) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };
    seg(l, t, l + armX, t);
    seg(l, t, l, t + armY);
    seg(r, t, r - armX, t);
    seg(r, t, r, t + armY);
    seg(l, b, l + armX, b);
    seg(l, b, l, b - armY);
    seg(r, b, r - armX, b);
    seg(r, b, r, b - armY);
  }
  if (debugLabels && rects.length > 0) {
    ctx.fillStyle = 'rgb(255,45,45)';
    ctx.font = 'bold 14px system-ui';
    const r7 = lapMode === 7;
    const first = rects[0]!;
    const last = rects[rects.length - 1]!;
    ctx.fillText(r7 ? 'Top - 7 laps' : 'Top', first[0] + 4, Math.max(20, first[1] - 6));
    ctx.fillText(r7 ? 'Bottom - 7 laps' : 'Bottom', last[0] + 4, last[3] + 18);
  }
  ctx.restore();
}
