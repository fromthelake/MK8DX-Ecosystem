"""Compare OpenCV 4/5 still-image decode without copying protected pixels.

Run independently in each venv with the same explicit private directories. The
JSON output belongs outside Git; source paths and names can be private.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]


def hash_array(value: np.ndarray) -> str:
    return hashlib.sha256(memoryview(np.ascontiguousarray(value)).cast("B")).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error("output must be outside the repository")
    cv2.setNumThreads(1)
    cv2.setRNGSeed(0)
    rows = []
    for directory in args.directory:
        directory = directory.resolve(strict=True)
        files = sorted(p for p in directory.rglob("*")
                       if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png", ".tif", ".tiff"})
        for path in files:
            source = path.read_bytes()
            with Image.open(path) as image:
                exif_orientation = image.getexif().get(274)
                icc = image.info.get("icc_profile")
            variants = {}
            for name, flag in (("color", cv2.IMREAD_COLOR),
                               ("unchanged", cv2.IMREAD_UNCHANGED),
                               ("ignore_orientation", cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)):
                decoded = cv2.imdecode(np.frombuffer(source, dtype=np.uint8), flag)
                variants[name] = (None if decoded is None else
                                  {"shape": list(decoded.shape), "dtype": str(decoded.dtype),
                                   "sha256": hash_array(decoded)})
            rows.append({"source_sha256": hashlib.sha256(source).hexdigest(),
                         "source": str(path), "exif_orientation": exif_orientation,
                         "icc_sha256": hashlib.sha256(icc).hexdigest() if icc else None,
                         "variants": variants})
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"schema": "mk8dx.opencv-image-input-probe.v1",
                                  "cv2": cv2.__version__, "rows": rows}, indent=2) + "\n",
                      encoding="utf-8")
    print(f"cv2={cv2.__version__} images={len(rows)}")


if __name__ == "__main__":
    main()
