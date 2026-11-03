"""Turn LAN capture frames into Clean Assets cut-out records for the 15-language Tournament banners (A6).

    python tooling/tournament/lan_cutouts.py --clean-assets "<Clean Assets>" --lang de \
        --frame twelfth=<frame.png> --frame race_word=<frame.png> --frame too_far=<frame.png> [--dry-run]

Each frame (a 1920x1080 capture from find_lan_banners.py) is scaled to the 1280x720 frame Tournament reads, and
the white text of one element is cut with a threshold mask (every channel > 180):
  twelfth   -> slug lan_results_banner       ("The results are in! ..." over row 12, message 9105)
  too_far   -> slug lan_too_far_behind       ("The race ended because you were too far behind." 9107)
  race_word -> slug lan_race_counter_word    (the word of the "Race N" counter banner, without its number)
  final_word -> slug lan_race_counter_final_word (the final-race word where it differs, e.g. Russian "Финал")
The frames are written as a short 1280x720 MP4 into Clean Assets `input video/` (the cut-out provenance) and each
cut-out is appended to cutouts/cutouts.json the way the cut-out server writes it (image + original + sha256).
Prints {element: cutout id}; the ids go into build_collection.py LANGUAGE_SOURCES. Labels stay literal: the record
says which language's banner text was on screen, nothing derived.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import time
from pathlib import Path

import cv2
import numpy as np

SLUGS = {"twelfth": "lan_results_banner", "too_far": "lan_too_far_behind", "race_word": "lan_race_counter_word",
         "final_word": "lan_race_counter_final_word"}
# Search bands in the 1280x720 frame: the message bar text line and the counter banner text line.
BANDS = {"twelfth": (640, 704), "too_far": (640, 704), "race_word": (585, 640), "final_word": (585, 640)}
X_RANGE = (60, 1220)
TAIL_CHARS = 0  # set by --tail-chars


def text_mask(frame: np.ndarray, band: tuple[int, int]) -> np.ndarray:
    """White text: every channel bright (> 180). The counter's yellow band is bright in grey but has no blue."""
    mask = np.zeros(frame.shape[:2], np.uint8)
    y0, y1 = band
    region = frame[y0:y1, X_RANGE[0]:X_RANGE[1]]
    mask[y0:y1, X_RANGE[0]:X_RANGE[1]] = (region.min(axis=2) > 180).astype(np.uint8) * 255
    return mask


def words(mask: np.ndarray, band: tuple[int, int]) -> list[tuple[int, int]]:
    """Horizontal runs of text columns, split at gaps wider than half the text height (word gaps)."""
    columns = mask[band[0]:band[1]].max(axis=0) > 0
    rows = np.where(mask[band[0]:band[1]].max(axis=1) > 0)[0]
    height = (rows[-1] - rows[0] + 1) if len(rows) else 20
    gap = max(4, int(height * 0.1))  # the counter font is outlined italic: letters touch, words have a 9-14 px gap
    runs, start, last = [], None, None
    for x, on in enumerate(columns):
        if on:
            if start is None:
                start = x
            elif x - last > gap:
                runs.append((start, last))
                start = x
            last = x
    if start is not None:
        runs.append((start, last))
    return runs


