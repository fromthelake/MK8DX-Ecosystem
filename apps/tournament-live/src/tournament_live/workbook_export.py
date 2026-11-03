"""Preserve the proven live Excel/CSV projection beside canonical V1 output."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from mk8dx_tournament_extraction.engine.ocr_export import (
    build_final_standings_df,
    build_user_export_df,
)

from .scoring_segments import live_session_indices


def _to_int(value: Any) -> int:
    try:
        return int(str(value).strip())
    except Exception:
        return 0


def _to_bool(value: Any) -> bool:
    return str(value).strip().lower() == "true"


def _clean_video_stem(video: str) -> str:
    return str(video or "").rsplit("__", 1)[-1]


def live_rows_to_export_df(rows: list[dict[str, Any]]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame()
    records = []
    for row, session_index in zip(rows, live_session_indices(rows), strict=True):
        video = _clean_video_stem(row.get("Video", ""))
        race = _to_int(row.get("Race"))
        records.append(
            {
                "RaceClass": video,
                "RaceIDNumber": race,
                "TrackName": row.get("Track", ""),
                "CupName": row.get("Cup", ""),
                "RacePosition": _to_int(row.get("Position")),
                "FixPlayerName": row.get("Player", ""),
                "Character": row.get("Character", ""),
                "CharacterRosterName": row.get("Character Roster", ""),
                "RacePoints": _to_int(row.get("Race Points")),
                "OldTotalScore": _to_int(row.get("Total Before Race")),
                "NewTotalScore": _to_int(row.get("Total After Race")),
                "PositionAfterRace": _to_int(row.get("Position After Race")),
                "ReviewNeeded": _to_bool(row.get("Needs Review", "")),
                "ReviewReason": row.get("Review Reason", ""),
                "CountsTowardTotals": _to_bool(row.get("Counts Toward Totals", "True")),
                "ExcludedFromTotalsReason": row.get("Scoring Note", ""),
                "SessionIndex": session_index,
            }
        )

    frame = pd.DataFrame(records)
    frame["SessionNewTotalScore"] = 0
    frame = frame.sort_values(
        ["RaceClass", "FixPlayerName", "RaceIDNumber"], kind="stable"
    ).reset_index(drop=True)
    for _key, group in frame.groupby(["RaceClass", "FixPlayerName"], sort=False):
        running = 0
        current_session = None
        for index in group.index:
            session = frame.at[index, "SessionIndex"]
            if session != current_session:
                current_session = session
                running = int(frame.at[index, "OldTotalScore"]) if session == 1 else 0
            if bool(frame.at[index, "CountsTowardTotals"]):
                running += int(frame.at[index, "RacePoints"])
            frame.at[index, "SessionNewTotalScore"] = running
    return frame


def write_compatible_workbook(
    workbook_path: Path,
    tournament_csv_path: Path,
    final_csv_path: Path,
    rows: list[dict[str, Any]],
) -> None:
    frame = live_rows_to_export_df(rows)
    results = build_user_export_df(frame)
    final = build_final_standings_df(frame)
    classes = {(_clean_video_stem(row.get("Video", "")), _to_int(row.get("Race"))): str(row.get("Class") or "")
               for row in rows}
    if any(classes.values()) and not results.empty:
        # ADR-0217: the race class column (the manual upload carries it to the website too)
        results["Class"] = [classes.get((str(video), _to_int(race)), "")
                            for video, race in zip(results["Video"], results["Race"])]
    with pd.ExcelWriter(workbook_path, engine="openpyxl") as writer:
        results.to_excel(writer, index=False, sheet_name="Results")
        final.to_excel(writer, index=False, sheet_name="Final Standings")
    results.to_csv(tournament_csv_path, index=False)
    final.to_csv(final_csv_path, index=False)
