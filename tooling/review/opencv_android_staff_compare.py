"""Compare per-item Android staff-panel decisions and raw visual metrics.

The inputs are private central_regression *-shared-run.json reports made from
the same labelled corpus/source revision. Outputs stay outside Git. Threshold
distances are shown as diagnostics; the actual decision basis must be checked
in GhostPanel before interpreting a crossing.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
METRICS = ("score", "margin", "ratio")


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("old", type=Path)
    parser.add_argument("new", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error("output must stay outside Git")
    old = json.loads(args.old.read_text(encoding="utf-8"))
    new = json.loads(args.new.read_text(encoding="utf-8"))
    if not old or set(old) != set(new):
        raise ValueError("different or empty case sets")
    records = []
    summary = Counter()
    for case in sorted(old):
        before, after = old[case], new[case]
        source = case.rsplit("_", 1)[-1]
        summary[f"{source}_cases"] += 1
        fields_equal = before.get("fields") == after.get("fields")
        if not fields_equal:
            summary[f"{source}_time_or_field_differences"] += 1
        pairs = []
        owners = set(before.get("owners", {})) | set(after.get("owners", {}))
        for owner in sorted(owners):
            left_fields = before.get("owners", {}).get(owner, {})
            right_fields = after.get("owners", {}).get(owner, {})
            for field in sorted(set(left_fields) | set(right_fields)):
                left, right = left_fields.get(field, {}), right_fields.get(field, {})
                marker_equal = (left.get("id"), left.get("ok")) == (right.get("id"), right.get("ok"))
                if not marker_equal:
                    summary[f"{source}_marker_differences"] += 1
                metrics = {}
                for key in METRICS:
                    a, b = left.get(key), right.get(key)
                    metrics[key] = {"old": a, "new": b, "delta": b - a if number(a) and number(b) else None}
                    if number(a) and number(b) and a != b:
                        summary[f"{source}_{key}_differences"] += 1
                for limit in (0.02, 0.35, 0.80):
                    key = "margin" if limit == 0.02 else "score"
                    a, b = left.get(key), right.get(key)
                    metrics[f"{key}_to_{limit}"] = {
                        "old": a - limit if number(a) else None,
                        "new": b - limit if number(b) else None,
                        "diagnostic_only": True,
                    }
                pairs.append({"owner": owner, "field": field, "marker_equal": marker_equal,
                              "old": {key: left.get(key) for key in ("id", "ok")},
                              "new": {key: right.get(key) for key in ("id", "ok")},
                              "metrics": metrics})
        records.append({"case": case, "source": source, "status_equal": before.get("status") == after.get("status"),
                        "fields_equal": fields_equal, "pairs": pairs})
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"schema": "mk8dx.opencv-android-staff-compare.v1",
                                  "cases": len(records), "summary": dict(sorted(summary.items())),
                                  "records": records}, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(dict(sorted(summary.items())))


if __name__ == "__main__":
    main()
