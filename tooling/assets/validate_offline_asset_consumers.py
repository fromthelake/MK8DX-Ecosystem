"""Read-only resource checks against an APK or a Tournament private-assets tree.

These checks verify the actual packaged bytes and known consumer filenames.
They do not launch the APK/GUI, run recognition, or claim device acceptance.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile

try:
    from .shared_asset_source import SharedAssetSource, contained, json_bytes, sha256
except ImportError:
    from shared_asset_source import SharedAssetSource, contained, json_bytes, sha256


ANDROID_COLLECTIONS = {
    "images/cups/": "cup", "images/tracks/previews/": "track",
    "images/characters/menu/": "character", "images/vehicles/bodies/defaults/": "body",
    "images/vehicles/tires/defaults/": "tire", "images/vehicles/gliders/defaults/": "glider",
    "images/countries/mk8_flags/": "country",
}
SCAN_PREFIXES = ("clean_assets/", "kart_config/", "grid/", "segment_templates/", "model/inference_model.onnx")


def android_mapping(source: SharedAssetSource) -> dict[str, str]:
    """Mirror only the existing Gradle filename projection, never recognition rules."""
    result = {}
    for logical in source.files:
        if logical.startswith("schema9/"):
            relative = logical.removeprefix("schema9/")
            for prefix, category in ANDROID_COLLECTIONS.items():
                if not relative.startswith(prefix):
                    continue
                name = relative.removeprefix(prefix)
                match = re.fullmatch(r"(\d+)_([^/]+)\.png", name)
                if match:
                    target = f"{match[2]}.png" if category == "country" else f"{int(match[1])}.png"
                    result[f"assets/private-product/img/{category}/{target}"] = logical
        elif logical.startswith("tt-scan/"):
            relative = logical.removeprefix("tt-scan/")
            if relative.startswith(SCAN_PREFIXES):
                result[f"assets/{relative}"] = logical
    return result


def verify_apk(source: SharedAssetSource, apk: Path) -> dict:
    errors = []
    mapping = android_mapping(source)
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            errors.append({"code": "duplicate_zip_entry"})
        for target, logical in sorted(mapping.items()):
            if target not in names:
                errors.append({"code": "missing_resource", "path": target, "sourcePath": logical})
                continue
            expected = source.files[logical]
            digest = hashlib.sha256()
            size = 0
            with archive.open(target) as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
                    size += len(chunk)
            if digest.hexdigest() != expected["sha256"] or size != expected["sizeBytes"]:
                errors.append({"code": "different_resource", "path": target, "sourcePath": logical,
                               "actualSha256": digest.hexdigest(), "expectedSha256": expected["sha256"]})
    return {"consumer": "android-apk", "artifactSha256": sha256(apk), "checkedResourceCount": len(mapping),
            "status": "verified" if not errors else "failed", "errors": errors,
            "scope": "packaged resource bytes; no install/launch/recognition claim"}


def verify_tournament(source: SharedAssetSource, root: Path, source_id: str = "tournament") -> dict:
    errors = []
    prefix = f"{source_id}/"
    mapping = {logical.removeprefix(prefix): logical for logical in source.files if logical.startswith(prefix)}
    if not mapping:
        raise ValueError(f"Unknown/empty Tournament source: {source_id}")
    for relative, logical in sorted(mapping.items()):
        path = contained(root.resolve(), relative)
        if not path.is_file():
            errors.append({"code": "missing_resource", "path": relative, "sourcePath": logical})
        elif sha256(path) != source.files[logical]["sha256"]:
            errors.append({"code": "different_resource", "path": relative, "sourcePath": logical,
                           "actualSha256": sha256(path), "expectedSha256": source.files[logical]["sha256"]})
    artifact_manifest = root.parent / "PACKAGE_MANIFEST.json"
    return {"consumer": "tournament-private-assets", "checkedResourceCount": len(mapping),
            "sourceId": source_id,
            "artifactManifestSha256": sha256(artifact_manifest) if artifact_manifest.is_file() else None,
            "status": "verified" if not errors else "failed", "errors": errors,
            "scope": "existing templates, crops and catalog; no GUI/replay/capture claim"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--asset-root", type=Path)
    parser.add_argument("--apk", type=Path)
    parser.add_argument("--tournament-root", type=Path)
    parser.add_argument("--tournament-source-id", default="tournament")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.apk is None and args.tournament_root is None:
        parser.error("supply --apk and/or --tournament-root")
    source = SharedAssetSource(args.asset_root)
    results = []
    if args.apk:
        results.append(verify_apk(source, args.apk))
    if args.tournament_root:
        results.append(verify_tournament(source, args.tournament_root, args.tournament_source_id))
    report = {"schemaVersion": "mk8dx.offline-asset-consumer-verification.v1",
              "sourceManifestSha256": source.manifest_sha256, "results": results}
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(json_bytes(report))
    else:
        print(json.dumps(report, indent=2))
    return 1 if any(result["status"] == "failed" for result in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
