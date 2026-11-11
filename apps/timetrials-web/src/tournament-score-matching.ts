import { localized } from "./product-language.js";

// Matching an Excel score row to a participant, shared by Step 5 and Step 9.
//
// This is the source Manager's `scoreImportSimilarity` / `buildSuggestedScore
// ImportMapping` behaviour, the same one the APK carries in
// `AndroidTournamentScoreImport.kt`: every name a Player answers to - the
// display name and the public aliases (migration 0049) - is a candidate, the
// strongest pair is taken first and both sides are then spent, so two rows can
// never resolve to the same participant.
//
// The web had exact display-name matching only, so an in-game handle like
// "Sounder" never found Sander and every row had to be pointed by hand.

export type ScoreMatchTone = "settled" | "strong" | "likely" | "attention";

export type ScoreMatchTarget = Readonly<{
  playerId: string;
  displayName: string;
  aliases: readonly string[];
}>;

export type ScoreMatchSuggestion = Readonly<{
  workbookName: string;
  points: number;
  playerId: string | null;
  confidence: number | null;
  viaAlias: boolean;
  /** The Player name that actually matched, so an alias can be named. */
  matchedName: string | null;
}>;

export function scoreNameKey(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toLocaleLowerCase("nl");
}

// Exact, prefix, containment, then token overlap. Deliberately not a Levenshtein
// distance: this is the scale the confidence thresholds were tuned against.
export function scoreSimilarity(left: string, right: string): number {
  const a = scoreNameKey(left);
  const b = scoreNameKey(right);
  if (a === "" || b === "") { return 0; }
  if (a === b) { return 1; }
  if (a.startsWith(b) || b.startsWith(a)) { return 0.93; }
  if (a.includes(b) || b.includes(a)) { return 0.89; }
  const leftTokens = new Set(a.split(" ").filter((token) => token !== ""));
  const rightTokens = new Set(b.split(" ").filter((token) => token !== ""));
  let intersection = 0;
  for (const token of leftTokens) { if (rightTokens.has(token)) { intersection += 1; } }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

/** Every name a Player answers to, display name first. */
export function scoreCandidateNames(
  displayName: string,
  aliases: readonly string[],
): ReadonlyArray<{ name: string; viaAlias: boolean }> {
  const seen = new Set<string>();
  const names: Array<{ name: string; viaAlias: boolean }> = [];
  const add = (value: string, viaAlias: boolean): void => {
    const key = scoreNameKey(value);
    if (key === "" || seen.has(key)) { return; }
    seen.add(key);
    names.push({ name: value.trim(), viaAlias });
  };
  add(displayName, false);
  for (const alias of aliases) { add(alias, true); }
  return names;
}

export function scoreMatchLabel(
  confidence: number | null,
  viaAlias: boolean,
  manual: boolean,
): Readonly<{ label: string; tone: ScoreMatchTone }> {
  if (manual) { return { label: localized("Matched by hand", "Handmatig gekoppeld"), tone: "settled" }; }
  if (confidence === null) { return { label: localized("Check", "Controleren"), tone: "attention" }; }
  if (viaAlias) { return { label: localized("Name match", "Naam-match"), tone: "settled" }; }
  if (confidence >= 0.999) { return { label: localized("Exact match", "Exacte match"), tone: "settled" }; }
  if (confidence >= 0.93) { return { label: localized("Very strong", "Zeer sterk"), tone: "strong" }; }
  if (confidence >= 0.75) { return { label: localized("Likely", "Waarschijnlijk"), tone: "likely" }; }
  return { label: localized("Check", "Controleren"), tone: "attention" };
}

/** The source shows the similarity beside the badge as a whole percentage. */
export function scoreConfidencePercent(confidence: number | null): string | null {
  return confidence === null ? null : localized(`${Math.trunc(confidence * 100)}% similar`, `${Math.trunc(confidence * 100)}% overeenkomst`);
}

/** The source's `SCORE_IMPORT_MIN_SIMILARITY`: below this it is not a candidate. */
const MINIMUM_SIMILARITY = 0.34;

export function suggestScoreMapping(
  workbookRows: ReadonlyArray<{ playerName: string; totalPoints: number }>,
  targets: readonly ScoreMatchTarget[],
): readonly ScoreMatchSuggestion[] {
  type Candidate = Readonly<{
    rowIndex: number;
    workbookName: string;
    playerId: string;
    score: number;
    viaAlias: boolean;
    matchedName: string;
  }>;
  const candidates: Candidate[] = [];
  for (const [rowIndex, row] of workbookRows.entries()) {
    for (const target of targets) {
      let best = 0;
      let bestViaAlias = false;
      let bestName = target.displayName;
      for (const candidate of scoreCandidateNames(target.displayName, target.aliases)) {
        const score = scoreSimilarity(row.playerName, candidate.name);
        // A display-name match outranks an alias at the same score, exactly as
        // the source's candidate priority does.
        if (score > best || (score === best && !candidate.viaAlias && bestViaAlias)) {
          best = score;
          bestViaAlias = candidate.viaAlias;
          bestName = candidate.name;
        }
      }
      if (best > MINIMUM_SIMILARITY) {
        candidates.push({
          rowIndex,
          workbookName: row.playerName,
          playerId: target.playerId,
          score: best,
          viaAlias: bestViaAlias,
          matchedName: bestName,
        });
      }
    }
  }
  const ordered = [...candidates].sort((left, right) =>
    right.score - left.score
    || Number(left.viaAlias) - Number(right.viaAlias)
    || left.workbookName.toLocaleLowerCase("nl").localeCompare(right.workbookName.toLocaleLowerCase("nl"))
    || left.rowIndex - right.rowIndex);
  const usedRows = new Set<number>();
  const usedPlayers = new Set<string>();
  const chosen = new Map<number, Candidate>();
  for (const candidate of ordered) {
    if (usedRows.has(candidate.rowIndex)) { continue; }
    if (usedPlayers.has(candidate.playerId)) { continue; }
    usedRows.add(candidate.rowIndex);
    usedPlayers.add(candidate.playerId);
    chosen.set(candidate.rowIndex, candidate);
  }
  return workbookRows.map((row, rowIndex) => {
    const candidate = chosen.get(rowIndex);
    return {
      workbookName: row.playerName,
      points: row.totalPoints,
      playerId: candidate?.playerId ?? null,
      confidence: candidate?.score ?? null,
      viaAlias: candidate?.viaAlias ?? false,
      matchedName: candidate?.matchedName ?? null,
    };
  });
}
