from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from importlib.resources import files


@lru_cache(maxsize=1)
def _known_asset_ids() -> frozenset[str]:
    path = files("mk8dx_tournament_extraction").joinpath("runtime-assets-v1.json")
    payload = json.loads(path.read_text(encoding="utf-8"))
    return frozenset(str(asset_id) for asset_id in payload["assetIds"])


def _slug(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    normalized = normalized.replace("'", "")
    return re.sub(r"[^a-z0-9]+", "_", normalized.casefold()).strip("_")


#: What the original Video Result Extractor writes as Track when a race has no
#: readable track card (for instance a recording that starts after it). The race
#: stays in the workbook so the Director fills the track in before importing.
TRACK_PLACEHOLDER = "UNKNOWN"


class MissingTrackError(ValueError):
    """The race's Track is empty or still the placeholder."""


def is_missing_track(value: object) -> bool:
    text = str(value or "").strip()
    return not text or text.casefold() == TRACK_PLACEHOLDER.casefold()


def resolve_track_id(value: object) -> str:
    text = str(value or "").strip()
    if is_missing_track(text):
        raise MissingTrackError("Track is required")
    candidate = text if text.startswith("track.") else f"track.{_slug(text)}"
    # Nintendo uses a different English name for this course by region. The
    # preserved Manager, Processor, and Live game catalogs all identify
    # ``Wii DK's Snowboard Cross`` (UK) and ``Wii DK Summit`` (US) as the same
    # track. Schema 9 intentionally uses the US-derived stable ID.
    if candidate == "track.wii_dks_snowboard_cross":
        candidate = "track.wii_dk_summit"
    if candidate not in _known_asset_ids():
        raise ValueError(f"Track {text!r} does not resolve to a schema-9 stable ID")
    return candidate


def resolve_character_id(value: object) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    candidate = text if text.startswith("character.") else f"character.{_slug(text)}"
    return candidate if candidate in _known_asset_ids() else None
