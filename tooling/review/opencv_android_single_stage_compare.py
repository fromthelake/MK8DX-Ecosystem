"""Compare two private Android OpenCV stage captures of the same saved case.

The output contains case hashes and stage names, never the source image. Timings
and runtime metadata are excluded from semantic JSON comparison.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def case_dir(root: Path) -> Path:
    paths = list(root.glob("opencv_ghost_stage_*"))
    if len(paths) != 1 or not paths[0].is_dir():
        raise ValueError("expected one Android ghost stage directory")
    return paths[0]


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def without_runtime(value):
    if isinstance(value, dict):
        return {key: without_runtime(item) for key, item in value.items()
                if not key.endswith("_ms") and key not in
                {"duration_ms", "elapsedMs", "ms", "elapsed_ms", "timestamp"}}
    if isinstance(value, list):
        return [without_runtime(item) for item in value]
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("old", type=Path)
    parser.add_argument("new", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error("output must stay outside Git")
    old, new = case_dir(args.old), case_dir(args.new)
    old_case, new_case = read(old / "case.json"), read(new / "case.json")
    if old_case["name_sha256"] != new_case["name_sha256"]:
        raise ValueError("different saved input cases")
    old_json = {path.name: without_runtime(read(path)) for path in old.glob("*.json")
                if path.name not in {"stage_png_sha256.json", "case.json"}}
    new_json = {path.name: without_runtime(read(path)) for path in new.glob("*.json")
                if path.name not in {"stage_png_sha256.json", "case.json"}}
    metadata_diffs = [name for name in sorted(old_json.keys() | new_json.keys())
                      if not re.match(r"\d{2}_", name) and old_json.get(name) != new_json.get(name)]
    json_diffs = [name for name in sorted(old_json.keys() | new_json.keys())
                  if re.match(r"\d{2}_", name)
                  if old_json.get(name) != new_json.get(name)]
    old_png, new_png = read(old / "stage_png_sha256.json"), read(new / "stage_png_sha256.json")
    png_diffs = [name for name in sorted(old_png.keys() | new_png.keys())
                 if old_png.get(name) != new_png.get(name)]
    report = {"schema": "mk8dx.opencv-android-single-stage-compare.v1",
              "source": old_case["source"], "name_sha256": old_case["name_sha256"],
              "status_old": old_case["status"], "status_new": new_case["status"],
              "first_json_difference": json_diffs[0] if json_diffs else None,
              "json_differences": json_diffs,
              "metadata_differences": metadata_diffs,
              "first_png_difference": png_diffs[0] if png_diffs else None,
              "png_differences": png_diffs}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print({key: report[key] for key in
           ("source", "status_old", "status_new", "first_json_difference", "first_png_difference")})


if __name__ == "__main__":
    main()
