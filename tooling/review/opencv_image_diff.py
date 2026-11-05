"""Pixel metrics and a visual difference image for two saved PNG stages.

Usage: python tooling/review/opencv_image_diff.py old.png new.png
       --output <private report.json> --difference <private diff.png>
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("old", type=Path)
    parser.add_argument("new", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--difference", type=Path, required=True)
    args = parser.parse_args()
    for path in (args.output, args.difference):
        resolved = path.resolve()
        if resolved == ROOT or ROOT in resolved.parents:
            parser.error("outputs must stay outside the repository")
        resolved.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(args.old, formats=["PNG"]) as image:
        left = np.asarray(image).copy()
    with Image.open(args.new, formats=["PNG"]) as image:
        right = np.asarray(image).copy()
    if left.shape != right.shape or left.dtype != right.dtype:
        raise ValueError(f"different image layout: {left.shape}/{left.dtype} vs {right.shape}/{right.dtype}")
    difference = np.abs(left.astype(np.float64) - right.astype(np.float64))
    maximum = float(np.max(difference)) if difference.size else 0.0
    mse = float(np.mean(difference ** 2)) if difference.size else 0.0
    peak = float(np.iinfo(left.dtype).max) if np.issubdtype(left.dtype, np.integer) else 1.0
    psnr = "infinite" if mse == 0 else 20 * math.log10(peak / math.sqrt(mse))
    rendered = np.uint8(np.clip(difference * (255 / maximum), 0, 255)) if maximum else np.zeros_like(left, dtype=np.uint8)
    Image.fromarray(rendered).save(args.difference)
    payload = {"schema": "mk8dx.opencv-image-diff.v1", "old": str(args.old), "new": str(args.new),
               "shape": list(left.shape), "dtype": str(left.dtype),
               "old_sha256": hashlib.sha256(left.tobytes()).hexdigest(),
               "new_sha256": hashlib.sha256(right.tobytes()).hexdigest(),
               "max_abs": maximum, "mean_abs": float(np.mean(difference)) if difference.size else 0.0,
               "changed_percent": 100 * np.count_nonzero(difference) / difference.size if difference.size else 0.0,
               "psnr_db": psnr, "difference_image": str(args.difference)}
    args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"max_abs={maximum} changed_percent={payload['changed_percent']:.6f} psnr_db={psnr}")


if __name__ == "__main__":
    main()
