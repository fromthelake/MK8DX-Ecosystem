from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2  # type: ignore

from mk8dx_tournament_extraction import track_names  # type: ignore

from .baseline_assets import load_imported_game_catalog, resolve_live_asset_file
from .ocr_runtime import easyocr_gpu_requested, optimize_easyocr_reader, write_ocr_runtime_report
from .paths import DIAGNOSTICS_ROOT, assert_write_allowed
from .run_context import attach_run_id, current_run_id

try:  # pragma: no cover - dependency availability is reported at runtime.
    import easyocr  # type: ignore
except Exception:  # pragma: no cover
    easyocr = None  # type: ignore


TRACK_NAME_ROI = ((319, 633), (925, 685))
TRACK_EASYOCR_LANGS = [
    part.strip()
    for part in os.environ.get("MK8_TRACK_EASYOCR_LANGS", "en,nl").split(",")
    if part.strip()
]
CHARACTER_VARIANT_FAMILY_ROSTER_NAMES = {
    7: "Birdo",
    8: "Yoshi",
    11: "Shy Guy",
    40: "Inkling",
}
EXPLICIT_CHARACTER_VARIANT_FAMILIES = {
    "Mario": ("Mario", "Metal Mario", "Gold Mario"),
    "Peach": ("Peach", "Cat Peach", "Baby Peach", "Pink Gold Peach", "Peachette"),
}

_EASYOCR_READERS: dict[tuple[str, ...], Any] = {}
_EASYOCR_LOCK = threading.Lock()


@dataclass(frozen=True)
class TrackMetadata:
    stream_id: str
    race_sequence: int
    track_frame_index: int
    track_frame_path: str
    raw_track_text: str
    track_name: str
    cup_name: str
    track_id: str
    confidence: float
    status: str
    track_name_nl: str = ""
    cup_name_nl: str = ""
    cup_id: str = ""
    track_icon_path: str = ""
    cup_icon_path: str = ""
    error: str = ""


def load_track_tuples() -> list[tuple[int, str, str, int, str]]:
    """Copy of baseline catalog tuple shape used by match_track_name/get_cup_name."""
    catalog = _load_catalog()
    cups = {
        int(cup["cupIndex"]): str(cup.get("nameUK", ""))
        for cup in catalog.get("cups", [])
    }
    tracks: list[tuple[int, str, str, int, str]] = []
    for track in catalog.get("tracks", []):
        track_index = int(track.get("trackIndex", 0))
        cup_index = int(track.get("cupIndex", 0))
        tracks.append(
            (
                track_index,
                str(track.get("nameUK", "")),
                str(track.get("nameNL", "")),
                cup_index,
                cups.get(cup_index, ""),
            )
        )
    return tracks


def lookup_track_catalog(track_name: str) -> dict[str, Any]:
    catalog = _load_catalog()
    for track in catalog.get("tracks", []):
        if track_name == str(track.get("nameUK", "")).strip():
            cup_index = int(track.get("cupIndex", -1))
            cup = next(
                (item for item in catalog.get("cups", []) if int(item.get("cupIndex", -2)) == cup_index),
                {},
            )
            return {"track": track, "cup": cup}
    return {"track": {}, "cup": {}}


def asset_path(asset_type: str, index: int | str | None) -> str:
    if index in (None, ""):
        return ""
    path = resolve_live_asset_file(asset_type, f"{index}.webp")
    return str(path) if path.exists() else ""


def match_track_name(track_name: str, track_list: list[tuple[int, str, str, int, str]], locale: str = "auto") -> str:
    """The English (UK) name of the track an OCR read names, by the central title matcher
    (packages/icon-matcher name_match.match_title, the same rule as LiveTrial; CENTRAL_RECOGNITION
    section 8.6) over the English and Dutch names. A read it does not accept - or no central
    matcher - returns the read itself, so the track stays unmatched for the Director instead of
    becoming the nearest wrong track."""
    try:
        import mk8dx_icon_matcher.name_match as name_match
    except ImportError:
        return track_name
    # A console's chosen game locale adds its own track names (languages roadmap A2).
    vocab = track_names.vocabulary(track_list, locale)
    found = name_match.match_title(track_name, vocab)
    return found.key.split("#", 1)[0] if found.key else track_name


