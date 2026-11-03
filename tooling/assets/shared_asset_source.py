"""Portable internal asset collection, byte-preserving staging and stable-ID catalog.

The default source root is inside this repository. Logical paths keep each
functional role while the object store keeps identical bytes once.
Recordings and review evidence stay outside this collection.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
from typing import Any, Iterable


MANIFEST_NAME = "collection-manifest.v1.json"
MANIFEST_VERSION = "mk8dx.internal-asset-collection.v1"
CATALOG_VERSION = "mk8dx.shared-asset-catalog.v1"
STAGING_NAME = "asset-staging-receipt.v1.json"
DEFAULT_ROOT = Path(__file__).resolve().parents[2] / "packages" / "assets" / "collection"
HASH = re.compile(r"^[0-9a-f]{64}$")
GROUP = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
DATA_PARTS = {"input_videos", "output_results", "recordings", "run-logs", "reviewed-datasets"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico"}


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def safe_relative(value: str) -> str:
    path = PurePosixPath(value)
    if (not value or value != path.as_posix() or path.is_absolute()
            or any(part in {".", ".."} for part in path.parts)
            or "\\" in value or ":" in value or any(ord(char) < 32 for char in value)):
        raise ValueError(f"Unsafe asset path: {value!r}")
    return value


def contained(root: Path, relative: str) -> Path:
    candidate = root / Path(safe_relative(relative))
    resolved = candidate.resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise ValueError(f"Asset path escapes its root: {relative}")
    # Resolving within the root is insufficient: aliases can hide platform drift.
    cursor = root
    for part in Path(relative).parts:
        cursor /= part
        if cursor.is_symlink() or (cursor.exists() and bool(getattr(cursor.lstat(), "st_file_attributes", 0) &
                                                       getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0))):
            raise ValueError(f"Asset symlink is not supported: {relative}")
        if cursor.exists() and part not in {entry.name for entry in cursor.parent.iterdir()}:
            raise ValueError(f"Asset filename case mismatch: {relative}")
    return candidate


def object_path(digest: str) -> str:
    if not HASH.fullmatch(digest):
        raise ValueError("Invalid asset SHA-256")
    return f"objects/{digest[:2]}/{digest}"


# GitHub refuses files over 100 MiB, so a larger object is kept in Git as numbered parts
# (`<sha>.part1`, `<sha>.part2`, ...). The joined object is an ignored local file.
PART = re.compile(r"^([0-9a-f]{64})\.part([1-9][0-9]*)$")
PART_BYTES = 95 * 1024 * 1024


def object_parts(root: Path, digest: str) -> list[Path]:
    folder = contained(root, object_path(digest)).parent
    parts = [path for path in folder.glob(f"{digest}.part*") if PART.fullmatch(path.name)]
    return sorted(parts, key=lambda path: int(PART.fullmatch(path.name).group(2)))


def hydrate_object(root: Path, digest: str) -> Path:
    """The object file, joined from its parts first when it is stored split."""
    target = contained(root, object_path(digest))
    if target.is_file():
        return target
    parts = object_parts(root, digest)
    if not parts:
        return target
    joining = target.with_name(target.name + ".joining")
    with joining.open("wb") as output:
        for part in parts:
            output.write(part.read_bytes())
    if sha256(joining) != digest:
        joining.unlink()
        raise ValueError(f"Split asset object does not join to its hash: {digest}")
    joining.replace(target)
    return target


def split_object(root: Path, digest: str) -> list[Path]:
    """Store one object as parts below the GitHub file limit; the joined file stays as a local copy."""
    target = contained(root, object_path(digest))
    if not target.is_file() or sha256(target) != digest:
        raise ValueError(f"Missing or changed asset object: {digest}")
    if object_parts(root, digest):
        raise ValueError(f"Asset object is already split: {digest}")
    data = target.read_bytes()
    parts = []
    for index, start in enumerate(range(0, len(data), PART_BYTES), 1):
        part = target.with_name(f"{digest}.part{index}")
        part.write_bytes(data[start:start + PART_BYTES])
        parts.append(part)
    return parts


def source_files(root: Path, includes: Iterable[str] | None = None) -> list[Path]:
    if not root.is_dir() or root.is_symlink():
        raise ValueError("Asset input must be a real directory")
    result: set[Path] = set()
    for name in includes or ["."]:
        start = root if name == "." else contained(root, name)
        if not start.exists():
            raise ValueError(f"Missing asset input: {name}")
        candidates = start.rglob("*") if start.is_dir() else [start]
        for path in candidates:
            if path.is_symlink():
                raise ValueError(f"Asset symlink is not supported: {path.name}")
            if not path.is_file():
                continue
            relative = path.relative_to(root).as_posix()
            safe_relative(relative)
            if (path.suffix.lower() in {".mp4", ".mkv", ".mov", ".avi"}
                    or DATA_PARTS.intersection(part.lower() for part in Path(relative).parts)):
                raise ValueError(f"Evidence/data is not a shared application asset: {relative}")
            result.add(path)
    names: dict[str, str] = {}
    for path in result:
        relative = path.relative_to(root).as_posix()
        previous = names.setdefault(relative.casefold(), relative)
        if previous != relative:
            raise ValueError(f"Case-colliding assets: {previous}, {relative}")
    return sorted(result, key=lambda item: item.relative_to(root).as_posix())


def import_sources(root: Path, inputs: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Add explicit named roots. Existing logical bytes cannot be replaced silently.

    Each input is {id, root, includes?}. IDs are logical resource namespaces,
    e.g. schema9 or tournament. Original absolute paths remain in the caller's
    private inventory, never in a portable catalog or generated consumer copy.
    """
    root = root.resolve()
    manifest_path = root / MANIFEST_NAME
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {
        "schemaVersion": MANIFEST_VERSION, "files": {}, "sources": {},
    }
    if manifest.get("schemaVersion") != MANIFEST_VERSION:
        raise ValueError("Unsupported shared asset source manifest")
    files = dict(manifest["files"])
    sources = dict(manifest["sources"])
    pending: list[tuple[Path, str]] = []
    for item in inputs:
        group = item["id"]
        if not GROUP.fullmatch(group):
            raise ValueError(f"Invalid asset source ID: {group}")
        origin = Path(item["root"]).resolve()
        if origin == root or root.is_relative_to(origin) or origin.is_relative_to(root):
            raise ValueError("Asset source and destination must not contain one another")
        group_files: dict[str, str] = {}
        for source in source_files(origin, item.get("includes")):
            relative = source.relative_to(origin).as_posix()
            logical = f"{group}/{relative}"
            digest = sha256(source)
            record = {"sha256": digest, "sizeBytes": source.stat().st_size,
                      "sourceId": group, "sourceRelativePath": relative}
            if logical in files and files[logical] != record:
                raise ValueError(f"Source drift needs a versioned import: {logical}")
            files[logical] = record
            group_files[relative] = digest
            pending.append((source, digest))
        tree = "".join(f"{digest}  {name}\n" for name, digest in sorted(group_files.items()))
        source_record = {"treeSha256": hashlib.sha256(tree.encode()).hexdigest(), "fileCount": len(group_files)}
        if group in sources and sources[group] != source_record:
            raise ValueError(f"Source inventory changed; use a new source version: {group}")
        sources[group] = source_record
    folded: dict[str, str] = {}
    for logical in files:
        previous = folded.setdefault(logical.casefold(), logical)
        if previous != logical:
            raise ValueError(f"Case-colliding logical assets: {previous}, {logical}")
    # All input paths/collisions are checked before creating the source tree.
    root.mkdir(parents=True, exist_ok=True)
    for source, digest in pending:
        target = contained(root, object_path(digest))
        if target.exists():
            if sha256(target) != digest:
                raise ValueError("Corrupt existing asset object")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        if sha256(target) != digest:
            raise ValueError("Asset changed during copy")
    result = {"schemaVersion": MANIFEST_VERSION, "files": files, "sources": sources}
    temporary = root / f"{MANIFEST_NAME}.tmp"
    temporary.write_bytes(json_bytes(result))
    temporary.replace(manifest_path)
    return SharedAssetSource(root).verify()