def element_box(mask: np.ndarray, kind: str) -> tuple[int, int, int, int]:
    band = BANDS[kind]
    runs = words(mask, band)
    if not runs:
        raise ValueError(f"{kind}: no text in the band")
    if kind in ("race_word", "final_word"):
        # the counter is "<number> <word>" or "<word> <number>" or one word ("Final Race" has two words but the
        # finder picks a numbered race): keep the widest run, which is the word, not the ordinal.
        x0, x1 = max(runs, key=lambda r: r[1] - r[0])
        if TAIL_CHARS:
            # Chinese writes the counter without a space (第2场比赛): keep the last characters, the word that
            # every race shares, and leave the number out. A CJK character is about as wide as the text height.
            rows = np.where(mask[band[0]:band[1], x0:x1 + 1].max(axis=1) > 0)[0]
            x0 = max(x0, x1 - int((rows[-1] - rows[0] + 1) * 0.98 * TAIL_CHARS))
    else:
        x0, x1 = runs[0][0], runs[-1][1]
    sub = mask[band[0]:band[1], x0:x1 + 1]
    rows = np.where(sub.max(axis=1) > 0)[0]
    y0, y1 = band[0] + rows[0], band[0] + rows[-1]
    pad = 3
    if kind in ("race_word", "final_word"):
        # exactly the rows of Tournament's race search band (DEFAULT_ROIS race y 584, h 60): the engine splits
        # that band into 12 stripes for its threshold/invert step, and the template must share those stripes
        return int(x0 - pad), 584, int(x1 - x0 + 1 + 2 * pad), 60
    return int(x0 - pad), int(y0 - pad), int(x1 - x0 + 1 + 2 * pad), int(y1 - y0 + 1 + 2 * pad)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--clean-assets", type=Path, required=True)
    parser.add_argument("--lang", required=True)
    parser.add_argument("--frame", action="append", default=[], help="element=path")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--preview", type=Path, help="write each cut-out as PNG here for a visual check")
    parser.add_argument("--tail-chars", type=int, default=0, help="counter word = the last N CJK characters")
    args = parser.parse_args()
    global TAIL_CHARS
    TAIL_CHARS = args.tail_chars
    root = args.clean_assets
    elements = dict(item.split("=", 1) for item in args.frame)
    frames = []
    for kind, path in elements.items():
        image = cv2.imread(path)
        if image is None:
            raise SystemExit(f"cannot read {path}")
        frames.append((kind, cv2.resize(image, (1280, 720), interpolation=cv2.INTER_AREA)))

    stamp = time.strftime("%Y%m%d")
    video = f"lan_{args.lang}_banners_{stamp}.mp4"
    out = {}
    records = []
    for index, (kind, frame) in enumerate(frames):
        mask = text_mask(frame, BANDS[kind])
        x, y, w, h = element_box(mask, kind)
        crop = frame[y:y + h, x:x + w, ::-1]
        # The counter word keeps its band: the engine thresholds the region (grey > 180), which makes the yellow
        # band white too, so what identifies the word is its dark outline on that band - a rectangle cut. The
        # message bars are white text on a dark bar: the text mask alone is the template there.
        alpha = np.full((h, w), 255, np.uint8) if kind in ("race_word", "final_word") else mask[y:y + h, x:x + w]
        rgba = np.dstack([crop, alpha])
        records.append((kind, index, (x, y, w, h), rgba))
        if args.preview:
            args.preview.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(args.preview / f"{args.lang}_{kind}.png"), cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
    if args.dry_run:
        print(json.dumps({kind: box for kind, _, box, _ in records}))
        return 0

    # provenance clip: one frame per second, frame index = element order
    video_dir = root / "input video"
    temp = video_dir / f".{video}.frames"
    temp.mkdir(parents=True, exist_ok=True)
    for index, (_, frame) in enumerate(frames):
        cv2.imwrite(str(temp / f"{index:03d}.png"), frame)
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-framerate", "1", "-i",
                    str(temp / "%03d.png"), "-c:v", "libx264", "-preset", "slow", "-crf", "12", "-pix_fmt",
                    "yuv420p", "-r", "1", str(video_dir / video)], check=True)
    for png in temp.glob("*.png"):
        png.unlink()
    temp.rmdir()

    db_path = root / "cutouts" / "cutouts.json"
    db = json.loads(db_path.read_text(encoding="utf-8"))
    for kind, index, (x, y, w, h), rgba in records:
        num = max(db["nextId"], max(int(c["id"].split(".")[-1]) for c in db["cutouts"]) + 1)
        db["nextId"] = num + 1
        cutout_id = f"cutout.{num:04d}"
        label = f"{SLUGS[kind]}_{args.lang}"
        filename = f"{Path(video).stem}_f{index:06d}_{label}_{num:04d}.png"
        ok, buffer = cv2.imencode(".png", cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
        png = buffer.tobytes()
        (root / "cutouts" / "images" / filename).write_bytes(png)
        (root / "cutouts" / "originals" / filename).write_bytes(png)
        db["cutouts"].append({
            "id": cutout_id, "video": video, "frame": index, "timeMs": index * 1000, "fps": 1.0,
            "frameSize": [1280, 720], "bbox": {"x": x, "y": y, "w": w, "h": h}, "tool": "lan_cutouts_threshold180",
            "points": None, "tolerance": None, "label": label,
            "notes": "LAN capture 2026-11-01 (two consoles, roadmap LANGUAGES_15 A5); text mask grey > 180 at 1280x720",
            "path": f"cutouts/images/{filename}", "originalPath": f"cutouts/originals/{filename}",
            "originalSha256": hashlib.sha256(png).hexdigest(), "createdMs": int(time.time() * 1000),
        })
        out[kind] = cutout_id
    db_path.write_text(json.dumps(db, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"lang": args.lang, "video": video, "cutouts": out}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