def get_cup_name(track_name: str, track_list: list[tuple[int, str, str, int, str]]) -> str:
    """Exact baseline behavior from extract_text.get_cup_name."""
    for track in track_list:
        if track_name == track[1]:
            return track[4]
    return ""


def get_track_id(track_name: str, track_list: list[tuple[int, str, str, int, str]]) -> str:
    for track in track_list:
        if track_name == track[1]:
            return str(track[0])
    return ""


def extract_track_metadata(track_entry: dict[str, Any]) -> TrackMetadata:
    stream_id = str(track_entry.get("stream_id", ""))
    race_sequence = int(track_entry.get("race_sequence") or 0)
    frame_index = int(track_entry.get("frame_index") or track_entry.get("selected_track_name_frame") or 0)
    crop_path = str(track_entry.get("ocr_ready_crop_path") or track_entry.get("crop_path") or "")
    tracks_list = load_track_tuples()
    locale = track_names.game_locale(stream_id, track_entry.get("game_locale"))
    if not crop_path:
        return TrackMetadata(
            stream_id=stream_id,
            race_sequence=race_sequence,
            track_frame_index=frame_index,
            track_frame_path=crop_path,
            raw_track_text="",
            track_name="",
            cup_name="",
            track_id="",
            confidence=0.0,
            status="failed",
            error="missing track crop path",
        )
    image = cv2.imread(crop_path)
    if image is None:
        return TrackMetadata(
            stream_id=stream_id,
            race_sequence=race_sequence,
            track_frame_index=frame_index,
            track_frame_path=crop_path,
            raw_track_text="",
            track_name="",
            cup_name="",
            track_id="",
            confidence=0.0,
            status="failed",
            error=f"could not read {crop_path}",
        )
    try:
        raw_text, confidence = extract_track_text_from_image(image, locale)
        track_name = match_track_name(raw_text.strip(), tracks_list, locale) if raw_text.strip() else ""
        cup_name = get_cup_name(track_name, tracks_list)
        track_id = get_track_id(track_name, tracks_list)
        catalog_match = lookup_track_catalog(track_name)
        track = catalog_match["track"]
        cup = catalog_match["cup"]
        cup_id = str(cup.get("cupIndex", "")) if cup else ""
        track_name_nl = str(track.get("nameNL", "")).strip() if track else ""
        cup_name_nl = str(cup.get("nameNL", "")).strip() if cup else ""
        status = "matched" if track_name and cup_name else "unmatched"
        error = "" if status == "matched" else "track OCR produced no catalog cup match"
        return TrackMetadata(
            stream_id=stream_id,
            race_sequence=race_sequence,
            track_frame_index=frame_index,
            track_frame_path=crop_path,
            raw_track_text=raw_text,
            track_name=track_name,
            cup_name=cup_name,
            track_id=track_id,
            confidence=confidence,
            status=status,
            track_name_nl=track_name_nl,
            cup_name_nl=cup_name_nl,
            cup_id=cup_id,
            track_icon_path=asset_path("track", track_id),
            cup_icon_path=asset_path("cup", cup_id),
            error=error,
        )
    except Exception as exc:
        return TrackMetadata(
            stream_id=stream_id,
            race_sequence=race_sequence,
            track_frame_index=frame_index,
            track_frame_path=crop_path,
            raw_track_text="",
            track_name="",
            cup_name="",
            track_id="",
            confidence=0.0,
            status="failed",
            error=str(exc),
        )


def extract_track_text_from_image(image: Any, locale: str = "auto") -> tuple[str, float]:
    (x1, y1), (x2, y2) = TRACK_NAME_ROI
    roi = image[y1:y2, x1:x2]
    languages = (tuple(TRACK_EASYOCR_LANGS) if os.environ.get("MK8_TRACK_EASYOCR_LANGS", "").strip()
                 else track_names.ocr_languages(locale))
    reader = _get_easyocr_reader(languages)
    if reader is None:
        raise RuntimeError("easyocr is not importable for baseline TrackName OCR")
    results = reader.readtext(roi, detail=1, paragraph=False)
    texts: list[str] = []
    confidences: list[float] = []
    for result in results:
        if len(result) >= 2:
            texts.append(str(result[1]))
        if len(result) >= 3:
            try:
                confidences.append(float(result[2]) * 100.0)
            except Exception:
                pass
    average = sum(confidences) / len(confidences) if confidences else 0.0
    return " ".join(texts).strip(), average


