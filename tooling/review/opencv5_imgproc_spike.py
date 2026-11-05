"""Opt-in OpenCV 4/5 warp and nearest-resize spike on saved QA arrays."""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import time
from pathlib import Path

import cv2
import numpy as np
import psutil
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]


def digest(array: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def timed(call, repeat: int = 101) -> tuple[np.ndarray, float]:
    call()  # Warm the backend once.
    times = []
    result = None
    for _ in range(repeat):
        start = time.perf_counter_ns()
        result = call()
        times.append((time.perf_counter_ns() - start) / 1_000_000)
    assert result is not None
    return result, statistics.median(times)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--matrix", type=Path, required=True)
    parser.add_argument("--mask", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error("output must stay outside Git")
    cv2.setNumThreads(1)
    cv2.setRNGSeed(0)
    source = np.load(args.source, allow_pickle=False)
    matrix = np.load(args.matrix, allow_pickle=False)
    mask = np.load(args.mask, allow_pickle=False)
    process = psutil.Process()
    rss_start = process.memory_info().rss
    warp, warp_ms = timed(lambda: cv2.warpPerspective(
        source, matrix, (source.shape[1], source.shape[0]),
        flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE))
    new_size = (max(1, mask.shape[1] // 3), max(1, mask.shape[0] // 3))
    nearest, nearest_ms = timed(lambda: cv2.resize(mask, new_size, interpolation=cv2.INTER_NEAREST))
    exact, exact_ms = timed(lambda: cv2.resize(mask, new_size, interpolation=cv2.INTER_NEAREST_EXACT))
    pillow = np.asarray(Image.fromarray(mask).resize(new_size, Image.Resampling.NEAREST))
    payload = {"schema": "mk8dx.opencv5-imgproc-spike.v1", "opencv": cv2.__version__,
               "source_sha256": digest(source), "matrix_sha256": digest(matrix),
               "mask_sha256": digest(mask), "warp_sha256": digest(warp),
               "warp_median_ms": warp_ms,
               "nearest_sha256": digest(nearest), "nearest_median_ms": nearest_ms,
               "nearest_pillow_changed_pixels": int(np.count_nonzero(nearest != pillow)),
               "exact_sha256": digest(exact), "exact_median_ms": exact_ms,
               "exact_pillow_changed_pixels": int(np.count_nonzero(exact != pillow)),
               "pillow_sha256": digest(pillow), "resize_shape": list(nearest.shape),
               "rss_delta_mb": (process.memory_info().rss - rss_start) / 1048576}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"opencv={cv2.__version__} warp_ms={warp_ms:.3f} "
          f"nearest_pillow_diff={payload['nearest_pillow_changed_pixels']} output={output}")


if __name__ == "__main__":
    main()
