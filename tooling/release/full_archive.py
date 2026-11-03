"""Build a complete, hydrated repository archive from the clean Git candidate."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import subprocess
import zipfile
from pathlib import Path, PurePosixPath

REPO = Path(__file__).resolve().parents[2]
COLLECTION = REPO / "packages/assets/collection/collection-manifest.v1.json"


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", "-C", str(REPO), *args],
                                   stderr=subprocess.PIPE)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    output = arguments.output
    if not output.is_absolute() or output.suffix.lower() != ".zip" or output.exists():
        raise SystemExit("output must be a new absolute ZIP path")
    if REPO.resolve(strict=True) != REPO or output.resolve().is_relative_to(REPO):
        raise SystemExit("repository boundary changed")
    for parent in output.parents:
        if parent.exists() and (parent.is_symlink() or getattr(parent.lstat(), "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)):
            raise SystemExit("reparse output parent")
    if git("status", "--porcelain"):
        raise SystemExit("repository must be committed and clean")
    paths = sorted(path.decode("utf-8") for path in git("ls-files", "-z").split(b"\0") if path)
    if not paths:
        raise SystemExit("empty repository")
    manifest = json.loads(COLLECTION.read_text(encoding="utf-8"))
    entries = []
    for name in paths:
        posix = PurePosixPath(name)
        if posix.is_absolute() or ".." in posix.parts or name != posix.as_posix():
            raise SystemExit("unsafe Git path")
        path = REPO / name
        if not path.is_file() or path.is_symlink() or getattr(path.lstat(), "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
            raise SystemExit(f"missing or linked tracked file: {name}")
        entries.append({"path": name, "sizeBytes": path.stat().st_size, "sha256": digest(path)})
    for logical, item in manifest["files"].items():
        sha = item["sha256"]
        obj_name = f"packages/assets/collection/objects/{sha[:2]}/{sha}"
        if any(entry["path"] == obj_name and entry["sha256"] == sha and entry["sizeBytes"] == item["sizeBytes"] for entry in entries):
            continue
        # An object over the GitHub file limit is tracked as `<sha>.partN`; the archive carries the parts.
        parts = sorted((entry for entry in entries if entry["path"].startswith(f"{obj_name}.part")),
                       key=lambda entry: int(entry["path"].rsplit(".part", 1)[1]))
        joined = hashlib.sha256()
        for entry in parts:
            joined.update((REPO / entry["path"]).read_bytes())
        if not parts or joined.hexdigest() != sha:
            raise SystemExit(f"untracked collection object: {logical}")
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED,
                             compresslevel=6, allowZip64=True) as archive:
            for entry in entries:
                archive.write(REPO / entry["path"], f"repository/{entry['path']}")
        receipt = {
            "schemaVersion": "mk8dx.full-local-source-release.v1",
            "publicationStatus": "release",
            "repositoryHead": git("rev-parse", "HEAD").decode().strip(),
            "collectionVersion": manifest["releaseVersion"],
            "collectionLogicalFiles": len(manifest["files"]),
            "trackedFiles": len(entries),
            "archiveName": output.name,
            "archiveSizeBytes": output.stat().st_size,
            "archiveSha256": digest(output),
            "files": entries,
        }
        sidecar = output.with_suffix(".manifest.json")
        sidecar.write_text(json.dumps(receipt, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    except Exception:
        output.unlink(missing_ok=True)
        raise
    print(json.dumps({key: receipt[key] for key in (
        "repositoryHead", "collectionVersion", "collectionLogicalFiles",
        "trackedFiles", "archiveSizeBytes", "archiveSha256")}, indent=2))


if __name__ == "__main__":
    main()
