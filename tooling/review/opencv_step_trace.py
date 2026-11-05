"""Run a Python recognition entry point with OpenCV array-call tracing.

Example: python tooling/review/opencv_step_trace.py --output <private>.jsonl --
         tooling/tournament/measure_shared_export_consensus.py <its arguments>

The wrapper calls the original OpenCV function exactly once. It records the
arguments' and results' array hashes, shapes, dtypes and elapsed time. The first
result for each source call site is saved as .npy for pixel-difference inspection.
No source images, labels, or credentials are written to the repository.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import json
import random
import runpy
import sys
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[2]
FUNCTIONS = (
    "imread", "imdecode", "cvtColor", "resize", "warpAffine", "warpPerspective",
    "remap", "matchTemplate", "threshold", "adaptiveThreshold", "GaussianBlur",
    "medianBlur", "bilateralFilter", "morphologyEx", "erode", "dilate",
    "Canny", "Sobel", "Laplacian", "filter2D", "normalize", "bitwise_and",
    "inRange", "minMaxLoc", "getPerspectiveTransform", "getAffineTransform",
    "findHomography", "HoughLines", "HoughLinesP", "equalizeHist", "imencode",
)


def array_info(value: Any) -> dict[str, Any]:
    if isinstance(value, np.ndarray):
        packed = np.ascontiguousarray(value)
        return {
            "kind": "array", "shape": list(packed.shape), "dtype": str(packed.dtype),
            "sha256": hashlib.sha256(memoryview(packed).cast("B")).hexdigest(),
        }
    if isinstance(value, (tuple, list)):
        return {"kind": type(value).__name__, "items": [array_info(item) for item in value]}
    if isinstance(value, (str, int, float, bool)) or value is None:
        return {"kind": "scalar", "value": value}
    return {"kind": type(value).__name__, "repr": repr(value)[:200]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--snapshot-dir", type=Path)
    parser.add_argument("--max-calls", type=int, default=10000,
                        help="cap trace records; later calls still run unmodified")
    parser.add_argument("script", type=Path)
    parser.add_argument("script_args", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.max_calls < 1:
        parser.error("--max-calls must be positive")
    output = args.output.resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error("trace output must be outside the repository")
    output.parent.mkdir(parents=True, exist_ok=True)
    snapshots = (args.snapshot_dir or output.with_suffix(".arrays")).resolve()
    if snapshots == ROOT or ROOT in snapshots.parents:
        parser.error("array snapshots must be outside the repository")
    snapshots.mkdir(parents=True, exist_ok=True)
    cv2.setNumThreads(1)
    cv2.setRNGSeed(0)
    random.seed(0)
    np.random.seed(0)
    occurrences: dict[str, int] = defaultdict(int)
    recorded = 0
    with output.open("w", encoding="utf-8") as stream:
        stream.write(json.dumps({"schema": "mk8dx.opencv-step-trace.v1", "cv2": cv2.__version__,
                                 "threads": cv2.getNumThreads(), "seed": 0,
                                 "script": str(args.script), "arguments": args.script_args}) + "\n")

        def wrap(name: str) -> None:
            original = getattr(cv2, name)

            def traced(*positional: Any, **keywords: Any) -> Any:
                nonlocal recorded
                if recorded >= args.max_calls:
                    return original(*positional, **keywords)
                frame = sys._getframe(1)
                location = f"{Path(frame.f_code.co_filename).as_posix()}:{frame.f_lineno}:{name}"
                occurrences[location] += 1
                ordinal = occurrences[location]
                inputs = [array_info(item) for item in positional]
                named = {key: array_info(value) for key, value in keywords.items()}
                start = time.perf_counter_ns()
                result = original(*positional, **keywords)
                elapsed_ns = time.perf_counter_ns() - start
                result_info = array_info(result)
                snapshot = None
                if ordinal == 1 and isinstance(result, np.ndarray):
                    digest = hashlib.sha256(location.encode()).hexdigest()[:16]
                    snapshot = f"{digest}.npy"
                    np.save(snapshots / snapshot, result)
                record = {"site": location, "ordinal": ordinal, "function": name,
                          "inputs": inputs, "keywords": named, "result": result_info,
                          "elapsed_ns": elapsed_ns, "snapshot": snapshot}
                stream.write(json.dumps(record, ensure_ascii=False) + "\n")
                recorded += 1
                return result

            setattr(cv2, name, traced)

        for function in FUNCTIONS:
            if hasattr(cv2, function):
                wrap(function)
        script = args.script.resolve()
        sys.argv = [str(script), *([arg for arg in args.script_args if arg != "--"])]
        sys.path.insert(0, str(script.parent))
        runpy.run_path(str(script), run_name="__main__")
    print(f"calls={sum(occurrences.values())} sites={len(occurrences)} output={output}")


if __name__ == "__main__":
    main()
