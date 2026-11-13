"""Package prebuilt local Linux container images and the operator tooling for one host platform.

Windows, Linux and macOS packages differ only in the launcher they point to, the pinned Python wheels
for the A2 offline CA tools and the image architecture (amd64, or arm64 for Apple Silicon and ARM
boards); the containers themselves are always Linux images."""
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
    "tooling/start-mk8dx.ps1", "tooling/mk8dx-ui.ps1", "tooling/start-mk8dx.sh",
    "tooling/mk8dx-ui.sh",
    "LICENSE", "LICENSE_SCOPE.md", "SOURCE_FOR_BINARIES.txt",
    "infrastructure/docker/Caddyfile.local", "infrastructure/docker/Caddyfile.lan",
    "infrastructure/docker/Caddyfile.production", "docs/OPERATIONS_NL.md",
    "docs/CLIENT_BUILDS.md", "docs/THIRD_PARTY_MATERIALS.md",
)
# A2 offline LAN (ADR-0223): Compose/Caddy, local CA tools, the setup wizard and their pinned Python closure.
OFFLINE_FILES = (
    "compose.offline-lan.yaml", "infrastructure/docker/Caddyfile.offline-lan",
    "tooling/offline_lan_ca.py", "tooling/offline_lan_ca_lifecycle.py", "tooling/requirements-offline-lan.txt",
    "tooling/setup_wizard.py", "tooling/auto_backup.py", "tooling/host_platform.py",
    "tooling/setup_wizard_static/index.html",
    "tooling/setup_wizard_static/wizard.js", "tooling/setup_wizard_static/wizard.css",
    "tooling/setup_wizard_static/icon.png", "tooling/mk8dx.ico",
)


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def offline_pins() -> dict:
    return dict(line.split("==") for line in (ROOT / "tooling/requirements-offline-lan.txt").read_text(
        encoding="utf-8").splitlines() if line.strip() and not line.startswith("#"))


# The binary-wheel platform tag each host package needs (pure-Python "none-any" wheels fit all).
WHEEL_PLATFORMS = {
    ("windows", "amd64"): re.compile(r"win_amd64"),
    ("linux", "amd64"): re.compile(r"manylinux[0-9_]*_x86_64"),
    ("linux", "arm64"): re.compile(r"manylinux[0-9_]*_aarch64"),
    ("macos", "amd64"): re.compile(r"macosx_[0-9_]+_(x86_64|universal2)"),
    ("macos", "arm64"): re.compile(r"macosx_[0-9_]+_(arm64|universal2)"),
}


# The CPython versions an offline package installs on. The launchers accept exactly this range, and the
# guides tell people to install 3.15 (the Python install manager's current version, November 2026).
PYTHON_VERSIONS = ("cp312", "cp313", "cp314", "cp315")


def wheel_fits(wheel_name: str, platform: str, arch: str) -> bool:
    if wheel_name.endswith("-none-any.whl"):
        return True
    tags = wheel_name[:-4].split("-")[-3:]
    return (tags[0] in PYTHON_VERSIONS or tags[1] == "abi3") and \
        WHEEL_PLATFORMS[(platform, arch)].search(wheel_name) is not None


def offline_wheels(folder: Path, platform: str = "windows", arch: str = "amd64") -> dict:
    """Per pinned requirement for this host: one universal (none-any/abi3) wheel, or exactly one wheel for every
    supported CPython version. Returns {wheel: sha256}."""
    wheels, superseded = {}, set()

    def tags(path):
        return path.name[:-4].split("-")[-3:]

    def stable_abi(path):
        return "abi3" in tags(path)[1].split(".")

    def cp_number(tag):
        return int(tag[2:]) if tag.startswith("cp") and tag[2:].isdigit() else None

    oldest = min(cp_number(v) for v in PYTHON_VERSIONS)
    for name, version in offline_pins().items():
        stem = name.replace("-", "_").lower() + "-" + version + "-"
        found = [p for p in folder.glob("*.whl") if p.name.lower().startswith(stem)]
        compatible = [p for p in found if wheel_fits(p.name, platform, arch)]
        # A stable-ABI wheel built for the oldest supported CPython or earlier covers every supported version.
        # pip may also fetch a newer stable-ABI build for one version (cryptography ships cp315-abi3.abi3t);
        # with a covering wheel present that one is redundant and stays out of the package.
        universal = [p for p in compatible if p.name.endswith("-none-any.whl") or
                     (stable_abi(p) and (cp_number(tags(p)[0]) or 0) <= oldest)]
        redundant = [p for p in compatible if universal and p not in universal and stable_abi(p)]
        compatible = [p for p in compatible if p not in redundant]
        per_version = {v: [p for p in compatible if tags(p)[0] == v and not stable_abi(p)]
                       for v in PYTHON_VERSIONS}
        if len(universal) == 1 and len(compatible) == 1:
            chosen = universal
            superseded.update(p.name for p in redundant)
        elif not universal and all(len(rows) == 1 for rows in per_version.values()) and \
                len(compatible) == len(PYTHON_VERSIONS):
            chosen = [rows[0] for rows in per_version.values()]
        else:
            raise SystemExit(f"Need one universal {platform}/{arch} wheel, or one per {', '.join(PYTHON_VERSIONS)}, "
                             f"for {name}=={version} in {folder}")
        wheels.update({p.name: sha256(p) for p in chosen})
    if len(list(folder.glob("*.whl"))) != len(wheels) + len(superseded):
        raise SystemExit("The wheel folder holds wheels that are not pinned requirements")
    return wheels


