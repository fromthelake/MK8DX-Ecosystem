from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BASELINE = ROOT / "tooling" / "assets" / "schema9-release-baseline-v7.json"
DEFAULT_OUTPUT = ROOT / "packages" / "assets" / "schema9-asset-catalog-v1.json"

ASSET_SOURCES = {
    "track": ("collections", "tracks", None),
    "character": ("collections", "characters", None),
    "character_variant": ("relationships", "characterVariants", "characterId"),
    "body": ("collections", "vehicleBodies", None),
    "body_variant": ("relationships", "bodyVariants", "bodyId"),
    "tire": ("collections", "vehicleTires", None),
    "glider": ("collections", "vehicleGliders", None),
    "glider_variant": ("relationships", "gliderVariants", "gliderId"),
    "country": ("collections", "countries", None),
}


class CatalogExportError(ValueError):
    pass


def load_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise CatalogExportError(f"JSON root must be an object: {path}")
    return value


def export_snapshot(database_path: Path, baseline_path: Path) -> dict[str, Any]:
    baseline = load_object(baseline_path)
    database_bytes = database_path.read_bytes()
    actual_hash = hashlib.sha256(database_bytes).hexdigest()
    expected_hash = baseline.get("database", {}).get("sha256")
    if actual_hash != expected_hash:
        raise CatalogExportError("schema-9 database hash does not match pinned baseline")
    database = json.loads(database_bytes)
    if not isinstance(database, dict) or database.get("schemaVersion") != 9:
        raise CatalogExportError("catalog source must be a schema-9 database object")

    assets: list[dict[str, str]] = []
    seen: set[str] = set()
    for asset_type, (section, collection, parent_field) in ASSET_SOURCES.items():
        records = database.get(section, {}).get(collection)
        if not isinstance(records, list):
            raise CatalogExportError(f"missing record list {section}.{collection}")
        for record in records:
            if not isinstance(record, dict) or not isinstance(record.get("id"), str):
                raise CatalogExportError(f"invalid record in {section}.{collection}")
            asset_id = record["id"]
            if asset_id in seen:
                raise CatalogExportError(f"duplicate asset ID {asset_id}")
            seen.add(asset_id)
            asset = {"id": asset_id, "assetType": asset_type}
            if parent_field is not None:
                parent_id = record.get(parent_field)
                if not isinstance(parent_id, str):
                    raise CatalogExportError(f"missing parent for {asset_id}")
                asset["parentId"] = parent_id
            assets.append(asset)

    assets.sort(key=lambda item: item["id"])
    return {
        "snapshotVersion": "mk8dx.schema9-asset-catalog-snapshot.v1",
        "schemaVersion": 9,
        "sourceDatabaseSha256": actual_hash,
        "assets": assets,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export the minimal runtime schema-9 stable-ID catalog."
    )
    parser.add_argument("database", type=Path)
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    arguments = parser.parse_args()
    snapshot = export_snapshot(
        arguments.database.resolve(), arguments.baseline.resolve()
    )
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(
        json.dumps(snapshot, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
