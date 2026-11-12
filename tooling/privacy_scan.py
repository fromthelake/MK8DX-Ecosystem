"""Fail-closed scan of distributable source paths and obvious private markers.

This is a gate, not a substitute for human provenance and license review.
"""
import os
import hashlib
import json
import re
import stat
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OMIT = {".git", ".gradle", "node_modules", "dist", "build", "coverage", ".cache", "__pycache__", ".venv", "venv", ".mk8dx-local", ".mk8dx-production"}
FORBIDDEN_SUFFIX = {".zip", ".tar", ".gz", ".db", ".sqlite", ".sqlite3", ".pem", ".key", ".p12", ".pfx", ".mp4", ".mkv", ".map"}
# Generic markers only; names of private people and their domains live in the maintainer's private intake policy.
MARKERS = [
    ("mariokart." + "basai.nl").encode(),
    ("C:" + "\\Ai\\").encode(),
    ("MK8DX_" + "Restricted_Migration").encode(),
    ("BEGIN " + "PRIVATE KEY").encode(),
    ("BEGIN OPENSSH " + "PRIVATE KEY").encode(),
]
SECRET_PATTERNS = [
    re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    re.compile(rb"\bgh[pousr]_[A-Za-z0-9_]{30,}\b"),
    re.compile(rb"\bsk-[A-Za-z0-9]{20,}\b"),
    re.compile(rb"https?://[^\s:/@]+:[^\s/@]+@", re.IGNORECASE),
]
READING_GUIDES = {
    "docs/install/MK8DX_Handleiding_NL.docx",
    "docs/install/MK8DX_User_Guide_EN.docx",
}
WORD_TEMPLATE_THUMBNAIL_SHA256 = "96367138dc44ce09bf2c8f0f8e49348a1478d2c5c0af69bbc2bbc38b63cdcead"
# The public recognition test set is admitted file by file through a reviewed list (SHA-256 and size).
TEST_SET_PREFIX = "packages/assets/test-set/"
TEST_SET_MANIFEST = TEST_SET_PREFIX + "test-set-files-v1.json"


def review_reading_guide(path, relative, findings):
    """Admit only the two guides after inspecting XML and a pinned stock thumbnail."""
    try:
        with zipfile.ZipFile(path) as archive:
            members = archive.infolist()
            if (len(members) > 60 or archive.testzip() is not None or
                    not any(item.filename == "word/document.xml" for item in members)):
                raise ValueError("unexpected Word structure")
            for item in members:
                name = item.filename
                if (item.is_dir() or name.startswith("/") or ".." in name.split("/") or
                        item.file_size > 2_000_000 or item.compress_size > 2_000_000 or
                        not name.endswith((".xml", ".rels")) and name not in
                        ("[Content_Types].xml", "docProps/thumbnail.jpeg")):
                    raise ValueError("unexpected Word member")
                contents = archive.read(item)
                if name == "docProps/thumbnail.jpeg":
                    if hashlib.sha256(contents).hexdigest() != WORD_TEMPLATE_THUMBNAIL_SHA256:
                        raise ValueError("changed Word thumbnail")
                    continue
                contents.decode("utf-8")
                lowered = contents.lower()
                if any(marker.lower() in lowered for marker in MARKERS) or any(
                        pattern.search(contents) for pattern in SECRET_PATTERNS):
                    raise ValueError("private content in Word member")
    except (OSError, ValueError, UnicodeError, zipfile.BadZipFile) as error:
        findings.append(f"unreviewed Word guide: {relative}: {error}")


def is_reparse(path):
    details = path.lstat()
    return path.is_symlink() or bool(getattr(details, "st_file_attributes", 0) &
                                     getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0))


