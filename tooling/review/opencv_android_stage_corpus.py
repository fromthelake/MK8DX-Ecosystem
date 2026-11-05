"""Stage one hash-pinned private Android QA corpus with bounded adb retries.

The source images stay outside Git; only the disposable AVD receives copies.
Run central_regression's matching Android gate afterward: its exact index check
then reuses this staged corpus instead of pushing the images a second time.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEVICE_ROOT = "/data/local/tmp/mk8-ghost-select"
QA_AVDS = {"Codex_AGP95_PostV010_API36_1", "Vivo_X200_Pro_API36"}


def adb(serial: str, *parts: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["adb", "-s", serial, *parts], capture_output=True, text=True)


def push(serial: str, source: Path, destination: str, ordinal: int) -> None:
    for attempt in range(5):
        result = adb(serial, "push", str(source), destination)
        if result.returncode == 0:
            return
        time.sleep(attempt + 1)
    raise RuntimeError(f"adb push failed for QA corpus item {ordinal} after five attempts")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--avd", choices=sorted(QA_AVDS), required=True)
    parser.add_argument("--labelled", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error("output must stay outside Git")
    if output.exists():
        parser.error("output must be a new file")
    actual = adb(args.serial, "emu", "avd", "name")
    if actual.returncode or not actual.stdout.splitlines() or actual.stdout.splitlines()[0].strip() != args.avd:
        parser.error("serial is not the specified disposable QA AVD")
    labelled = json.loads(args.labelled.resolve(strict=True).read_text(encoding="utf-8"))
    rows = []
    for ordinal, entry in enumerate(labelled["entries"], start=1):
        source = Path(entry["path"]).resolve(strict=True)
        if source == ROOT or ROOT in source.parents:
            parser.error("input image must remain outside Git")
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        if digest != entry["sha256"]:
            raise ValueError(f"source hash mismatch at item {ordinal}")
        rows.append({"name": entry["name"], "file": entry["name"] + source.suffix.lower(),
                     "sha256": digest, "source": source})
    if adb(args.serial, "shell", "mkdir", "-p", DEVICE_ROOT).returncode:
        raise RuntimeError("could not create disposable AVD corpus directory")
    for ordinal, row in enumerate(rows, start=1):
        push(args.serial, row["source"], f"{DEVICE_ROOT}/{row['file']}", ordinal)
    index = [{key: row[key] for key in ("name", "file", "sha256")} for row in rows]
    index_text = json.dumps(index, separators=(",", ":"))
    with tempfile.TemporaryDirectory() as temp:
        path = Path(temp) / "index.json"
        path.write_text(index_text, encoding="utf-8")
        push(args.serial, path, f"{DEVICE_ROOT}/index.json", len(rows) + 1)
    if adb(args.serial, "shell", "chmod", "-R", "a+rX", DEVICE_ROOT).returncode:
        raise RuntimeError("could not set AVD corpus read permission")
    if adb(args.serial, "shell", "cat", f"{DEVICE_ROOT}/index.json").stdout.strip() != index_text:
        raise RuntimeError("AVD corpus index did not round-trip")
    report = {"schema": "mk8dx.opencv-android-staged-corpus.v1", "avd": args.avd,
              "cases": len(rows), "index_sha256": hashlib.sha256(index_text.encode()).hexdigest()}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
