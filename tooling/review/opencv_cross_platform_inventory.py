"""Inventory OpenCV call sites in the Web scanner and Android runtime.

This is a source inventory, not a parser or an execution trace. It records the
full balanced argument text (including flags) for review alongside the Python
AST inventory; generated sources, tests and the bundled OpenCV.js are excluded.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCES = (
    ("web", ROOT / "apps/timetrials-scanner-web/src", "*.ts",
     re.compile(r"\b(?:c|cv)\.([A-Za-z]\w*)\s*\(")),
    ("android", ROOT / "apps/timetrials-android/scan-runtime/engine-overlay/java", "*.java",
     re.compile(r"\b(Imgproc|Core|Geometry|Calib3d|Photo|Video|Dnn|Imgcodecs)\.([A-Za-z]\w*)\s*\(")),
    ("android", ROOT / "apps/timetrials-android/scan-runtime/src/main/java", "*.java",
     re.compile(r"\b(Imgproc|Core|Geometry|Calib3d|Photo|Video|Dnn|Imgcodecs)\.([A-Za-z]\w*)\s*\(")),
    ("android-image", ROOT / "apps/timetrials-android/scan-runtime/engine-overlay/java", "*.java",
     re.compile(r"\b(BitmapFactory|Bitmap|Canvas|ColorMatrix|Matrix|ExifInterface|ImageDecoder)\.([A-Za-z]\w*)\s*\(")),
    ("android-image", ROOT / "apps/timetrials-android/scan-runtime/src/main/java", "*.java",
     re.compile(r"\b(BitmapFactory|Bitmap|Canvas|ColorMatrix|Matrix|ExifInterface|ImageDecoder)\.([A-Za-z]\w*)\s*\(")),
    ("android-image", ROOT / "apps/timetrials-android/app/src/main/java", "*.kt",
     re.compile(r"\b(BitmapFactory|Bitmap|Canvas|ColorMatrix|Matrix|ExifInterface|ImageDecoder)\.([A-Za-z]\w*)\s*\(")),
    ("android-image", ROOT / "apps/timetrials-android/scan-runtime/src/main/java", "*.kt",
     re.compile(r"\b(BitmapFactory|Bitmap|Canvas|ColorMatrix|Matrix|ExifInterface|ImageDecoder)\.([A-Za-z]\w*)\s*\(")),
)

# `c` is also used for a Canvas or string in a few scanner files. These calls
# are not OpenCV.js even though they match the intentionally broad alias scan.
NON_OPENCV_WEB_CALLS = {"getContext", "charCodeAt", "convertToBlob", "split"}


def arguments(source: str, start: int) -> str:
    """Return balanced argument text, ignoring delimiters inside string literals."""
    depth = 1
    quote = ""
    escaped = False
    pos = start
    while pos < len(source):
        char = source[pos]
        pos += 1
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = ""
        elif char in "\"'`":
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return source[start:pos - 1].strip()
    return source[start:].strip()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error("inventory output must stay outside the repository")
    calls = []
    for platform, directory, suffix, pattern in SOURCES:
        for file in sorted(directory.rglob(suffix)):
            if file.name.endswith(".generated.ts") or "/src/test/" in file.as_posix():
                continue
            source = file.read_text(encoding="utf-8")
            for match in pattern.finditer(source):
                # Ignore matches in line comments; callers can inspect the saved site.
                line_start = source.rfind("\n", 0, match.start()) + 1
                if "//" in source[line_start:match.start()]:
                    continue
                if platform == "web" and match.group(1) in NON_OPENCV_WEB_CALLS:
                    continue
                calls.append({
                    "platform": platform,
                    "path": file.relative_to(ROOT).as_posix(),
                    "line": source.count("\n", 0, match.start()) + 1,
                    "function": ".".join(part for part in match.groups() if part),
                    "arguments": arguments(source, match.end()),
                })
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"schema": "mk8dx.opencv-cross-platform-call-inventory.v1",
                                  "calls": calls}, indent=2) + "\n", encoding="utf-8")
    print(f"calls={len(calls)} output={output}")


if __name__ == "__main__":
    main()
