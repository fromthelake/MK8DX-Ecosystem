"""Cut the LAN class badges (50cc/100cc/200cc/Mirror) of the track-intro screen as Clean Assets cut-outs (roadmap
LANGUAGES_15 D2; 055 lan_badge_150cc is the 150cc one).

    python tooling/tournament/badge_cutouts.py --clean-assets "<Clean Assets>" \
        --clip 50cc=<video>@<frame> --clip 100cc=... --clip 200cc=... --clip mirror=... [--preview DIR] [--dry-run]

Each source is a cup recording and the frame of a settled track intro. A 4 s clip around it is written at 1280x720 into
Clean Assets `input video/lan_badge_<class>_20261101.mp4` (the cut-out provenance; the tool opens it), and the badge is
cut from the clip's frame 45 inside 055's box widened by 12 px: the shield silhouette (saturated pixels of its golden
border and coloured fill, closed and hole-filled, largest region) is the alpha. Each cut-out is
appended to cutouts/cutouts.json the way the cut-out server writes it, labelled lan_badge_<class>. The owner reviews
and can re-cut them in the tool (Neutral templates). Labels stay literal: which badge was on screen.
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

BOX_150 = (216, 617, 88, 86)  # 055 lan_badge_150cc anchor on the 1280x720 frame
MARGIN = 12
CLIP_LEAD_FRAMES = 45  # the clip starts 1.5 s before the settled frame


def silhouette(crop_bgr: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2HSV)
    # the golden border and the coloured fill are saturated; the grey banner and the black screen edge are not
    mask = ((hsv[:, :, 1] > 70) * 255).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    if count <= 1:
        return mask
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    mask = np.where(labels == largest, 255, 0).astype(np.uint8)
    flood = mask.copy()
    cv2.floodFill(flood, np.zeros((mask.shape[0] + 2, mask.shape[1] + 2), np.uint8), (0, 0), 255)
    return mask | cv2.bitwise_not(flood)  # holes inside the shield filled


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--clean-assets", type=Path, required=True)
    parser.add_argument("--clip", action="append", required=True, metavar="CLASS=VIDEO@FRAME")
    parser.add_argument("--preview", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    root = args.clean_assets
    records = []
    for item in args.clip:
        cls, _, source = item.partition("=")
        video_path, _, settled = source.rpartition("@")
        start = (int(settled) - CLIP_LEAD_FRAMES) / 30.0
        clip_name = f"lan_badge_{cls}_20261101.mp4"
        clip = root / "input video" / clip_name
        if not args.dry_run:
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{start:.3f}", "-i", video_path,
                            "-t", "4", "-vf", "scale=1280:720:flags=area", "-c:v", "libx264", "-crf", "10",
                            "-preset", "slow", "-pix_fmt", "yuv420p", "-an", str(clip)], check=True)
            capture = cv2.VideoCapture(str(clip))
            for _ in range(CLIP_LEAD_FRAMES + 1):
                ok, frame = capture.read()
            capture.release()
        else:
            capture = cv2.VideoCapture(video_path)
            capture.set(cv2.CAP_PROP_POS_FRAMES, int(settled))
            ok, frame = capture.read()
            capture.release()
            frame = cv2.resize(frame, (1280, 720), interpolation=cv2.INTER_AREA)
        x0, y0 = BOX_150[0] - MARGIN, BOX_150[1] - MARGIN
        region = frame[y0:y0 + BOX_150[3] + 2 * MARGIN, x0:x0 + BOX_150[2] + 2 * MARGIN]
        mask = silhouette(region)
        ys, xs = np.nonzero(mask)
        bx, by, bw, bh = int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)
        rgba = np.dstack([region[by:by + bh, bx:bx + bw, ::-1], mask[by:by + bh, bx:bx + bw]])
        records.append((cls, clip_name, (x0 + bx, y0 + by, bw, bh), rgba))
        if args.preview:
            args.preview.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(args.preview / f"badge_{cls}.png"), cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
    if args.dry_run:
        print(json.dumps({cls: box for cls, _, box, _ in records}))
        return 0
    db_path = root / "cutouts" / "cutouts.json"
    db = json.loads(db_path.read_text(encoding="utf-8"))
    out = {}
    for cls, clip_name, (x, y, w, h), rgba in records:
        num = max(db["nextId"], max(int(c["id"].split(".")[-1]) for c in db["cutouts"]) + 1)
        db["nextId"] = num + 1
        cutout_id = f"cutout.{num:04d}"
        label = f"lan_badge_{cls}"
        filename = f"{Path(clip_name).stem}_f{CLIP_LEAD_FRAMES:06d}_{label}_{num:04d}.png"
        png = cv2.imencode(".png", cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))[1].tobytes()
        (root / "cutouts" / "images" / filename).write_bytes(png)
        (root / "cutouts" / "originals" / filename).write_bytes(png)
        db["cutouts"].append({
            "id": cutout_id, "video": clip_name, "frame": CLIP_LEAD_FRAMES, "timeMs": CLIP_LEAD_FRAMES * 1000 // 30,
            "fps": 30.0, "frameSize": [1280, 720], "bbox": {"x": x, "y": y, "w": w, "h": h},
            "tool": "badge_silhouette", "points": None, "tolerance": None, "label": label,
            "notes": "LAN class cup 2026-11-01 (roadmap LANGUAGES_15 D2); shield silhouette mask, to be reviewed by the owner",
            "path": f"cutouts/images/{filename}", "originalPath": f"cutouts/originals/{filename}",
            "originalSha256": hashlib.sha256(png).hexdigest(), "createdMs": int(time.time() * 1000),
        })
        out[cls] = cutout_id
    db_path.write_text(json.dumps(db, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
