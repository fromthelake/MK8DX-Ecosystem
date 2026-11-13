"""Smoke run of the recorded analysis after the text reading, on synthetic rows only (issue #169).

Recorded-video analysis reads the score screens with OCR and then finalizes the rows: name linking,
colour-variant refinement (``refine_character_variant_families``), session validation, the Excel/CSV
export, and the canonical ``TournamentRaceResultsV1`` JSON. Under pandas 3 that second half stopped
with a TypeError, and no check reached it. This script drives the same functions with the installed
dependencies:

* the reviewed public recorded-asset groups supply the game catalog, the name-character data and the
  character templates, materialized into one folder exactly as the Tools package ships
  ``runtime-assets/recorded``::

      node tooling/assets/materialize_collection.mjs tournament <dir>
      node tooling/assets/materialize_collection.mjs tournament-text <dir>

* score frames are synthesized by placing those templates in the score rows of an empty canvas, so the
  colour-variant refinement has something real to measure;
* OCR rows are synthetic: invented player names, the neutral family name where the game shows a
  colour variant (as the fast per-race reader does), and consistent points.

Nothing here reads a recording, private reference data or real player names.

    python tooling/tournament/recorded_post_analysis_smoke.py --recorded-assets <dir> --runtime-root <dir>

It prints a JSON summary (``--summary`` also writes it to a file) and exits non-zero when the output is not what the synthetic input implies.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from pathlib import Path

VIDEO = "SyntheticCup"
RACES = 4
# Invented names; the first three drive a colour variant the OCR row reports by its neutral family name.
PLAYERS = (
    ("Nova Jet", "Pink Yoshi", "Yoshi"),
    ("Kiki Loop", "Orange Shy Guy", "Shy Guy"),
    ("Turbo Tess", "Black Yoshi", "Yoshi"),
    ("Lily Lap", "Luigi", "Luigi"),
    ("Max Drift", "Toad", "Toad"),
    ("Zip Zora", "Bowser", "Bowser"),
    ("Pip Glide", "Daisy", "Daisy"),
    ("Rio Boost", "Wario", "Wario"),
    ("Sol Spark", "Koopa Troopa", "Koopa Troopa"),
    ("Ace Bloom", "Rosalina", "Rosalina"),
    ("Juno Skid", "Donkey Kong", "Donkey Kong"),
    ("Echo Rush", "Toadette", "Toadette"),
)
TRACKS = ("Mario Kart Stadium", "Water Park", "Sweet Sweet Canyon", "Thwomp Ruins")


def _configure(recorded_assets: Path, runtime_root: Path) -> None:
    # The engine resolves these when its modules are imported.
    os.environ["MK8DX_TOURNAMENT_RUNTIME_ROOT"] = str(runtime_root)
    os.environ["MK8DX_TOURNAMENT_ASSETS_ROOT"] = str(recorded_assets / "assets")
    os.environ["MK8DX_TOURNAMENT_REFERENCE_ROOT"] = str(recorded_assets)
    os.environ["MK8DX_TOURNAMENT_ENGINE_DATA_ROOT"] = str(recorded_assets)
    # OCR never runs here; keep the GPU probe and worker policy out of the way.
    os.environ.setdefault("MK8_EASYOCR_GPU_MODE", "cpu")


def _finishing_order(race_index: int) -> list[int]:
    """Player indices in finishing order: a different rotation per race."""
    return [(race_index * 5 + offset) % len(PLAYERS) for offset in range(len(PLAYERS))]


def _write_score_frame(path: Path, order: list[int], templates_by_name: dict) -> None:
    import cv2
    import numpy as np

    from mk8dx_tournament_extraction.engine.ocr_scoreboard_consensus import (
        CHARACTER_ROW_PADDING_TOP,
        character_row_roi,
    )

    canvas = np.full((720, 1280, 3), 24, dtype=np.uint8)
    for position_index, player_index in enumerate(order):
        template = templates_by_name[PLAYERS[player_index][1]]
        image = np.asarray(template["template_image"], dtype=np.float32)
        alpha = np.asarray(template["template_alpha"], dtype=np.float32)[:, :, None] / 255.0
        (x1, y1), _ = character_row_roi(position_index)
        top = y1 + CHARACTER_ROW_PADDING_TOP
        size = image.shape[0]
        region = canvas[top:top + size, x1:x1 + size].astype(np.float32)
        canvas[top:top + size, x1:x1 + size] = (image * alpha + region * (1.0 - alpha)).astype(np.uint8)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(path), canvas):
        raise RuntimeError(f"could not write {path}")


def _ocr_rows(columns: list[str], templates_by_name: dict) -> list[list]:
    from mk8dx_tournament_extraction.engine.extract_text import get_race_points

    totals = [0] * len(PLAYERS)
    rows = []
    for race_index in range(RACES):
        order = _finishing_order(race_index)
        for position_index, player_index in enumerate(order):
            name, _shown, read_as = PLAYERS[player_index]
            position = position_index + 1
            points = get_race_points(position, len(PLAYERS))
            old_total = totals[player_index]
            totals[player_index] += points
            read_template = templates_by_name[read_as]
            values = {
                "RaceClass": VIDEO,
                "RaceIDNumber": race_index + 1,
                "TrackName": TRACKS[race_index],
                "RacePosition": position,
                "PlayerName": name,
                "Character": read_as,
                "CharacterIndex": int(read_template["character_index"]),
                "CharacterMatchConfidence": 88.0,
                "CharacterMatchMethod": "synthetic",
                "RacePoints": points,
                "DetectedRacePoints": points,
                "DetectedOldTotalScore": old_total,
                "DetectedTotalScore": totals[player_index],
                "DetectedNewTotalScore": totals[player_index],
                "NameConfidence": 95.0,
                "NameAllowedCharRatio": 1.0,
                "NameUnknownChars": "",
                "NameValidationFlags": "",
                "DigitConsensus": 100.0,
                "RowCountConfidence": 100.0,
                "RaceScorePlayerCount": len(PLAYERS),
                "TotalScorePlayerCount": len(PLAYERS),
                "LegacyRaceScorePlayerCount": len(PLAYERS),
                "LegacyTotalScorePlayerCount": len(PLAYERS),
                "LegacyRowCountConfidence": 100.0,
                "RaceScoreRecoveryUsed": False,
                "RaceScoreRecoveryCount": len(PLAYERS),
                "ScoreLayoutId": "",
                "SourceVideoWidth": 1280,
                "SourceVideoHeight": 720,
                "IsLowRes": False,
                "ReviewReason": "",
            }
            rows.append([values.get(column, "") for column in columns])
    return rows


def run(recorded_assets: Path, runtime_root: Path) -> dict:
    _configure(recorded_assets, runtime_root)
    from mk8dx_tournament_extraction.engine import extract_text
    from mk8dx_tournament_extraction.engine.extract_common import score_bundle_dir
    from mk8dx_tournament_extraction.engine.ocr_scoreboard_consensus import load_character_templates
    from tournament_processor.recorded_export import write_recorded_results

    templates_by_name = {str(item["character_name"]): item for item in load_character_templates()}
    for race_index in range(RACES):
        frame = score_bundle_dir(VIDEO, race_index + 1, "2RaceScore") / "anchor_100.png"
        _write_score_frame(frame, _finishing_order(race_index), templates_by_name)

    columns = _finalize_columns(extract_text)
    frames_folder = runtime_root / "Output_Results" / "Frames"
    payload = extract_text.finalize_ocr_results(
        _ocr_rows(columns, templates_by_name),
        folder_path=str(frames_folder),
        phase_start_time=time.time(),
        per_video_ocr_durations={VIDEO: 0.0},
        progress_peak_lines=[],
        ocr_profiler_lines=[],
        write_outputs=True,
        emit_logs=False,
    )
    csv_path = Path(payload["output_excel_path"]).with_suffix(".csv")
    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    canonical = write_recorded_results(
        rows,
        csv_path.with_name(csv_path.name.replace("_Tournament_Results.csv", "_TournamentRaceResultsV1.json")),
        session_id="synthetic-smoke",
        producer_version="recorded-post-analysis-smoke",
        created_at_ms=1_700_000_000_000,
    )
    frame = payload["df"]
    characters: dict[str, list[str]] = {}
    final_totals: dict[str, int] = {}
    for row in rows:
        characters.setdefault(row["Player"], [])
        if row["Character"] not in characters[row["Player"]]:
            characters[row["Player"]].append(row["Character"])
        if int(row["Race"]) == RACES:
            final_totals[row["Player"]] = int(row["Total After Race"])
    return {
        "csv": str(csv_path),
        "csvRows": len(rows),
        "rowsNeedingReview": sum(1 for row in rows if row["Needs Review"].strip().lower() == "true"),
        "raceCount": int(payload["race_count"]),
        "canonicalRaces": len(canonical),
        "canonicalPlacements": sum(len(result.get("placements", [])) for result in canonical),
        "characters": characters,
        "finalTotals": final_totals,
        "familyBestIndex": sorted({str(value) for value in frame["CharacterFamilyBestIndex"] if str(value)}),
        "methods": sorted(set(frame["CharacterMatchMethod"])),
    }


def _finalize_columns(extract_text) -> list[str]:
    """The column order finalize_ocr_results builds its frame with (process_race_group's result rows)."""
    return [
        "RaceClass", "RaceIDNumber", "TrackName", "RacePosition", "PlayerName",
        "Character", "CharacterIndex", "CharacterMatchConfidence", "CharacterMatchMethod",
        "CharacterMatchRawBest", "CharacterMatchRawMargin", "CharacterMatchRawTop5Spread", "CharacterMatchRawTop5FamilyCount",
        "RacePoints", "DetectedRacePoints", "DetectedRacePointsSource", "DetectedOldTotalScore",
        "DetectedOldTotalScoreSource", "DetectedTotalScore", "DetectedTotalScoreSource", "DetectedNewTotalScore",
        "DetectedNewTotalScoreSource", "PositionAfterRace",
        *extract_text.POSITION_TEMPLATE_COEFF_COLUMNS,
        "NameConfidence", "NameAllowedCharRatio", "NameUnknownChars", "NameValidationFlags",
        "DigitConsensus", "RowCountConfidence", "RaceScorePlayerCount", "TotalScorePlayerCount",
        "LegacyRaceScorePlayerCount", "LegacyTotalScorePlayerCount", "LegacyRowCountConfidence",
        "RaceScoreCountVotes", "TotalScoreCountVotes", "LegacyRaceScoreCountVotes", "LegacyTotalScoreCountVotes",
        "RaceScoreRowSignals", "TotalScoreRowSignals",
        "RaceScoreRecoveryUsed", "RaceScoreRecoverySource", "RaceScoreRecoveryCount",
        "RacePointsAnchorFrame",
        "ScoreLayoutId",
        "TotalScoreMappingMethod", "TotalScoreMappingScore", "TotalScoreMappingMargin", "TotalScoreNameSimilarity",
        "SourceVideoWidth", "SourceVideoHeight", "IsLowRes", "ReviewReason",
    ]


def _expected_totals() -> dict[str, int]:
    from mk8dx_tournament_extraction.engine.extract_text import get_race_points

    totals = {name: 0 for name, _shown, _read_as in PLAYERS}
    for race_index in range(RACES):
        for position_index, player_index in enumerate(_finishing_order(race_index)):
            totals[PLAYERS[player_index][0]] += get_race_points(position_index + 1, len(PLAYERS))
    return totals


def check(summary: dict) -> list[str]:
    """What the synthetic input implies; an empty list means the run is sane."""
    problems = []
    expected_rows = RACES * len(PLAYERS)
    if summary["csvRows"] != expected_rows:
        problems.append(f"CSV has {summary['csvRows']} rows, expected {expected_rows}")
    if summary["raceCount"] != RACES or summary["canonicalRaces"] != RACES:
        problems.append(f"races: {summary['raceCount']} exported, {summary['canonicalRaces']} canonical, expected {RACES}")
    if summary["canonicalPlacements"] != expected_rows:
        problems.append(f"canonical placements {summary['canonicalPlacements']}, expected {expected_rows}")
    for name, shown, _read_as in PLAYERS:
        if summary["characters"].get(name) != [shown]:
            problems.append(f"{name}: characters {summary['characters'].get(name)}, expected [{shown!r}]")
    if summary["rowsNeedingReview"]:
        problems.append(f"{summary['rowsNeedingReview']} rows need review; the synthetic rows are consistent")
    expected_totals = _expected_totals()
    if summary["finalTotals"] != expected_totals:
        problems.append(f"final totals {summary['finalTotals']}, expected {expected_totals}")
    if not summary["familyBestIndex"]:
        problems.append("the colour-variant refinement wrote no CharacterFamilyBestIndex")
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--recorded-assets", type=Path, required=True,
                        help="the 'tournament' and 'tournament-text' collection groups materialized into one folder")
    parser.add_argument("--runtime-root", type=Path, required=True, help="empty scratch folder for Output_Results")
    parser.add_argument("--summary", type=Path, help="also write the JSON summary to this file")
    args = parser.parse_args(argv)
    recorded_assets = args.recorded_assets.resolve()
    for required in ("reference_data/game_catalog.json", "data/mii_allowed_chars.json", "assets/character"):
        if not (recorded_assets / required).exists():
            parser.error(f"{recorded_assets} lacks {required}; materialize 'tournament' and 'tournament-text' into it")
    runtime_root = args.runtime_root.resolve()
    if runtime_root.exists() and any(runtime_root.iterdir()):
        parser.error(f"{runtime_root} is not empty")
    runtime_root.mkdir(parents=True, exist_ok=True)
    summary = run(recorded_assets, runtime_root)
    problems = check(summary)
    summary["problems"] = problems
    text = json.dumps(summary, indent=2, ensure_ascii=False)
    print(text)
    if args.summary:
        args.summary.write_text(text + "\n", encoding="utf-8")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
