"""Strict in-memory schema-9 catalog adapter for the LiveTrial asset port."""

from __future__ import annotations

import re
from types import MappingProxyType

from livetrial_adapter import LiveTrialAssetRecord


_ASSET_TYPES = {
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
_PARENT_TYPES = {
    "character_variant": "character",
    "body_variant": "body",
    "glider_variant": "glider",
}
_ID_PATTERNS = {
    "track": re.compile(r"^track\.[a-z0-9]+(?:_[a-z0-9]+)*$"),
    "character": re.compile(r"^character\.[a-z0-9]+(?:_[a-z0-9]+)*$"),
    "character_variant": re.compile(
        r"^character_variant\.[a-z0-9]+(?:_[a-z0-9]+)*\.[0-9]{3}_[a-z0-9]+(?:_[a-z0-9]+)*$"
    ),
    "body": re.compile(r"^body\.[a-z0-9]+(?:_[a-z0-9]+)*$"),
    "body_variant": re.compile(
        r"^body_variant\.[a-z0-9]+(?:_[a-z0-9]+)*\.[0-9]{3}_[a-z0-9]+(?:_[a-z0-9]+)*$"
    ),
    "tire": re.compile(r"^tire\.[a-z0-9]+(?:_[a-z0-9]+)*$"),
    "glider": re.compile(r"^glider\.[a-z0-9]+(?:_[a-z0-9]+)*$"),
    "glider_variant": re.compile(
        r"^glider_variant\.[a-z0-9]+(?:_[a-z0-9]+)*\.[0-9]{3}_[a-z0-9]+(?:_[a-z0-9]+)*$"
    ),
    "country": re.compile(r"^country\.[a-z]{2}$"),
}
_SHA256 = re.compile(r"^[a-f0-9]{64}$")


class LiveTrialAssetCatalogError(ValueError):
    """Bounded invalid-catalog error without document or path detail."""


def _fail() -> None:
    raise LiveTrialAssetCatalogError("LiveTrial asset catalog is invalid.") from None


class Schema9LiveTrialAssetCatalog:
    """Immutable lookup adapter from one already parsed shared snapshot."""

    def __init__(self, document: object, expected_source_sha256: str) -> None:
        if (
            not isinstance(expected_source_sha256, str)
            or not _SHA256.fullmatch(expected_source_sha256)
            or not isinstance(document, dict)
            or set(document)
            != {"snapshotVersion", "schemaVersion", "sourceDatabaseSha256", "assets"}
            or document.get("snapshotVersion")
            != "mk8dx.schema9-asset-catalog-snapshot.v1"
            or document.get("schemaVersion") != 9
            or isinstance(document.get("schemaVersion"), bool)
            or document.get("sourceDatabaseSha256") != expected_source_sha256
            or not isinstance(document.get("assets"), list)
        ):
            _fail()

        records: dict[str, LiveTrialAssetRecord] = {}
        for candidate in document["assets"]:
            if (
                not isinstance(candidate, dict)
                or not {"id", "assetType"} <= set(candidate)
                or not set(candidate) <= {"id", "assetType", "parentId"}
                or not isinstance(candidate.get("id"), str)
                or candidate.get("assetType") not in _ASSET_TYPES
            ):
                _fail()
            stable_id = candidate["id"]
            asset_type = candidate["assetType"]
            if stable_id in records or not _ID_PATTERNS[asset_type].fullmatch(stable_id):
                _fail()
            parent_id = candidate.get("parentId")
            if (
                asset_type in _PARENT_TYPES
                and not isinstance(parent_id, str)
            ) or (
                asset_type not in _PARENT_TYPES
                and "parentId" in candidate
            ):
                _fail()
            records[stable_id] = LiveTrialAssetRecord(asset_type, parent_id)

        for record in records.values():
            expected_parent_type = _PARENT_TYPES.get(record.asset_type)
            if expected_parent_type is None:
                continue
            parent = records.get(record.parent_id or "")
            if parent is None or parent.asset_type != expected_parent_type:
                _fail()
        self._records = MappingProxyType(records)

    @property
    def size(self) -> int:
        return len(self._records)

    def resolve(self, stable_id: str) -> LiveTrialAssetRecord | None:
        return self._records.get(stable_id)
