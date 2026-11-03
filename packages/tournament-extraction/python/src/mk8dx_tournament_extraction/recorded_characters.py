"""The shared character decision for the post-analysis tool's results (Live = post-analysis, roadmap LANGUAGES_15 E3).

Tournament Live decides every row's character with the shared field reader (`shared_characters`), including the owner's
lobby Mii rule; the recorded engine kept its own character route and read a Mii as Rosalina or Champion Link
(01-11 cups). After the engine has written its results, this step reads each race's saved RaceScore context frames
(`Frames/<video>/Race_NNN/2RaceScore/Race_NNN_F*.jpg`) and lobby frame (`0TrackName.jpg`) with the same reader and
writes the decision into the results CSV, the final standings CSV and the workbook (Character, Character Roster).

A row the shared reader does not decide keeps the engine's character: this step only replaces, it never clears.
Without Clean Assets (the reader's references) nothing changes and the summary says why.
"""
from __future__ import annotations

import csv
import os
from collections import defaultdict
from pathlib import Path
from typing import Any

import cv2  # type: ignore


def _layout_id(race_dir: Path) -> str:
    names = [path.name for path in (race_dir / "2RaceScore").glob("*.jpg")]
    return "lan1_full_1p" if any(name.endswith("_1p.jpg") for name in names) else "lan2_split_2p"


def _read_csv(path: Path) -> tuple[list[str], list[dict[str, str]], bool]:
    raw = path.read_bytes()
    bom = raw.startswith(b"\xef\xbb\xbf")
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
        return list(reader.fieldnames or []), rows, bom


