"""Opt-in RF-DETR OpenCV 5 DNN vs ONNX Runtime probe on private QA frames.

The model, frames and JSON output must remain outside Git. This does not change
the product inference route or infer recognition acceptance from raw tensors.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import time
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
import psutil


ROOT = Path(__file__).resolve().parents[2]
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)[:, None, None]
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)[:, None, None]


def input_tensor(path: Path) -> np.ndarray:
    bgr = cv2.imread(str(path), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
    if bgr is None:
        raise ValueError(f"cannot decode {path}")
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    resized = cv2.resize(rgb, (704, 704), interpolation=cv2.INTER_LINEAR)
    chw = np.moveaxis(resized.astype(np.float32) / np.float32(255), -1, 0)
    return np.ascontiguousarray(((chw - MEAN) / STD)[None])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--frames", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=12)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error("output must stay outside Git")
    cv2.setNumThreads(1)
    cv2.setRNGSeed(0)
    ort.set_default_logger_severity(3)
    model = args.model.resolve(strict=True)
    frames = sorted(path for path in args.frames.resolve(strict=True).iterdir()
                    if path.suffix.lower() in {".png", ".jpg", ".jpeg"})[:args.limit]
    if not frames:
        parser.error("no frames")
    process = psutil.Process()
    initial_rss = process.memory_info().rss
    start = time.perf_counter()
    session = ort.InferenceSession(str(model), providers=["CPUExecutionProvider"],
                                   sess_options=ort.SessionOptions())
    ort_load_ms = (time.perf_counter() - start) * 1000
    start = time.perf_counter()
    net = cv2.dnn.readNetFromONNX(str(model))
    cv_load_ms = (time.perf_counter() - start) * 1000
    names = list(session.get_outputs())
    output_names = [item.name for item in names]
    records = []
    for frame in frames:
        tensor = input_tensor(frame)
        start = time.perf_counter()
        baseline = session.run(output_names, {session.get_inputs()[0].name: tensor})
        ort_ms = (time.perf_counter() - start) * 1000
        net.setInput(tensor)
        start = time.perf_counter()
        candidate = net.forward(output_names)
        cv_ms = (time.perf_counter() - start) * 1000
        metrics = {}
        for name, left, right in zip(output_names, baseline, candidate):
            delta = np.abs(left.astype(np.float64) - right.astype(np.float64))
            metrics[name] = {"shape_equal": left.shape == right.shape,
                             "max_abs": float(delta.max()), "mean_abs": float(delta.mean()),
                             "changed_percent": float(np.count_nonzero(delta) * 100 / delta.size)}
        ort_logits = baseline[output_names.index("labels")][0, :, :3]
        cv_logits = candidate[output_names.index("labels")][0, :, :3]
        ort_scores = 1.0 / (1.0 + np.exp(-ort_logits))
        cv_scores = 1.0 / (1.0 + np.exp(-cv_logits))
        ort_marks = ort_scores >= 0.2
        cv_marks = cv_scores >= 0.2
        active = np.any(ort_marks | cv_marks, axis=1)
        ort_boxes = baseline[output_names.index("dets")][0]
        cv_boxes = candidate[output_names.index("dets")][0]
        active_box_delta = (np.abs(ort_boxes[active] - cv_boxes[active])
                            if np.any(active) else np.empty((0, 4), dtype=np.float32))
        records.append({"frame_sha256": hashlib.sha256(frame.read_bytes()).hexdigest(),
                        "ort_ms": ort_ms, "opencv_ms": cv_ms, "outputs": metrics,
                        "ort_detection_count": int(np.count_nonzero(ort_marks)),
                        "opencv_detection_count": int(np.count_nonzero(cv_marks)),
                        "detection_marks_changed": int(np.count_nonzero(ort_marks != cv_marks)),
                        "active_box_max_abs": float(np.max(active_box_delta)) if active_box_delta.size else 0.0,
                        "score_max_abs": float(np.max(np.abs(ort_scores - cv_scores)))})
    payload = {"schema": "mk8dx.opencv5-dnn-spike.v1", "opencv": cv2.__version__,
               "onnxruntime": ort.__version__, "model_sha256": hashlib.sha256(model.read_bytes()).hexdigest(),
               "frames": records, "ort_load_ms": ort_load_ms, "opencv_load_ms": cv_load_ms,
               "ort_median_ms": statistics.median(item["ort_ms"] for item in records),
               "opencv_median_ms": statistics.median(item["opencv_ms"] for item in records),
               "rss_delta_mb": (process.memory_info().rss - initial_rss) / 1048576}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"frames={len(records)} ort_median_ms={payload['ort_median_ms']:.1f} "
          f"opencv_median_ms={payload['opencv_median_ms']:.1f} output={output}")


if __name__ == "__main__":
    main()
