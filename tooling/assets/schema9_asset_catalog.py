from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

from verify_schema9_release import DEFAULT_BASELINE_PATH, load_json, verify_release


CATALOG_VERSION = "mk8dx.schema9-asset-catalog.v1"

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

VARIANT_PARENT_TYPES = {
    "character_variant": "character",
    "body_variant": "body",
    "glider_variant": "glider",
}


class ReleaseVerificationError(ValueError):
    def __init__(self, verification_result: dict[str, Any]) -> None:
        super().__init__("Schema-9 release verification failed")
        self.verification_result = verification_result


class Schema9AssetCatalog:
    """Read-only stable-ID and variant-parent index for a schema-9 database."""

    def __init__(self, database: dict[str, Any]) -> None:
        if database.get("schemaVersion") != 9:
            raise ValueError("Schema9AssetCatalog requires schemaVersion 9")
        self.database = database
        self._assets: dict[str, dict[str, Any]] = {}

        for asset_type, (section, collection, parent_field) in ASSET_SOURCES.items():
            records = database.get(section, {}).get(collection)
            if not isinstance(records, list):
                raise ValueError(f"Missing schema-9 record list: {section}.{collection}")
            for record in records:
                if not isinstance(record, dict) or not isinstance(record.get("id"), str):
                    raise ValueError(f"Invalid record in {section}.{collection}")
                asset_id = record["id"]
                if asset_id in self._assets:
                    raise ValueError(f"Duplicate schema-9 asset ID: {asset_id}")
                parent_id = record.get(parent_field) if parent_field else None
                if parent_field and not isinstance(parent_id, str):
                    raise ValueError(
                        f"Missing {parent_field} for schema-9 variant {asset_id}"
                    )
                self._assets[asset_id] = {
                    "assetType": asset_type,
                    "parentId": parent_id,
                }

        for asset_id, metadata in self._assets.items():
            expected_parent_type = VARIANT_PARENT_TYPES.get(metadata["assetType"])
            if expected_parent_type is None:
                continue
            parent = self._assets.get(metadata["parentId"])
            if parent is None or parent["assetType"] != expected_parent_type:
                raise ValueError(
                    f"Invalid schema-9 parent {metadata['parentId']} for {asset_id}"
                )

    @classmethod
    def from_database_path(cls, database_path: Path) -> "Schema9AssetCatalog":
        database = load_json(database_path)
        if not isinstance(database, dict):
            raise ValueError("Schema-9 database root must be an object")
        return cls(database)

    @classmethod
    def from_verified_release(
        cls,
        release_root: Path,
        baseline_path: Path = DEFAULT_BASELINE_PATH,
    ) -> "Schema9AssetCatalog":
        verification = verify_release(release_root, baseline_path)
        if verification["status"] != "PASS":
            raise ReleaseVerificationError(verification)
        baseline = load_json(baseline_path)
        return cls.from_database_path(release_root / baseline["database"]["path"])

    @property
    def size(self) -> int:
        return len(self._assets)

    def ids(self, asset_type: str | None = None) -> set[str]:
        if asset_type is None:
            return set(self._assets)
        return {
            asset_id
            for asset_id, metadata in self._assets.items()
            if metadata["assetType"] == asset_type
        }

    def resolve(
        self, asset_id: Any, expected_types: str | Iterable[str] | None = None
    ) -> dict[str, Any]:
        if isinstance(expected_types, str):
            expected = [expected_types]
        elif expected_types is None:
            expected = []
        else:
            expected = sorted(set(expected_types))

        if not isinstance(asset_id, str):
            return {
                "catalogVersion": CATALOG_VERSION,
                "status": "INVALID_ASSET_ID",
                "assetId": asset_id,
                "expectedTypes": expected,
                "actualType": None,
                "parentId": None,
            }

        metadata = self._assets.get(asset_id)
        if metadata is None:
            return {
                "catalogVersion": CATALOG_VERSION,
                "status": "UNKNOWN_ASSET_ID",
                "assetId": asset_id,
                "expectedTypes": expected,
                "actualType": None,
                "parentId": None,
            }

        actual_type = metadata["assetType"]
        return {
            "catalogVersion": CATALOG_VERSION,
            "status": "RESOLVED" if not expected or actual_type in expected else "TYPE_MISMATCH",
            "assetId": asset_id,
            "expectedTypes": expected,
            "actualType": actual_type,
            "parentId": metadata["parentId"],
        }

    def _reference_error(
        self,
        path: str,
        asset_id: Any,
        expected_types: str | Iterable[str],
    ) -> dict[str, Any] | None:
        result = self.resolve(asset_id, expected_types)
        if result["status"] == "RESOLVED":
            return None
        return {
            "code": result["status"],
            "path": path,
            "assetId": asset_id,
            "expectedTypes": result["expectedTypes"],
            "actualType": result["actualType"],
            "expectedParentId": None,
            "actualParentId": result["parentId"],
        }

    def _parent_error(
        self,
        path: str,
        variant_id: Any,
        base_id: Any,
        variant_type: str,
    ) -> dict[str, Any] | None:
        variant = self.resolve(variant_id, variant_type)
        if variant["status"] != "RESOLVED" or variant["parentId"] == base_id:
            return None
        return {
            "code": "VARIANT_PARENT_MISMATCH",
            "path": path,
            "assetId": variant_id,
            "expectedTypes": [variant_type],
            "actualType": variant["actualType"],
            "expectedParentId": base_id,
            "actualParentId": variant["parentId"],
        }

    @staticmethod
    def _append(errors: list[dict[str, Any]], error: dict[str, Any] | None) -> None:
        if error is not None:
            errors.append(error)

    def validate_time_trial_submission(self, document: Any) -> list[dict[str, Any]]:
        if not isinstance(document, dict):
            return [
                {
                    "code": "INVALID_DOCUMENT_SHAPE",
                    "path": "",
                    "assetId": None,
                    "expectedTypes": [],
                    "actualType": None,
                    "expectedParentId": None,
                    "actualParentId": None,
                }
            ]

        errors: list[dict[str, Any]] = []
        self._append(
            errors,
            self._reference_error("/trackId", document.get("trackId"), "track"),
        )
        if "countryId" in document:
            self._append(
                errors,
                self._reference_error("/countryId", document["countryId"], "country"),
            )

        loadout = document.get("loadout")
        if isinstance(loadout, dict):
            fields = {
                "characterId": "character",
                "characterVariantId": "character_variant",
                "bodyId": "body",
                "bodyVariantId": "body_variant",
                "tireId": "tire",
                "gliderId": "glider",
                "gliderVariantId": "glider_variant",
            }
            for field, asset_type in fields.items():
                if field in loadout:
                    self._append(
                        errors,
                        self._reference_error(
                            f"/loadout/{field}", loadout[field], asset_type
                        ),
                    )
            for variant_field, base_field, variant_type in (
                ("characterVariantId", "characterId", "character_variant"),
                ("bodyVariantId", "bodyId", "body_variant"),
                ("gliderVariantId", "gliderId", "glider_variant"),
            ):
                if variant_field in loadout and base_field in loadout:
                    self._append(
                        errors,
                        self._parent_error(
                            f"/loadout/{variant_field}",
                            loadout[variant_field],
                            loadout[base_field],
                            variant_type,
                        ),
                    )
        return errors

    def validate_tournament_race_result(self, document: Any) -> list[dict[str, Any]]:
        if not isinstance(document, dict):
            return self.validate_time_trial_submission(document)

        errors: list[dict[str, Any]] = []
        self._append(
            errors,
            self._reference_error("/trackId", document.get("trackId"), "track"),
        )
        placements = document.get("placements")
        if isinstance(placements, list):
            for index, placement in enumerate(placements):
                if not isinstance(placement, dict):
                    continue
                if "characterId" in placement:
                    self._append(
                        errors,
                        self._reference_error(
                            f"/placements/{index}/characterId",
                            placement["characterId"],
                            "character",
                        ),
                    )
                if "characterVariantId" in placement:
                    variant_path = f"/placements/{index}/characterVariantId"
                    self._append(
                        errors,
                        self._reference_error(
                            variant_path,
                            placement["characterVariantId"],
                            "character_variant",
                        ),
                    )
                    if "characterId" in placement:
                        self._append(
                            errors,
                            self._parent_error(
                                variant_path,
                                placement["characterVariantId"],
                                placement["characterId"],
                                "character_variant",
                            ),
                        )
        return errors
