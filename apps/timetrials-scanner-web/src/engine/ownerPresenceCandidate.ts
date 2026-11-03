// Opt-in result-card presence gate. It uses in-game card/badge detections only.
type Detection = { label?: string; score?: number };
type Frame = {
  raceProfile?: string;
  fields?: Record<string, unknown>;
  diagnostics?: { canonicalDetections?: Detection[] };
  kartConfig?: { owners?: Record<string, unknown> } | null;
};

export function applyOwnerPresenceCandidate(frame: Frame) {
  const detections = frame.diagnostics?.canonicalDetections ?? [];
  const best = (label: string) => Math.max(0, ...detections
    .filter((item) => item.label === label)
    .map((item) => Number(item.score) || 0));
  const playerScore = best('player_timetrail_box');
  const ghostScore = best('ghost_timetrail_box');
  const badgeCount = detections.filter((item) =>
    item.label === 'lap_index' && (item.score ?? 0) >= 0.5).length;
  const ghostTimePresent = Object.keys(frame.fields ?? {}).some((key) => key.startsWith('ghost_'));
  const soloBadgeCount = frame.raceProfile === 'race7' ? 7 : frame.raceProfile === 'race3' ? 3 : null;
  const reason = soloBadgeCount !== null && badgeCount === soloBadgeCount &&
    playerScore >= 0.9 && ghostScore < 0.5 && !ghostTimePresent
    ? 'solo_card_constellation' : 'retain';
  const hadGhostOutput = Object.hasOwn(frame.kartConfig?.owners ?? {}, 'ghost');
  if (reason !== 'retain' && hadGhostOutput) delete frame.kartConfig?.owners?.ghost;
  return { reason, playerScore, ghostScore, badgeCount, ghostTimePresent,
    removedGhostOutput: reason !== 'retain' && hadGhostOutput };
}
