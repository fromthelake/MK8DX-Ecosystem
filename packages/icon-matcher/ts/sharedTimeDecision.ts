/** The central time decision across the fields of one card (Python time_decision.py, Java
 * TimeDecision; CENTRAL_RECOGNITION section 8.6, phase 2c): the M:SS.mmm format, the lap sum,
 * the single-digit fill/flip that closes it, and the repair-confidence guard. Pure text logic:
 * the matcher reads the digits, this decides the card.
 */

export const DIGIT_POSITIONS = [0, 2, 3, 5, 6, 7] as const;
export const REPAIR_MIN_DIGIT_CONFIDENCE = 0.65;

const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';

export function formatValid(text: string | null | undefined): boolean {
  if (!text || text.length !== 8 || text.charAt(1) !== ':' || text.charAt(4) !== '.') return false;
  for (const pos of DIGIT_POSITIONS) if (!isDigit(text.charAt(pos))) return false;
  const seconds = parseInt(text.substring(2, 4), 10);
  return seconds >= 0 && seconds <= 59;
}

export function timeMs(text: string | null | undefined): number | null {
  if (!formatValid(text)) return null;
  const t = text as string;
  return parseInt(t.substring(0, 1), 10) * 60000 + parseInt(t.substring(2, 4), 10) * 1000 + parseInt(t.substring(5, 8), 10);
}

export interface OwnerTimes { total: string | null; laps: string[] }

/** Every owner that shows times closes, and at least one does. */
export function lapSumComplete(owners: OwnerTimes[]): boolean {
  let closed = 0;
  for (const owner of owners) {
    if (owner.total === null && owner.laps.length === 0) continue;
    const total = owner.total !== null ? timeMs(owner.total) : null;
    if (total === null || owner.laps.length === 0) return false;
    let lapSum = 0;
    for (const lap of owner.laps) {
      const ms = timeMs(lap);
      if (ms === null) return false;
      lapSum += ms;
    }
    if (lapSum !== total) return false;
    closed++;
  }
  return closed > 0;
}

const replaceAt = (text: string, pos: number, ch: string): string => text.substring(0, pos) + ch + text.substring(pos + 1);

function delta(texts: string[], index: number, replacement: string | null): number | null {
  let total = 0;
  let lapSum = 0;
  for (let i = 0; i < texts.length; i++) {
    const ms = timeMs(i === index ? replacement : texts[i]);
    if (ms === null) return null;
    if (i === 0) total = ms;
    else lapSum += ms;
  }
  return lapSum - total;
}

export interface LapSumRepair { field: number; pos: number; from: string; to: string; kind: 'fill' | 'flip' }

/** One owner's [total, lap1, lap2, ...]: the single repair that closes the sum, or null. */
export function lapSumClosure(texts: string[]): LapSumRepair | null {
  if (texts.some((t) => !t || t.length !== 8 || t.charAt(1) !== ':' || t.charAt(4) !== '.')) return null;
  const unknown: [number, number][] = [];
  texts.forEach((text, field) => {
    for (const pos of DIGIT_POSITIONS) if (!isDigit(text.charAt(pos))) unknown.push([field, pos]);
  });
  if (unknown.length === 1) {
    const [field, pos] = unknown[0];
    const fits: string[] = [];
    for (let d = 0; d <= 9; d++) {
      const candidate = replaceAt(texts[field], pos, String(d));
      if (formatValid(candidate) && delta(texts, field, candidate) === 0) fits.push(String(d));
    }
    return fits.length === 1
      ? { field, pos, from: texts[field], to: replaceAt(texts[field], pos, fits[0]), kind: 'fill' } : null;
  }
  if (unknown.length > 0) return null;
  const current = delta(texts, -1, null);
  if (current === null || current === 0) return null;
  let found: LapSumRepair | null = null;
  let count = 0;
  texts.forEach((text, field) => {
    for (const pos of DIGIT_POSITIONS) {
      for (let d = 0; d <= 9; d++) {
        if (String(d) === text.charAt(pos)) continue;
        const candidate = replaceAt(text, pos, String(d));
        if (formatValid(candidate) && delta(texts, field, candidate) === 0) {
          found = { field, pos, from: text, to: candidate, kind: 'flip' };
          count++;
        }
      }
    }
  });
  return count === 1 ? found : null;
}

export interface RepairGuard { kind: 'repair_confidence_guard'; min_digit_confidence: number; threshold: number }

/** The guard record when a repaired, closed sum must count as open; null when it stands. */
export function repairGuard(lapSumOk: boolean, repairCount: number, minDigitConfidence: number): RepairGuard | null {
  if (!lapSumOk || repairCount === 0 || minDigitConfidence >= REPAIR_MIN_DIGIT_CONFIDENCE) return null;
  return { kind: 'repair_confidence_guard', min_digit_confidence: minDigitConfidence, threshold: REPAIR_MIN_DIGIT_CONFIDENCE };
}
