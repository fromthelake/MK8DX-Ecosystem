"""Write a release's manifest.json: the tag, the commit, the pins and every asset in the release folder.

  python tooling/release/release_manifest.py <dist folder> <tag> <commit>

One file answers "what exactly is in this release": the product and asset-collection versions and the
database migration from compatibility.json, and per asset its size and SHA-256. Host packages also
name their platform, processor and the exact container images (from their PACKAGE_MANIFEST.json).
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def package_details(path: Path) -> dict:
    if path.suffix != ".zip":
        return {}
    try:
        with zipfile.ZipFile(path) as archive:
            if "PACKAGE_MANIFEST.json" not in archive.namelist():
                return {}
            inner = json.loads(archive.read("PACKAGE_MANIFEST.json"))
    except (zipfile.BadZipFile, ValueError):
        return {}
    return {key: inner[key] for key in ("platform", "arch", "images", "revision", "sourceCommit", "qaOfflineCandidate")
            if key in inner}


def build(dist: Path, tag: str, commit: str) -> dict:
    if not re.fullmatch(r"v\d+\.\d+\.\d+(?:-rc\.\d+)?", tag) or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise SystemExit("Give a release tag such as v0.2.0-rc.1 and a full 40-character commit")
    compatibility = json.loads((ROOT / "compatibility.json").read_text(encoding="utf-8"))
    assets = []
    for path in sorted(p for p in dist.iterdir() if p.is_file() and p.name not in ("manifest.json", "SHA256SUMS.txt")):
        entry = {"name": path.name, "bytes": path.stat().st_size, "sha256": sha256(path)}
        entry.update(package_details(path))
        assets.append(entry)
    return {"schemaVersion": "mk8dx.release-manifest.v2", "tag": tag, "sourceCommit": commit,
            "compatibility": compatibility, "assets": assets}


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 3:
        raise SystemExit(__doc__)
    dist = Path(argv[0])
    manifest = build(dist, argv[1], argv[2])
    (dist / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"manifest.json: {len(manifest['assets'])} assets")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
