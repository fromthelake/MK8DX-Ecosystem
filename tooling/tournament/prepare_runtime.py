"""Prepare a Tournament runtime from the bundled internal collection."""
from __future__ import annotations

import argparse
import json
import os
import stat
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MATERIALIZER = REPO / "tooling/assets/materialize_collection.mjs"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, help="new absolute runtime directory")
    parser.add_argument("--role", required=True, choices=("live", "recorded"))
    args = parser.parse_args()
    output = Path(args.output)
    if not output.is_absolute() or output.exists() or output == REPO or REPO in output.parents:
        raise SystemExit("runtime output must be a new absolute directory outside repository")
    if REPO.resolve(strict=True) != REPO:
        raise SystemExit("repository boundary changed")
    cursor = Path(output.anchor)
    for part in output.parts[1:]:
        cursor /= part
        if cursor.exists():
            info = cursor.lstat()
            if cursor.is_symlink() or getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
                raise SystemExit("reparse output path")
    output.mkdir(parents=True)
    group = "legacy-live" if args.role == "live" else "tournament"
    for selection, destination in ((group, output), ("schema9", output / "clean-assets"),
                                   ("ocr-models", output / "ocr-models"),
                                   ("tournament-text", output)):
        subprocess.run(["node", str(MATERIALIZER), selection, str(destination)],
                       cwd=REPO, check=True, env=os.environ.copy())
    receipt = {"role": args.role, "collectionGroup": group,
               "environment": {
                   "MK8DX_TOURNAMENT_RUNTIME_ROOT": str(output),
                   "MK8DX_TOURNAMENT_LIVE_ROOT": str(output),
                   "MK8DX_TOURNAMENT_ASSETS_ROOT": str(output / "assets"),
                   "MK8DX_TOURNAMENT_REFERENCE_ROOT": str(output),
                   "MK8_CLEAN_ASSETS_ROOT": str(output / "clean-assets"),
                   "EASYOCR_MODULE_PATH": str(output / "ocr-models")}}
    (output / "runtime-config.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"role": args.role, "collectionGroup": group,
                      "prepared": True}))


if __name__ == "__main__":
    main()
