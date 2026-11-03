"""The race class of a LAN track-intro screen (0TrackName frame): 50cc, 100cc, 150cc, 200cc or Mirror (roadmap
LANGUAGES_15 D3, owner 01-11).

The class badge sits in the engine's TrackName box. The best of the class templates (the engine's 150cc Trackname
template plus the `track` entries of `locale_templates.json`), after the TrackName preprocessing, names the class.
150cc and Mirror differ only in the mirrored number, which these binary templates cannot tell apart (the Mirror
template scores 0.93 on a 150cc badge): the colour of the badge's number band decides them, blue for 150cc and red for
Mirror. Measured on the 01-11 cups: 29/29 intros of both consoles right, number band blue 0.34-0.45 vs red 0.52-0.59.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import cv2  # type: ignore
import numpy as np

from . import locale_templates

MIN_SCORE = 0.6  # the engine's TrackName threshold
# The badge's number band on the 1280x720 frame (inside 055 lan_badge_150cc's box at 216,617).
NUMBER_BAND = (236, 621, 48, 16)


@dataclass(frozen=True)
class RaceClass:
    race_class: Optional[str]
    score: float
    scores: dict[str, float]
    band_red: float
    band_blue: float


def _binary(path: Path) -> np.ndarray:
    image = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    return cv2.threshold(image, 180, 255, cv2.THRESH_BINARY)[1]


def class_templates(templates_dir: Path) -> dict[str, np.ndarray]:
    templates = {"150cc": _binary(Path(templates_dir) / "Trackname_template.png")}
    for entry in locale_templates.read_manifest(Path(templates_dir)):
        if entry.kind == "track":
            templates[entry.locale] = _binary(entry.file)
    return templates


def number_band_colour(frame_bgr: np.ndarray) -> tuple[float, float]:
    x, y, w, h = NUMBER_BAND
    hsv = cv2.cvtColor(frame_bgr[y:y + h, x:x + w], cv2.COLOR_BGR2HSV)
    hue, saturated = hsv[:, :, 0].astype(float), hsv[:, :, 1] > 90
    red = float(np.mean(((hue < 10) | (hue > 165)) & saturated))
    blue = float(np.mean((hue > 95) & (hue < 130) & saturated))
    return red, blue


def classify(frame_bgr: np.ndarray, templates: dict[str, np.ndarray]) -> RaceClass:
    """The class of a track-intro frame, or None when no class template reaches the TrackName threshold."""
    from .engine import extract_initial_scan as scan  # noqa: WPS433
    from .engine.extract_common import preprocess_roi  # noqa: WPS433

    if frame_bgr.shape[:2] != (720, 1280):
        frame_bgr = cv2.resize(frame_bgr, (1280, 720), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    target = scan.INITIAL_SCAN_TARGETS[1]
    x, y, w, h = scan._expanded_roi(gray, target["roi"])
    box = preprocess_roi(gray[y:y + h, x:x + w], scan.INITIAL_SCAN_TARGETS.index(target))
    scores = {name: float(cv2.minMaxLoc(cv2.matchTemplate(box, template, cv2.TM_CCOEFF_NORMED))[1])
              for name, template in templates.items()
              if box.shape[0] >= template.shape[0] and box.shape[1] >= template.shape[1]}
    red, blue = number_band_colour(frame_bgr)
    if not scores or max(scores.values()) < MIN_SCORE:
        return RaceClass(None, max(scores.values(), default=0.0), scores, red, blue)
    best = max(scores, key=scores.get)
    if best in ("150cc", "mirror"):
        best = "mirror" if red > blue else "150cc"
    return RaceClass(best, scores[max(scores, key=scores.get)], scores, red, blue)


# Clean Assets class badges (055 lan_badge_150cc, 094-097 lan_badge_50cc/_100cc/_200cc/_mirror, owner-cut 01-11):
# masked colour match at the badge anchor. 01-11 cups, 29 intros of both consoles: own class >= 0.95, any other
# <= 0.39 except 150cc/Mirror (0.86/0.83, still >= 0.09 below the own badge).
BADGE_SLUGS = {"lan_badge_150cc": "150cc", "lan_badge_50cc": "50cc", "lan_badge_100cc": "100cc",
               "lan_badge_200cc": "200cc", "lan_badge_mirror": "mirror"}
BADGE_MIN_SCORE = 0.8
BADGE_SEARCH = 10


def badge_templates(clean_assets: Path) -> dict[str, tuple[np.ndarray, np.ndarray, dict]]:
    import json

    db = json.loads((Path(clean_assets) / "database.json").read_text(encoding="utf-8"))
    out = {}
    for record in db["collections"]["hudTemplates"]:
        race_class = BADGE_SLUGS.get(record["slug"])
        if race_class is None:
            continue
        image = cv2.imread(str(Path(clean_assets) / record["assets"]["template"]["path"]), cv2.IMREAD_UNCHANGED)
        out[race_class] = (image[:, :, :3], (image[:, :, 3] > 0).astype(np.uint8) * 255, record["anchor"])
    return out


def classify_by_badges(frame_bgr: np.ndarray, badges: dict[str, tuple[np.ndarray, np.ndarray, dict]]) -> RaceClass:
    """The class from the Clean Assets badge cut-outs; None below BADGE_MIN_SCORE (no track intro)."""
    if frame_bgr.shape[:2] != (720, 1280):
        frame_bgr = cv2.resize(frame_bgr, (1280, 720), interpolation=cv2.INTER_AREA)
    scores = {}
    for race_class, (image, mask, anchor) in badges.items():
        x, y, s = int(anchor["x"]), int(anchor["y"]), BADGE_SEARCH
        region = frame_bgr[max(0, y - s):y + image.shape[0] + s, max(0, x - s):x + image.shape[1] + s]
        if region.shape[0] < image.shape[0] or region.shape[1] < image.shape[1]:
            continue
        result = np.nan_to_num(cv2.matchTemplate(region, image, cv2.TM_CCOEFF_NORMED, mask=mask), nan=-1.0,
                               posinf=-1.0, neginf=-1.0)
        scores[race_class] = float(result.max())
    red, blue = number_band_colour(frame_bgr)
    best = max(scores, key=scores.get) if scores else None
    if best is None or scores[best] < BADGE_MIN_SCORE:
        return RaceClass(None, scores.get(best, 0.0) if best else 0.0, scores, red, blue)
    return RaceClass(best, scores[best], scores, red, blue)



CLASS_LABELS = {"50cc": "50cc", "100cc": "100cc", "150cc": "150cc", "200cc": "200cc", "mirror": "Mirror"}


class RaceClassReader:
    """The race class of each race's track-intro frame for the exports (ADR-0217): the "Class" column of the results
    (50cc, 100cc, 150cc, 200cc, Mirror; empty when the race has no intro frame, e.g. a recording started mid-race)."""

    def __init__(self, clean_assets: Path):
        self.badges = badge_templates(Path(clean_assets))
        self._cache: dict[str, str] = {}

    def label_for(self, intro_frame: Path) -> str:
        key = str(intro_frame)
        if key not in self._cache:
            image = cv2.imread(key) if Path(intro_frame).is_file() else None
            result = classify_by_badges(image, self.badges) if image is not None else None
            self._cache[key] = CLASS_LABELS.get(result.race_class, "") if result and result.race_class else ""
        return self._cache[key]

    def annotate(self, rows: list[dict], intro_frame_for) -> int:
        """Set row["Class"] for every row whose (video, race) has an intro frame (intro_frame_for(video, race) ->
        Path | None). Returns the number of races given a class."""
        races = 0
        labels: dict[tuple[str, str], str] = {}
        for row in rows:
            key = (str(row.get("Video", "")), str(row.get("Race", "")))
            if key not in labels:
                path = intro_frame_for(*key)
                labels[key] = self.label_for(path) if path is not None else ""
                races += bool(labels[key])
            if labels[key]:
                row["Class"] = labels[key]
        return races


def reader_from_environment() -> Optional[RaceClassReader]:
    import os

    root = os.environ.get("MK8_CLEAN_ASSETS_ROOT")
    if not root or not (Path(root) / "database.json").is_file():
        return None
    try:
        return RaceClassReader(Path(root))
    except Exception:  # noqa: BLE001 - a missing badge set leaves the class out, it never stops an export
        return None
