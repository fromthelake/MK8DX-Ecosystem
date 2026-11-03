"""Score Tournament banner templates on real video frames with the engine's own preprocessing.

Used to accept a per-locale template (Clean Assets 061/064) before it goes into the Tournament manifest:
a template is fit when it scores high on frames that show the banner and low on frames that do not.

  .venv\\Scripts\\python.exe tooling/tournament/score_locale_templates.py --video V.mkv \
      --times 1154.7,1150.0 --template a.png --template b.png [--roi 200,650,880,56] [--process 0]

Prints one JSON line per (time, template) with the best normalised correlation inside the ROI.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages" / "tournament-extraction" / "python" / "src"))

from mk8dx_tournament_extraction.engine.extract_common import match_template, preprocess_roi  # noqa: E402


def load_template(path: Path) -> tuple[np.ndarray, np.ndarray | None]:
    """The same conversion the engine applies when it loads a template (extract_frames)."""
    image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise SystemExit(f"cannot read template {path}")
    if image.ndim == 3 and image.shape[2] == 4:
        gray = cv2.cvtColor(image, cv2.COLOR_BGRA2GRAY)
        _, alpha = cv2.threshold(image[:, :, 3], 0, 255, cv2.THRESH_BINARY)
        _, binary = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY)
        return binary, alpha
    if image.ndim == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        _, binary = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY)
        return binary, None
    return image, None


def frame_at(video: Path, seconds: float) -> np.ndarray:
    """One frame scaled to the engine's 1280x720 working size."""
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{seconds:.3f}", "-i", str(video), "-frames:v", "1",
         "-vf", "scale=1280:720", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(720, 1280)


def score(gray: np.ndarray, roi: tuple[int, int, int, int], template, process: int) -> float:
    x, y, w, h = roi
    section = gray[y:y + h, x:x + w]
    processed = preprocess_roi(section, process)
    binary, alpha = template
    if processed.shape[0] < binary.shape[0] or processed.shape[1] < binary.shape[1]:
        processed = cv2.resize(processed, (max(binary.shape[1], processed.shape[1]),
                                           max(binary.shape[0], processed.shape[0])))
    return float(match_template(processed, binary, alpha))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--times", required=True, help="comma-separated seconds")
    parser.add_argument("--template", action="append", required=True, type=Path)
    parser.add_argument("--roi", default="200,650,880,56", help="x,y,w,h in 1280x720")
    parser.add_argument("--process", type=int, default=0, help="engine preprocess_roi type (0 = 12th/race path)")
    args = parser.parse_args()
    roi = tuple(int(part) for part in args.roi.split(","))
    templates = {path.name: load_template(path) for path in args.template}
    for seconds in (float(part) for part in args.times.split(",")):
        gray = frame_at(args.video, seconds)
        for name, template in templates.items():
            print(json.dumps({"t": seconds, "template": name, "score": round(score(gray, roi, template, args.process), 4)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
