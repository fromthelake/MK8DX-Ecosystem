from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE = ROOT.parent / "MK8DX Clean Assets - deploy" / "database.json"
DEFAULT_BASELINE = ROOT / "tooling" / "assets" / "schema9-release-baseline-v7.json"
DEFAULT_CATALOG = ROOT / "packages" / "assets" / "schema9-asset-catalog-v1.json"
DEFAULT_OUTPUT = (
    ROOT
    / "apps"
    / "timetrials-android"
    / "app"
    / "src"
    / "main"
    / "java"
    / "nl"
    / "mariokart8"
    / "mk8dxtimetrials"
    / "track"
    / "Schema9AndroidTrackCatalog.kt"
)

TRACK_ID_PATTERN = re.compile(r"^track\.[a-z0-9]+(?:_[a-z0-9]+)*$")
CUP_ID_PATTERN = re.compile(r"^cup\.[a-z0-9]+(?:_[a-z0-9]+)*$")


class AndroidTrackCatalogExportError(ValueError):
    pass


def _load_object(path: Path) -> tuple[dict[str, Any], bytes]:
    encoded = path.read_bytes()
    value = json.loads(encoded)
    if not isinstance(value, dict):
        raise AndroidTrackCatalogExportError(f"JSON root must be an object: {path}")
    return value, encoded


def _checked_tracks(
    database: dict[str, Any],
    database_bytes: bytes,
    baseline: dict[str, Any],
    catalog: dict[str, Any],
) -> tuple[list[dict[str, Any]], str]:
    database_hash = hashlib.sha256(database_bytes).hexdigest()
    if database_hash != baseline.get("database", {}).get("sha256"):
        raise AndroidTrackCatalogExportError("database hash differs from baseline")
    if database_hash != catalog.get("sourceDatabaseSha256"):
        raise AndroidTrackCatalogExportError("catalog source hash differs from database")

    expected_count = baseline.get("collections", {}).get("tracks")
    tracks = database.get("collections", {}).get("tracks")
    if type(expected_count) is not int or not isinstance(tracks, list):
        raise AndroidTrackCatalogExportError("track collections are unavailable")
    if len(tracks) != expected_count:
        raise AndroidTrackCatalogExportError("track count differs from baseline")

    catalog_track_ids = {
        asset.get("id")
        for asset in catalog.get("assets", [])
        if isinstance(asset, dict) and asset.get("assetType") == "track"
    }
    checked: list[dict[str, Any]] = []
    observed_ids: set[str] = set()
    for expected_index, track in enumerate(tracks):
        if not isinstance(track, dict):
            raise AndroidTrackCatalogExportError("track record is invalid")
        track_id = track.get("id")
        index = track.get("index")
        lap_count = track.get("lapCount")
        names = track.get("names")
        display_name = names.get("en-US") if isinstance(names, dict) else None
        if (
            not isinstance(track_id, str)
            or not TRACK_ID_PATTERN.fullmatch(track_id)
            or track_id in observed_ids
            or index != expected_index
            or lap_count not in {3, 7}
            or not isinstance(display_name, str)
            or not 1 <= len(display_name) <= 64
            or any(ord(character) < 32 for character in display_name)
        ):
            raise AndroidTrackCatalogExportError("track metadata is invalid")
        observed_ids.add(track_id)
        checked.append(
            {
                "id": track_id,
                "index": index,
                "displayName": display_name,
                "lapCount": lap_count,
            }
        )
    if observed_ids != catalog_track_ids:
        raise AndroidTrackCatalogExportError("track IDs differ from runtime catalog")
    return checked, database_hash


