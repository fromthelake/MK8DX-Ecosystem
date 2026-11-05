"""Compare two opencv_step_trace JSONL runs and sampled result arrays.

Usage: python tooling/review/opencv_trace_compare.py old.jsonl new.jsonl
       --output <private report.json> --diff-dir <private directory>
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[2]


def read_trace(path: Path) -> tuple[dict, list[dict]]:
    with path.open(encoding="utf-8") as stream:
        header = json.loads(next(stream))
        calls = [json.loads(line) for line in stream]
    return header, calls


def metrics(old: np.ndarray, new: np.ndarray) -> dict:
    if old.shape != new.shape or old.dtype != new.dtype:
        return {"comparable": False}
    difference = np.abs(old.astype(np.float64) - new.astype(np.float64))
    changed = np.count_nonzero(difference)
    mean_squared = float(np.mean(difference * difference)) if difference.size else 0.0
    if np.issubdtype(old.dtype, np.integer):
        peak = float(np.iinfo(old.dtype).max)
    else:
        peak = max(1.0, float(np.max(np.abs(old))) if old.size else 1.0,
                   float(np.max(np.abs(new))) if new.size else 1.0)
    psnr = "infinite" if mean_squared == 0 else 20 * math.log10(peak / math.sqrt(mean_squared))
    return {"comparable": True, "max_abs": float(np.max(difference)) if difference.size else 0.0,
            "mean_abs": float(np.mean(difference)) if difference.size else 0.0,
            "changed_percent": 100 * changed / difference.size if difference.size else 0.0,
            "psnr_db": psnr, "peak": peak}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("old", type=Path)
    parser.add_argument("new", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--diff-dir", type=Path, required=True)
    args = parser.parse_args()
    for path in (args.output, args.diff_dir):
        resolved = path.resolve()
        if resolved == ROOT or ROOT in resolved.parents:
            parser.error("comparison outputs must stay outside the repository")
    old_head, old_calls = read_trace(args.old)
    new_head, new_calls = read_trace(args.new)
    def key(item):
        site = item["site"]
        if "/site-packages/" in site:
            site = "site-packages/" + site.split("/site-packages/", 1)[1]
        return site, item["ordinal"]

    old_by_key = {key(item): item for item in old_calls}
    new_by_key = {key(item): item for item in new_calls}
    args.diff_dir.mkdir(parents=True, exist_ok=True)
    differences = []
    for key, old in old_by_key.items():
        new = new_by_key.get(key)
        if new is None:
            differences.append({"site": key[0], "ordinal": key[1], "kind": "missing_new_call"})
            continue
        if old["result"] == new["result"]:
            continue
        record = {"site": key[0], "ordinal": key[1], "function": old["function"],
                  "old_result": old["result"], "new_result": new["result"],
                  "same_inputs": old["inputs"] == new["inputs"] and old["keywords"] == new["keywords"],
                  "old_elapsed_ns": old["elapsed_ns"], "new_elapsed_ns": new["elapsed_ns"]}
        if old.get("snapshot") and new.get("snapshot"):
            left = np.load(args.old.with_suffix(".arrays") / old["snapshot"], allow_pickle=False)
            right = np.load(args.new.with_suffix(".arrays") / new["snapshot"], allow_pickle=False)
            record["pixels"] = metrics(left, right)
            if record["pixels"]["comparable"] and left.ndim in {2, 3}:
                diff = np.abs(left.astype(np.float64) - right.astype(np.float64))
                top = float(np.max(diff)) if diff.size else 0.0
                display = np.uint8(np.clip(diff * (255 / top), 0, 255)) if top else np.zeros(left.shape, np.uint8)
                name = f"{old['function']}-{len(differences):04d}.png"
                cv2.imwrite(str(args.diff_dir / name), display)
                record["difference_image"] = name
        differences.append(record)
    for key in new_by_key.keys() - old_by_key.keys():
        differences.append({"site": key[0], "ordinal": key[1], "kind": "new_call"})
    report = {"schema": "mk8dx.opencv-step-comparison.v1", "old": old_head, "new": new_head,
              "old_calls": len(old_calls), "new_calls": len(new_calls),
              "differences": differences}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"old_calls={len(old_calls)} new_calls={len(new_calls)} differences={len(differences)} output={args.output}")


if __name__ == "__main__":
    main()
