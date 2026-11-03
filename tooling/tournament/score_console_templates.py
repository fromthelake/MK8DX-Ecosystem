"""Score every Clean Assets HUD template on a recording from another console (roadmap LANGUAGES_15 C2).

    .venv\\Scripts\\python.exe tooling/tournament/score_console_templates.py --clean-assets "<Clean Assets>" \
        --video private-qa/lan-test-cups/s2-timetrial-nl.mkv --language nl --out report.json

For each template (the language's variant when the record has one, otherwise the neutral template) the best masked
match over the recording (1 frame per second, frames resized to the 1280x720 template space) inside its anchor box
widened by --search pixels, with the frame time and the shift from the anchor. A template whose screen is in the
recording scores high at a near-zero shift when the console draws it the same; a clear miss on a screen that was
visited, or a large shift, needs a look and possibly a console variant. Templates whose screen was not visited score
low by nature, so the verdict is read together with the walk log.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def templates(clean_assets: Path, language: str):
    db = json.loads((clean_assets / "database.json").read_text(encoding="utf-8"))
    for record in db["collections"]["hudTemplates"]:
        asset = record["assets"]["template"]
        variant = asset.get("byLanguage", {}).get(language) if "byLanguage" in asset else None
        entry = variant or (asset if "path" in asset else None)
        anchor = (variant or {}).get("anchor") or record.get("anchor")
        if entry is None or anchor is None:
            continue
        image = cv2.imread(str(clean_assets / entry["path"]), cv2.IMREAD_UNCHANGED)
        if image is None or image.shape[2] != 4:
            continue
        yield record["index"], record["slug"], language if variant else "", image, anchor


def sample_frames(video: Path, step_seconds: float):
    capture = cv2.VideoCapture(str(video))
    fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, int(round(step_seconds * fps)))
    index = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if index % step == 0:
            yield index / fps, cv2.resize(frame, (1280, 720), interpolation=cv2.INTER_AREA)
        index += 1
    capture.release()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--clean-assets", type=Path, required=True)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--language", default="nl")
    parser.add_argument("--search", type=int, default=24)
    parser.add_argument("--step-seconds", type=float, default=1.0)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    items = list(templates(args.clean_assets, args.language))
    best = {index: (-1.0, 0.0, 0, 0) for index, *_ in items}
    for seconds, frame in sample_frames(args.video, args.step_seconds):
        for index, slug, language, image, anchor in items:
            x, y, w, h = anchor["x"], anchor["y"], anchor["w"], anchor["h"]
            s = args.search
            x0, y0 = max(0, x - s), max(0, y - s)
            region = frame[y0:min(720, y + h + s), x0:min(1280, x + w + s)]
            template = image[:, :, :3]
            mask = (image[:, :, 3] > 0).astype(np.uint8) * 255
            if region.shape[0] < template.shape[0] or region.shape[1] < template.shape[1]:
                continue
            result = cv2.matchTemplate(region, template, cv2.TM_CCOEFF_NORMED, mask=mask)
            result = np.nan_to_num(result, nan=-1.0, posinf=-1.0, neginf=-1.0)
            _, score, _, (bx, by) = cv2.minMaxLoc(result)
            if score > best[index][0]:
                best[index] = (float(score), seconds, x0 + bx - x, y0 + by - y)
    rows = []
    for index, slug, language, _image, _anchor in items:
        score, seconds, dx, dy = best[index]
        rows.append({"index": index, "slug": slug, "language": language, "score": round(score, 3),
                     "atSeconds": round(seconds, 1), "shift": [dx, dy]})
    rows.sort(key=lambda row: row["index"])
    args.out.write_text(json.dumps({"video": str(args.video), "language": args.language, "templates": rows},
                                   indent=1), encoding="utf-8")
    for row in rows:
        print(f'{row["index"]:3} {row["slug"]:44} {row["language"]:3} {row["score"]:6.3f} '
              f'@{row["atSeconds"]:7.1f}s shift {row["shift"]}')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
