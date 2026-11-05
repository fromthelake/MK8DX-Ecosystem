"""Separate-process RSS/time probe of one RF-DETR engine on a saved QA tensor."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import psutil

from opencv5_dnn_spike import input_tensor


ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", choices=("opencv", "ort"), required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--frame", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error("output must stay outside Git")
    tensor = input_tensor(args.frame)
    process = psutil.Process()
    initial = process.memory_info().rss
    started = time.perf_counter()
    if args.engine == "opencv":
        import cv2
        cv2.setNumThreads(1)
        net = cv2.dnn.readNetFromONNX(str(args.model))
        loaded = process.memory_info().rss
        net.setInput(tensor)
        values = net.forward(["dets", "labels"])
    else:
        import onnxruntime as ort
        session = ort.InferenceSession(str(args.model), providers=["CPUExecutionProvider"])
        loaded = process.memory_info().rss
        values = session.run(["dets", "labels"], {"input": tensor})
    elapsed = (time.perf_counter() - started) * 1000
    payload = {"schema": "mk8dx.opencv5-dnn-memory-probe.v1", "engine": args.engine,
               "load_rss_delta_mb": (loaded - initial) / 1048576,
               "final_rss_delta_mb": (process.memory_info().rss - initial) / 1048576,
               "load_and_forward_ms": elapsed,
               "output_shapes": [list(value.shape) for value in values],
               "finite": [bool(np.isfinite(value).all()) for value in values]}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"{args.engine}: {payload['final_rss_delta_mb']:.1f} MiB, {elapsed:.1f} ms")


if __name__ == "__main__":
    main()
