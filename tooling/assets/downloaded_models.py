"""Public upstream model files that packages download at build time instead of keeping them in Git.

`packages/assets/downloaded-models-v1.json` pins every file: its path inside the staged group folder, size,
SHA-256, the MD5 the upstream project publishes, the license (its text is in packages/assets/licenses/) and the
official https archive with its own size and SHA-256. A build fetches each archive once into a cache, checks the
archive and the extracted file against every pin, and fails closed on any mismatch; nothing unverified is staged.

    python tooling/assets/downloaded_models.py fetch [--cache DIR]
    python tooling/assets/downloaded_models.py stage --group ocr-models --output DIR [--cache DIR]
    python tooling/assets/downloaded_models.py admit --group ocr-models --path model/x.pth --url https://... \\
        --member x.pth --md5 <upstream md5> --license Apache-2.0 [--cache DIR]

The cache is `--cache`, else `MK8DX_MODEL_CACHE`, else `%LOCALAPPDATA%\\MK8DX\\model-cache` (Windows) or
`~/.cache/mk8dx/model-cache`. Cached files are re-verified on every use, so a damaged cache is refetched.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tempfile
import urllib.request
import zipfile

REPO = Path(__file__).resolve().parents[2]
PINS = REPO / "packages/assets/downloaded-models-v1.json"
SCHEMA = "mk8dx.downloaded-models.v1"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
HEX32 = re.compile(r"^[0-9a-f]{32}$")
SUFFIXES = {".pth"}
TIMEOUT_SECONDS = 120
CHUNK = 1024 * 1024
urlopen = urllib.request.urlopen  # replaced in tests


class ModelError(ValueError):
    """A pin, download or cached file that does not match; the build must stop."""


def default_cache() -> Path:
    configured = os.environ.get("MK8DX_MODEL_CACHE")
    if configured:
        return Path(configured)
    if os.name == "nt" and os.environ.get("LOCALAPPDATA"):
        return Path(os.environ["LOCALAPPDATA"]) / "MK8DX" / "model-cache"
    return Path.home() / ".cache" / "mk8dx" / "model-cache"


def safe_path(value: str) -> str:
    path = PurePosixPath(value)
    if (not value or "\\" in value or ":" in value or path.is_absolute()
            or any(part in ("", ".", "..") for part in value.split("/"))):
        raise ModelError(f"Unsafe model path: {value!r}")
    return value


def load_pins(path: Path = PINS) -> dict:
    pins = json.loads(path.read_text(encoding="utf-8"))
    if pins.get("schemaVersion") != SCHEMA:
        raise ModelError("Unknown downloaded-models schema")
    for group, record in pins["groups"].items():
        for relative, row in record["files"].items():
            check_row(group, relative, row, path.parents[0] / "licenses")
    return pins


def check_row(group: str, relative: str, row: dict, licenses: Path) -> None:
    safe_path(relative)
    source = row.get("source", {})
    if (Path(relative).suffix.lower() not in SUFFIXES or not HEX64.fullmatch(row.get("sha256", ""))
            or not HEX32.fullmatch(row.get("upstreamMd5", "")) or not isinstance(row.get("sizeBytes"), int)
            or not str(source.get("url", "")).startswith("https://") or not HEX64.fullmatch(source.get("sha256", ""))
            or not isinstance(source.get("sizeBytes"), int) or not source.get("member")):
        raise ModelError(f"Incomplete pin for {group}/{relative}")
    license_id = row.get("license", "")
    if not license_id or "/" in license_id or "\\" in license_id or not (licenses / f"{license_id}.txt").is_file():
        raise ModelError(f"License text missing for {group}/{relative}")


def hashes(path: Path) -> tuple[int, str, str]:
    sha, md5, size = hashlib.sha256(), hashlib.md5(), 0
    with path.open("rb") as stream:
        while block := stream.read(CHUNK):
            sha.update(block)
            md5.update(block)
            size += len(block)
    return size, sha.hexdigest(), md5.hexdigest()


def download(url: str, target: Path) -> None:
    if not url.startswith("https://"):
        raise ModelError("Only https downloads are allowed")
    with urlopen(url, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310 - https only, pinned below
        final = getattr(response, "geturl", lambda: url)()
        if not str(final).startswith("https://"):
            raise ModelError("Download was redirected away from https")
        with target.open("wb") as output:
            shutil.copyfileobj(response, output, CHUNK)


def archive(source: dict, cache: Path) -> Path:
    """The verified source archive in the cache, downloading it when absent or damaged."""
    folder = cache / "archives"
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"{source['sha256']}.zip"
    if target.is_file() and hashes(target)[:2] == (source["sizeBytes"], source["sha256"]):
        return target
    with tempfile.NamedTemporaryFile(dir=folder, suffix=".partial", delete=False) as stream:
        temporary = Path(stream.name)
    try:
        download(source["url"], temporary)
        size, sha, _ = hashes(temporary)
        if (size, sha) != (source["sizeBytes"], source["sha256"]):
            raise ModelError(f"Downloaded archive does not match its pin: {source['url']}")
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return target


def cached_file(row: dict, cache: Path) -> Path:
    """The verified model file in the cache (named by its SHA-256), extracted from its archive if needed."""
    folder = cache / "files"
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / row["sha256"]
    expected = (row["sizeBytes"], row["sha256"], row["upstreamMd5"])
    if target.is_file() and hashes(target) == expected:
        return target
    source = archive(row["source"], cache)
    with tempfile.NamedTemporaryFile(dir=folder, suffix=".partial", delete=False) as stream:
        temporary = Path(stream.name)
    try:
        with zipfile.ZipFile(source) as bundle:
            members = [info for info in bundle.infolist() if info.filename == row["source"]["member"]]
            if len(members) != 1 or members[0].file_size != row["sizeBytes"]:
                raise ModelError(f"Archive member missing or resized: {row['source']['member']}")
            with bundle.open(members[0]) as reader, temporary.open("wb") as output:
                shutil.copyfileobj(reader, output, CHUNK)
        if hashes(temporary) != expected:
            raise ModelError(f"Extracted model does not match its pin: {row['source']['member']}")
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return target


def fetch(cache: Path, groups: list[str] | None = None, pins_path: Path = PINS) -> dict:
    pins = load_pins(pins_path)
    selected = groups or sorted(pins["groups"])
    files = 0
    for group in selected:
        if group not in pins["groups"]:
            raise ModelError(f"Unknown downloaded-model group: {group}")
        for row in pins["groups"][group]["files"].values():
            cached_file(row, cache)
            files += 1
    return {"fetched": files, "groups": selected, "cache": str(cache)}


def stage(group: str, output: Path, cache: Path, pins_path: Path = PINS) -> dict:
    """Copy the group's verified models into `output` (for example runtime-assets/ocr-models)."""
    pins = load_pins(pins_path)
    if group not in pins["groups"]:
        raise ModelError(f"Unknown downloaded-model group: {group}")
    rows = pins["groups"][group]["files"]
    staged = {}
    for relative, row in sorted(rows.items()):
        source = cached_file(row, cache)
        target = output.joinpath(*safe_path(relative).split("/"))
        expected = (row["sizeBytes"], row["sha256"], row["upstreamMd5"])
        if target.exists():
            if not target.is_file() or hashes(target) != expected:
                raise ModelError(f"Existing staged file differs: {relative}")
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            if hashes(target) != expected:
                target.unlink()
                raise ModelError(f"Staged copy changed: {relative}")
        staged[relative] = {"sha256": row["sha256"], "sizeBytes": row["sizeBytes"]}
    return {"group": group, "files": len(staged), "bytes": sum(item["sizeBytes"] for item in staged.values()),
            "staged": staged}


