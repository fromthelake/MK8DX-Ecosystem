from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
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
    / "scan"
    / "Schema9ScanStableAssetResolver.kt"
)

SNAPSHOT_VERSION = "mk8dx.schema9-asset-catalog-snapshot.v1"
TYPE_CONFIG = {
    "character": ("CHARACTER", None, ("collections", "characters")),
    "character_variant": (
        "CHARACTER_VARIANT",
        "character",
        ("relationships", "characterVariants"),
    ),
    "body": ("BODY", None, ("collections", "vehicleBodies")),
    "body_variant": (
        "BODY_VARIANT",
        "body",
        ("relationships", "bodyVariants"),
    ),
    "glider": ("GLIDER", None, ("collections", "vehicleGliders")),
    "glider_variant": (
        "GLIDER_VARIANT",
        "glider",
        ("relationships", "gliderVariants"),
    ),
}
ALL_CATALOG_TYPES = {
    "track",
    "character",
    "character_variant",
    "body",
    "body_variant",
    "tire",
    "glider",
    "glider_variant",
    "country",
}
ID_PATTERN = re.compile(r"^[a-z_]+\.[a-z0-9]+(?:[._-][a-z0-9]+)*$")


class StableScanResolverExportError(ValueError):
    pass


def load_object_bytes(path: Path) -> tuple[dict[str, Any], bytes]:
    encoded = path.read_bytes()
    value = json.loads(encoded)
    if not isinstance(value, dict):
        raise StableScanResolverExportError(f"JSON root must be an object: {path}")
    return value, encoded


def expected_counts(baseline: dict[str, Any]) -> dict[str, int]:
    result: dict[str, int] = {}
    for asset_type, (_, _, (section, key)) in TYPE_CONFIG.items():
        value = baseline.get(section, {}).get(key)
        if type(value) is not int or value < 0:
            raise StableScanResolverExportError(
                f"baseline lacks valid count for {asset_type}"
            )
        result[asset_type] = value
    return result


def checked_selected_assets(
    catalog: dict[str, Any], baseline: dict[str, Any]
) -> list[dict[str, str]]:
    if set(catalog) != {
        "snapshotVersion",
        "schemaVersion",
        "sourceDatabaseSha256",
        "assets",
    }:
        raise StableScanResolverExportError("runtime catalog root shape is invalid")
    if catalog.get("snapshotVersion") != SNAPSHOT_VERSION or catalog.get("schemaVersion") != 9:
        raise StableScanResolverExportError("runtime catalog metadata is invalid")
    source_hash = catalog.get("sourceDatabaseSha256")
    if source_hash != baseline.get("database", {}).get("sha256"):
        raise StableScanResolverExportError("runtime catalog source hash differs from baseline")
    assets = catalog.get("assets")
    if not isinstance(assets, list):
        raise StableScanResolverExportError("runtime catalog assets must be a list")

    records_by_id: dict[str, dict[str, str]] = {}
    ordered_ids: list[str] = []
    for raw_asset in assets:
        if not isinstance(raw_asset, dict):
            raise StableScanResolverExportError("runtime catalog asset must be an object")
        asset_type = raw_asset.get("assetType")
        allowed_keys = {"id", "assetType", "parentId"} if str(asset_type).endswith("_variant") else {"id", "assetType"}
        if set(raw_asset) != allowed_keys:
            raise StableScanResolverExportError("runtime catalog asset shape is invalid")
        asset_id = raw_asset.get("id")
        if (
            not isinstance(asset_id, str)
            or not ID_PATTERN.fullmatch(asset_id)
            or asset_type not in ALL_CATALOG_TYPES
        ):
            raise StableScanResolverExportError("runtime catalog asset ID/type is invalid")
        if not asset_id.startswith(f"{asset_type}."):
            raise StableScanResolverExportError(f"runtime catalog ID/type mismatch: {asset_id}")
        if asset_id in records_by_id:
            raise StableScanResolverExportError(f"duplicate runtime catalog ID {asset_id}")
        record = {"id": asset_id, "assetType": asset_type}
        if "parentId" in raw_asset:
            parent_id = raw_asset["parentId"]
            if not isinstance(parent_id, str):
                raise StableScanResolverExportError(f"invalid parent for {asset_id}")
            record["parentId"] = parent_id
        records_by_id[asset_id] = record
        ordered_ids.append(asset_id)
    if ordered_ids != sorted(ordered_ids):
        raise StableScanResolverExportError("runtime catalog assets must be ID-sorted")

    selected = [
        record for record in records_by_id.values() if record["assetType"] in TYPE_CONFIG
    ]
    counts = Counter(record["assetType"] for record in selected)
    if counts != Counter(expected_counts(baseline)):
        raise StableScanResolverExportError("stable scan asset counts differ from baseline")
    for record in selected:
        asset_type = record["assetType"]
        expected_parent_type = TYPE_CONFIG[asset_type][1]
        parent_id = record.get("parentId")
        if expected_parent_type is None:
            if parent_id is not None:
                raise StableScanResolverExportError(
                    f"base stable scan asset has a parent: {record['id']}"
                )
            continue
        parent = records_by_id.get(parent_id or "")
        if parent is None or parent.get("assetType") != expected_parent_type:
            raise StableScanResolverExportError(
                f"variant parent is missing or wrong type: {record['id']}"
            )
    return selected


def export_kotlin_source(catalog_path: Path, baseline_path: Path) -> str:
    catalog, catalog_bytes = load_object_bytes(catalog_path)
    baseline, _ = load_object_bytes(baseline_path)
    selected = checked_selected_assets(catalog, baseline)
    source_hash = catalog["sourceDatabaseSha256"]
    catalog_hash = hashlib.sha256(catalog_bytes).hexdigest()
    counts = Counter(record["assetType"] for record in selected)
    record_lines: list[str] = []
    for record in selected:
        enum_name = TYPE_CONFIG[record["assetType"]][0]
        parent_argument = (
            f', "{record["parentId"]}"' if "parentId" in record else ""
        )
        record_lines.append(
            f'        "{record["id"]}" to ScanStableAssetRecord('
            f"ScanStableAssetType.{enum_name}{parent_argument}),"
        )
    entries = "\n".join(record_lines)
    return f'''// Generated by tooling/assets/export_android_scan_stable_resolver.py.
// Source database SHA-256: {source_hash}
// Source catalog SHA-256: {catalog_hash}
package nl.mariokart8.mk8dxtimetrials.scan

internal object Schema9ScanStableAssetResolver : ScanStableAssetResolver {{
    const val SOURCE_DATABASE_SHA256 = "{source_hash}"
    const val SOURCE_CATALOG_SHA256 = "{catalog_hash}"
    const val ASSET_COUNT = {len(selected)}
    const val CHARACTER_COUNT = {counts["character"]}
    const val CHARACTER_VARIANT_COUNT = {counts["character_variant"]}
    const val BODY_COUNT = {counts["body"]}
    const val BODY_VARIANT_COUNT = {counts["body_variant"]}
    const val GLIDER_COUNT = {counts["glider"]}
    const val GLIDER_VARIANT_COUNT = {counts["glider_variant"]}

    private val records = mapOf(
{entries}
    )

    override fun resolve(assetId: String): ScanStableAssetRecord? = records[assetId]
}}
'''


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export the Android scan stable asset Kotlin resolver."
    )
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    arguments = parser.parse_args()
    output = export_kotlin_source(
        arguments.catalog.resolve(), arguments.baseline.resolve()
    )
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(output, encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
