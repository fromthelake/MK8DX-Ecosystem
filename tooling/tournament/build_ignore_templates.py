"""Build Tournament's console/Album ignore templates and merge them into `locale_templates.json`.

    .venv\\Scripts\\python.exe tooling/tournament/build_ignore_templates.py --templates <engine templates dir> \
        --clean-assets "clean-assets"
    (or --ns2-album-frame <a Switch 2 Album frame (1920x1080 or 1280x720)> to cut only the ns2 marker from a frame)

Run it after build_locale_templates.py and build_track_templates.py (the locale builder rewrites the manifest; this
one and the track builder merge into it). It owns every `ignore` entry: those are replaced, all other entries stay.

**Switch 2 marker (`ns2`).** Since Clean Assets v5.10 the indicator is HUD template 098
`system_album_ns2_controller_indicator`, cut from the same frame at the same box. The Nintendo Switch 2 draws its
controller indicator (a gamepad with four player dots, bottom left) on every Album, picture and video screen, whatever
the system language; the game never shows it. The engine's own ignore templates (`ignore.png`,
`albumgallery_ignore.png`, `ignore_2.png`) are the Switch 1 bars and score <= 0.19 on the Switch 2 gallery. This
cuts the indicator at its place on the 1280x720 frame (grey, used by the engine as it is) into
`<templates>/locale/ignore_ns2_controller.png`, entry locale `ns2`. Measured 2026-11-02 (engine matcher, ROI below):
Switch 2 Album/picture/video frames >= 0.901 (19), the game frames of the same recording <= 0.275, 4890 frames of the
ten 01-11 LAN cup recordings (both consoles) <= 0.484, the Switch 2 Time Trial runs <= 0.506. Threshold 0.75.

**Switch 1 Album bars per system language (--clean-assets only).** The engine's three built-in ignore templates are
the English Switch 1 bars: `albumgallery_ignore.png` = Clean Assets 066 (Album list), `ignore_2.png` = 067 (picture
view), `ignore.png` = 068 (video playback). A Switch 1 in another system language draws those bars in its language,
which the English templates do not match. For 066, 067 and 068 this writes every language bucket's cut-out
(`images/hud/templates/<bucket>/06x_*.png`) except English (built in) as `locale/ignore_<bar>_<locale>.png`; a
bucket whose file is byte-identical to one already written (en-us = en, fr-ca = fr, es-419 = es) is skipped. The
form is the locale builder's banner form (alpha-premultiplied grey thresholded at 180, no mask). Each entry's ROI is
that cut-out's own Clean Assets anchor (1280x720) widened by MARGIN on every side, because the bars of different
languages start at different x. Thresholds per bar: ALBUM_THRESHOLDS, measured with score_ignore_templates.py
(see the table there and docs/roadmap/LANGUAGES_15_ROADMAP.md A3).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages" / "tournament-extraction" / "python" / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from mk8dx_tournament_extraction import locale_templates  # noqa: E402
from build_locale_templates import BUCKET_LOCALES  # noqa: E402

BOX = (60, 650, 55, 53)      # the indicator on the 1280x720 frame
ROI = (50, 640, 75, 73)      # search window: the box +-10
THRESHOLD = 0.75
FILE = "locale/ignore_ns2_controller.png"
CLEAN_ASSETS_SLUG = "system_album_ns2_controller_indicator"

# Clean Assets slug -> short bar name in the file name. English is built in (see above).
ALBUM_BARS = {
    "system_album_list_bar": "album_list",
    "system_album_view_bar": "album_view",
    "system_video_replay_bar": "video_replay",
}
ALBUM_BUCKETS = {"nl": "EUnl", **BUCKET_LOCALES}
BUILT_IN_BUCKET = "en"
MARGIN = 6
# Measured 2026-11-02 with score_ignore_templates.py (engine matcher and decision rule), positives = visually
# labelled frames of the Clean Assets Album walks (tt_<lang>_album_*.mp4 for de/es/fr/it/ja/ko/pt/ru/zh-cn/zh-tw,
# the NL Switch 1 recording 2026-07-21 14-21-11.mp4), negatives = every other frame: the ten 01-11 LAN cups and the
# Switch 2 Time Trials (2 fps), 135 Clean Assets game/menu/banner/replay recordings in all 13 languages (2 fps), key
# frames of 38 TN07-TN13 recordings, and the HOME/settings/game parts of the walks; ~98,000 frames, Album screens
# among them (already ignored before, or seen by eye) left out of the maximum.
#   bar           own-screen min (all 11 languages)       highest non-Album frame
#   album_list    0.832 (nl; others >= 0.925)              0.562 (German system settings, white theme)
#   album_view    0.843 (nl; others >= 0.947)              0.299
#   video_replay  0.606 (nl, bar fading; others >= 0.944)  0.287
# Thresholds sit between the two with margin; lower than 0.75 also means a new entry rarely wins below its own
# threshold over a built-in target that would have fired (the engine's best-target rule): measured, no frame that
# was ignored before is ignored no longer, and no non-Album frame is newly ignored. Real-event evidence: TN13
# (Dutch consoles) shows the white-theme Album list before a viewed results screenshot; 2.2.43 does not ignore that
# list, the EUnl list template scores 0.838 on it.
ALBUM_THRESHOLDS = {"album_list": 0.70, "album_view": 0.70, "video_replay": 0.60}
FRAME = (1280, 720)
# Background grey levels measured on the bars in real frames (1280x720 grey, median): white-theme Album list 235,
# dark bar under the white text about 30. A cut-out whose opaque pixels average below DARK_TEXT_MEAN is dark text.
LIGHT_BAR = 235.0
DARK_BAR = 30.0
DARK_TEXT_MEAN = 140.0


def album_template(path: Path) -> np.ndarray:
    """A bar cut-out as a grey template the engine uses as it is (2-D file; the ignore matcher compares raw grey
    frames). The cut-outs are glyph masks: the transparent pixels are the bar's background. Dark-on-light bars (the
    Album list in the console's white theme: opaque pixels mostly dark) are laid on the light background, the others
    (white text on the dark bar) on the dark one. The banners' binary form (> 180) cannot be used: it loses the dark
    letters of a white-theme bar completely."""
    image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if image is None or image.ndim != 3 or image.shape[2] != 4:
        raise ValueError(f"{path} is not a BGRA cut-out")
    gray = cv2.cvtColor(image[:, :, :3], cv2.COLOR_BGR2GRAY).astype(np.float32)
    alpha = image[:, :, 3].astype(np.float32) / 255.0
    background = LIGHT_BAR if float(gray[alpha > 0].mean()) < DARK_TEXT_MEAN else DARK_BAR
    return np.clip(alpha * gray + (1.0 - alpha) * background, 0, 255).astype(np.uint8)


def album_roi(anchor: dict) -> list[int]:
    x0 = max(0, int(anchor["x"]) - MARGIN)
    y0 = max(0, int(anchor["y"]) - MARGIN)
    x1 = min(FRAME[0], int(anchor["x"]) + int(anchor["w"]) + MARGIN)
    y1 = min(FRAME[1], int(anchor["y"]) + int(anchor["h"]) + MARGIN)
    return [x0, y0, x1 - x0, y1 - y0]


def album_entries(clean_assets: Path, templates: Path, database: dict) -> tuple[list[dict], list[str]]:
    """Write the per-language Album bar templates; returns their manifest entries and what was skipped."""
    records = {r["slug"]: r for r in database["collections"]["hudTemplates"]}
    entries, skipped = [], []
    for slug, bar in ALBUM_BARS.items():
        record = records.get(slug)
        if record is None:
            raise SystemExit(f"{slug} is not in this Clean Assets")
        by_language = record["assets"]["template"]["byLanguage"]
        seen = {}
        built_in = by_language.get(BUILT_IN_BUCKET)
        if built_in is not None:
            seen[hashlib.sha256((clean_assets / built_in["path"]).read_bytes()).hexdigest()] = BUILT_IN_BUCKET
        for bucket, locale in ALBUM_BUCKETS.items():
            asset = by_language.get(bucket)
            if asset is None:
                skipped.append(f"{bar}:{bucket} (not in Clean Assets)")
                continue
            source = clean_assets / asset["path"]
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            if digest in seen:
                skipped.append(f"{bar}:{bucket} (same as {seen[digest]})")
                continue
            seen[digest] = bucket
            name = f"locale/ignore_{bar}_{locale}.png"
            (templates / name).parent.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(templates / name), album_template(source))
            entries.append({
                "locale": locale,
                "kind": "ignore",
                "file": name,
                "roi": album_roi(asset["anchor"]),
                "threshold": ALBUM_THRESHOLDS[bar],
                "source": f"Clean Assets {asset['path']}",
                "sourceSha256": digest,
            })
    return entries, skipped


def build(templates: Path, clean_assets: Path | None = None, ns2_album_frame: Path | None = None) -> dict:
    """Write the ignore templates and merge their entries into the manifest (ns2 first, then the Album bars)."""
    if (clean_assets is None) == (ns2_album_frame is None):
        raise ValueError("give exactly one of clean_assets and ns2_album_frame")
    out = templates / FILE
    out.parent.mkdir(parents=True, exist_ok=True)
    album, skipped = [], []
    if clean_assets is not None:
        db = json.loads((clean_assets / "database.json").read_text(encoding="utf-8"))
        record = next((r for r in db["collections"]["hudTemplates"] if r["slug"] == CLEAN_ASSETS_SLUG), None)
        if record is None:
            raise SystemExit(f"{CLEAN_ASSETS_SLUG} is not in this Clean Assets (v5.10 or newer is needed)")
        anchor = record["anchor"]
        if (anchor["x"], anchor["y"], anchor["w"], anchor["h"]) != BOX:
            raise SystemExit(f"Clean Assets anchor {anchor} differs from the measured box {BOX}")
        image = cv2.imread(str(clean_assets / record["assets"]["template"]["path"]), cv2.IMREAD_UNCHANGED)
        cv2.imwrite(str(out), cv2.cvtColor(image[:, :, :3], cv2.COLOR_BGR2GRAY))
        album, skipped = album_entries(clean_assets, templates, db)
    else:
        frame = cv2.imread(str(ns2_album_frame))
        if frame is None:
            raise SystemExit(f"cannot read {ns2_album_frame}")
        gray = cv2.cvtColor(cv2.resize(frame, (1280, 720), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
        x, y, w, h = BOX
        cv2.imwrite(str(out), gray[y:y + h, x:x + w])

    manifest_path = templates / locale_templates.MANIFEST_NAME
    document = (json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file()
                else {"schemaVersion": locale_templates.SCHEMA_VERSION, "templates": []})
    if clean_assets is None:  # a frame-only run replaces the marker and keeps earlier Album entries
        album = [e for e in document["templates"] if e.get("kind") == "ignore" and e.get("locale") != "ns2"]
    document["templates"] = [entry for entry in document["templates"] if entry.get("kind") != "ignore"]
    document["templates"].append({"locale": "ns2", "kind": "ignore", "file": FILE, "roi": list(ROI),
                                  "threshold": THRESHOLD})
    document["templates"].extend(album)
    manifest_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    locale_templates.read_manifest(templates)  # validates the result
    return {"template": str(out), "roi": ROI, "threshold": THRESHOLD, "album": len(album),
            "albumLocales": sorted({e["locale"] for e in album}), "skipped": skipped}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--templates", type=Path, required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--clean-assets", type=Path, help="Clean Assets folder (v5.10+, HUD templates 066-068, 098)")
    source.add_argument("--ns2-album-frame", type=Path)
    args = parser.parse_args()
    print(json.dumps(build(args.templates, args.clean_assets, args.ns2_album_frame)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
