"""Compare two private LiveTrial Select-a-Ghost runs without exporting labels."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def numeric(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def metric(item: dict, name: str):
    raw = item.get("raw" + name.capitalize())
    if numeric(raw):
        return float(raw), "raw"
    ranked = item.get("rankedScores") or []
    if name == "score" and ranked and numeric(ranked[0]):
        return float(ranked[0]), "ranked"
    if name == "margin" and len(ranked) >= 2 and all(numeric(v) for v in ranked[:2]):
        return float(ranked[0] - ranked[1]), "ranked"
    value = item.get(name)
    return (float(value), "rounded") if numeric(value) else (None, "missing")


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
    if set(old) != set(new):
        raise ValueError("different case sets")
    records = []
    decisions_changed = 0
    markers_changed = 0
    for case in old:
        before, after = old[case], new[case]
        decision_keys = ("status", "state", "totalMs")
        if any(before.get(key) != after.get(key) for key in decision_keys):
            decisions_changed += 1
        for owner, fields in before.get("owners", {}).items():
            for field, left in fields.items():
                right = after.get("owners", {}).get(owner, {}).get(field, {})
                if (left.get("id"), left.get("ok")) != (right.get("id"), right.get("ok")):
                    markers_changed += 1
                for name, threshold in (("score", 0.65), ("margin", 0.02)):
                    a, source_a = metric(left, name)
                    b, source_b = metric(right, name)
                    if a is None or b is None:
                        continue
                    distance_old = a - threshold
                    distance_new = b - threshold
                    shrink = ((abs(distance_old) - abs(distance_new)) / abs(distance_old)
                              if distance_old != 0 else None)
                    records.append({"case": case, "owner": owner, "field": field,
                                    "metric": name, "old": a, "new": b,
                                    "source_old": source_a, "source_new": source_b,
                                    "threshold": threshold,
                                    "crossed": (distance_old >= 0) != (distance_new >= 0),
                                    "old_distance": distance_old,
                                    "new_distance": distance_new, "shrink": shrink})
    positive = [item for item in records if item["shrink"] is not None]
    worst = sorted(positive, key=lambda item: item["shrink"], reverse=True)[:20]
    report = {"schema": "mk8dx.opencv-ghost-metric-compare.v1", "cases": len(old),
              "decisions_changed": decisions_changed, "markers_changed": markers_changed,
              "metric_values": len(records),
              "ranked_metric_values": sum(item["source_old"] == "ranked" and item["source_new"] == "ranked"
                                          for item in records),
              "threshold_crossings": sum(item["crossed"] for item in records),
              "crossings": [item for item in records if item["crossed"]],
              "over_ten_percent_shrink": sum(item["shrink"] is not None and item["shrink"] > 0.1
                                             for item in records),
              "worst": worst}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print({key: report[key] for key in ("cases", "decisions_changed", "markers_changed",
                                        "metric_values", "ranked_metric_values",
                                        "threshold_crossings", "over_ten_percent_shrink")})


if __name__ == "__main__":
    main()
