// The scan's sequence decision: the central specification (packages/icon-matcher
// sharedSequenceDecision, the same rules as the APK and Python; CENTRAL_RECOGNITION section 8.6,
// phase 6). This class keeps the scanner's own names and input shapes: the times' evidence ladder
// (direct_lap_som / bevestigd_na_reparatie / veld_stemming) and the identity vote per burst.
import { FIELD_MIN_MARGIN, FIELD_MIN_SUPPORT, SequenceDecision } from '../../../../packages/icon-matcher/ts/sharedSequenceDecision';
import type { IdentitySnapshot, KartConfigResult } from './types';

export { FIELD_MIN_MARGIN, FIELD_MIN_SUPPORT };

export class ScanSession {
  private readonly decision = new SequenceDecision();

  get locked(): boolean { return this.decision.locked; }
  get acceptPath(): string { return this.decision.acceptPath; }
  get lockedFields(): Record<string, string> { return this.decision.lockedFields; }
  get framesAnalyzed(): number { return this.decision.framesAnalyzed; }
  get okFrames(): number { return this.decision.acceptedFrames; }
  get identityFrames(): number { return this.decision.identityFrames; }

  /** Verwerkt één geanalyseerd frame; true zodra de sessie nét gelockt is. */
  update(fields: Record<string, string> | null, lapSumOk: boolean, lapSumRepairs: number, expectedFields: number): boolean {
    return this.decision.updateTimes(fields, lapSumOk, lapSumRepairs, expectedFields);
  }

  addIdentityVotes(kartConfig: KartConfigResult | null): void {
    if (!kartConfig || !kartConfig.owners) return;
    // The shared field reader puts an unsure field's alternatives on shared_field; the central
    // decision reads them from the observation itself.
    const owners: Record<string, unknown> = {};
    for (const [owner, match] of Object.entries(kartConfig.owners)) {
      if (!match) continue;
      const read: Record<string, unknown> = { card_name: match.card_name };
      for (const kind of ['character', 'kart', 'wheel', 'glider', 'flag'] as const) {
        const entry = match[kind];
        if (!entry) continue;
        const shared = entry.shared_field as { alternatives?: unknown[] } | undefined;
        read[kind] = shared?.alternatives ? { ...entry, alternatives: shared.alternatives } : entry;
      }
      owners[owner] = read;
    }
    this.decision.addIdentity(owners);
  }

  identitySettled(): boolean {
    return this.decision.identitySettled();
  }

  identitySnapshot(): IdentitySnapshot {
    return this.decision.identitySnapshot() as unknown as IdentitySnapshot;
  }
}
