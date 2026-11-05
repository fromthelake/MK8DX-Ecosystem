"""One-call warpAffine probe on frozen LiveTrial QA arrays (outside Git)."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[2]


def sha(array: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("matrix", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error("output must stay outside Git")
    source = np.load(args.source, allow_pickle=False)
    matrix = np.load(args.matrix, allow_pickle=False)
    if source.ndim != 3 or matrix.shape != (2, 3):
        parser.error("expected HxWxC image and 2x3 affine matrix")
    cv2.setNumThreads(1)
    cv2.setRNGSeed(0)
    result = cv2.warpAffine(source, matrix, (source.shape[1], source.shape[0]),
                            borderMode=cv2.BORDER_REPLICATE)
    output.parent.mkdir(parents=True, exist_ok=True)
    np.save(output, result)
    output.with_suffix(".json").write_text(json.dumps({
        "schema": "mk8dx.opencv-affine-probe.v1", "opencv": cv2.__version__,
        "source_sha256": sha(source), "matrix_sha256": sha(matrix),
        "result_sha256": sha(result), "shape": list(result.shape),
        "interpolation": "default INTER_LINEAR", "border": "BORDER_REPLICATE",
    }, indent=2) + "\n", encoding="utf-8")
    print(f"opencv={cv2.__version__} result={sha(result)}")


if __name__ == "__main__":
    main()
