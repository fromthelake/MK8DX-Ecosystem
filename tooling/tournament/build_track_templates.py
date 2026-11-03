"""Build Tournament's class-badge track templates (roadmap LANGUAGES_15 D2/D3) and merge them into `locale_templates.json`.

    .venv\\Scripts\\python.exe tooling/tournament/build_track_templates.py --templates <engine templates dir> \
        --intro 50cc=<frame.png> --intro 100cc=<frame.png> --intro 200cc=<frame.png> --intro mirror=<frame.png>

The engine's `Trackname_template.png` is the 150cc badge with the banner edge, matched in the TrackName box after the
TrackName preprocessing (`preprocess_roi(.., 1)`). For every other class this cuts the same window from a track-intro
frame of that class (1280x720), preprocessed the same way, at the place where the 150cc template fits best, so the new
template lines up with the engine's box. Writes `<templates>/locale/track_<class>.png` and adds or replaces the
`track` entries of the manifest; its other entries stay. Prints the self-scores and the 150cc template's score per frame.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "packages" / "tournament-extraction" / "python" / "src"),
                str(ROOT / "packages" / "icon-matcher" / "python")]

from mk8dx_tournament_extraction import locale_templates  # noqa: E402
from mk8dx_tournament_extraction.engine import extract_initial_scan as scan  # noqa: E402
from mk8dx_tournament_extraction.engine.extract_common import preprocess_roi  # noqa: E402


def processed_track_box(frame_path: Path):
    gray = cv2.cvtColor(cv2.resize(cv2.imread(str(frame_path)), (1280, 720), interpolation=cv2.INTER_AREA),
                        cv2.COLOR_BGR2GRAY)
    target = scan.INITIAL_SCAN_TARGETS[1]
    assert target["kind"] == "track"
    x, y, w, h = scan._expanded_roi(gray, target["roi"])
    return preprocess_roi(gray[y:y + h, x:x + w], scan.INITIAL_SCAN_TARGETS.index(target))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--templates", type=Path, required=True, help="the engine's templates folder")
    parser.add_argument("--intro", action="append", required=True, metavar="CLASS=FRAME")
    args = parser.parse_args()
    base = cv2.imread(str(args.templates / "Trackname_template.png"), cv2.IMREAD_GRAYSCALE)
    _, base = cv2.threshold(base, 180, 255, cv2.THRESH_BINARY)
    (args.templates / "locale").mkdir(exist_ok=True)
    built = {}
    for item in args.intro:
        cls, _, frame = item.partition("=")
        if cls not in locale_templates.TRACK_CLASSES:
            raise SystemExit(f"unknown class {cls}; one of {locale_templates.TRACK_CLASSES}")
        box = processed_track_box(Path(frame))
        _, base_score, _, (bx, by) = cv2.minMaxLoc(cv2.matchTemplate(box, base, cv2.TM_CCOEFF_NORMED))
        template = box[by:by + base.shape[0], bx:bx + base.shape[1]].copy()
        cv2.imwrite(str(args.templates / "locale" / f"track_{cls}.png"), template)
        self_score = cv2.minMaxLoc(cv2.matchTemplate(box, template, cv2.TM_CCOEFF_NORMED))[1]
        built[cls] = {"file": f"locale/track_{cls}.png", "offset": [bx, by], "selfScore": round(self_score, 3),
                      "trackname150Score": round(base_score, 3)}
    manifest_path = args.templates / locale_templates.MANIFEST_NAME
    document = (json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file()
                else {"schemaVersion": locale_templates.SCHEMA_VERSION, "templates": []})
    document["templates"] = [entry for entry in document["templates"] if entry.get("kind") != "track"] + [
        {"locale": cls, "kind": "track", "file": info["file"]} for cls, info in built.items()]
    manifest_path.write_text(json.dumps(document, indent=1), encoding="utf-8")
    locale_templates.read_manifest(args.templates)  # validates what was written
    print(json.dumps(built, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