def inventory_sources(inputs: Iterable[dict[str, Any]], canonical: "SharedAssetSource | None" = None) -> dict[str, Any]:
    """Read-only duplicate/reference inventory of explicitly selected directories.

    The report is private: it records the operator-supplied original roots. A
    filename similarity is never enough to replace a recognition or UI variant.
    """
    canonical_hashes: dict[str, list[str]] = defaultdict(list)
    if canonical:
        for name, row in canonical.files.items():
            canonical_hashes[row["sha256"]].append(name)
    files = []
    roots = []
    duplicates: dict[str, list[str]] = defaultdict(list)
    for item in inputs:
        root = Path(item["root"]).resolve()
        if not root.is_dir():
            roots.append({"id": item["id"], "root": str(root), "status": "unavailable"})
            continue
        count = 0
        for path in source_files(root, item.get("includes")):
            relative = path.relative_to(root).as_posix()
            digest = sha256(path)
            key = f"{item['id']}/{relative}"
            duplicates[digest].append(key)
            files.append({"reference": key, "sizeBytes": path.stat().st_size, "sha256": digest,
                          "canonicalPaths": sorted(canonical_hashes.get(digest, []))})
            count += 1
        roots.append({"id": item["id"], "root": str(root), "status": "inventoried", "fileCount": count})
    return {"schemaVersion": "mk8dx.shared-asset-inventory.v1", "roots": roots, "files": files,
            "byteIdenticalGroups": [names for _, names in sorted(duplicates.items()) if len(names) > 1],
            "unmappedFileCount": sum(not row["canonicalPaths"] for row in files)}


