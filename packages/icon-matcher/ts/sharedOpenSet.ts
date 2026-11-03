// The central open-set character decision (CENTRAL_RECOGNITION section 8.7): the TypeScript port of
// python/mk8dx_icon_matcher/open_set.py (the reference) and OpenSet.java. A Mii is no character the
// references can hold, so an unaccepted character read without a clear winner suggests "Mii": never
// accepted, without a size (the catalog's bare Mii, character.mii_medium). `propose` makes it the
// proposed value (Tournament score rows), `alternative` offers it beside the best match (cards,
// where unread real characters share the no-clear-winner zone).

export const MII_ID = 'character.mii_medium';
export const MII_LABEL = 'Mii';
export const MII_EVIDENCE = 'open_set_mii';
export const MII_LOOKALIKES = ['character.pauline', 'character.champion_link'];

export type OpenSetMode = 'propose' | 'alternative';
export const OPEN_SET_PROFILES: Record<string, { maxScore: number | null; maxFamilyMargin: number | null; mode: OpenSetMode }> = {
  scoreboard: { maxScore: 0.84, maxFamilyMargin: null, mode: 'propose' },
  result: { maxScore: 0.81, maxFamilyMargin: 0.012, mode: 'alternative' },
};

export interface MiiSuggestion { id: string; label: string; evidence: string; mode: OpenSetMode;
  score: number; familyMargin: number | null }
type Ranked = { id: string; familyId?: string; score: number };

/** The first score minus the best score of another family, or null. */
export function familyMargin(top: Ranked[]): number | null {
  if (top.length === 0) return null;
  const family = top[0].familyId ?? top[0].id;
  const other = top.slice(1).find((item) => (item.familyId ?? item.id) !== family);
  return other ? top[0].score - other.score : null;
}

/** The Mii suggestion for an unaccepted read, or null. */
export function miiSuggestion(profile: string | undefined, top: Ranked[], acceptedId: string | null): MiiSuggestion | null {
  const rule = profile ? OPEN_SET_PROFILES[profile] : undefined;
  if (acceptedId || !rule || rule.maxScore === null || top.length === 0) return null;
  const score = top[0].score;
  const margin = familyMargin(top);
  if (score >= rule.maxScore) return null;
  if (rule.maxFamilyMargin !== null && margin !== null && margin >= rule.maxFamilyMargin) return null;
  return { id: MII_ID, label: MII_LABEL, evidence: MII_EVIDENCE, mode: rule.mode, score, familyMargin: margin };
}
