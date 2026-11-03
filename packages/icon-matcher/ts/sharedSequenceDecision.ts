// The central sequence decision for a Time Trial scan (CENTRAL_RECOGNITION section 8.6, phase 6):
// the TypeScript port of python/mk8dx_icon_matcher/sequence_decision.py (the reference) and
// SequenceDecision.java, kept equal by the parity vectors
// (tooling/recognition/sequence_decision_vectors.py). The agreement over the frames of one scan:
// the times' evidence ladder (direct_lap_som / bevestigd_na_reparatie / veld_stemming) and the
// identity vote. Iteration order is insertion order everywhere (first best wins on ties).

export const FIELD_MIN_SUPPORT = 3;
export const FIELD_MIN_MARGIN = 2;
const ACCEPTED_VOTE_WEIGHT = 2;
export const SEQUENCE_KINDS = ['character', 'kart', 'wheel', 'glider', 'flag'] as const;
const TIME = /^[0-9]:[0-9][0-9]\.[0-9][0-9][0-9]$/;

type Observation = Record<string, unknown>;

export interface SequenceSnapshotEntry {
  id: string;
  index: number;
  name: string;
  asset_ref: string;
  score: number;
  ok: boolean;
  votes: number;
  frames: number;
  crop_png?: string;
  crop_path?: string;
  alternatives?: unknown[];
}

function millis(value: string): number {
  return (value.charCodeAt(0) - 48) * 60000 + (value.charCodeAt(2) - 48) * 10000
    + (value.charCodeAt(3) - 48) * 1000 + parseInt(value.substring(5), 10);
}

function repairImpossibleSeconds(valid: Map<string, string>): void {
  for (const owner of ['player', 'ghost']) {
    const total = valid.get(`${owner}_total`);
    if (total === undefined || total.charAt(2) > '5') continue;
    const lapKeys: string[] = [];
    for (let lap = 1; lap <= 7; lap++) {
      const key = `${owner}_lap_${lap}`;
      if (!valid.has(key)) break;
      lapKeys.push(key);
    }
    if (lapKeys.length < 2) continue;
    let sum = 0;
    let broken: string | null = null;
    for (const key of lapKeys) {
      const value = valid.get(key)!;
      if (value.charAt(2) > '5') {
        if (broken !== null) return;
        broken = key;
      }
      sum += millis(value);
    }
    if (broken === null) continue;
    const value = valid.get(broken)!;
    const fixed = value.substring(0, 2) + '0' + value.substring(3);
    if (sum - millis(value) + millis(fixed) === millis(total)) valid.set(broken, fixed);
  }
}

function best<K>(votes: Map<K, number>): [K | null, number, number] {
  let bestKey: K | null = null;
  let top = 0;
  let second = 0;
  for (const [key, count] of votes) {
    if (count > top) {
      second = top;
      top = count;
      bestKey = key;
    } else if (count > second) {
      second = count;
    }
  }
  return [bestKey, top, second];
}

export interface FieldVote<V> { value: V; weight: number; second: number; share: number }

/**
 * The shared multi-frame vote for one field (Python field_vote): (value, weight) per frame, empty
 * values skipped, negative weights count as 0 (the first value wins when every weight is 0); weights sum per value in first-seen order; the highest
 * sum wins, the first on a tie; null below minSupport or with a lead under minMargin. Presets: the
 * Time Trial ladder (3 / 2, closed frames weigh 2), Tournament Live and LiveTrial (0 / 0).
 */
export function fieldVote<V>(values: Iterable<readonly [V, number]>, minSupport = 0, minMargin = 0): FieldVote<V> | null {
  const sums = new Map<V, number>();
  let total = 0;
  for (const [value, weight] of values) {
    if (value === null || value === undefined || (value as unknown) === '') continue;
    const w = Math.max(0, Number(weight) || 0);
    sums.set(value, (sums.get(value) ?? 0) + w);
    total += w;
  }
  if (sums.size === 0) return null;
  let [value, top, second] = best(sums);
  if (value === null) [value, top, second] = [sums.keys().next().value as V, 0, 0];
  if (top < minSupport || top - second < minMargin) return null;
  return { value: value as V, weight: top, second, share: total > 0 ? top / total : 0 };
}

