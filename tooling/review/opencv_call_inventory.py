"""Inventory explicit OpenCV Python calls without importing product modules.

Usage: python tooling/review/opencv_call_inventory.py --output <private JSON path>
The JSON preserves each call expression, arguments, flags and source location.
"""

from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCAN_ROOTS = ("apps", "packages", "tooling")


def chain(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        prefix = chain(node.value)
        return f"{prefix}.{node.attr}" if prefix else None
    return None


def inventory(path: Path) -> list[dict[str, object]]:
    source = path.read_text(encoding="utf-8-sig")
    try:
        tree = ast.parse(source, filename=str(path))
    except SyntaxError:
        return []
    aliases = {
        alias.asname or alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
        if alias.name == "cv2"
    }
    if not aliases:
        return []
    relative = path.relative_to(ROOT).as_posix()
    category = "tooling" if relative.startswith("tooling/") else "product"
    records = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        function = chain(node.func)
        if not function or function.split(".", 1)[0] not in aliases:
            continue
        flags = sorted({
            value for item in ast.walk(node)
            if (value := chain(item)) is not None
            and value.split(".", 1)[0] in aliases
            and value != function
        })
        records.append({
            "category": category,
            "file": relative,
            "line": node.lineno,
            "function": function,
            "arguments": [ast.unparse(argument) for argument in node.args],
            "keywords": {keyword.arg or "**": ast.unparse(keyword.value) for keyword in node.keywords},
            "opencv_constants_in_call": flags,
            "expression": ast.unparse(node),
        })
    return records


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    records: list[dict[str, object]] = []
    for directory in SCAN_ROOTS:
        for path in (ROOT / directory).rglob("*.py"):
            if any(part in {"build", "dist", ".venv", "node_modules", "__pycache__"} for part in path.parts):
                continue
            records.extend(inventory(path))
    records.sort(key=lambda record: (record["file"], record["line"]))
    payload = {"schema": "mk8dx.opencv-python-call-inventory.v1", "root": str(ROOT), "calls": records}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"calls={len(records)} files={len({record['file'] for record in records})} output={args.output}")


if __name__ == "__main__":
    main()
