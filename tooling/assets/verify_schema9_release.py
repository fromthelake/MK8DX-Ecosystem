from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path, PurePosixPath
from typing import Any, Iterable


VERIFIER_VERSION = "mk8dx.schema9-release-verifier.v1"
DEFAULT_BASELINE_PATH = Path(__file__).with_name("schema9-release-baseline-v1.json")


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def release_tree_sha256(release_root: Path, relative_files: Iterable[str]) -> str:
    """Hash sorted `<file-sha256>  <POSIX-relative-path>\n` inventory lines."""

    digest = hashlib.sha256()
    for relative_path in sorted(relative_files):
        file_hash = sha256_file(release_root / Path(PurePosixPath(relative_path)))
        digest.update(f"{file_hash}  {relative_path}\n".encode("utf-8"))
    return digest.hexdigest()


def asset_paths(value: Any) -> set[str]:
    paths: set[str] = set()
    if isinstance(value, str):
        if value.startswith(("images/", "images\\")):
            paths.add(value)
    elif isinstance(value, dict):
        for child in value.values():
            paths.update(asset_paths(child))
    elif isinstance(value, list):
        for child in value:
            paths.update(asset_paths(child))
    return paths


def _error(
    errors: list[dict[str, Any]],
    code: str,
    path: str,
    expected: Any,
    actual: Any,
) -> None:
    errors.append(
        {
            "code": code,
            "path": path,
            "expected": expected,
            "actual": actual,
        }
    )


def _compare(
    errors: list[dict[str, Any]],
    code: str,
    path: str,
    expected: Any,
    actual: Any,
) -> None:
    if actual != expected:
        _error(errors, code, path, expected, actual)


def _record_counts(value: Any) -> dict[str, int] | None:
    if not isinstance(value, dict):
        return None
    counts: dict[str, int] = {}
    for key, records in value.items():
        if not isinstance(key, str) or not isinstance(records, list):
            return None
        counts[key] = len(records)
    return counts


def _valid_asset_path(path: str) -> bool:
    pure = PurePosixPath(path)
    return (
        path == pure.as_posix()
        and not pure.is_absolute()
        and len(pure.parts) >= 2
        and pure.parts[0] == "images"
        and ".." not in pure.parts
        and pure.suffix == ".png"
    )


