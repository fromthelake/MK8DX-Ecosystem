"""Isolate the Android card-edge HoughLinesP call on one frozen edge array.

Usage: python tooling/review/opencv_hough_probe.py <edges.npy>
       --output <private.json> [--threshold 35] [--min-line 45] [--max-gap 22]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("edges", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--threshold", type=int, default=35)
    parser.add_argument("--min-line", type=float, default=45.0)
    parser.add_argument("--max-gap", type=float, default=22.0)
    args = parser.parse_args()
    output = args.output.resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error("output must stay outside the repository")
    edges = np.load(args.edges, allow_pickle=False)
    if edges.dtype != np.uint8 or edges.ndim != 2:
        parser.error("edge array must be a 2D uint8 image")
    cv2.setNumThreads(1)
    cv2.setRNGSeed(0)
    lines = cv2.HoughLinesP(edges, 1.0, math.pi / 180.0, args.threshold,
                            minLineLength=args.min_line, maxLineGap=args.max_gap)
    ordered = sorted([list(map(int, row)) for row in np.asarray(lines).reshape(-1, 4)]
                     if lines is not None else [])
    payload = {"schema": "mk8dx.opencv-hough-probe.v1", "cv2": cv2.__version__,
               "input_sha256": hashlib.sha256(memoryview(np.ascontiguousarray(edges))).hexdigest(),
               "input_shape": list(edges.shape), "output_shape": list(lines.shape) if lines is not None else None,
               "threshold": args.threshold,
               "min_line": args.min_line, "max_gap": args.max_gap,
               "line_count": len(ordered), "lines": ordered}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"cv2={cv2.__version__} lines={len(ordered)} output={output}")


if __name__ == "__main__":
    main()
