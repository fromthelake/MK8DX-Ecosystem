"""Package prebuilt local linux/amd64 images and the existing operator tooling."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IMAGES = ("mk8dx/api:local-v010-node26-amd64", "mk8dx/web:local-v010-node26-amd64",
          "mysql:8.4.11", "axllent/mailpit:v1.32.0")
VERSION = re.compile(r"^v\d+\.\d+\.\d+(?:-rc\.\d+)?$")
PACKAGE_IMAGE_FILES = {"compose.yaml", "tooling/start-mk8dx.ps1", "tooling/start-mk8dx.sh"}
FILES = (
    "Start-MK8DX.cmd", "Start-MK8DX-LAN.cmd", "compose.yaml", "compose.local.yaml", "compose.lan.yaml",
    "compose.production.yaml", "compose.images.yaml", "tooling/install.py", "tooling/lifecycle.py",
    "tooling/start-mk8dx.ps1", "tooling/start-mk8dx.sh",
    "LICENSE", "LICENSE_SCOPE.md", "SOURCE_FOR_BINARIES.txt",
    "infrastructure/docker/Caddyfile.local", "infrastructure/docker/Caddyfile.lan",
    "infrastructure/docker/Caddyfile.production", "docs/OPERATIONS_NL.md",
    "docs/CLIENT_BUILDS.md", "docs/THIRD_PARTY_MATERIALS.md",
)


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def image_tags(version):
    if version is None:
        return IMAGES
    if not VERSION.fullmatch(version):
        raise SystemExit("--version must be a release tag such as v0.1.0 or v0.1.0-rc.9")
    return (f"ghcr.io/fromthelake/mk8dx-api:{version}-amd64",
            f"ghcr.io/fromthelake/mk8dx-web:{version}-amd64", *IMAGES[2:])


def package_bytes(name, images):
    payload = (ROOT / name).read_bytes()
    if name not in PACKAGE_IMAGE_FILES or images == IMAGES:
        return payload
    source = payload.decode("utf-8")
    for old, new in zip(IMAGES[:2], images[:2]):
        if source.count(old) != 1:
            raise ValueError(f"Expected exactly one source image reference in {name}: {old}")
        source = source.replace(old, new)
    return source.encode("utf-8")


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        epilog="The four images must exist locally as linux/amd64 before packaging: build the API and Web images "
               "with the tags --list-images prints and pull the MySQL and Mailpit images (docs/guides/HOSTING.md, "
               "'Build the host package from a clone').")
    parser.add_argument("--output", type=Path,
                        help="the package to write: a new absolute path ending in .zip, outside this repository "
                             "(an existing file is refused); a .manifest.json is written next to it")
    parser.add_argument("--revision", help="package revision shown to users, for example r14 (independent of the "
                                           "image tags)")
    parser.add_argument("--version", help="release tag for versioned GHCR image references; omitted for local clone builds")
    parser.add_argument("--list-images", action="store_true",
                        help="print the image tags the package contains, one per line, and exit")
    args = parser.parse_args()
    images = image_tags(args.version)
    if args.list_images:
        print("\n".join(images))
        return
    if args.output is None or args.revision is None:
        parser.error("--output and --revision are required")
    if not args.output.is_absolute():
        raise SystemExit("Choose a new absolute ZIP path outside repository")
    output = args.output.resolve()
    if output.suffix != ".zip" or output.exists() or output.is_relative_to(ROOT) or not output.is_absolute():
        raise SystemExit("Choose a new absolute ZIP path outside repository")
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, str(ROOT / "tooling/privacy_scan.py")], cwd=ROOT, check=True)
    paths = list(FILES) + [p.relative_to(ROOT).as_posix() for p in sorted((ROOT / "docs/install").iterdir())
                           if p.is_file() and p.suffix.lower() in (".md", ".txt", ".docx")]
    for name in paths:
        path = ROOT / name
        if not path.is_file() or path.is_symlink():
            raise SystemExit(f"Missing or linked package file: {name}")
    for image in images:
        platform = subprocess.check_output(["docker", "image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", image],
                                           text=True).strip()
        if platform != "linux/amd64":
            raise SystemExit(f"Wrong image architecture: {image} is {platform}")
    with tempfile.TemporaryDirectory(prefix="mk8dx-host-bundle-", dir=output.parent) as temporary:
        tar = Path(temporary) / "docker-images-amd64.tar"
        subprocess.run(["docker", "save", "--output", str(tar), *images], check=True)
        file_bytes = {name: package_bytes(name, images) for name in paths}
        first = (f"MK8DX host package {args.revision}\n\n"
                 "Open docs/install/MK8DX_Handleiding_NL.docx or .txt (Nederlands),\n"
                 "or docs/install/MK8DX_User_Guide_EN.docx or .txt (English).\n"
                 "Windows: double-click Start-MK8DX.cmd. Ubuntu: sh tooling/start-mk8dx.sh /var/lib/mk8dx/instance.\n"
                 "Your installation data is created outside this package. Never publish it or a backup.\n")
        file_bytes["README-FIRST.txt"] = first.encode("utf-8")
        receipt = {"schemaVersion": "mk8dx.host-bundle.v1", "revision": args.revision,
                   "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                   "images": list(images), "files": {name: {"bytes": len(payload),
                                                        "sha256": hashlib.sha256(payload).hexdigest()}
                                                 for name, payload in file_bytes.items()}}
        receipt["files"]["images/docker-images-amd64.tar"] = {"bytes": tar.stat().st_size, "sha256": sha256(tar)}
        try:
            with zipfile.ZipFile(output, "x", allowZip64=True) as archive:
                archive.writestr("PACKAGE_MANIFEST.json", json.dumps(receipt, indent=2) + "\n")
                for name, payload in file_bytes.items():
                    archive.writestr(name, payload, compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
                # Linux runners save uncompressed Docker layers. Compressing the
                # tar here keeps the offline package practical to download;
                # the manifest still verifies the exact tar bytes after unzip.
                archive.write(tar, "images/docker-images-amd64.tar", compress_type=zipfile.ZIP_DEFLATED, compresslevel=3)
        except Exception:
            output.unlink(missing_ok=True)
            raise
    receipt.update({"archiveName": output.name, "archiveBytes": output.stat().st_size, "archiveSha256": sha256(output)})
    output.with_suffix(".manifest.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: receipt[k] for k in ("archiveName", "archiveBytes", "archiveSha256", "images")}, indent=2))


if __name__ == "__main__":
    main()
