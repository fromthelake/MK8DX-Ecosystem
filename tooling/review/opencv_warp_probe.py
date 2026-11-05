"""Run one warpPerspective call against frozen source and homography arrays.

Usage: python tooling/review/opencv_warp_probe.py source.npy matrix.npy
       --output <private.npy> [--border replicate|constant]
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
    parser.add_argument("source", type=Path)
    parser.add_argument("matrix", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--border", choices=("replicate", "constant"), default="replicate")
    args = parser.parse_args()
    output = args.output.resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error("output must stay outside the repository")
    source = np.load(args.source, allow_pickle=False)
    matrix = np.load(args.matrix, allow_pickle=False)
    if source.ndim != 3 or matrix.shape != (3, 3):
        parser.error("expected an HxWxC source and 3x3 matrix")
    cv2.setNumThreads(1)
    cv2.setRNGSeed(0)
    border = cv2.BORDER_REPLICATE if args.border == "replicate" else cv2.BORDER_CONSTANT
    result = cv2.warpPerspective(source, matrix, (source.shape[1], source.shape[0]),
                                 flags=cv2.INTER_LINEAR, borderMode=border)
    output.parent.mkdir(parents=True, exist_ok=True)
    np.save(output, result)
    payload = {"schema": "mk8dx.opencv-warp-probe.v1", "cv2": cv2.__version__,
               "source_sha256": hashlib.sha256(np.ascontiguousarray(source).tobytes()).hexdigest(),
               "matrix_sha256": hashlib.sha256(np.ascontiguousarray(matrix).tobytes()).hexdigest(),
               "result_sha256": hashlib.sha256(np.ascontiguousarray(result).tobytes()).hexdigest(),
               "shape": list(result.shape), "border": args.border, "interpolation": "INTER_LINEAR"}
    output.with_suffix(".json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"cv2={cv2.__version__} result={payload['result_sha256']} output={output}")


if __name__ == "__main__":
    main()