def image_tags(version, arch="amd64"):
    if version is None:
        return IMAGES
    if not VERSION.fullmatch(version):
        raise SystemExit("--version must be a release tag such as v0.1.0 or v0.1.0-rc.9")
    return (f"ghcr.io/fromthelake/mk8dx-api:{version}-{arch}",
            f"ghcr.io/fromthelake/mk8dx-web:{version}-{arch}", *IMAGES[2:])


START = {
    "windows": "Windows: double-click Start-MK8DX-LAN.cmd; the setup wizard opens in your browser.\n",
    "linux": "Linux: open a terminal in this folder and run: sh tooling/start-mk8dx.sh\n"
             "The setup wizard opens in your browser (docs/install/A2_HOME_GUIDE_EN.md).\n",
    "macos": "macOS: open Terminal in this folder and run: sh tooling/start-mk8dx.sh\n"
             "The setup wizard opens in your browser (docs/install/A2_HOME_GUIDE_EN.md).\n",
}


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
    parser.add_argument("--offline-candidate", action="store_true",
                        help="A2 offline QA candidate: add the offline files, the setup wizard and the pinned wheels")
    parser.add_argument("--api-image", help="candidate API image tag (with --offline-candidate; default: the "
                                            "--version or local tag)")
    parser.add_argument("--web-image", help="candidate Web image tag (with --offline-candidate, together with "
                                            "--api-image)")
    parser.add_argument("--wheels-dir", type=Path, help="folder with the pinned cp312-cp315 wheels for --platform/--arch "
                                                        "(with --offline-candidate)")
    parser.add_argument("--platform", choices=("windows", "linux", "macos"), default="windows",
                        help="the host operating system this package is for (default: windows)")
    parser.add_argument("--arch", choices=("amd64", "arm64"), default="amd64",
                        help="host processor: amd64 (Intel/AMD) or arm64 (Apple Silicon, ARM boards)")
    args = parser.parse_args()
    if args.platform == "windows" and args.arch != "amd64":
        parser.error("Windows packages are amd64")
    images = image_tags(args.version, args.arch)
    if (args.api_image or args.web_image or args.wheels_dir) and not args.offline_candidate:
        parser.error("--api-image, --web-image and --wheels-dir apply only with --offline-candidate")
    if bool(args.api_image) != bool(args.web_image):
        parser.error("Give --api-image and --web-image together")
    if args.api_image:
        images = (args.api_image, args.web_image, *images[2:])
    if args.list_images:
        print("\n".join(images))
        return
    if args.output is None or args.revision is None:
        parser.error("--output and --revision are required")
    wheels = {}
    if args.offline_candidate:
        if args.wheels_dir is None:
            parser.error("An offline candidate needs --wheels-dir")
        args.wheels_dir = args.wheels_dir.resolve()
        wheels = offline_wheels(args.wheels_dir, args.platform, args.arch)
    if not args.output.is_absolute():
        raise SystemExit("Choose a new absolute ZIP path outside repository")
    output = args.output.resolve()
    if output.suffix != ".zip" or output.exists() or output.is_relative_to(ROOT) or not output.is_absolute():
        raise SystemExit("Choose a new absolute ZIP path outside repository")
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, str(ROOT / "tooling/privacy_scan.py")], cwd=ROOT, check=True)
    paths = list(FILES) + (list(OFFLINE_FILES) if args.offline_candidate else []) + \
        [p.relative_to(ROOT).as_posix() for p in sorted((ROOT / "docs/install").iterdir())
         if p.is_file() and p.suffix.lower() in (".md", ".txt", ".docx")] + \
        [p.relative_to(ROOT).as_posix() for p in sorted((ROOT / "docs/install/guide").rglob("*"))
         if p.is_file() and p.suffix.lower() in (".html", ".css", ".js", ".png")]
    for name in paths:
        path = ROOT / name
        if not path.is_file() or path.is_symlink():
            raise SystemExit(f"Missing or linked package file: {name}")
    for image in images:
        platform = subprocess.check_output(["docker", "image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", image],
                                           text=True).strip()
        if platform != f"linux/{args.arch}":
            raise SystemExit(f"Wrong image architecture: {image} is {platform}")
    with tempfile.TemporaryDirectory(prefix="mk8dx-host-bundle-", dir=output.parent) as temporary:
        tar = Path(temporary) / f"docker-images-{args.arch}.tar"
        subprocess.run(["docker", "save", "--output", str(tar), *images], check=True)
        file_bytes = {name: package_bytes(name, images) for name in paths}
        if args.offline_candidate:
            # The launcher and installer read the exact images from here and start the setup wizard.
            file_bytes["images/images.json"] = (json.dumps({"api": images[0], "web": images[1],
                                                            "revision": args.revision,
                                                            "qaOfflineCandidate": True}, indent=2) + "\n").encode()
            pins = offline_pins()
            hashes = {}
            for wheel, digest in sorted(wheels.items()):
                name = next(n for n in pins if wheel.lower().startswith(n.replace("-", "_").lower() + "-"))
                hashes.setdefault(name, []).append(f"--hash=sha256:{digest}")
            lines = [f"{name}=={pins[name]} " + " ".join(rows) for name, rows in sorted(hashes.items())]
            file_bytes["wheels/requirements.hashes.txt"] = ("\n".join(lines) + "\n").encode()
        if args.offline_candidate:
            first = (f"MK8DX at home or at the club (A2), package {args.revision}\n\n"
                     + START[args.platform] + "\n"
                     "Step by step, with pictures: docs/install/guide/en.html (English) or\n"
                     "docs/install/guide/nl.html (Nederlands). The wizard's Manual link opens the same guide.\n"
                     "Updating later: unpack a newer package in a new folder and start it the same way.\n\n"
                     "Your installation data is created outside this package. Never publish it or a backup.\n")
        else:
            first = (f"MK8DX host package {args.revision}\n\n"
                     "Open docs/install/MK8DX_Handleiding_NL.docx or .txt (Nederlands),\n"
                     "or docs/install/MK8DX_User_Guide_EN.docx or .txt (English).\n"
                     "Windows: double-click Start-MK8DX.cmd. Ubuntu: sh tooling/start-mk8dx.sh /var/lib/mk8dx/instance.\n"
                     "For home or club use without internet, download the mk8dx-a2-... package instead.\n"
                     "Your installation data is created outside this package. Never publish it or a backup.\n")
        file_bytes["README-FIRST.txt"] = first.encode("utf-8")
        receipt = {"schemaVersion": "mk8dx.host-bundle.v1", "revision": args.revision,
                   "platform": args.platform, "arch": args.arch,
                   "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                   "images": list(images), "files": {name: {"bytes": len(payload),
                                                        "sha256": hashlib.sha256(payload).hexdigest()}
                                                 for name, payload in file_bytes.items()}}
        receipt["files"][f"images/docker-images-{args.arch}.tar"] = {"bytes": tar.stat().st_size, "sha256": sha256(tar)}
        for wheel, digest in wheels.items():
            receipt["files"][f"wheels/{wheel}"] = {"bytes": (args.wheels_dir / wheel).stat().st_size, "sha256": digest}
        if args.offline_candidate:
            receipt["qaOfflineCandidate"] = True
        try:
            with zipfile.ZipFile(output, "x", allowZip64=True) as archive:
                archive.writestr("PACKAGE_MANIFEST.json", json.dumps(receipt, indent=2) + "\n")
                for name, payload in file_bytes.items():
                    archive.writestr(name, payload, compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
                for wheel in wheels:
                    archive.write(args.wheels_dir / wheel, f"wheels/{wheel}", compress_type=zipfile.ZIP_STORED)
                # Linux runners save uncompressed Docker layers. Compressing the
                # tar here keeps the offline package practical to download;
                # the manifest still verifies the exact tar bytes after unzip.
                archive.write(tar, f"images/docker-images-{args.arch}.tar", compress_type=zipfile.ZIP_DEFLATED,
                              compresslevel=3)
        except Exception:
            output.unlink(missing_ok=True)
            raise
    receipt.update({"archiveName": output.name, "archiveBytes": output.stat().st_size, "archiveSha256": sha256(output)})
    output.with_suffix(".manifest.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: receipt[k] for k in ("archiveName", "archiveBytes", "archiveSha256", "images")}, indent=2))


if __name__ == "__main__":
    main()
