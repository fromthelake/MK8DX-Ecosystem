"""Canonical Clean Assets presentation, separate from recognition templates.

The generated metadata shares its source with the Web asset manifest. Legacy
recognition indexes are translated here; display consumers receive stable IDs.
Only exact catalog names/IDs are accepted, never an arbitrary asset path.
"""
from __future__ import annotations

from functools import lru_cache
from importlib.resources import files
import json
import os
from pathlib import Path
from typing import Any

from .paths import PRIVATE_REFERENCE_ROOT


def clean_assets_root() -> Path:
    return Path(os.environ.get("MK8_CLEAN_ASSETS_ROOT") or PRIVATE_REFERENCE_ROOT / "clean-assets").resolve()


@lru_cache(maxsize=1)
def track_presentations() -> tuple[dict[str, Any], ...]:
    data = json.loads(files("live_processor").joinpath("schema9-track-presentation.json").read_text(encoding="utf-8"))
    return tuple(data["tracks"])


def resolve_track_assets(data: dict[str, Any]) -> dict[str, Any] | None:
    tracks = track_presentations()
    identity_value = data.get("canonical_track_id")
    if identity_value in (None, ""):
        identity_value = data.get("track_id")
    identity = str(identity_value if identity_value is not None else "").strip()
    if identity.startswith("track."):
        return next((dict(track) for track in tracks if track["id"] == identity), None)
    # A recognized title is stronger evidence than an old numeric index.
    name = str(data.get("track_name") or data.get("track_name_nl") or "").strip().casefold()
    if name:
        return next((dict(track) for track in tracks
                     if name in {str(value).casefold() for value in track["names"].values()}), None)
    # Explicit compatibility boundary for older local events with only an index.
    return next((dict(track) for track in tracks if str(track["legacyIndex"]) == identity), None)


@lru_cache(maxsize=1)
def canonical_asset_paths() -> frozenset[str]:
    return frozenset(str(track[field]) for track in track_presentations() for field in ("previewPath", "cupIconPath"))


def canonical_asset_file(relative: str) -> Path | None:
    if relative not in canonical_asset_paths():
        return None
    root = clean_assets_root()
    path = (root / relative).resolve()
    return path if path.is_relative_to(root) and path.is_file() else None
