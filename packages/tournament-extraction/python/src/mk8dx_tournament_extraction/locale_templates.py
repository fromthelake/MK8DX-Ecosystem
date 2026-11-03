"""Per-locale banner templates for Tournament recognition beyond the built-in English and Dutch ones.

The engine has always matched eight fixed templates (indices 0-7, English and Dutch for the "Race N" counter and
the "The results are in!" banner over row 12). Every other game locale comes from an optional manifest,
`locale_templates.json`, next to those templates:

    {"schemaVersion": "mk8dx.tournament-locale-templates.v1",
     "templates": [{"locale": "EUde", "kind": "twelfth", "file": "locale/twelfth_EUde.png",
                    "roi": [100, 646, 1080, 64], "threshold": 0.6}, ...]}

Kinds: `race` (the counter banner at race start), `twelfth` (results banner over row 12), `ignore` (Album or
replay bars) and `track` (the class badge of the track-name screen; the engine's own Trackname template is the 150cc
badge, so a LAN race in 50cc/100cc/200cc/Mirror had no track screen). A `track` entry names its class in `locale`
(`50cc`, `100cc`, `200cc`, `mirror`): the badge carries no text. An `ignore` entry may name a console instead of a
language (`ns2`): the Nintendo Switch 2 shows its controller indicator on every Album, picture and video screen,
whatever the system language, so that one marker keeps its gallery out of the detections. Per-language `ignore`
entries are the Switch 1 Album bars (Clean Assets 066 list, 067 picture view, 068 video playback) in every system
language besides the built-in English ones; each carries its own ROI (the cut-out's anchor plus a margin) and
threshold. The templates are appended after the fixed eight, in manifest order, so their indices start at 8;
without a manifest nothing changes. The files are built from Clean Assets cut-outs by
`tooling/tournament/build_locale_templates.py` (banners: alpha-premultiplied grey, threshold 180, no alpha mask),
`build_track_templates.py` and `build_ignore_templates.py` (ns2 marker and Album bars: grey, used as they are).

This module lives outside `engine/` on purpose: the engine-provenance manifest pins every `engine/*.py`.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

MANIFEST_NAME = "locale_templates.json"
SCHEMA_VERSION = "mk8dx.tournament-locale-templates.v1"
FIRST_LOCALE_TEMPLATE_INDEX = 8
KINDS = ("race", "twelfth", "ignore", "track")
TRACK_CLASSES = ("50cc", "100cc", "200cc", "mirror")
# Language-neutral console markers an `ignore` entry may name instead of a game locale.
CONSOLE_MARKERS = ("ns2",)
LOCALES = (
    "EUnl", "EUen", "USen", "EUfr", "USfr", "EUde", "EUes", "USes",
    "EUit", "EUpt", "EUru", "JPja", "KRko", "CNzh", "TWzh",
)

# Wide search bands, because the word position differs per language. The results band is the one the 9105 text
# OCR reads (`game_messages.py`); the race band covers the English (540/640) and Dutch (694) positions and more.
DEFAULT_ROIS = {
    "race": (400, 584, 520, 60),
    "twelfth": (100, 646, 1080, 64),
    "ignore": (413, 667, 808, 36),
    "track": (141, 607, 183, 101),  # the engine's TrackName target box (badge + banner edge)
}
# Measured on the 2026-11-01 LAN captures (score_lan_matrix.py, held-out races): counter words score 0.61-0.99 on
# their own language and <= 0.15 on frames without a counter (zh-cn is the lowest at 0.61); results banners 0.88-0.91
# against <= 0.54 (a 9107 bar sharing the sentence end).
DEFAULT_THRESHOLDS = {"race": 0.5, "twelfth": 0.6, "ignore": 0.75, "track": 0.6}


class LocaleTemplateManifestError(ValueError):
    pass


@dataclass(frozen=True)
class LocaleTemplate:
    locale: str
    kind: str
    file: Path
    roi: tuple[int, int, int, int]
    threshold: float
    template_index: int = -1


def read_manifest(templates_dir: Path) -> tuple[LocaleTemplate, ...]:
    """The manifest's entries in order, validated; an absent manifest means none."""
    path = Path(templates_dir) / MANIFEST_NAME
    if not path.is_file():
        return ()
    document = json.loads(path.read_text(encoding="utf-8"))
    if document.get("schemaVersion") != SCHEMA_VERSION:
        raise LocaleTemplateManifestError(f"{path} is not {SCHEMA_VERSION}")
    entries = []
    for position, raw in enumerate(document.get("templates", [])):
        locale = raw.get("locale")
        kind = raw.get("kind")
        file_name = raw.get("file")
        names = TRACK_CLASSES if kind == "track" else (*LOCALES, *CONSOLE_MARKERS) if kind == "ignore" else LOCALES
        if locale not in names or kind not in KINDS or not isinstance(file_name, str):
            raise LocaleTemplateManifestError(f"{path} entry {position} is invalid")
        file_path = (Path(templates_dir) / file_name).resolve()
        if Path(templates_dir).resolve() not in file_path.parents:
            raise LocaleTemplateManifestError(f"{path} entry {position} leaves the templates folder")
        roi = tuple(int(value) for value in raw.get("roi", DEFAULT_ROIS[kind]))
        if len(roi) != 4 or roi[2] <= 0 or roi[3] <= 0:
            raise LocaleTemplateManifestError(f"{path} entry {position} has an invalid roi")
        threshold = float(raw.get("threshold", DEFAULT_THRESHOLDS[kind]))
        entries.append(LocaleTemplate(locale, kind, file_path, roi, threshold))  # type: ignore[arg-type]
    return tuple(entries)