class SharedAssetSource:
    def __init__(self, root: Path | str | None = None) -> None:
        configured = root or os.environ.get("MK8DX_INTERNAL_ASSET_ROOT") or DEFAULT_ROOT
        self.root = Path(configured).resolve()
        self.manifest_path = self.root / MANIFEST_NAME
        self.manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        if self.manifest.get("schemaVersion") != MANIFEST_VERSION:
            raise ValueError("Unsupported shared asset source manifest")
        self.files = self.manifest["files"]
        self.manifest_sha256 = sha256(self.manifest_path)
        folded: set[str] = set()
        for logical, record in self.files.items():
            safe_relative(logical)
            if logical.casefold() in folded:
                raise ValueError("Case-colliding logical assets")
            folded.add(logical.casefold())
            object_path(record["sha256"])
            if not isinstance(record["sizeBytes"], int) or record["sizeBytes"] < 0:
                raise ValueError("Invalid asset byte count")

    def resolve(self, logical_path: str) -> Path:
        logical_path = safe_relative(logical_path)
        record = self.files.get(logical_path)
        if record is None:
            raise ValueError(f"Unknown asset path: {logical_path}")
        path = hydrate_object(self.root, record["sha256"])
        if not path.is_file() or path.stat().st_size != record["sizeBytes"] or sha256(path) != record["sha256"]:
            raise ValueError(f"Missing or changed shared asset: {logical_path}")
        return path

    def catalog(self, locale: str = "en-GB", types: Iterable[str] | None = None) -> list[dict[str, Any]]:
        database = json.loads(self.resolve("schema9/database.json").read_text(encoding="utf-8"))
        if database.get("schemaVersion") != 9:
            raise ValueError("Expected canonical schema-9 database")
        allowed = set(types) if types is not None else None
        result = []
        seen: set[str] = set()
        for section in ("collections", "relationships"):
            for records in database.get(section, {}).values():
                if not isinstance(records, list):
                    continue
                for record in records:
                    if not isinstance(record, dict) or not isinstance(record.get("id"), str):
                        continue
                    identity = record["id"]
                    kind = identity.split(".", 1)[0]
                    if allowed is not None and kind not in allowed:
                        continue
                    images: dict[str, dict[str, Any]] = {}
                    def collect(value: Any, role: str) -> None:
                        if isinstance(value, dict):
                            if isinstance(value.get("path"), str):
                                logical = f"schema9/{safe_relative(value['path'])}"
                                resource = self.files.get(logical)
                                if resource is None:
                                    raise ValueError(f"Catalog asset missing from manifest: {logical}")
                                images[role or "image"] = {**value, "path": logical,
                                    "sha256": resource["sha256"], "sizeBytes": resource["sizeBytes"]}
                            else:
                                for key, child in value.items():
                                    collect(child, f"{role}.{key}" if role else key)
                        elif isinstance(value, list):
                            for index, child in enumerate(value):
                                collect(child, f"{role}.{index}")
                    collect(record.get("assets", {}), "")
                    collect(record.get("asset", {}), "image")
                    # These are distinct functional roles, joined only through
                    # the source's explicit stable IDs / extractor index map.
                    # No resemblance-based alias or image transformation occurs.
                    external = record.get("externalIds", {}).get("videoResultExtractor", {})
                    recognition: dict[str, str] = {}
                    if kind in {"character", "character_variant"}:
                        index = external.get("characterIndex")
                        if isinstance(index, int):
                            recognition["recognition.tournament"] = f"tournament/assets/character/{index}.png"
                        recognition["recognition.icon-matcher"] = f"icon-matcher/characters/{identity}.png"
                        recognition["recognition.scoreboard"] = f"icon-matcher/characters_scoreboard/{identity}.png"
                    elif kind in {"track", "cup"}:
                        index = external.get("trackIndex" if kind == "track" else "cupIndex")
                        if isinstance(index, int):
                            recognition["recognition.tournament"] = f"tournament/assets/{kind}/{index}.webp"
                    for role, logical in recognition.items():
                        resource = self.files.get(logical)
                        if resource is not None:
                            images[role] = {"path": logical, "sha256": resource["sha256"], "sizeBytes": resource["sizeBytes"]}
                    if not images and kind != "country":
                        continue
                    if identity in seen:
                        raise ValueError(f"Duplicate catalog ID: {identity}")
                    seen.add(identity)
                    names = record.get("names", {})
                    entry = {"id": identity, "type": kind,
                        "label": names.get(locale) or names.get("en-GB") or names.get("en-US") or record.get("slug") or identity,
                        "names": names, "images": images, "externalIds": record.get("externalIds", {})}
                    for key in ("index", "sourceIndex", "lapCount", "cupId", "cupSlot", "variantSlug"):
                        if key in record:
                            entry[key] = record[key]
                    for key in ("characterId", "bodyId", "gliderId", "itemId"):
                        if key in record and kind.endswith("variant"):
                            entry["parentId"] = record[key]
                    result.append(entry)
        return sorted(result, key=lambda entry: entry["id"])

    def image(self, asset_id: str, role: str | None = None) -> Path:
        entry = next((entry for entry in self.catalog() if entry["id"] == asset_id), None)
        if entry is None:
            raise ValueError(f"Unknown catalog asset: {asset_id}")
        images = entry["images"]
        if role is None:
            role = next((key for key in ("menu", "preview", "icon", "template") if key in images), next(iter(images)))
        if role not in images:
            raise ValueError(f"Unknown image role: {asset_id}/{role}")
        return self.resolve(images[role]["path"])

    def verify(self) -> dict[str, Any]:
        by_hash: dict[str, list[str]] = defaultdict(list)
        for logical, record in sorted(self.files.items()):
            self.resolve(logical)
            by_hash[record["sha256"]].append(logical)
        catalog = self.catalog() if "schema9/database.json" in self.files else []
        known = {object_path(digest) for digest in by_hash}
        objects = set()
        for path in (self.root / "objects").rglob("*"):
            if not path.is_file() or path.name.endswith(".joining"):
                continue
            part = PART.fullmatch(path.name)
            objects.add(object_path(part.group(1)) if part else path.relative_to(self.root).as_posix())
        if objects != known:
            raise ValueError("Uncataloged or missing asset objects")
        return {"schemaVersion": "mk8dx.shared-asset-verification.v1", "status": "verified",
            "manifestSha256": self.manifest_sha256, "logicalFileCount": len(self.files),
            "uniqueObjectCount": len(by_hash), "catalogCount": len(catalog),
            "duplicateGroups": [paths for paths in by_hash.values() if len(paths) > 1],
            "sources": self.manifest["sources"]}

    def stage(self, source_id: str, target: Path) -> dict[str, Any]:
        if source_id not in self.manifest["sources"]:
            raise ValueError(f"Unknown asset source: {source_id}")
        target = target.resolve()
        if target == self.root or target.is_relative_to(self.root) or self.root.is_relative_to(target):
            raise ValueError("Staging target must not contain the shared source")
        expected = {logical.split("/", 1)[1]: record for logical, record in self.files.items()
                    if logical.startswith(f"{source_id}/")}
        previous_path = target / STAGING_NAME
        previous = json.loads(previous_path.read_text(encoding="utf-8")) if previous_path.exists() else None
        for relative, record in expected.items():
            source = self.resolve(f"{source_id}/{relative}")
            destination = contained(target, relative)
            if destination.exists() and sha256(destination) != record["sha256"]:
                if previous is None or relative not in previous.get("files", {}):
                    raise ValueError(f"Refusing to replace unowned asset: {relative}")
            destination.parent.mkdir(parents=True, exist_ok=True)
            if not destination.exists() or sha256(destination) != record["sha256"]:
                shutil.copyfile(source, destination)
        receipt = {"schemaVersion": "mk8dx.shared-asset-staging.v1", "sourceId": source_id,
            "sourceManifestSha256": self.manifest_sha256,
            "files": {name: {"sha256": row["sha256"], "sizeBytes": row["sizeBytes"]} for name, row in expected.items()}}
        (target / STAGING_NAME).write_bytes(json_bytes(receipt))
        return self.verify_staged(source_id, target)

    def verify_staged(self, source_id: str, target: Path) -> dict[str, Any]:
        target = target.resolve()
        expected = {logical.split("/", 1)[1]: row for logical, row in self.files.items() if logical.startswith(f"{source_id}/")}
        if not expected:
            raise ValueError(f"Unknown/empty asset source: {source_id}")
        actual = {path.relative_to(target).as_posix() for path in target.rglob("*") if path.is_file() and path.name != STAGING_NAME}
        errors = [{"path": name, "code": "unexpected_staged_file"} for name in sorted(actual - expected.keys())]
        for relative, record in expected.items():
            path = contained(target, relative)
            if not path.is_file() or sha256(path) != record["sha256"]:
                errors.append({"path": relative, "code": "missing_or_stale_copy"})
        return {"schemaVersion": "mk8dx.shared-asset-staging-verification.v1",
            "status": "verified" if not errors else "failed", "sourceId": source_id,
            "fileCount": len(expected), "sourceManifestSha256": self.manifest_sha256, "errors": errors}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("inventory", "catalog", "verify", "stage", "verify-staged"))
    parser.add_argument("--asset-root", type=Path)
    parser.add_argument("--inputs", type=Path, help="Explicit private JSON list of {id, root, includes?}")
    parser.add_argument("--source-id")
    parser.add_argument("--target", type=Path)
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()
    if arguments.command == "inventory":
        if arguments.inputs is None:
            parser.error("inventory needs --inputs")
        source = SharedAssetSource(arguments.asset_root) if arguments.asset_root else None
        result = inventory_sources(json.loads(arguments.inputs.read_text(encoding="utf-8")), source)
    else:
        source = SharedAssetSource(arguments.asset_root)
        if arguments.command == "catalog":
            result = {"schemaVersion": CATALOG_VERSION, "sourceManifestSha256": source.manifest_sha256,
                      "entries": source.catalog()}
        elif arguments.command == "verify":
            result = source.verify()
        else:
            if arguments.target is None or arguments.source_id is None:
                parser.error("staging needs --source-id and --target")
            result = source.stage(arguments.source_id, arguments.target) if arguments.command == "stage" else source.verify_staged(arguments.source_id, arguments.target)
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_bytes(json_bytes(result))
    else:
        print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2))
    return 1 if result.get("status") == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