def main():
    findings = []
    checked = 0
    manifest_path = ROOT / "packages/assets/collection/collection-manifest.v1.json"
    allowed_objects = {}
    seen_objects = set()
    # Objects over GitHub's file limit are stored as `<sha>.partN`; they are checked joined.
    split_parts: dict[str, list[tuple[int, bytes]]] = {}
    native_binary_manifest = ROOT / "packages/assets/native-binaries-v1.json"
    allowed_native = {}
    seen_native = set()
    if native_binary_manifest.is_file():
        binary_manifest = json.loads(native_binary_manifest.read_text(encoding="utf-8"))
        if binary_manifest.get("schemaVersion") != "mk8dx.native-binaries.v1":
            findings.append("unknown native binary schema")
        allowed_native = binary_manifest.get("files", {})
    # Guide screenshots (docs/install/guide/img) are admitted one by one after a person looked at them:
    # tooling/build_guide_html.py --review-images records their exact size and hash.
    guide_manifest = ROOT / "docs/install/guide/images-reviewed-v1.json"
    allowed_guide = {}
    if guide_manifest.is_file():
        guide_images = json.loads(guide_manifest.read_text(encoding="utf-8"))
        if guide_images.get("schemaVersion") != "mk8dx.guide-images-reviewed.v1":
            findings.append("unknown guide image schema")
        allowed_guide = {relative: row for relative, row in guide_images.get("files", {}).items()
                         if relative.startswith("docs/install/guide/img/") and relative.endswith(".png")}
    # README screenshots (docs/readme) follow the same rule: listed one by one, with exact size and hash, after
    # a person looked at them (made-up players, or real names made unrecognisable).
    readme_manifest = ROOT / "docs/readme/images-reviewed-v1.json"
    if readme_manifest.is_file():
        readme_images = json.loads(readme_manifest.read_text(encoding="utf-8"))
        if readme_images.get("schemaVersion") != "mk8dx.readme-images-reviewed.v1":
            findings.append("unknown README image schema")
        allowed_guide.update({relative: row for relative, row in readme_images.get("files", {}).items()
                              if relative.startswith("docs/readme/") and relative.endswith(".jpg")})
    allowed_test_set = {}
    seen_test_set = set()
    test_set_manifest = ROOT / TEST_SET_MANIFEST
    if test_set_manifest.is_file():
        test_set = json.loads(test_set_manifest.read_text(encoding="utf-8"))
        if test_set.get("schemaVersion") != "mk8dx.public-test-set-files.v1":
            findings.append("unknown public test set schema")
        for relative, row in test_set.get("files", {}).items():
            # The list can only admit files inside the test set folder.
            if (not relative.startswith(TEST_SET_PREFIX) or ".." in relative.split("/") or
                    not isinstance(row, dict) or not isinstance(row.get("sizeBytes"), int) or
                    not re.fullmatch(r"[0-9a-f]{64}", str(row.get("sha256")))):
                findings.append(f"invalid public test set entry: {relative}")
                continue
            allowed_test_set[relative] = row
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("schemaVersion") != "mk8dx.internal-asset-collection.v1":
            findings.append("unknown internal collection schema")
        for logical, row in manifest.get("files", {}).items():
            digest = row.get("sha256")
            if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
                findings.append(f"invalid collection digest: {logical}")
                continue
            relative_object = f"packages/assets/collection/objects/{digest[:2]}/{digest}"
            size = row.get("sizeBytes")
            if relative_object in allowed_objects and allowed_objects[relative_object] != size:
                findings.append(f"inconsistent collection object: {logical}")
            allowed_objects[relative_object] = size
    for directory, dirs, names in os.walk(ROOT, followlinks=False):
        relative_directory = Path(directory).relative_to(ROOT).as_posix()
        # The scanner materializes an ignored build view from the checked
        # collection. Scan the authoritative objects here; inspect built
        # images and archives separately at the release gate.
        if relative_directory == "apps/timetrials-scanner-web":
            dirs[:] = [name for name in dirs if name not in {"public"}]
        for name in list(dirs):
            path = Path(directory) / name
            if name in OMIT:
                dirs.remove(name)
            elif is_reparse(path):
                findings.append(f"reparse directory: {path.relative_to(ROOT).as_posix()}")
                dirs.remove(name)
        for name in names:
            path = Path(directory) / name
            relative = path.relative_to(ROOT).as_posix()
            if is_reparse(path) or not path.is_file():
                findings.append(f"unsafe file: {relative}")
                continue
            suffix = path.suffix.lower()
            if suffix in FORBIDDEN_SUFFIX or name in (".env", "id_rsa") or name.startswith(".env."):
                findings.append(f"forbidden artifact: {relative}")
                continue
            content = path.read_bytes()
            checked += 1
            if relative in READING_GUIDES:
                review_reading_guide(path, relative, findings)
                continue
            part = re.fullmatch(r"([0-9a-f]{64})\.part([1-9][0-9]*)", name)
            if relative.startswith("packages/assets/collection/objects/") and part:
                split_parts.setdefault(part.group(1), []).append((int(part.group(2)), content))
                continue
            if relative.startswith("packages/assets/collection/objects/") and name.endswith(".joining"):
                findings.append(f"unfinished object join: {relative}")
                continue
            admitted_object = relative in allowed_objects
            admitted_native = relative in allowed_native
            admitted_test_set = relative in allowed_test_set
            guide_row = allowed_guide.get(relative)
            admitted_guide = guide_row is not None and len(content) == guide_row.get("sizeBytes") and \
                hashlib.sha256(content).hexdigest() == guide_row.get("sha256")
            if relative.startswith("packages/assets/collection/objects/"):
                seen_objects.add(relative)
                if not admitted_object or len(content) != allowed_objects.get(relative) or hashlib.sha256(content).hexdigest() != name:
                    findings.append(f"unknown or changed collection object: {relative}")
            if admitted_native:
                seen_native.add(relative)
                row = allowed_native[relative]
                if len(content) != row.get("sizeBytes") or hashlib.sha256(content).hexdigest() != row.get("sha256"):
                    findings.append(f"changed native binary: {relative}")
            if admitted_test_set:
                seen_test_set.add(relative)
                row = allowed_test_set[relative]
                if len(content) != row["sizeBytes"] or hashlib.sha256(content).hexdigest() != row["sha256"]:
                    findings.append(f"changed public test set file: {relative}")
            lower = content.lower()
            if any(marker.lower() in lower for marker in MARKERS):
                findings.append(f"private marker: {relative}")
            if any(pattern.search(content) for pattern in SECRET_PATTERNS):
                findings.append(f"credential-shaped value: {relative}")
            try:
                content.decode("utf-8")
                undecodable = False
            except UnicodeDecodeError:
                undecodable = True
            if ((undecodable or suffix in (".png", ".woff2")) and not admitted_object and not admitted_native
                    and not admitted_test_set and not admitted_guide):
                if not relative.startswith("apps/timetrials-web/styles/") or suffix not in (".png", ".woff2"):
                    findings.append(f"unreviewed binary: {relative}")
    for digest, parts in sorted(split_parts.items()):
        relative = f"packages/assets/collection/objects/{digest[:2]}/{digest}"
        joined = b"".join(content for _index, content in sorted(parts))
        indices = sorted(index for index, _content in parts)
        if (relative not in allowed_objects or indices != list(range(1, len(parts) + 1))
                or len(joined) != allowed_objects[relative] or hashlib.sha256(joined).hexdigest() != digest):
            findings.append(f"unknown or changed split collection object: {relative}")
        seen_objects.add(relative)
    for relative in sorted(set(allowed_objects) - seen_objects):
        findings.append(f"missing collection object: {relative}")
    for relative in sorted(set(allowed_native) - seen_native):
        findings.append(f"missing native binary: {relative}")
    for relative in sorted(set(allowed_test_set) - seen_test_set):
        findings.append(f"missing public test set file: {relative}")
    print(f"privacy scan: checked={checked}, findings={len(findings)}")
    for finding in findings:
        print(finding, file=sys.stderr)
    if findings:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