def resolve_character_variant_family_name(character_name: str | None) -> str:
    """Copy of baseline family lookup behavior for export roster names."""
    normalized = str(character_name or "").strip()
    if not normalized:
        return ""
    return _character_variant_family_lookup().get(normalized, (None, ""))[1]


def character_roster_name(character_name: str | None) -> str:
    normalized = str(character_name or "").strip()
    if not normalized:
        return ""
    family = resolve_character_variant_family_name(normalized)
    if family:
        return family
    if normalized.startswith("Mii"):
        return "Mii"
    return normalized


def character_index(character_name: str | None) -> int | None:
    normalized = str(character_name or "").strip()
    if not normalized:
        return None
    for character in _load_catalog().get("characters", []):
        if normalized == str(character.get("nameUK", "")).strip():
            return int(character.get("characterIndex", -1))
    return None


def write_track_metadata_report(metadata: dict[tuple[str, int], TrackMetadata]) -> None:
    rows = [
        {
            "run_id": current_run_id(),
            "stream_id": item.stream_id,
            "race_sequence": item.race_sequence,
            "track_frame_index": item.track_frame_index,
            "track_frame_path": item.track_frame_path,
            "raw_track_text": item.raw_track_text,
            "track_name": item.track_name,
            "cup_name": item.cup_name,
            "track_id": item.track_id,
            "track_name_nl": item.track_name_nl,
            "cup_name_nl": item.cup_name_nl,
            "cup_id": item.cup_id,
            "track_icon_path": item.track_icon_path,
            "cup_icon_path": item.cup_icon_path,
            "confidence": item.confidence,
            "status": item.status,
            "error": item.error,
        }
        for item in metadata.values()
    ]
    DIAGNOSTICS_ROOT.mkdir(parents=True, exist_ok=True)
    assert_write_allowed(DIAGNOSTICS_ROOT / "track_name_ocr_report.json").write_text(
        json.dumps(attach_run_id(rows), indent=2, sort_keys=True),
        encoding="utf-8",
    )
    lines = ["# Track Name OCR Report", ""]
    for row in rows:
        lines.append(
            f"- {row['stream_id']} race {row['race_sequence']}: {row['track_name'] or 'UNKNOWN'} / {row['cup_name'] or 'UNKNOWN'} "
            f"(raw={row['raw_track_text']!r}, status={row['status']}, confidence={row['confidence']:.2f})"
        )
    assert_write_allowed(DIAGNOSTICS_ROOT / "track_name_ocr_report.md").write_text("\n".join(lines), encoding="utf-8")


def _get_easyocr_reader(languages: tuple[str, ...]) -> Any:
    if easyocr is None:
        return None
    with _EASYOCR_LOCK:
        if languages not in _EASYOCR_READERS:
            gpu_requested = _easyocr_gpu_enabled()
            write_ocr_runtime_report("track_name_ocr_reader", gpu_requested=gpu_requested, languages=languages)
            reader = easyocr.Reader(list(languages), gpu=gpu_requested, verbose=False)
            optimize_easyocr_reader(reader)
            _EASYOCR_READERS[languages] = reader
        return _EASYOCR_READERS[languages]


def _easyocr_gpu_enabled() -> bool:
    return easyocr_gpu_requested()


def _character_variant_family_lookup() -> dict[str, tuple[int | None, str]]:
    lookup: dict[str, tuple[int | None, str]] = {}
    for family_name, variant_names in EXPLICIT_CHARACTER_VARIANT_FAMILIES.items():
        for variant_name in variant_names:
            lookup[str(variant_name).strip()] = (-1, str(family_name))
    catalog = _load_catalog()
    for character in catalog.get("characters", []):
        roster_index = int(character.get("rosterIndex", -1))
        if roster_index not in CHARACTER_VARIANT_FAMILY_ROSTER_NAMES:
            continue
        lookup[str(character.get("nameUK", "")).strip()] = (
            roster_index,
            CHARACTER_VARIANT_FAMILY_ROSTER_NAMES[roster_index],
        )
    return lookup


def _load_catalog() -> dict[str, Any]:
    return load_imported_game_catalog()
