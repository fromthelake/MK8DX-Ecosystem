// The central scan result (CENTRAL_RECOGNITION section 8.6, phase 4): the TypeScript port of
// python/mk8dx_icon_matcher/scan_result.py (the reference) and ScanResult.java, kept equal by the
// parity vectors (tooling/recognition/scan_result_vectors.py). What a locked Time Trial scan says,
// built from the sequence decision's output, so the Web scanner and the APK give the same result
// for the same frames.

export const SCAN_RESULT_SCHEMA = 'mk8dx.scan-result.v1';
export const SCAN_DOUBT_BELOW = 0.75;
const MAX_ALTERNATIVES = 2;
const MAX_NAME_CODE_POINTS = 64;
const MAX_TIME_MS = 599999;
const TIME = /^([0-9]):([0-5][0-9])\.([0-9]{3})$/;

export type ScanPartName = 'character' | 'body' | 'tire' | 'glider' | 'country';
/** The sequence decision's slot names, mapped to the contract's part names. */
export const SCAN_PARTS: readonly (readonly [ScanPartName, string])[] = [
  ['character', 'character'], ['body', 'kart'], ['tire', 'wheel'], ['glider', 'glider'], ['country', 'flag'],
];
const CAPTURE_LAYOUT: Record<string, 'time_trial_result' | 'ghost_details'> = {
  endscreen: 'time_trial_result', ghost_detail: 'ghost_details',
};

export interface ScanAlternative { id: string | null; index: number | null; name: string | null }

export interface ScanPart {
  present: boolean;
  accepted: boolean;
  id: string | null;
  index: number | null;
  score: number | null;
  doubt: boolean;
  alternatives: ScanAlternative[];
}

export interface ScanLap { time: string | null; ms: number | null }

export interface CentralScanResult {
  schema: string;
  status: 'ok' | 'not_locked' | 'no_total';
  owner: 'player' | 'ghost';
  layout: 'endscreen' | 'ghost_detail';
  captureLayout: 'time_trial_result' | 'ghost_details';
  acceptPath: string | null;
  totalTime: string | null;
  totalMs: number | null;
  laps: ScanLap[];
  lapsComplete: boolean;
  lapSumMatches: boolean | null;
  parts: Partial<Record<ScanPartName, ScanPart>>;
  confidence: Partial<Record<ScanPartName, number>>;
  /** Part names and "laps" the player must check. */
  doubt: string[];
  observedPlayerName: string | null;
}

/** Milliseconds of a readable m:ss.mmm time; null for anything else. */
export function scanTimeMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = TIME.exec(value);
  if (!m) return null;
  const ms = Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number(m[3]);
  return ms >= 1 && ms <= MAX_TIME_MS ? ms : null;
}

function round4(score: unknown): number | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return Math.floor(score * 10000 + 0.5) / 10000;
}

function has(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function partOf(slot: unknown): ScanPart {
  if (!slot || typeof slot !== 'object' || Array.isArray(slot)) {
    return { present: false, accepted: false, id: null, index: null, score: null, doubt: false, alternatives: [] };
  }
  const s = slot as Record<string, unknown>;
  const accepted = s.ok === true;
  const score = round4(s.score);
  const id = typeof s.id === 'string' && s.id ? s.id : null;
  const index = isInt(s.index) ? s.index : null;
  const alternatives: ScanAlternative[] = [];
  if (!accepted && Array.isArray(s.alternatives)) {
    for (const alt of s.alternatives.slice(0, MAX_ALTERNATIVES)) {
      if (!alt || typeof alt !== 'object' || Array.isArray(alt)) continue;
      const a = alt as Record<string, unknown>;
      alternatives.push({ id: typeof a.id === 'string' ? a.id : null, index: isInt(a.index) ? a.index : null,
        name: typeof a.name === 'string' ? a.name : null });
    }
  }
  return { present: true, accepted, id, index, score,
    doubt: accepted && score !== null && score < SCAN_DOUBT_BELOW, alternatives };
}

function nameOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
  const points = [...name].length;
  return points >= 1 && points <= MAX_NAME_CODE_POINTS ? name : null;
}

/** The scan result of a sequence decision; lapCount: the track's lap count when known. */
export function composeScanResult(consensus: Record<string, any>, lapCount: number | null = null): CentralScanResult {
  const fields: Record<string, unknown> = consensus.fields && typeof consensus.fields === 'object'
    && !Array.isArray(consensus.fields) ? consensus.fields : {};
  const owner = has(fields, 'player_total') ? 'player' : 'ghost';
  const layout = consensus.layout === 'endscreen' || consensus.layout === 'ghost_detail'
    ? consensus.layout as 'endscreen' | 'ghost_detail' : owner === 'player' ? 'endscreen' : 'ghost_detail';
  const path = has(consensus, 'acceptPath') ? consensus.acceptPath : consensus.accept_path;
  const acceptPath = typeof path === 'string' ? path : null;
  const out: CentralScanResult = { schema: SCAN_RESULT_SCHEMA, status: 'ok', owner, layout,
    captureLayout: CAPTURE_LAYOUT[layout], acceptPath, totalTime: null, totalMs: null, laps: [],
    lapsComplete: false, lapSumMatches: null, parts: {}, confidence: {}, doubt: [], observedPlayerName: null };
  if (consensus.locked !== true) {
    out.status = 'not_locked';
    return out;
  }
  const total = fields[`${owner}_total`];
  const totalMs = scanTimeMs(total);
  if (totalMs === null) {
    out.status = 'no_total';
    return out;
  }
  out.totalTime = total as string;
  out.totalMs = totalMs;
  let last = 0;
  for (let lap = 1; lap <= 7; lap++) if (has(fields, `${owner}_lap_${lap}`)) last = lap;
  for (let lap = 1; lap <= last; lap++) {
    const value = fields[`${owner}_lap_${lap}`];
    const ms = scanTimeMs(value);
    out.laps.push({ time: ms !== null ? value as string : null, ms });
  }
  out.lapsComplete = (last === 3 || last === 7) && out.laps.every((lap) => lap.ms !== null)
    && (lapCount === null || last === lapCount);
  if (out.lapsComplete) {
    out.lapSumMatches = out.laps.reduce((sum, lap) => sum + (lap.ms as number), 0) === totalMs;
    if (!out.lapSumMatches) out.doubt.push('laps');
  }
  const rawIdentity = consensus.identity && typeof consensus.identity === 'object' ? consensus.identity[owner] : null;
  const identity: Record<string, unknown> = rawIdentity && typeof rawIdentity === 'object' && !Array.isArray(rawIdentity)
    ? rawIdentity : {};
  for (const [name, slot] of SCAN_PARTS) {
    const part = partOf(identity[slot]);
    out.parts[name] = part;
    if (part.accepted && part.score !== null) out.confidence[name] = part.score;
    if (part.doubt) out.doubt.push(name);
  }
  out.observedPlayerName = nameOf(identity.card_name);
  return out;
}
