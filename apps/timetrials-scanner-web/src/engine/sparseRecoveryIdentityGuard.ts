import type { FrameResult } from './types';

const SPARSE_ROUTE = 'lap_index_sparse_dual_yellow_candidate';
const IDENTITY_FIELDS = ['character', 'kart', 'wheel', 'glider', 'flag'] as const;

/** A badge/yellow-panel recovery locates the cards without a player-card box.
 * Keep its proposed IDs for review, but do not auto-accept their crops. */
export function withholdSparseRecoveryIdentities(result: FrameResult) {
  if (result.diagnostics.roi?.route !== SPARSE_ROUTE) return null;
  let withheld = 0;
  for (const parts of Object.values(result.kartConfig?.owners ?? {})) {
    for (const kind of IDENTITY_FIELDS) {
      const entry = parts[kind];
      if (!entry || entry.ok !== true) continue;
      entry.sparse_recovery_raw_ok = true;
      entry.ok = false;
      withheld++;
    }
  }
  return { reason: 'player_card_box_missing_review_identities', withheld };
}
