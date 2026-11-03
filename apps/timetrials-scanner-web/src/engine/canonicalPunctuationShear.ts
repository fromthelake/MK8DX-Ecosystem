/** Opt-in endscreen geometry probe: fixed game punctuation against the known 7-lap grid. */
import { cv, rgbaToBgrMat } from './cv';
import type { Detection, Frame } from './types';

export interface PunctuationField { owner: string; lap: number; left: number; top: number }
interface Hit { owner: string; lap: number; y: number; dx: number; score: number }
export interface PunctuationShearFit {
  selected: boolean;
  reason: string;
  slope: number;
  intercept: number;
  badgeDeltaX: number;
  colonMinScore: number;
  dotMinScore: number;
  dotMaeBefore: number;
  dotMaeAfterPredicted: number;
  maxShift: number;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
const round = (n: number): number => Math.round(n * 1000) / 1000;

function hits(gray: any, reference: any, fields: PunctuationField[], kind: 'colon' | 'dot'): Hit[] {
  const c = cv();
  const refX = kind === 'colon' ? 1071 : 1117;
  const width = kind === 'colon' ? 6 : 4;
  const expectedDeltaX = refX - 1053;
  const found: Hit[] = [];
  for (const field of fields) {
    const sourceY = field.owner === 'player' ? 427 : 125;
    const template = reference.roi(new c.Rect(refX, sourceY, width, 24));
    const x = Math.round(field.left + expectedDeltaX);
    const y = Math.round(field.top);
    const pad = 9;
    if (x - pad < 0 || y - pad < 0 || x + width + pad > gray.cols || y + 24 + pad > gray.rows) {
      template.delete();
      return [];
    }
    const search = gray.roi(new c.Rect(x - pad, y - pad, width + 2 * pad, 24 + 2 * pad));
    const response = new c.Mat();
    try {
      c.matchTemplate(search, template, response, c.TM_CCOEFF_NORMED);
      const best = c.minMaxLoc(response);
      found.push({ owner: field.owner, lap: field.lap, y: y + 12,
        dx: best.maxLoc.x - pad, score: best.maxVal });
    } finally {
      template.delete(); search.delete(); response.delete();
    }
  }
  return found;
}

function fitLine(points: Hit[]): { slope: number; intercept: number } {
  const my = mean(points.map((p) => p.y));
  const mx = mean(points.map((p) => p.dx));
  const denominator = points.reduce((v, p) => v + (p.y - my) ** 2, 0);
  const slope = points.reduce((v, p) => v + (p.y - my) * (p.dx - mx), 0) / denominator;
  return { slope, intercept: mx - slope * my };
}

/** Reference is an explicitly supplied capture-card image; never inferred from the evaluated photo. */
export function fitCanonicalPunctuationShear(canonical: any, referenceImage: Frame,
  fields: PunctuationField[], detections: Detection[]): PunctuationShearFit {
  const empty = (reason: string): PunctuationShearFit => ({ selected: false, reason,
    slope: 0, intercept: 0, badgeDeltaX: 0, colonMinScore: 0,
    dotMinScore: 0, dotMaeBefore: 0, dotMaeAfterPredicted: 0, maxShift: 0 });
  if (canonical.cols !== 1280 || canonical.rows !== 720 || referenceImage.width !== 1280
      || referenceImage.height !== 720 || fields.length !== 14
      || fields.filter((f) => f.owner === 'player').length !== 7
      || fields.filter((f) => f.owner === 'ghost').length !== 7) return empty('unsupported_layout');
  const c = cv();
  const gray = new c.Mat();
  const reference = new c.Mat();
  const referenceBgr = rgbaToBgrMat(referenceImage.rgba, referenceImage.width, referenceImage.height);
  let colon: Hit[];
  let dot: Hit[];
  try {
    c.cvtColor(canonical, gray, c.COLOR_BGR2GRAY);
    c.cvtColor(referenceBgr, reference, c.COLOR_BGR2GRAY);
    colon = hits(gray, reference, fields, 'colon');
    dot = hits(gray, reference, fields, 'dot');
  } finally {
    gray.delete(); reference.delete(); referenceBgr.delete();
  }
  if (colon.length !== 14 || dot.length !== 14) return empty('missing_punctuation');
  const colonMinScore = Math.min(...colon.map((p) => p.score));
  const dotMinScore = Math.min(...dot.map((p) => p.score));
  if (colonMinScore < 0.82 || dotMinScore < 0.82) return { ...empty('weak_punctuation'),
    colonMinScore: round(colonMinScore), dotMinScore: round(dotMinScore) };
  let line = fitLine(colon);
  const residuals = colon.map((p) => p.dx - line.slope * p.y - line.intercept);
  const center = median(residuals);
  const inliers = colon.filter((_, i) => Math.abs(residuals[i] - center) <= 2);
  if (inliers.length < 10) return empty('colon_anchors_disagree');
  line = fitLine(inliers);
  const shift = (y: number) => line.slope * y + line.intercept;
  const maxShift = Math.max(Math.abs(shift(0)), Math.abs(shift(720)));
  const ownerMean = (list: Hit[], owner: string) => mean(list.filter((p) => p.owner === owner).map((p) => p.dx));
  const colonOwnerDelta = ownerMean(colon, 'ghost') - ownerMean(colon, 'player');
  const dotOwnerDelta = ownerMean(dot, 'ghost') - ownerMean(dot, 'player');
  const badgeCenters = (owner: string) => detections.filter((d) => d.label === 'lap_index'
    && ((d.top + d.bottom) * 0.5 < 0.5) === (owner === 'ghost'))
    .map((d) => ((d.left + d.right) * 0.5) * 1280);
  const ghostBadges = badgeCenters('ghost');
  const playerBadges = badgeCenters('player');
  if (ghostBadges.length !== 7 || playerBadges.length !== 7) return empty('missing_badge_column');
  const badgeDeltaX = mean(ghostBadges) - mean(playerBadges);
  const dotMaeBefore = mean(dot.map((p) => Math.abs(p.dx)));
  const dotMaeAfterPredicted = mean(dot.map((p) => Math.abs(p.dx - shift(p.y))));
  const dotPlayerAfter = mean(dot.filter((p) => p.owner === 'player').map((p) => Math.abs(p.dx - shift(p.y))));
  const dotPlayerBefore = mean(dot.filter((p) => p.owner === 'player').map((p) => Math.abs(p.dx)));
  let reason = 'selected';
  if (maxShift > 9 || Math.abs(line.slope) > 0.03) reason = 'correction_too_large';
  else if (Math.abs(line.slope) < 0.006) reason = 'already_upright';
  else if (Math.abs(badgeDeltaX) < 4 || Math.sign(badgeDeltaX) !== Math.sign(colonOwnerDelta)
      || Math.sign(dotOwnerDelta) !== Math.sign(colonOwnerDelta)) reason = 'badge_or_dot_disagrees';
  else if (dotMaeAfterPredicted > dotMaeBefore - 0.7 || dotPlayerAfter > dotPlayerBefore + 1)
    reason = 'heldout_dots_not_better';
  return { selected: reason === 'selected', reason, slope: round(line.slope),
    intercept: round(line.intercept), badgeDeltaX: round(badgeDeltaX),
    colonMinScore: round(colonMinScore), dotMinScore: round(dotMinScore),
    dotMaeBefore: round(dotMaeBefore), dotMaeAfterPredicted: round(dotMaeAfterPredicted),
    maxShift: round(maxShift) };
}
