"""Diff two read-only Android scan-debug dossiers by stage and JSON field.

Usage: python tooling/review/android_scan_dossier_diff.py <old> <new>
       --output <private report.json>
"""

from __future__ import annotations

import argparse
from hashlib import sha256
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def leaves(value: object, prefix: str = "") -> dict[str, object]:
    if isinstance(value, dict):
        return {key: item for name, child in value.items()
                for key, item in leaves(child, f"{prefix}.{name}" if prefix else name).items()}
    if isinstance(value, list):
        return {key: item for index, child in enumerate(value)
                for key, item in leaves(child, f"{prefix}[{index}]").items()}
    return {prefix: value}


def describe(root: Path) -> dict[str, Path]:
    return {path.relative_to(root).as_posix(): path for path in root.rglob("*") if path.is_file()}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("old", type=Path)
    parser.add_argument("new", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    destination = args.output.resolve()
    if destination == ROOT or ROOT in destination.parents:
        parser.error("report must be outside the repository")
    old_files, new_files = describe(args.old), describe(args.new)
    files = []
    for name in sorted(old_files.keys() | new_files.keys()):
        before, after = old_files.get(name), new_files.get(name)
        entry: dict[str, object] = {"file": name}
        if before is None or after is None:
            entry["kind"] = "missing_old" if before is None else "missing_new"
        else:
            prior, current = before.read_bytes(), after.read_bytes()
            if prior == current:
                continue
            entry["old_sha256"] = sha256(prior).hexdigest()
            entry["new_sha256"] = sha256(current).hexdigest()
            if name.endswith(".json"):
                left = leaves(json.loads(prior))
                right = leaves(json.loads(current))
                entry["fields"] = [
                    {"path": key, "old": left.get(key), "new": right.get(key)}
                    for key in sorted(left.keys() | right.keys()) if left.get(key) != right.get(key)
                ]
            else:
                entry["kind"] = "binary_difference"
        files.append(entry)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps({"schema": "mk8dx.android-dossier-diff.v1",
                                       "old": str(args.old), "new": str(args.new), "files": files},
                                      ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"different_files={len(files)} output={destination}")


if __name__ == "__main__":
    main()
