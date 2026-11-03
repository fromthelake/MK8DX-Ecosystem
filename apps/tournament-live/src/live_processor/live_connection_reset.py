"""Live adaptation of the original *connection reset* handling.

A connection reset is a whole-lobby event: after a reconnect the game restarts
its on-screen score tally, so every player's displayed total suddenly drops to
roughly that race's points. The tournament continues, so two things must happen:

1. **Continuity** — the tournament totals keep going from before the reset (we
   add each player's pre-reset total back as an offset).
2. **Identity relink** — a player who comes back under a slightly different OCR
   name is relinked to their prior identity (done by the original
   :func:`reconcile_connection_reset_identities` once ``SessionResetDetected`` is
   set; this module only provides the detection + continuity).

Detection reuses the original
:func:`mk8dx_tournament_extraction.engine.ocr_session_validation.detect_connection_reset`
verbatim, so the live path follows the same rule.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from mk8dx_tournament_extraction.engine.ocr_session_validation import detect_connection_reset


@dataclass
class RaceTotals:
    race: int
    totals: dict[str, int]   # player key -> on-screen total after this race
    points: dict[str, int]   # player key -> race points this race


@dataclass
class ResetEvaluation:
    reset_races: set[int] = field(default_factory=set)
    # race number -> {player key -> offset to ADD to the on-screen total so the
    # tournament total stays continuous across resets}
    offset_by_race: dict[int, dict[str, int]] = field(default_factory=dict)

    def offset_for(self, race: int, player: str) -> int:
        return int(self.offset_by_race.get(int(race), {}).get(player, 0))


def evaluate_connection_resets(history: list[RaceTotals]) -> ResetEvaluation:
    """Find reset races and the per-player continuity offset for each race.

    ``history`` is the per-race on-screen totals **in race order**. When no reset
    is detected every offset is 0 (the no-reset case stays untouched).
    """

    evaluation = ResetEvaluation()
    if not history:
        return evaluation

    offset: dict[str, int] = defaultdict(int)
    previous_totals: dict[str, int] = {}
    for entry in history:
        prepared = [
            {"player_key": key, "detected_total": int(total), "race_points": int(entry.points.get(key, 0))}
            for key, total in entry.totals.items()
        ]
        if previous_totals and detect_connection_reset(previous_totals, prepared):
            evaluation.reset_races.add(int(entry.race))
            # Carry each player's pre-reset total forward as the new baseline.
            for key in entry.totals:
                offset[key] += int(previous_totals.get(key, 0))
        evaluation.offset_by_race[int(entry.race)] = dict(offset)
        previous_totals = {key: int(total) for key, total in entry.totals.items()}

    return evaluation


def _to_int(value: object) -> int:
    try:
        return int(str(value).strip())
    except Exception:
        return 0


def apply_connection_reset_continuity(
    rows: list[dict[str, str]],
) -> tuple[list[dict[str, str]], dict[str, set[int]]]:
    """Make exported tournament totals continuous across connection resets.

    Returns the adjusted rows and a ``{video: {reset race numbers}}`` map so the
    caller can mark ``SessionResetDetected`` for the identity relink. The no-reset
    case returns the rows unchanged.
    """

    if not rows:
        return rows, {}

    groups: dict[str, list[int]] = {}
    for index, row in enumerate(rows):
        groups.setdefault(str(row.get("Video", "")), []).append(index)

    result = [dict(row) for row in rows]
    resets_by_video: dict[str, set[int]] = {}
    for video, indices in groups.items():
        per_race_totals: dict[int, dict[str, int]] = {}
        per_race_points: dict[int, dict[str, int]] = {}
        for index in indices:
            row = rows[index]
            race = _to_int(row.get("Race"))
            player = str(row.get("Player", ""))
            per_race_totals.setdefault(race, {})[player] = _to_int(row.get("Total After Race"))
            per_race_points.setdefault(race, {})[player] = _to_int(row.get("Race Points"))
        history = [
            RaceTotals(race=race, totals=per_race_totals[race], points=per_race_points.get(race, {}))
            for race in sorted(per_race_totals)
        ]
        evaluation = evaluate_connection_resets(history)
        if not evaluation.reset_races:
            continue
        resets_by_video[video] = set(evaluation.reset_races)

        for index in indices:
            row = result[index]
            race = _to_int(row.get("Race"))
            player = str(row.get("Player", ""))
            offset = evaluation.offset_for(race, player)
            if offset:
                total_after = _to_int(row.get("Total After Race")) + offset
                row["Total After Race"] = str(total_after)
                row["Total Before Race"] = str(total_after - _to_int(row.get("Race Points")))
            if race in evaluation.reset_races:
                row["Session Reset Detected"] = "True"
                # Match the original's export annotation: every row of a reset
                # race is flagged for review with the canonical reset reason
                # (ocr_session_validation's "connection_reset" message). Parts
                # are "|"-separated; the export formatter dedupes/truncates.
                row["Needs Review"] = "True"
                reason = "Connection reset detected; tournament totals continue from prior standings."
                existing = str(row.get("Review Reason") or "").strip()
                if reason not in existing:
                    row["Review Reason"] = f"{reason} | {existing}" if existing else reason
    return result, resets_by_video
