"""Compare saved Web and Android staff-panel marks on the same private corpus.

Run separately with Android OpenCV 4 and 5. The change in disagreement count
measures whether the candidate moves closer to the unchanged Web scanner.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FIELDS = ("character", "kart", "wheel", "glider", "flag")


def mark(record: dict, owner: str, field: str) -> tuple[object, object]:
    item = ((record.get("owners") or {}).get(owner) or {}).get(field) or {}
    return item.get("id"), item.get("ok")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("web", type=Path)
    parser.add_argument("android", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error("output must stay outside Git")
    web = json.loads(args.web.read_text(encoding="utf-8"))
    android = json.loads(args.android.read_text(encoding="utf-8"))
    if not web or set(web) != set(android):
        raise ValueError("Web and Android case sets differ or are empty")
    summary = Counter()
    mismatches = []
    for case in sorted(web):
        left, right = web[case], android[case]
        source = case.rsplit("_", 1)[-1]
        summary[f"{source}_cases"] += 1
        if left.get("status") != right.get("status"):
            summary[f"{source}_status_differences"] += 1
        owners = set((left.get("owners") or {})) | set((right.get("owners") or {}))
        for owner in sorted(owners):
            for field in FIELDS:
                before, after = mark(left, owner, field), mark(right, owner, field)
                summary[f"{source}_field_pairs"] += 1
                if before != after:
                    summary[f"{source}_field_differences"] += 1
                    mismatches.append({"case": case, "owner": owner, "field": field,
                                       "web": before, "android": after})
    payload = {"schema": "mk8dx.opencv-web-android-parity.v1", "cases": len(web),
               "summary": dict(sorted(summary.items())), "mismatches": mismatches}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(payload["summary"])


if __name__ == "__main__":
    main()