function scoreOf(observation: Observation | undefined): number {
  const score = observation?.score;
  return typeof score === 'number' ? score : 0;
}

function sameMap(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}

export class SequenceDecision {
  locked = false;
  acceptPath = '';
  lockedFields: Record<string, string> = {};
  framesAnalyzed = 0;
  acceptedFrames = 0;
  identityFrames = 0;

  private readonly frames: Map<string, string>[] = [];
  private readonly accepted: boolean[] = [];
  private repairCandidate: Map<string, string> | null = null;
  private expected = 0;
  private readonly votes = new Map<string, Map<string, number>>();
  private readonly meta = new Map<string, Map<string, Observation>>();
  private readonly names = new Map<string, Map<string, number>>();

  /** One analysed frame's times; true when this frame locked the times. */
  updateTimes(fields: Record<string, unknown> | null, lapSumOk: boolean, lapSumRepairs: number, expectedFields: number): boolean {
    this.framesAnalyzed++;
    if (!fields || Object.keys(fields).length === 0) return false;
    if (expectedFields > 0) this.expected = expectedFields;
    let valid = new Map<string, string>();
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === 'string' && value.length === 8 && TIME.test(value)) valid.set(key, value);
    }
    repairImpossibleSeconds(valid);
    valid = new Map([...valid].filter(([, value]) => value.charAt(2) <= '5'));
    if (valid.size === 0) return false;
    this.frames.push(valid);
    this.accepted.push(lapSumOk);
    if (lapSumOk) this.acceptedFrames++;
    if (this.locked) return false;
    if (lapSumOk && lapSumRepairs === 0 && valid.size >= Math.max(2, this.expected)) {
      this.lock(valid, 'direct_lap_som');
      return true;
    }
    if (lapSumOk && lapSumRepairs > 0) {
      if (this.repairCandidate !== null && sameMap(this.repairCandidate, valid)) {
        this.lock(valid, 'bevestigd_na_reparatie');
        return true;
      }
      this.repairCandidate = new Map(valid);
    }
    const candidate = this.fieldVoteCandidate();
    const required = this.expected > 0 ? this.expected : valid.size;
    if (required > 0 && candidate.size >= required) {
      this.lock(candidate, 'veld_stemming');
      return true;
    }
    return false;
  }

  private lock(fields: Map<string, string>, path: string): void {
    this.locked = true;
    this.acceptPath = path;
    this.lockedFields = Object.fromEntries(fields);
  }

  private fieldVoteCandidate(): Map<string, string> {
    const votes = new Map<string, [string, number][]>();
    this.frames.forEach((fields, index) => {
      const weight = this.accepted[index] ? ACCEPTED_VOTE_WEIGHT : 1;
      for (const [key, value] of fields) {
        let list = votes.get(key);
        if (!list) votes.set(key, list = []);
        list.push([value, weight]);
      }
    });
    const candidate = new Map<string, string>();
    for (const [key, list] of votes) {
      const won = fieldVote(list, FIELD_MIN_SUPPORT, FIELD_MIN_MARGIN);
      if (won) candidate.set(key, won.value);
    }
    return candidate;
  }

  /** One frame's identity reads: {owner: {kind: observation, card_name: text}}. */
  addIdentity(owners: Record<string, unknown> | null | undefined): void {
    if (owners === null || owners === undefined) return;
    this.identityFrames++;
    for (const [owner, raw] of Object.entries(owners)) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const match = raw as Record<string, unknown>;
      const cardName = typeof match.card_name === 'string' ? match.card_name.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '') : '';
      if (cardName) {
        let votes = this.names.get(owner);
        if (!votes) this.names.set(owner, votes = new Map());
        votes.set(cardName, (votes.get(cardName) ?? 0) + 1);
      }
      for (const kind of SEQUENCE_KINDS) {
        const result = match[kind];
        if (!result || typeof result !== 'object' || Array.isArray(result)) continue;
        const r = result as Observation;
        const voteKey = r.id !== null && r.id !== undefined ? String(r.id)
          : r.index !== null && r.index !== undefined ? String(r.index) : '';
        if (!voteKey) continue;
        const slot = `${owner}|${kind}`;
        let votes = this.votes.get(slot);
        if (!votes) this.votes.set(slot, votes = new Map());
        const ok = r.ok === true;
        votes.set(voteKey, (votes.get(voteKey) ?? 0) + (ok ? ACCEPTED_VOTE_WEIGHT : 1));
        let meta = this.meta.get(slot);
        if (!meta) this.meta.set(slot, meta = new Map());
        const previous = meta.get(voteKey);
        if (!previous || (ok && previous.ok !== true) || scoreOf(r) > scoreOf(previous)) meta.set(voteKey, r);
      }
    }
  }

  identitySettled(): boolean {
    if (this.identityFrames < 2 || this.votes.size === 0) return false;
    for (const [slot, votes] of this.votes) {
      let bestKey: string | null = null;
      let top = 0;
      let total = 0;
      for (const [key, count] of votes) {
        total += count;
        if (count > top) {
          top = count;
          bestKey = key;
        }
      }
      if (bestKey === null || top < 2 || top !== total) return false;
      const meta = this.meta.get(slot)?.get(bestKey);
      if (!meta || meta.ok !== true) return false;
    }
    return true;
  }

  identitySnapshot(): Record<string, Record<string, SequenceSnapshotEntry | string>> {
    const out: Record<string, Record<string, SequenceSnapshotEntry | string>> = {};
    for (const [slot, votes] of this.votes) {
      const bar = slot.indexOf('|');
      const owner = slot.substring(0, bar);
      const kind = slot.substring(bar + 1);
      const [bestKey, top, second] = best(votes);
      if (bestKey === null) continue;
      const meta = this.meta.get(slot)?.get(bestKey);
      const uncertain = second >= top || !meta || meta.ok !== true;
      const entry: SequenceSnapshotEntry = {
        id: !meta || meta.id === null || meta.id === undefined ? '' : String(meta.id),
        index: !meta || meta.index === null || meta.index === undefined ? -1 : Math.trunc(Number(meta.index)),
        name: typeof meta?.name === 'string' ? meta.name : '',
        asset_ref: typeof meta?.asset_ref === 'string' ? meta.asset_ref : '',
        score: scoreOf(meta),
        ok: !uncertain,
        votes: top,
        frames: this.identityFrames,
      };
      if (typeof meta?.crop_png === 'string') entry.crop_png = meta.crop_png;
      if (typeof meta?.crop_path === 'string') entry.crop_path = meta.crop_path;
      if (uncertain && Array.isArray(meta?.alternatives) && meta.alternatives.length) entry.alternatives = meta.alternatives;
      (out[owner] ??= {})[kind] = entry;
    }
    for (const [owner, votes] of this.names) {
      let bestName: string | null = null;
      let top = 0;
      for (const [name, count] of votes) {
        if (count > top) {
          top = count;
          bestName = name;
        }
      }
      if (bestName !== null) (out[owner] ??= {}).card_name = bestName;
    }
    return out;
  }

  /** The sequence decision as the central scan result reads it (sharedScanResult). */
  result(): Record<string, unknown> {
    return { locked: this.locked, acceptPath: this.acceptPath, fields: { ...this.lockedFields },
      identity: this.identitySnapshot(), framesAnalyzed: this.framesAnalyzed, acceptedFrames: this.acceptedFrames };
  }
}
