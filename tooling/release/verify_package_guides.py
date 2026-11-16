"""Check that a built host ZIP contains the guides from the release's source commit.

Run this against the actual ZIP before uploading it. Historical releases are
checked against their own checked-out tag, not against a later `main`.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import zipfile
from html.parser import HTMLParser
from pathlib import Path

from tooling.release import host_bundle


class _Links(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.hrefs: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            self.hrefs.update(value for name, value in attrs if name == "href" and value is not None)


def verify(package: Path, *, source_root: Path = host_bundle.ROOT,
           guide_paths: list[str] | None = None, source_commit: str | None = None) -> int:
    """Raise ValueError for missing/stale guide bytes, source identity or manifest data."""
    guide_paths = host_bundle.guide_paths() if guide_paths is None else guide_paths
    source_commit = source_commit or subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=source_root, text=True).strip()
    with zipfile.ZipFile(package) as archive:
        manifest_names = [name for name in archive.namelist()
                          if name == "PACKAGE_MANIFEST.json" or
                          (name.endswith("/PACKAGE_MANIFEST.json") and name.count("/") == 1)]
        if len(manifest_names) != 1:
            raise ValueError("expected one package manifest at the ZIP root")
        prefix = manifest_names[0].removesuffix("PACKAGE_MANIFEST.json")
        if prefix not in ("", package.stem + "/"):
            raise ValueError("unexpected A2 ZIP root folder")
        receipt = json.loads(archive.read(manifest_names[0]))
        if receipt.get("sourceCommit") != source_commit:
            raise ValueError("package source commit differs from the checked-out release commit")
        revision = receipt.get("revision")
        if not isinstance(revision, str) or revision not in package.stem.split("-"):
            raise ValueError("package file name and manifest revision differ")
        names = set(archive.namelist())
        bundled = {name[len(prefix):] for name in names
                   if name.startswith(prefix + "docs/install/")}
        if bundled != set(guide_paths):
            missing = sorted(set(guide_paths) - bundled)
            extra = sorted(bundled - set(guide_paths))
            raise ValueError(f"guide file set differs: missing={missing[:5]}, extra={extra[:5]}")
        for name in guide_paths:
            source = (source_root / name).read_bytes()
            packaged = archive.read(prefix + name)
            entry = receipt["files"].get(name)
            if packaged != source or entry != {
                "bytes": len(source), "sha256": hashlib.sha256(source).hexdigest()
            }:
                raise ValueError(f"guide differs from source or manifest: {name}")
        if prefix:
            start = archive.read(prefix + "START-HERE.html")
            expected = (source_root / "tooling/release/a2_guide_start.html").read_bytes()
            entry = receipt["files"].get("START-HERE.html")
            if start != expected or entry != {
                "bytes": len(expected), "sha256": hashlib.sha256(expected).hexdigest()
            }:
                raise ValueError("A2 guide start page differs from source or manifest")
            links = _Links()
            links.feed(start.decode("utf-8"))
            pages = {name for name in guide_paths if name.startswith("docs/install/guide/")
                     and name.endswith(".html")}
            if links.hrefs != pages:
                raise ValueError("A2 guide start page does not link to all bundled language pages")
    return len(guide_paths)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path, help="built host or A2 ZIP to check against this checkout")
    args = parser.parse_args()
    try:
        count = verify(args.package)
    except (ValueError, KeyError, OSError, zipfile.BadZipFile) as error:
        parser.exit(1, f"guide package check failed: {error}\n")
    print(f"verified {count} guide files against release source and package manifest: {args.package.name}")


if __name__ == "__main__":
    main()
