export const RANK_TRACK_FOCUS_VALUES = [
  "staff-left",
  "near-record",
  "current-records",
  "tracks-left",
  "top-three",
  "outside-top-ten",
] as const;

export type RankTrackFocus = (typeof RANK_TRACK_FOCUS_VALUES)[number];

export function parseRankTrackFocus(value: string | null): RankTrackFocus | null {
  return RANK_TRACK_FOCUS_VALUES.includes(value as RankTrackFocus)
    ? value as RankTrackFocus
    : null;
}

export function rankTrackFocusLabel(focus: RankTrackFocus): string {
  switch (focus) {
    case "staff-left": return "Staff ghosts left";
    case "near-record": return "Within 1s of #1";
    case "current-records": return "Current track records";
    case "tracks-left": return "Tracks left to drive";
    case "top-three": return "Top 3 positions";
    case "outside-top-ten": return "Outside the top 10";
  }
}

export function rankTrackFocusHref(
  focus: RankTrackFocus,
  mode: 150 | 200,
): string {
  return `/?ranking=timetrials&tab=tracks&mode=${mode}&focus=${focus}`;
}

export type RankTrackFocusEvidence = Readonly<{
  bestRank?: number;
  bestTimeMs?: number;
  staffTimeMs?: number;
  leaderTimeMs?: number;
}>;

export function matchesRankTrackFocus(
  focus: RankTrackFocus,
  evidence: RankTrackFocusEvidence,
): boolean {
  switch (focus) {
    case "staff-left":
      return evidence.staffTimeMs !== undefined &&
        (evidence.bestTimeMs === undefined ||
          evidence.bestTimeMs >= evidence.staffTimeMs);
    case "near-record":
      return evidence.bestRank !== undefined && evidence.bestRank > 1 &&
        evidence.bestTimeMs !== undefined && evidence.leaderTimeMs !== undefined &&
        evidence.bestTimeMs >= evidence.leaderTimeMs &&
        evidence.bestTimeMs - evidence.leaderTimeMs <= 1_000;
    case "current-records":
      return evidence.bestRank === 1;
    case "tracks-left":
      return evidence.bestTimeMs === undefined;
    case "top-three":
      return evidence.bestRank !== undefined && evidence.bestRank <= 3;
    case "outside-top-ten":
      return evidence.bestRank !== undefined && evidence.bestRank > 10;
  }
}