def verify_release(release_root: Path, baseline_path: Path = DEFAULT_BASELINE_PATH) -> dict:
    release_root = release_root.resolve()
    errors: list[dict[str, Any]] = []
    try:
        baseline = load_json(baseline_path)
    except (OSError, json.JSONDecodeError) as exc:
        _error(
            errors,
            "BASELINE_UNREADABLE",
            baseline_path.as_posix(),
            "valid JSON",
            str(exc),
        )
        return {
            "verifierVersion": VERIFIER_VERSION,
            "status": "FAIL",
            "releaseRoot": release_root.as_posix(),
            "observed": None,
            "errors": errors,
        }

    if not release_root.is_dir():
        _error(errors, "RELEASE_ROOT_MISSING", ".", "directory", None)
        return {
            "verifierVersion": VERIFIER_VERSION,
            "status": "FAIL",
            "releaseRoot": release_root.as_posix(),
            "observed": None,
            "errors": errors,
        }

    relative_files: list[str] = []
    symlinks: list[str] = []
    for path in release_root.rglob("*"):
        relative = path.relative_to(release_root).as_posix()
        if path.is_symlink():
            symlinks.append(relative)
        elif path.is_file():
            relative_files.append(relative)
    relative_files.sort()

    for path in symlinks:
        _error(
            errors,
            "UNEXPECTED_SYMLINK",
            path,
            "regular release file/directory",
            "symlink",
        )

    actual_root_entries = sorted(path.name for path in release_root.iterdir())
    _compare(
        errors,
        "ROOT_ENTRIES_MISMATCH",
        ".",
        sorted(baseline["rootEntries"]),
        actual_root_entries,
    )

    observed: dict[str, Any] = {
        "fileCount": len(relative_files),
        "totalBytes": sum(
            (release_root / path).stat().st_size for path in relative_files
        ),
        "pngCount": sum(path.endswith(".png") for path in relative_files),
        "treeSha256": release_tree_sha256(release_root, relative_files),
    }

    for field in ("fileCount", "totalBytes", "pngCount", "treeSha256"):
        _compare(
            errors,
            f"INVENTORY_{field.upper()}_MISMATCH",
            f"inventory.{field}",
            baseline["inventory"][field],
            observed[field],
        )

    database_relative = baseline["database"]["path"]
    readme_relative = baseline["readme"]["path"]
    database_path = release_root / database_relative
    readme_path = release_root / readme_relative

    for label, relative, path in (
        ("DATABASE", database_relative, database_path),
        ("README", readme_relative, readme_path),
    ):
        expected = baseline[label.lower()]
        if not path.is_file():
            _error(errors, f"{label}_MISSING", relative, "regular file", None)
            continue
        _compare(
            errors,
            f"{label}_SIZE_MISMATCH",
            relative,
            expected["sizeBytes"],
            path.stat().st_size,
        )
        _compare(
            errors,
            f"{label}_SHA256_MISMATCH",
            relative,
            expected["sha256"],
            sha256_file(path),
        )

    database: Any = None
    if database_path.is_file():
        try:
            database = load_json(database_path)
        except (OSError, json.JSONDecodeError) as exc:
            _error(errors, "DATABASE_UNREADABLE", database_relative, "valid JSON", str(exc))

    referenced_assets: set[str] = set()
    if isinstance(database, dict):
        _compare(
            errors,
            "SCHEMA_VERSION_MISMATCH",
            "database.json#/schemaVersion",
            baseline["schemaVersion"],
            database.get("schemaVersion"),
        )
        _compare(
            errors,
            "COLLECTION_COUNTS_MISMATCH",
            "database.json#/collections",
            baseline["collections"],
            _record_counts(database.get("collections")),
        )
        _compare(
            errors,
            "RELATIONSHIP_COUNTS_MISMATCH",
            "database.json#/relationships",
            baseline["relationships"],
            _record_counts(database.get("relationships")),
        )

        for raw_path in sorted(asset_paths(database)):
            normalized = raw_path.replace("\\", "/")
            if raw_path != normalized or not _valid_asset_path(normalized):
                _error(
                    errors,
                    "INVALID_ASSET_PATH",
                    "database.json",
                    "safe images/*.png POSIX-relative path",
                    raw_path,
                )
                continue
            referenced_assets.add(normalized)

    observed["assetReferenceCount"] = len(referenced_assets)
    _compare(
        errors,
        "ASSET_REFERENCE_COUNT_MISMATCH",
        "inventory.assetReferenceCount",
        baseline["inventory"]["assetReferenceCount"],
        observed["assetReferenceCount"],
    )

    actual_files = set(relative_files)
    expected_files = {database_relative, readme_relative, *referenced_assets}
    for path in sorted(expected_files - actual_files):
        _error(
            errors,
            "MISSING_ASSET" if path.startswith("images/") else "MISSING_FILE",
            path,
            "file",
            None,
        )
    for path in sorted(actual_files - expected_files):
        _error(errors, "UNEXPECTED_FILE", path, None, "file")

    errors.sort(key=lambda item: (item["code"], item["path"]))
    return {
        "verifierVersion": VERIFIER_VERSION,
        "status": "PASS" if not errors else "FAIL",
        "releaseRoot": release_root.as_posix(),
        "observed": observed,
        "errors": errors,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Verify a schema-9 runtime asset release without modifying it."
    )
    parser.add_argument("release_root", type=Path)
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE_PATH)
    args = parser.parse_args(argv)
    result = verify_release(args.release_root, args.baseline)
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