def _checked_cups(
    database: dict[str, Any],
    baseline: dict[str, Any],
    tracks: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    expected_count = baseline.get("collections", {}).get("cups")
    if expected_count is None:
        return []
    cups = database.get("collections", {}).get("cups")
    if type(expected_count) is not int or not isinstance(cups, list):
        raise AndroidTrackCatalogExportError("cup collection is unavailable")
    if len(cups) != expected_count:
        raise AndroidTrackCatalogExportError("cup count differs from baseline")
    track_index_by_id = {track["id"]: track["index"] for track in tracks}
    checked: list[dict[str, Any]] = []
    observed_track_ids: list[str] = []
    observed_cup_ids: set[str] = set()
    for expected_index, cup in enumerate(cups):
        if not isinstance(cup, dict):
            raise AndroidTrackCatalogExportError("cup metadata is invalid")
        cup_id = cup.get("id")
        index = cup.get("index")
        names = cup.get("names")
        display_name = names.get("en-US") if isinstance(names, dict) else None
        track_ids = cup.get("trackIds")
        if (
            not isinstance(cup_id, str)
            or CUP_ID_PATTERN.fullmatch(cup_id) is None
            or cup_id in observed_cup_ids
            or index != expected_index
            or not isinstance(display_name, str)
            or not 1 <= len(display_name) <= 64
            or any(ord(character) < 32 for character in display_name)
            or not isinstance(track_ids, list)
            or len(track_ids) != 4
            or any(track_id not in track_index_by_id for track_id in track_ids)
            or len(set(track_ids)) != 4
        ):
            raise AndroidTrackCatalogExportError("cup metadata is invalid")
        observed_cup_ids.add(cup_id)
        observed_track_ids.extend(track_ids)
        checked.append(
            {
                "id": cup_id,
                "index": index,
                "displayName": display_name,
                "trackIndices": [track_index_by_id[track_id] for track_id in track_ids],
            }
        )
    if observed_track_ids != [track["id"] for track in tracks]:
        raise AndroidTrackCatalogExportError("cup track order differs from track collection")
    return checked


def _kotlin_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False).replace("$", "\\$")


def export_kotlin_source(
    database_path: Path,
    baseline_path: Path,
    catalog_path: Path,
) -> str:
    database, database_bytes = _load_object(database_path)
    baseline, _ = _load_object(baseline_path)
    catalog, catalog_bytes = _load_object(catalog_path)
    tracks, database_hash = _checked_tracks(
        database,
        database_bytes,
        baseline,
        catalog,
    )
    cups = _checked_cups(database, baseline, tracks)
    lines = "\n".join(
        "        AndroidTrackCatalogEntry("
        f"{_kotlin_string(track['id'])}, {track['index']}, "
        f"{_kotlin_string(track['displayName'])}, {track['lapCount']}),"
        for track in tracks
    )
    catalog_hash = hashlib.sha256(catalog_bytes).hexdigest()
    cup_lines = "\n".join(
        "        AndroidCupCatalogEntry("
        f"{_kotlin_string(cup['id'])}, {cup['index']}, "
        f"{_kotlin_string(cup['displayName'])}, "
        "listOf("
        + ", ".join(f"entries[{index}]" for index in cup["trackIndices"])
        + ")),"
        for cup in cups
    )
    return f'''// Generated by tooling/assets/export_android_track_catalog.py.
// Source database SHA-256: {database_hash}
// Source catalog SHA-256: {catalog_hash}
package nl.mariokart8.mk8dxtimetrials.track

internal data class AndroidTrackCatalogEntry(
    val id: String,
    val index: Int,
    val displayName: String,
    val lapCount: Int,
)

internal data class AndroidCupCatalogEntry(
    val id: String,
    val index: Int,
    val displayName: String,
    val tracks: List<AndroidTrackCatalogEntry>,
)

internal object Schema9AndroidTrackCatalog {{
    const val SOURCE_DATABASE_SHA256 = "{database_hash}"
    const val SOURCE_CATALOG_SHA256 = "{catalog_hash}"
    const val TRACK_COUNT = {len(tracks)}

    val entries: List<AndroidTrackCatalogEntry> = listOf(
{lines}
    )

    private val byId = entries.associateBy(AndroidTrackCatalogEntry::id)

    val cups: List<AndroidCupCatalogEntry> = listOf(
{cup_lines}
    )

    fun find(trackId: String): AndroidTrackCatalogEntry? = byId[trackId]
}}
'''


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export the schema-9 Android track catalog."
    )
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    arguments = parser.parse_args()
    output = export_kotlin_source(
        arguments.database.resolve(),
        arguments.baseline.resolve(),
        arguments.catalog.resolve(),
    )
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(output, encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