def admit(group: str, relative: str, url: str, member: str, md5: str, license_id: str, cache: Path,
          pins_path: Path = PINS) -> dict:
    """Record a new public upstream model: download it, check the upstream MD5 and pin every hash."""
    pins = json.loads(pins_path.read_text(encoding="utf-8")) if pins_path.is_file() else {
        "schemaVersion": SCHEMA, "groups": {}}
    record = pins["groups"].setdefault(group, {"files": {}})
    if relative in record["files"]:
        raise ModelError("Model is already pinned")
    folder = cache / "archives"
    folder.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=folder, suffix=".partial", delete=False) as stream:
        temporary = Path(stream.name)
    try:
        download(url, temporary)
        archive_size, archive_sha, _ = hashes(temporary)
        with zipfile.ZipFile(temporary) as bundle:
            payload = bundle.read(member)
        target = folder / f"{archive_sha}.zip"
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    if hashlib.md5(payload).hexdigest() != md5:
        raise ModelError("Downloaded model does not match the upstream MD5")
    row = {"license": license_id, "sha256": hashlib.sha256(payload).hexdigest(), "sizeBytes": len(payload),
           "source": {"member": member, "sha256": archive_sha, "sizeBytes": archive_size, "url": url},
           "upstreamMd5": md5}
    check_row(group, relative, row, pins_path.parents[0] / "licenses")
    record["files"][relative] = row
    record["files"] = dict(sorted(record["files"].items()))
    pins_path.write_text(json.dumps(pins, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    return {"admitted": f"{group}/{relative}", "sha256": row["sha256"], "sizeBytes": row["sizeBytes"]}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("fetch", "stage", "admit"):
        sub = commands.add_parser(name)
        sub.add_argument("--cache", type=Path, default=None)
        if name == "fetch":
            sub.add_argument("--group", action="append")
        else:
            sub.add_argument("--group", required=True)
        if name == "stage":
            sub.add_argument("--output", type=Path, required=True)
        if name == "admit":
            for option in ("--path", "--url", "--member", "--md5", "--license"):
                sub.add_argument(option, required=True)
    args = parser.parse_args(argv)
    cache = (args.cache or default_cache()).resolve()
    try:
        if args.command == "fetch":
            result = fetch(cache, args.group)
        elif args.command == "stage":
            result = stage(args.group, args.output.resolve(), cache)
            result.pop("staged")
        else:
            result = admit(args.group, args.path, args.url, args.member, args.md5, args.license, cache)
    except (ModelError, OSError, zipfile.BadZipFile, KeyError) as error:
        print(f"downloaded models: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