def _write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]], bom: bool) -> None:
    with path.open("w", encoding="utf-8-sig" if bom else "utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def _roster_name(character: str) -> str:
    from .engine.ocr_export import _character_roster_fields  # noqa: WPS433

    return str(_character_roster_fields(character)[1] or "")


def _most_used(rows: list[dict[str, str]]) -> str:
    """The engine's final-standings rule: the most used character, the latest race on a tie."""
    counts: dict[str, int] = defaultdict(int)
    latest: dict[str, int] = {}
    for row in rows:
        character = str(row.get("Character") or "").strip()
        if not character:
            continue
        counts[character] += 1
        try:
            race = int(row.get("Race") or 0)
        except ValueError:
            race = 0
        latest[character] = max(latest.get(character, 0), race)
    if not counts:
        return ""
    return min(counts, key=lambda name: (-counts[name], -latest[name], name))


def apply_recorded_shared_characters(results_csv: Path, frames_root: Path,
                                     clean_assets: Path | None = None) -> dict[str, Any]:
    root = clean_assets or (Path(os.environ["MK8_CLEAN_ASSETS_ROOT"]) if os.environ.get("MK8_CLEAN_ASSETS_ROOT") else None)
    if root is None or not (Path(root) / "database.json").is_file():
        return {"applied": False, "reason": "no Clean Assets for the shared reader (--clean-assets / MK8_CLEAN_ASSETS_ROOT)"}
    from .shared_characters import SharedExportCharacters  # noqa: WPS433

    reader = SharedExportCharacters(Path(root))
    fieldnames, rows, bom = _read_csv(results_csv)
    races: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        races[(row["Video"], row["Race"])].append(row)
    changed = 0
    decided = 0
    renamed: dict[tuple[str, str], str] = {}
    for (video, race), race_rows in races.items():
        race_dir = Path(frames_root) / video / f"Race_{int(race):03d}"
        frame_paths = sorted((race_dir / "2RaceScore").glob("Race_*_F*.jpg"))
        frames = [image for image in (cv2.imread(str(path)) for path in frame_paths) if image is not None]
        if not frames:
            continue
        lobby_path = race_dir / "0TrackName.jpg"
        lobby = cv2.imread(str(lobby_path)) if lobby_path.is_file() else None
        consensus = {"rows": [{"RacePosition": row["Position"], "PlayerName": row["Player"],
                               "Character": row.get("Character", ""), "CharacterIndex": ""} for row in race_rows]}
        reader.apply(consensus, frames, _layout_id(race_dir), "shared", lobby)
        for row, decision in zip(race_rows, consensus["rows"]):
            snapped = str(decision.get("PlayerName") or "")
            if snapped and snapped != row["Player"]:
                # a CPU's name snapped to its character's spelling (shared reader, owner 01-11)
                renamed[(video, row["Player"])] = snapped
                row["Player"] = snapped
            character = str(decision.get("Character") or "")
            if not character:
                continue  # not decided by the shared reader: the engine's character stays
            decided += 1
            if character != row.get("Character"):
                changed += 1
                row["Character"] = character
                if "Character Roster" in row:
                    row["Character Roster"] = _roster_name(character)
    _write_csv(results_csv, fieldnames, rows, bom)
    standings = _update_final_standings(results_csv, rows, renamed)
    workbook = _update_workbook(results_csv, rows, standings, renamed)
    return {"applied": True, "rowsDecided": decided, "rowsChanged": changed, "namesSnapped": len(renamed),
            "finalStandings": bool(standings), "workbook": workbook}


def _update_final_standings(results_csv: Path, rows: list[dict[str, str]],
                            renamed: dict[tuple[str, str], str] | None = None) -> dict[tuple[str, str], str]:
    path = results_csv.with_name(results_csv.name.replace("_Tournament_Results.csv", "_Final_Standings.csv"))
    by_player: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        by_player[(row["Video"], row["Player"])].append(row)
    characters = {key: _most_used(player_rows) for key, player_rows in by_player.items()}
    if not path.is_file() or path == results_csv:
        return characters
    fieldnames, standings, bom = _read_csv(path)
    for row in standings:
        key = (row.get("VideoName", ""), row.get("PlayerName", ""))
        if renamed and key in renamed:
            row["PlayerName"] = renamed[key]
        character = characters.get((row.get("VideoName", ""), row.get("PlayerName", "")))
        if character:
            row["Character"] = character
            if "CharacterRosterName" in row:
                row["CharacterRosterName"] = _roster_name(character)
    _write_csv(path, fieldnames, standings, bom)
    return characters


def _update_workbook(results_csv: Path, rows: list[dict[str, str]], standings: dict[tuple[str, str], str],
                     renamed: dict[tuple[str, str], str] | None = None) -> bool:
    path = results_csv.with_suffix(".xlsx")
    if not path.is_file():
        return False
    import openpyxl  # noqa: WPS433

    workbook = openpyxl.load_workbook(path)
    if "Results" in workbook.sheetnames:
        sheet = workbook["Results"]
        header = [cell.value for cell in sheet[1]]
        by_key = {(row["Video"], str(row["Race"]), str(row["Position"])): row for row in rows}
        for cells in sheet.iter_rows(min_row=2):
            values = {name: cell for name, cell in zip(header, cells)}
            key = tuple(str(values[name].value) for name in ("Video", "Race", "Position"))
            row = by_key.get(key)
            if row is None:
                continue
            values["Character"].value = row["Character"]
            if "Player" in values:
                values["Player"].value = row["Player"]
            if "Character Roster" in values:
                values["Character Roster"].value = row.get("Character Roster", values["Character Roster"].value)
    if "Final Standings" in workbook.sheetnames:
        sheet = workbook["Final Standings"]
        header = [cell.value for cell in sheet[1]]
        for cells in sheet.iter_rows(min_row=2):
            values = {name: cell for name, cell in zip(header, cells)}
            key = (str(values["VideoName"].value), str(values["PlayerName"].value))
            if renamed and key in renamed:
                values["PlayerName"].value = renamed[key]
                key = (key[0], renamed[key])
            character = standings.get(key)
            if character:
                values["Character"].value = character
                if "CharacterRosterName" in values:
                    values["CharacterRosterName"].value = _roster_name(character)
    workbook.save(path)
    return True


def apply_recorded_race_classes(results_csv: Path, frames_root: Path, clean_assets: Path | None = None) -> dict[str, Any]:
    """ADR-0217: the race class of each race's track-intro frame into the results' "Class" column (CSV and the
    workbook's Results sheet), which the canonical export turns into mode/mirror. Races without an intro frame stay
    empty."""
    root = clean_assets or (Path(os.environ["MK8_CLEAN_ASSETS_ROOT"]) if os.environ.get("MK8_CLEAN_ASSETS_ROOT") else None)
    if root is None or not (Path(root) / "database.json").is_file():
        return {"applied": False, "reason": "no Clean Assets for the class badges"}
    from .race_class import RaceClassReader  # noqa: WPS433

    reader = RaceClassReader(Path(root))
    fieldnames, rows, bom = _read_csv(results_csv)
    races = reader.annotate(rows, lambda video, race: Path(frames_root) / video / f"Race_{int(race):03d}" / "0TrackName.jpg")
    if "Class" not in fieldnames:
        fieldnames.append("Class")
    for row in rows:
        row.setdefault("Class", "")
    _write_csv(results_csv, fieldnames, rows, bom)
    workbook = results_csv.with_suffix(".xlsx")
    if workbook.is_file():
        import openpyxl  # noqa: WPS433

        book = openpyxl.load_workbook(workbook)
        if "Results" in book.sheetnames:
            sheet = book["Results"]
            header = [cell.value for cell in sheet[1]]
            column = header.index("Class") + 1 if "Class" in header else len(header) + 1
            sheet.cell(row=1, column=column, value="Class")
            by_key = {(row["Video"], str(row["Race"]), str(row["Position"])): row.get("Class", "") for row in rows}
            for index, cells in enumerate(sheet.iter_rows(min_row=2), start=2):
                values = dict(zip(header, (cell.value for cell in cells)))
                key = (str(values.get("Video")), str(values.get("Race")), str(values.get("Position")))
                sheet.cell(row=index, column=column, value=by_key.get(key, ""))
            book.save(workbook)
    return {"applied": True, "racesWithClass": races}
