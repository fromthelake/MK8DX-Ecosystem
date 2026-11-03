"""Prepare a LiveTrial engine tree using only this repository's collection."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import stat
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SOURCE = REPO / "apps/timetrials-desktop/vision-runtime/livetrial"
MATERIALIZER = REPO / "tooling/assets/materialize_collection.mjs"


def no_reparse(path: Path, root: Path) -> None:
    current = root
    for part in path.relative_to(root).parts:
        current /= part
        if current.exists():
            details = current.lstat()
            if current.is_symlink() or getattr(details, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
                raise ValueError("reparse path")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, help="new absolute engine directory")
    arguments = parser.parse_args()
    output = Path(arguments.output)
    if not output.is_absolute() or output.exists() or REPO == output or REPO in output.parents:
        raise SystemExit("output must be a new absolute directory outside the repository")
    if REPO.resolve(strict=True) != REPO or SOURCE.resolve(strict=True) != SOURCE:
        raise SystemExit("repository boundary changed")
    for parent in [output.parent, *output.parents]:
        if parent.exists():
            no_reparse(parent, parent.anchor and Path(parent.anchor) or parent)
    for path in SOURCE.rglob("*"):
        no_reparse(path, REPO)
        if path.is_file() and path.suffix.lower() in {".png", ".jpg", ".jpeg", ".mp4"}:
            raise SystemExit("engine source contains an uncollected binary")
    output.mkdir(parents=True)
    shutil.copytree(SOURCE, output / "livetrial", dirs_exist_ok=True)
    for group, dest in (("livetrial-runtime", output / "livetrial"),
                        ("schema9", output / "MK8DX Clean Assets"),
                        ("ocr-models", output / "ocr-models")):
        subprocess.run(["node", str(MATERIALIZER), group, str(dest)],
                       cwd=REPO, check=True, env=os.environ.copy())
    # The shared field reader the engine imports (packages/icon-matcher) and, from the central recognition pack,
    # the card anchors, the Time Trial frame geometry and the pack record (central_versions.py reads it).
    shutil.copytree(REPO / "packages/icon-matcher/python/mk8dx_icon_matcher", output / "livetrial/mk8dx_icon_matcher",
                    ignore=shutil.ignore_patterns("__pycache__"), dirs_exist_ok=True)
    pack = output / "recognition-pack"
    subprocess.run(["node", str(MATERIALIZER), "recognition-pack", str(pack)], cwd=REPO, check=True,
                   env=os.environ.copy())
    manifest = json.loads((pack / "manifest.json").read_text(encoding="utf-8"))
    for name in ("card-anchors-v1.json", "frame-definitions-v1.json"):
        shutil.copy2(pack / name, output / name)
    (output / "recognition-pack.json").write_text(json.dumps({
        "schema": "mk8dx.staged-recognition-pack.v1", "packId": manifest["packId"],
        "fieldSemanticsVersion": manifest["fieldSemanticsVersion"], "catalogSha256": manifest["catalogSha256"],
    }) + "\n", encoding="utf-8")
    shutil.rmtree(pack)
    print(f"prepared engine: {output}")


if __name__ == "__main__":
    main()
