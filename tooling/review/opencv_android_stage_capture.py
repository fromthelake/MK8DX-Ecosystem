"""Capture opt-in Android OpenCV QA stages from an allowlisted disposable AVD.

Build ``:scan-runtime:assembleDebugAndroidTest`` with the staged private pack
first. The APK, input corpus and all extracted outputs stay outside Git.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import subprocess
import tarfile
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PACKAGE = "nl.mariokart8.mk8dxtimetrials.scanruntime.test"
RUNNER = f"{PACKAGE}/androidx.test.runner.AndroidJUnitRunner"
TEST = "nl.mariokart8.mk8dxtimetrials.scanruntime.OpenCvQualificationMetricsTest"
QA_AVDS = {"Codex_AGP95_PostV010_API36_1", "Vivo_X200_Pro_API36"}


def adb(serial: str, *parts: str, text: bool = True) -> str | bytes:
    completed = subprocess.run(["adb", "-s", serial, *parts], check=True,
                               capture_output=True, text=text)
    return completed.stdout


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--avd", choices=sorted(QA_AVDS), required=True)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--source", choices=("phone", "hdmi", "webcam", "frames"), required=True)
    parser.add_argument("--labelled", type=Path, help="stage the first matching private labelled image")
    parser.add_argument("--case-name", help="select an exact case from --labelled")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error("output must stay outside Git")
    if output.exists():
        parser.error("output must be new")
    avd = str(adb(args.serial, "emu", "avd", "name")).splitlines()
    if not avd or avd[0].strip() != args.avd:
        parser.error("serial is not the named disposable QA AVD")
    apk = args.apk.resolve(strict=True)
    if not apk.name.endswith("-androidTest.apk"):
        parser.error("expected the scan-runtime Android test APK")
    adb(args.serial, "install", "-r", str(apk))
    if args.labelled:
        if args.source == "frames":
            parser.error("--labelled is for a ghost image source")
        labelled = json.loads(args.labelled.resolve(strict=True).read_text(encoding="utf-8"))
        if args.case_name and not args.case_name.endswith(f"_{args.source}"):
            parser.error("--case-name must match --source")
        entry = next(item for item in labelled["entries"]
                     if item["name"] == args.case_name or
                     not args.case_name and item["name"].endswith(f"_{args.source}"))
        source = Path(entry["path"]).resolve(strict=True)
        if source == ROOT or ROOT in source.parents:
            parser.error("labelled input must remain outside Git")
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        if digest != entry["sha256"]:
            parser.error("labelled input hash mismatch")
        file_name = entry["name"] + source.suffix.lower()
        device_root = "/data/local/tmp/mk8-ghost-select"
        adb(args.serial, "shell", "mkdir", "-p", device_root)
        adb(args.serial, "push", str(source), f"{device_root}/{file_name}")
        index = [{"name": entry["name"], "file": file_name, "sha256": digest}]
        with tempfile.TemporaryDirectory() as temporary:
            index_path = Path(temporary) / "index.json"
            index_path.write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
            adb(args.serial, "push", str(index_path), f"{device_root}/index.json")
        adb(args.serial, "shell", "chmod", "-R", "a+rX", device_root)
    adb(args.serial, "logcat", "-c")
    method = "captureAllPinnedFrameMetrics" if args.source == "frames" else "captureOneGhostPhotoStage"
    result = str(adb(args.serial, "shell", "am", "instrument", "-w", "-e", "class",
                     f"{TEST}#{method}", "-e", "opencv.source", args.source, RUNNER))
    if "OK (1 test)" not in result:
        raise RuntimeError("Android qualification instrumentation failed; inspect device logcat")
    log = str(adb(args.serial, "logcat", "-d", "-s", "MK8Cv5QA:I"))
    roots = re.findall(r"root=(/data/user/0/[^\s]+)", log)
    if not roots:
        raise RuntimeError("Android qualification root was not logged")
    prefix = f"/data/user/0/{PACKAGE}/cache/"
    root = roots[-1]
    leaf = root.removeprefix(prefix)
    if not root.startswith(prefix) or not re.fullmatch(r"opencv_(?:ghost_stage_(?:phone|hdmi|webcam)|qualification)_[0-9]+", leaf):
        raise RuntimeError("unexpected Android qualification root")
    archive = adb(args.serial, "exec-out", "run-as", PACKAGE,
                  "tar", "-cf", "-", "-C", "cache", leaf, text=False)
    assert isinstance(archive, bytes)
    output.mkdir(parents=True)
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as tar:
        members = tar.getmembers()
        if any(member.name != leaf and not member.name.startswith(f"{leaf}/")
               or not member.isfile() and not member.isdir() for member in members):
            raise RuntimeError("unexpected Android qualification archive entry")
        tar.extractall(output, filter="data")
    summary = {"schema": "mk8dx.opencv-android-stage-capture.v1", "source": args.source,
               "avd": args.avd, "files": sum(path.is_file() for path in output.rglob("*")),
               "root": leaf}
    (output / "capture.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print({key: summary[key] for key in ("source", "files", "root")})


if __name__ == "__main__":
    main()
