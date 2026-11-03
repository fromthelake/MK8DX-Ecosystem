"""Score Tournament's Album/replay `ignore` targets on real recordings, old template set against new.

    .venv\\Scripts\\python.exe tooling/tournament/score_ignore_templates.py --video V.mp4 [--fps 4] \
        --templates old=<templates dir> --templates new=<templates dir> --output scores.jsonl

For every sampled frame (resized to the engine's 1280x720 working size with INTER_LINEAR, grey) it computes the
score of every ignore target the engine would try in that template set: the three built-in Switch 1 targets
(`IGNORE_FRAME_TARGETS`, template indices 3-5) and the `ignore` entries of `locale_templates.json`, with the
engine's own template loading (extract_frames: colour -> grey > 180, 2-D files as they are) and matcher
(`_bounded_roi` + `match_template`, no preprocessing). The frame's decision is the engine's: the best-scoring
target decides, and the frame is ignored when that score is above that target's threshold. One JSON line per
frame: time, per set the decision, the winning label and every target's score.

The engine files are imported, not edited (engine-provenance manifest).
"""
from __future__ import annotations

import argparse
import ast
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages" / "tournament-extraction" / "python" / "src"))

from mk8dx_tournament_extraction import locale_templates  # noqa: E402
from mk8dx_tournament_extraction.engine.extract_common import match_template  # noqa: E402


def _engine_ignore_targets() -> tuple[dict, ...]:
    """`IGNORE_FRAME_TARGETS` read from the engine source (importing that module needs the private data files)."""
    path = ROOT / "packages/tournament-extraction/python/src/mk8dx_tournament_extraction/engine/extract_initial_scan.py"
    for node in ast.parse(path.read_text(encoding="utf-8")).body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == "IGNORE_FRAME_TARGETS" for t in node.targets):
            return ast.literal_eval(node.value)
    raise SystemExit("IGNORE_FRAME_TARGETS not found in the engine")


IGNORE_FRAME_TARGETS = _engine_ignore_targets()

BUILT_IN = ("Trackname_template.png", "Race_template.png", "12th_pos_template.png", "ignore.png",
            "albumgallery_ignore.png", "ignore_2.png", "Race_template_NL_final.png", "12th_pos_templateNL.png")


def load_engine_template(path: Path):
    image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise SystemExit(f"cannot read {path}")
    if image.ndim == 3 and image.shape[2] == 4:
        gray = cv2.cvtColor(image, cv2.COLOR_BGRA2GRAY)
        _, alpha = cv2.threshold(image[:, :, 3], 0, 255, cv2.THRESH_BINARY)
        _, binary = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY)
        return binary, alpha
    if image.ndim == 3:
        _, binary = cv2.threshold(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), 180, 255, cv2.THRESH_BINARY)
        return binary, None
    return image, None


class TemplateSet:
    """The ignore targets of one templates folder, as the engine registers them."""

    def __init__(self, templates_dir: Path):
        entries = locale_templates.register(locale_templates.read_manifest(templates_dir))
        self.targets = []
        for target in IGNORE_FRAME_TARGETS:
            path = templates_dir / BUILT_IN[int(target["template_index"])]
            self.targets.append((target["label"], tuple(target["roi"]), float(target["match_threshold"]),
                                 load_engine_template(path)))
        for entry in entries:
            if entry.kind == "ignore":
                self.targets.append((f"Ignore{entry.locale}:{entry.file.name}", entry.roi, entry.threshold,
                                     load_engine_template(entry.file)))
        locale_templates.register(())

    def scores(self, gray: np.ndarray) -> list[tuple[str, float, float]]:
        out = []
        for label, (x, y, w, h), threshold, (template, alpha) in self.targets:
            x, y = max(int(x), 0), max(int(y), 0)
            w, h = min(int(w), gray.shape[1] - x), min(int(h), gray.shape[0] - y)
            roi = gray[y:y + h, x:x + w]
            if roi.shape[0] < template.shape[0] or roi.shape[1] < template.shape[1]:
                roi = cv2.resize(roi, (max(template.shape[1], roi.shape[1]), max(template.shape[0], roi.shape[0])),
                                 interpolation=cv2.INTER_LINEAR)
            value = float(match_template(roi, template, alpha))
            out.append((label, 0.0 if not np.isfinite(value) else value, threshold))
        return out

    @staticmethod
    def decision(scores: list[tuple[str, float, float]]) -> tuple[bool, str, float]:
        """The engine's rule: the best-scoring target decides with its own threshold."""
        label, best, threshold = max(scores, key=lambda item: item[1], default=("", 0.0, 1.0))
        return best > threshold, label, best


def frames(video: Path, fps: float, start: float | None, duration: float | None, keyframes: bool = False):
    """(seconds, 1280x720 grey) for each sampled frame; decoded by ffmpeg, resized like the engine. With keyframes
    only the key frames are decoded (fast sampling of hours-long recordings; the times are then approximate)."""
    probe = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
         "-of", "json", str(video)], capture_output=True, check=True).stdout)
    width, height = probe["streams"][0]["width"], probe["streams"][0]["height"]
    command = ["ffmpeg", "-v", "error"]
    if keyframes:
        command += ["-skip_frame", "nokey"]
    if start is not None:
        command += ["-ss", f"{start:.3f}"]
    command += ["-i", str(video)]
    if duration is not None:
        command += ["-t", f"{duration:.3f}"]
    command += (["-vsync", "vfr"] if keyframes else ["-vf", f"fps={fps}"])
    command += ["-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    process = subprocess.Popen(command, stdout=subprocess.PIPE)
    size = width * height * 3
    index = 0
    try:
        while True:
            raw = process.stdout.read(size)
            if len(raw) < size:
                break
            frame = np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 3)
            resized = cv2.resize(frame, (1280, 720), interpolation=cv2.INTER_LINEAR)
            # key-frame samples carry their sample number instead of a time
            yield (float(index) if keyframes else (start or 0.0) + index / fps), cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
            index += 1
    finally:
        process.kill()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--templates", action="append", required=True, help="name=<templates dir>")
    parser.add_argument("--fps", type=float, default=2.0)
    parser.add_argument("--start", type=float)
    parser.add_argument("--duration", type=float)
    parser.add_argument("--keyframes", action="store_true", help="decode key frames only (long recordings)")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    sets = {}
    for item in args.templates:
        name, _, folder = item.partition("=")
        sets[name] = TemplateSet(Path(folder))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with args.output.open("w", encoding="utf-8") as handle:
        for seconds, gray in frames(args.video, args.fps, args.start, args.duration, args.keyframes):
            row = {"video": args.video.name, ("sample" if args.keyframes else "t"): round(seconds, 3)}
            for name, template_set in sets.items():
                scores = template_set.scores(gray)
                ignored, label, best = template_set.decision(scores)
                row[name] = {"ignored": ignored, "label": label, "best": round(best, 4),
                             "scores": {label_: round(value, 4) for label_, value, _ in scores}}
            handle.write(json.dumps(row) + "\n")
            count += 1
    print(json.dumps({"video": str(args.video), "frames": count, "output": str(args.output)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
