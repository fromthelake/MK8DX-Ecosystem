from __future__ import annotations

import argparse
import hashlib
import json
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
    / "Schema9ScanLegacyAssetResolver.kt"
)


class ScanResolverExportError(ValueError):
    pass


def load_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ScanResolverExportError(f"JSON root must be an object: {path}")
    return value


def checked_records(database: dict[str, Any], name: str) -> list[dict[str, Any]]:
    collections = database.get("collections")
    if not isinstance(collections, dict):
        raise ScanResolverExportError("schema-9 collections must be an object")
    records = collections.get(name)
    if not isinstance(records, list) or not all(isinstance(item, dict) for item in records):
        raise ScanResolverExportError(f"missing record list collections.{name}")
    return records


def checked_indexed_ids(
    records: list[dict[str, Any]],
    expected_type: str,
    catalog_types: dict[str, str],
) -> list[tuple[int, str]]:
    result: list[tuple[int, str]] = []
    seen_indices: set[int] = set()
    for record in records:
        index = record.get("index")
        asset_id = record.get("id")
        if type(index) is not int or index < 0 or not isinstance(asset_id, str):
            raise ScanResolverExportError(f"invalid {expected_type} index record")
        if index in seen_indices:
            raise ScanResolverExportError(f"duplicate {expected_type} index {index}")
        seen_indices.add(index)
        if catalog_types.get(asset_id) != expected_type:
            raise ScanResolverExportError(
                f"{expected_type} ID missing or wrong type in runtime catalog: {asset_id}"
            )
        result.append((index, asset_id))
    return sorted(result)


def export_kotlin_source(
    database_path: Path,
    baseline_path: Path,
    catalog_path: Path,
) -> str:
    baseline = load_object(baseline_path)
    database_bytes = database_path.read_bytes()
    source_hash = hashlib.sha256(database_bytes).hexdigest()
    if source_hash != baseline.get("database", {}).get("sha256"):
        raise ScanResolverExportError("schema-9 database hash does not match pinned baseline")
    database = json.loads(database_bytes)
    if not isinstance(database, dict) or database.get("schemaVersion") != 9:
        raise ScanResolverExportError("resolver source must be a schema-9 database object")

    catalog = load_object(catalog_path)
    if catalog.get("sourceDatabaseSha256") != source_hash:
        raise ScanResolverExportError("runtime catalog and database hashes differ")
    assets = catalog.get("assets")
    if not isinstance(assets, list):
        raise ScanResolverExportError("runtime catalog assets must be a list")
    catalog_types: dict[str, str] = {}
    for asset in assets:
        if not isinstance(asset, dict):
            raise ScanResolverExportError("runtime catalog asset must be an object")
        asset_id = asset.get("id")
        asset_type = asset.get("assetType")
        if not isinstance(asset_id, str) or not isinstance(asset_type, str):
            raise ScanResolverExportError("runtime catalog asset ID/type is invalid")
        if asset_id in catalog_types:
            raise ScanResolverExportError(f"duplicate runtime catalog ID {asset_id}")
        catalog_types[asset_id] = asset_type

    tires = checked_indexed_ids(
        checked_records(database, "vehicleTires"), "tire", catalog_types
    )
    if [index for index, _ in tires] != list(range(len(tires))):
        raise ScanResolverExportError("tire indices must be contiguous from zero")

    country_records = checked_records(database, "countries")
    all_countries = checked_indexed_ids(country_records, "country", catalog_types)
    record_by_index = {record["index"]: record for record in country_records}
    scan_countries: list[tuple[int, str]] = []
    for index, asset_id in all_countries:
        record = record_by_index[index]
        is_mk8_country = record.get("isMk8Country")
        if not isinstance(is_mk8_country, bool):
            raise ScanResolverExportError(f"country {asset_id} lacks boolean isMk8Country")
        record_assets = record.get("assets")
        mk8_flag = record_assets.get("mk8Flag") if isinstance(record_assets, dict) else None
        if is_mk8_country:
            if not isinstance(mk8_flag, dict) or not isinstance(mk8_flag.get("path"), str):
                raise ScanResolverExportError(f"MK8 country lacks flag asset: {asset_id}")
            # The staged flag templates carry the schema-9 country index (ADR-0214;
            # verify_source_runtime.rekey_flags), so the scan index is the country index.
            scan_countries.append((index, asset_id))

    tire_lines = "\n".join(f'        "{asset_id}",' for _, asset_id in tires)
    country_lines = "\n".join(
        f'        {index} to "{asset_id}",' for index, asset_id in scan_countries
    )
    return f'''// Generated by tooling/assets/export_android_scan_legacy_resolver.py.
// Source database SHA-256: {source_hash}
package nl.mariokart8.mk8dxtimetrials.scan

internal object Schema9ScanLegacyAssetResolver : ScanLegacyAssetResolver {{
    const val SOURCE_DATABASE_SHA256 = "{source_hash}"
    const val TIRE_COUNT = {len(tires)}
    const val COUNTRY_COUNT = {len(scan_countries)}

    private val tireIds = listOf(
{tire_lines}
    )

    private val countryIds = mapOf(
{country_lines}
    )

    override fun resolveTire(index: Int): String? = tireIds.getOrNull(index)

    override fun resolveCountry(index: Int): String? = countryIds[index]
}}
'''


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export the Android scan legacy tire/country Kotlin resolver."
    )
    parser.add_argument("database", type=Path)
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