# The templates of the running extraction, with the indices they were loaded at. Set by the engine when it loads
# its template list (`register`), read by the matching steps.
_ACTIVE: tuple[LocaleTemplate, ...] = ()


def register(entries: tuple[LocaleTemplate, ...], first_index: int = FIRST_LOCALE_TEMPLATE_INDEX) -> tuple[LocaleTemplate, ...]:
    global _ACTIVE
    _ACTIVE = tuple(
        LocaleTemplate(entry.locale, entry.kind, entry.file, entry.roi, entry.threshold, first_index + offset)
        for offset, entry in enumerate(entries)
    )
    return _ACTIVE


def load_for_engine(resolve_templates_dir: Callable[[], Optional[Path]]) -> tuple[LocaleTemplate, ...]:
    """Read and register the manifest beside the engine's templates; returns the entries to append."""
    templates_dir = resolve_templates_dir()
    return register(read_manifest(templates_dir) if templates_dir is not None else ())


def active(kind: str) -> tuple[LocaleTemplate, ...]:
    return tuple(entry for entry in _ACTIVE if entry.kind == kind)


def race_candidates() -> tuple[dict, ...]:
    """Extra `alternate_matches` for the RaceNumber target."""
    return tuple({"roi": entry.roi, "template_index": entry.template_index} for entry in active("race"))


def track_candidates() -> tuple[dict, ...]:
    """Extra `alternate_matches` for the TrackName target: the class badges besides 150cc."""
    return tuple({"roi": entry.roi, "template_index": entry.template_index} for entry in active("track"))


def twelfth_candidates() -> tuple[tuple[tuple[int, int, int, int], int], ...]:
    """Extra (roi, template_index) pairs for the 12th-place banner check."""
    return tuple((entry.roi, entry.template_index) for entry in active("twelfth"))


def ignore_targets() -> tuple[dict, ...]:
    """Extra Album/replay ignore targets, shaped like the engine's IGNORE_FRAME_TARGETS."""
    return tuple(
        {
            "kind": "ignore",
            "label": f"Ignore{entry.locale}",
            "match_threshold": entry.threshold,
            "skip_seconds": 5,
            "roi": entry.roi,
            "template_index": entry.template_index,
        }
        for entry in active("ignore")
    )
