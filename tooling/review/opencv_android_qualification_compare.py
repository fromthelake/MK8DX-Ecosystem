"""Compare QA-only Android stage snapshots from OpenCV 4 and 5.

Each input directory is the adb-pulled cache root produced by the opt-in
instrumented qualification tests. Output stays outside Git and uses case
ordinals, hashes, decisions and numeric metrics rather than source images.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
STAGES = ("01_auto_card_roi.json", "12_hough_lines.json", "15_quad_select.json",
          "17_perspective_warp_geometry.json", "19_rfdetr_3class_detect.json",
          "20_rfdetr_lap_index_refine.json", "21_dynamic_lap_grid.json",
          "26_ocr_result_slot_details.json", "27_kart_config.json")


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


def without_timing(value):
    if isinstance(value, dict):
        return {key: without_timing(item) for key, item in value.items()
                if not key.endswith("_ms") and "timing" not in key.lower()
                and key not in {"duration_ms", "elapsedMs", "ms"}}
    if isinstance(value, list):
        return [without_timing(item) for item in value]
    return value


def markers(row: Path):
    config = read(row / "27_kart_config.json") or {}
    owners = {}
    for owner, fields in (config.get("owners") or {}).items():
        owners[owner] = {field: {key: value.get(key) for key in ("id", "index", "ok")}
                         for field, value in fields.items() if isinstance(value, dict)}
    ocr = read(row / "26_ocr_result_slot_details.json") or {}
    values = {field.get("field_name"): (field.get("decoded_value"), field.get("valid_format"))
              for field in ocr.get("fields", [])}
    return {"case": read(row / "case.json"), "owners": owners, "ocr": values}


def thresholds(row: Path):
    config = read(row / "27_kart_config.json") or {}
    out = {}
    for owner, fields in (config.get("owners") or {}).items():
        for field, value in fields.items():
            if not isinstance(value, dict):
                continue
            for key, threshold in (("score", 0.35 if field == "wheel" else 0.62),
                                   ("margin", 0.02)):
                metric = value.get(key)
                if isinstance(metric, (float, int)) and not isinstance(metric, bool):
                    out[f"{owner}.{field}.{key}"] = {"value": float(metric),
                                                      "threshold": threshold,
                                                      "distance": float(metric) - threshold}
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("old", type=Path)
    parser.add_argument("new", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error("output must stay outside Git")
    old_rows = {path.name: path for path in args.old.iterdir() if path.is_dir() and path.name.isdigit()}
    new_rows = {path.name: path for path in args.new.iterdir() if path.is_dir() and path.name.isdigit()}
    if not old_rows or set(old_rows) != set(new_rows):
        raise ValueError("different or empty case sets")
    records = []
    for ordinal in sorted(old_rows):
        old, new = old_rows[ordinal], new_rows[ordinal]
        before, after = read(old / "case.json"), read(new / "case.json")
        if before.get("name_sha256") != after.get("name_sha256"):
            raise ValueError(f"different source item at {ordinal}")
        images_old = read(old / "stage_png_sha256.json") or {}
        images_new = read(new / "stage_png_sha256.json") or {}
        first_png = next((name for name in sorted(images_old)
                          if name in images_new and images_old[name] != images_new[name]), None)
        stage_diffs = [name for name in STAGES
                       if without_timing(read(old / name)) != without_timing(read(new / name))]
        old_marks, new_marks = markers(old), markers(new)
        old_metrics, new_metrics = thresholds(old), thresholds(new)
        shrink = {}
        crossing = []
        for key in old_metrics.keys() & new_metrics.keys():
            a, b = old_metrics[key], new_metrics[key]
            if (a["distance"] >= 0) != (b["distance"] >= 0):
                crossing.append(key)
            if a["distance"] != 0:
                shrink[key] = (abs(a["distance"]) - abs(b["distance"])) / abs(a["distance"])
        records.append({"ordinal": ordinal, "name_sha256": before["name_sha256"],
                        "decision_markers_equal": old_marks == new_marks,
                        "first_png_difference": first_png,
                        "stage_json_differences": stage_diffs,
                        "threshold_crossings": sorted(crossing),
                        "maximum_threshold_shrink": max(shrink.values(), default=None),
                        "over_ten_percent_shrink": sorted(k for k, v in shrink.items() if v > 0.1),
                        "old_metrics": old_metrics, "new_metrics": new_metrics})
    report = {"schema": "mk8dx.opencv-android-qualification-compare.v1",
              "cases": len(records),
              "decision_marker_differences": sum(not item["decision_markers_equal"] for item in records),
              "threshold_crossings": sum(len(item["threshold_crossings"]) for item in records),
              "over_ten_percent_shrink": sum(len(item["over_ten_percent_shrink"]) for item in records),
              "records": records}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print({key: report[key] for key in ("cases", "decision_marker_differences",
                                        "threshold_crossings", "over_ten_percent_shrink")})


if __name__ == "__main__":
    main()
