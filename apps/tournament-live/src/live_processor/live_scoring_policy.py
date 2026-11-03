"""Live adaptation of the post-processing *temporary player drop* policy.

A player who loses connection for a race ("connection error") makes that race
show fewer players, which skews its points. The original project's rule is: a
low-player-count race is **excluded from the running totals only once a later
race recovers** to a higher count (a genuine, permanent reduction is kept). This
module reuses that original decision logic verbatim
(:func:`mk8dx_tournament_extraction.engine.ocr_scoring_policy._mark_temporary_player_drop_races`)
so the live path follows it strictly, and exposes a small structured result the
live scoreboard/export can act on (which races to exclude + a "suspected drop"
flag for the dashboard, since the latest race can't be excluded until the *next*
one arrives).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from mk8dx_tournament_extraction.engine.ocr_scoring_policy import _mark_temporary_player_drop_races


@dataclass
class RaceDropInfo:
    race: int
    scored_count: int           # players who scored in this race (those who raced)
    points: dict[str, int]      # player key -> race points


@dataclass
class DropEvaluation:
    excluded_races: set[int] = field(default_factory=set)  # temporary-drop races to discount
    full_count: int = 0          # the largest player count seen (the "full field")
    latest_race: int | None = None
    latest_count: int = 0
    suspected: bool = False      # latest race is below the full field and not (yet) excluded
    # player key -> total points that should be discounted (sum over excluded races)
    discount_by_player: dict[str, int] = field(default_factory=dict)


def evaluate_player_drops(history: list[RaceDropInfo]) -> DropEvaluation:
    """Decide which races are temporary-drop races, using the original policy.

    ``history`` is the per-race scored-player data **in race order**. Returns a
    :class:`DropEvaluation`; when ``excluded_races`` is empty the caller should
    leave totals untouched (the no-drop case stays byte-identical).
    """

    if not history:
        return DropEvaluation()

    rows: list[dict[str, object]] = []
    for entry in history:
        for key, pts in entry.points.items():
            if pts and pts > 0:  # one row per racer -> visible-row count == racer count
                rows.append(
                    {
                        "RaceClass": "live",
                        "RaceIDNumber": int(entry.race),
                        "RaceScorePlayerCount": int(entry.scored_count),
                        "CountsTowardTotals": True,
                        "ExcludedFromTotalsReason": "",
                        "ReviewReason": "",
                        "ReviewReasonCodes": "",
                        "ReviewNeeded": False,
                    }
                )

    counts = {int(e.race): int(e.scored_count) for e in history}
    full_count = max(counts.values()) if counts else 0
    latest = history[-1]

    excluded: set[int] = set()
    if rows:
        marked = _mark_temporary_player_drop_races(pd.DataFrame(rows))
        counts_col = marked["CountsTowardTotals"].astype(bool)
        excluded = {int(r) for r in marked.loc[~counts_col, "RaceIDNumber"].unique()}

    discount: dict[str, int] = {}
    for race_id in excluded:
        for entry in history:
            if int(entry.race) == race_id:
                for key, pts in entry.points.items():
                    discount[key] = discount.get(key, 0) + int(pts or 0)

    suspected = (
        full_count > 0
        and int(latest.scored_count) < full_count
        and int(latest.race) not in excluded
    )

    return DropEvaluation(
        excluded_races=excluded,
        full_count=full_count,
        latest_race=int(latest.race),
        latest_count=int(latest.scored_count),
        suspected=suspected,
        discount_by_player=discount,
    )


def _to_int(value: object) -> int:
    try:
        return int(str(value).strip())
    except Exception:
        return 0


def apply_drop_exclusions_to_tournament_rows(
    rows: list[dict[str, str]],
) -> list[dict[str, str]]:
    """Apply the temporary-player-drop exclusion to exported tournament rows.

    Groups by ``Video`` (a tournament group), uses the original policy to decide
    which races are temporary drops, then discounts those races' points from the
    running totals (so the export matches the live scoreboard) and marks the
    excluded race rows for review. Returns a new list; the no-drop case returns
    rows unchanged.
    """

    if not rows:
        return rows

    groups: dict[str, list[int]] = {}
    for index, row in enumerate(rows):
        groups.setdefault(str(row.get("Video", "")), []).append(index)

    result = [dict(row) for row in rows]
    for _video, indices in groups.items():
        # per-race scored points by player, in race order
        per_race: dict[int, dict[str, int]] = {}
        scored_rows_by_race: dict[int, int] = {}
        for index in indices:
            row = rows[index]
            race = _to_int(row.get("Race"))
            pts = _to_int(row.get("Race Points"))
            per_race.setdefault(race, {})[str(row.get("Player", ""))] = pts
            # Count confirmed scoring observations, not distinct raw OCR names.
            # Two players can have the same observed name before the later
            # identity pass disambiguates them. Collapsing those rows into the
            # points lookup made a full 12-player field look like 11 players and
            # wrongly excluded earlier races when one spelling changed later.
            # The Scoreboard accumulator already deduplicates whole race events.
            scored_rows_by_race[race] = scored_rows_by_race.get(race, 0) + int(pts > 0)
        history = [
            RaceDropInfo(
                race=race,
                scored_count=scored_rows_by_race[race],
                points=players,
            )
            for race, players in sorted(per_race.items())
        ]
        evaluation = evaluate_player_drops(history)
        if not evaluation.excluded_races:
            continue

        for index in indices:
            row = result[index]
            player = str(row.get("Player", ""))
            race = _to_int(row.get("Race"))
            discount_after = sum(
                per_race.get(ex, {}).get(player, 0)
                for ex in evaluation.excluded_races
                if ex <= race
            )
            discount_before = sum(
                per_race.get(ex, {}).get(player, 0)
                for ex in evaluation.excluded_races
                if ex < race
            )
            row["Total After Race"] = str(_to_int(row.get("Total After Race")) - discount_after)
            row["Total Before Race"] = str(_to_int(row.get("Total Before Race")) - discount_before)
            if race in evaluation.excluded_races:
                row["Counts Toward Totals"] = "False"
                row["Needs Review"] = "True"
                note = "temporary player drop excluded (connection error)"
                existing = str(row.get("Review Reason") or "").strip()
                row["Review Reason"] = f"{existing} | {note}".strip(" |") if existing else note
                row["Scoring Note"] = note
    return result
