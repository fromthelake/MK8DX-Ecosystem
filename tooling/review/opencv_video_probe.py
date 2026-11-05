"""Probe exact decoded video frames, indices, timestamps and FFmpeg backend.

Usage: python tooling/review/opencv_video_probe.py <video> --output <private.json>
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--frames", type=int, nargs="*")
    parser.add_argument("--all-frames", action="store_true",
                        help="sequentially hash every decoded frame without writing images")
    args = parser.parse_args()
    output = args.output.resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error("output must be outside the repository")
    output.parent.mkdir(parents=True, exist_ok=True)
    cv2.setNumThreads(1)
    cv2.setRNGSeed(0)
    capture = cv2.VideoCapture(str(args.video), cv2.CAP_FFMPEG)
    if not capture.isOpened():
        raise RuntimeError("FFmpeg VideoCapture could not open the video")
    try:
        count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        if args.all_frames and args.frames is not None:
            parser.error("--all-frames and --frames cannot be combined")
        wanted = (range(count) if args.all_frames else
                  args.frames if args.frames is not None else
                  sorted({0, min(30, count - 1), count // 2, max(0, count - 1)}))
        frames = []
        for index in wanted:
            if not args.all_frames:
                capture.set(cv2.CAP_PROP_POS_FRAMES, index)
            before_index = capture.get(cv2.CAP_PROP_POS_FRAMES)
            before_ms = capture.get(cv2.CAP_PROP_POS_MSEC)
            ok, frame = capture.read()
            after_index = capture.get(cv2.CAP_PROP_POS_FRAMES)
            after_ms = capture.get(cv2.CAP_PROP_POS_MSEC)
            item = {"requested_index": index, "before_index": before_index,
                    "before_ms": before_ms, "after_index": after_index,
                    "after_ms": after_ms, "read_ok": ok}
            if ok:
                packed = np.ascontiguousarray(frame)
                item.update({"shape": list(frame.shape), "dtype": str(frame.dtype),
                             "sha256": hashlib.sha256(memoryview(packed).cast("B")).hexdigest()})
                if not args.all_frames:
                    image_path = output.with_name(f"{output.stem}-frame-{index}.png")
                    cv2.imwrite(str(image_path), frame)
                    item["image"] = str(image_path)
            frames.append(item)
        build = cv2.getBuildInformation()
        ffmpeg = [line.strip() for line in build.splitlines()
                  if any(label in line for label in ("FFMPEG:", "avcodec:", "avformat:", "avutil:"))]
        payload = {"schema": "mk8dx.opencv-video-probe.v1", "cv2": cv2.__version__,
                   "threads": cv2.getNumThreads(), "backend": capture.getBackendName(),
                   "frame_count": count, "fps": capture.get(cv2.CAP_PROP_FPS),
                   "ffmpeg": ffmpeg, "frames": frames}
    finally:
        capture.release()
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"cv2={cv2.__version__} frames={len(frames)} output={output}")


if __name__ == "__main__":
    main()
