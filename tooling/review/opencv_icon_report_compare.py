"""Compare same-crop icon benchmark rows across two OpenCV environments.

Usage: python tooling/review/opencv_icon_report_compare.py old.json new.json
       --output <private report.json>
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FIELDS = ("top1", "id", "status", "score", "margin", "top3", "scoreArtControl")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("old", type=Path)
    parser.add_argument("new", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    destination = args.output.resolve()
    if destination == ROOT or ROOT in destination.parents:
        parser.error("output must stay outside the repository")
    before = json.loads(args.old.read_text(encoding="utf-8"))
    after = json.loads(args.new.read_text(encoding="utf-8"))
    old_rows = {row["caseId"]: row for row in before["rows"]}
    new_rows = {row["caseId"]: row for row in after["rows"]}
    differences = []
    counts: Counter[str] = Counter()
    for case in sorted(old_rows.keys() | new_rows.keys()):
        left, right = old_rows.get(case), new_rows.get(case)
        if left is None or right is None:
            differences.append({"caseId": case, "kind": "missing_row"})
            continue
        fields = []
        for name in FIELDS:
            if left.get(name) != right.get(name):
                counts[name] += 1
                fields.append({"field": name, "old": left.get(name), "new": right.get(name)})
        if fields:
            differences.append({"caseId": case, "family": left.get("family"), "fields": fields})
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps({"schema": "mk8dx.opencv-icon-report-comparison.v1",
                                       "old": str(args.old), "new": str(args.new),
                                       "row_count": len(old_rows), "field_difference_counts": dict(counts),
                                       "differences": differences}, ensure_ascii=False, indent=2) + "\n",
                           encoding="utf-8")
    print(f"rows={len(old_rows)} differences={len(differences)} fields={dict(counts)}")


if __name__ == "__main__":
    main()
