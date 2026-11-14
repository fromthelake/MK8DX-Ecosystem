"""Review an exact asset replacement, then apply it to the internal collection.

The policy and plan live outside the release tree. Each `changes` entry names
an existing logical resource and pins both its previous and proposed SHA-256.
An `admissions` entry adds one new public upstream model file to an existing
group: it pins the file's SHA-256, size, upstream MD5, https source URL and a
license whose text is in packages/assets/licenses/, and the new manifest row
keeps that provenance. New groups, new roles, catalog/seed JSON and changes to
existing models still require a separate reviewed import. This command never
executes code in an upstream directory.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile

from shared_asset_source import (PART_BYTES, SharedAssetSource, contained, json_bytes, object_parts,
                                 object_path, safe_relative, split_object)

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico"}
ADMISSION_SUFFIXES = {".pth"}
HEX = set("0123456789abcdef")
VIEWS = ("web-asset", "android-scan", "android-product")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def plain_file(path: Path) -> bytes:
    cursor = path.resolve().anchor
    for part in path.absolute().parts[1:]:
        cursor = os.path.join(cursor, part)
        if os.path.lexists(cursor):
            flags = os.lstat(cursor).st_file_attributes if os.name == "nt" else 0
            if os.path.islink(cursor) or flags & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
                raise ValueError("Reparse path is forbidden")
    if not path.is_file():
        raise ValueError("Source file is missing")
    return path.read_bytes()


def expected(policy: dict, collection: Path, repo: Path) -> tuple[dict, dict, list[dict]]:
    source = SharedAssetSource(collection)
    manifest = source.manifest
    if policy.get("schemaVersion") != "mk8dx.collection-update-policy.v1":
        raise ValueError("Unknown update policy")
    if policy.get("baseManifestSha256") != source.manifest_sha256:
        raise ValueError("Collection baseline changed; replan")
    if policy.get("baseVersion") != manifest["releaseVersion"]:
        raise ValueError("Collection version changed; replan")
    version = policy.get("nextVersion")
    if not isinstance(version, str) or not version or version == manifest["releaseVersion"]:
        raise ValueError("A distinct next collection version is required")
    root = Path(policy["sourceRoot"])
    if (not root.is_dir() or not root.resolve().is_relative_to(repo.parent.resolve())
            or root.resolve().is_relative_to(repo.resolve())):
        raise ValueError("Source must be a separate task-owned review copy")
    changes = policy.get("changes", [])
    admissions = policy.get("admissions", [])
    if not isinstance(changes, list) or not isinstance(admissions, list) or not (changes or admissions):
        raise ValueError("Explicit replacements or admissions are required")
    seen = set()
    resolved = []
    for change in changes:
        logical = safe_relative(change["logical"])
        relative = safe_relative(change["sourceRelative"])
        if logical.casefold() in seen or Path(logical).suffix.lower() not in IMAGE_SUFFIXES:
            raise ValueError("Duplicate or non-image replacement needs separate admission")
        seen.add(logical.casefold())
        row = manifest["files"].get(logical)
        if row is None or row["sha256"] != change["previousSha256"]:
            raise ValueError("Logical resource is unknown or has changed")
        payload = plain_file(contained(root, relative))
        if digest(payload) != change["nextSha256"]:
            raise ValueError("Proposed source bytes changed")
        if payload.startswith(b"version https://git-lfs.github.com/spec"):
            raise ValueError("LFS pointer is not an asset")
        resolved.append({"logical": logical, "sourceRelative": relative,
                         "previousSha256": row["sha256"], "nextSha256": digest(payload),
                         "sizeBytes": len(payload)})
    for entry in admissions:
        resolved.append(admission(entry, manifest, root, repo, seen))
    for name in VIEWS:
        view = read_json(repo / "packages/assets" / f"{name}-selection-v1.json")
        if view["collectionVersion"] != manifest["releaseVersion"]:
            raise ValueError("Consumer view has drifted")
    if read_json(repo / "compatibility.json")["assetCollectionVersion"] != manifest["releaseVersion"]:
        raise ValueError("Compatibility record has drifted")
    return manifest, {"baseManifestSha256": source.manifest_sha256,
                      "baseVersion": manifest["releaseVersion"], "nextVersion": version}, resolved


def admission(entry: dict, manifest: dict, root: Path, repo: Path, seen: set) -> dict:
    """One new public upstream file for an existing group, with its provenance pinned."""
    logical = safe_relative(entry["logical"])
    relative = safe_relative(entry["sourceRelative"])
    group, _, inside = logical.partition("/")
    record = manifest["sources"].get(group)
    if record is None or not inside:
        raise ValueError("Admission needs an existing collection group")
    if logical.casefold() in seen or Path(logical).suffix.lower() not in ADMISSION_SUFFIXES:
        raise ValueError("Duplicate admission or a file kind that needs separate review")
    seen.add(logical.casefold())
    if any(name.casefold() == logical.casefold() for name in manifest["files"]):
        raise ValueError("Admitted resource already exists; use a replacement")
    url, md5, license_id = entry.get("sourceUrl"), entry.get("upstreamMd5"), entry.get("license")
    if not isinstance(url, str) or not url.startswith("https://") or any(c.isspace() for c in url):
        raise ValueError("Admission needs an https source URL")
    if not isinstance(md5, str) or len(md5) != 32 or not set(md5) <= HEX:
        raise ValueError("Admission needs the upstream MD5")
    if (not isinstance(license_id, str) or not license_id or "/" in license_id or "\\" in license_id
            or not (repo / "packages/assets/licenses" / f"{license_id}.txt").is_file()):
        raise ValueError("Admission license text is missing from packages/assets/licenses")
    payload = plain_file(contained(root, relative))
    if payload.startswith(b"version https://git-lfs.github.com/spec"):
        raise ValueError("LFS pointer is not an asset")
    if digest(payload) != entry.get("sha256") or len(payload) != entry.get("sizeBytes"):
        raise ValueError("Admitted source bytes changed")
    if hashlib.md5(payload).hexdigest() != md5:
        raise ValueError("Admitted source does not match the upstream MD5")
    return {"logical": logical, "sourceRelative": relative, "admitted": True,
            "nextSha256": digest(payload), "sizeBytes": len(payload),
            "row": {"consumers": list(record["consumers"]), "format": Path(logical).suffix[1:].lower(),
                    "provenance": {"license": license_id, "sourceUrl": url, "upstreamMd5": md5},
                    "role": record["role"], "sha256": digest(payload), "sizeBytes": len(payload),
                    "sourceId": group, "sourceRelativePath": inside}}


def plan(policy_path: Path, plan_path: Path, collection: Path, repo: Path) -> None:
    policy_bytes = plain_file(policy_path)
    policy = json.loads(policy_bytes)
    if already_applied(policy, collection):
        print(json.dumps({"planned": 0, "version": policy["nextVersion"]}))
        return
    _, context, changes = expected(policy, collection, repo)
    plan_data = {"schemaVersion": "mk8dx.collection-update-plan.v1",
                 "policySha256": digest(policy_bytes), **context, "changes": changes}
    plan_path.parent.mkdir(parents=True, exist_ok=True)
    plan_path.write_bytes(json_bytes(plan_data))
    print(json.dumps({"planned": len(changes), "nextVersion": context["nextVersion"]}))


def apply(policy_path: Path, plan_path: Path, collection: Path, repo: Path) -> None:
    policy_bytes = plain_file(policy_path)
    policy = json.loads(policy_bytes)
    if already_applied(policy, collection):
        print(json.dumps({"applied": 0, "version": policy["nextVersion"]}))
        return
    saved = read_json(plan_path)
    manifest, context, changes = expected(policy, collection, repo)
    if saved != {"schemaVersion": "mk8dx.collection-update-plan.v1",
                 "policySha256": digest(policy_bytes), **context, "changes": changes}:
        raise ValueError("Stale or altered update plan")
    new_manifest = json.loads(json.dumps(manifest))
    for change in changes:
        logical = change["logical"]
        if change.get("admitted"):
            new_manifest["files"][logical] = change["row"]
            continue
        new_manifest["files"][logical]["sha256"] = change["nextSha256"]
        new_manifest["files"][logical]["sizeBytes"] = change["sizeBytes"]
    new_manifest["files"] = dict(sorted(new_manifest["files"].items()))
    new_manifest["releaseVersion"] = context["nextVersion"]
    for group, source in new_manifest["sources"].items():
        rows = sorted((row["sourceRelativePath"], row["sha256"])
                      for row in new_manifest["files"].values() if row["sourceId"] == group)
        source["treeSha256"] = digest("".join(f"{sha}  {name}\n" for name, sha in rows).encode())
        source["fileCount"] = len(rows)
    outputs = {collection / "collection-manifest.v1.json": json_bytes(new_manifest)}
    for name in VIEWS:
        path = repo / "packages/assets" / f"{name}-selection-v1.json"
        view = read_json(path)
        view["collectionVersion"] = context["nextVersion"]
        outputs[path] = json_bytes(view)
    compatibility_path = repo / "compatibility.json"
    compatibility = read_json(compatibility_path)
    compatibility["assetCollectionVersion"] = context["nextVersion"]
    outputs[compatibility_path] = json_bytes(compatibility)
    # An object over GitHub's file limit is kept as parts; its joined copy stays an ignored local file.
    ignore_path = repo / ".gitignore"
    ignore = ignore_path.read_bytes() if ignore_path.is_file() else b""
    lines = ignore.decode("utf-8").splitlines()
    extra = [f"packages/assets/collection/{object_path(change['nextSha256'])}" for change in changes
             if change["sizeBytes"] > PART_BYTES]
    extra = [line for line in dict.fromkeys(extra) if line not in lines]
    if extra:
        outputs[ignore_path] = (ignore + (b"" if not ignore or ignore.endswith(b"\n") else b"\n")
                                + "".join(f"{line}\n" for line in extra).encode("utf-8"))
    backups = {path: path.read_bytes() if path.exists() else None for path in outputs}
    created = []
    removed = {}
    try:
        for change in changes:
            payload = plain_file(contained(Path(policy["sourceRoot"]), change["sourceRelative"]))
            target = contained(collection, object_path(change["nextSha256"]))
            if target.exists() or object_parts(collection, change["nextSha256"]):
                if target.exists() and digest(plain_file(target)) != change["nextSha256"]:
                    raise ValueError("Existing object has changed")
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(payload)
                created.append(target)
                if change["sizeBytes"] > PART_BYTES:
                    created.extend(split_object(collection, change["nextSha256"]))
        for path, content in outputs.items():
            with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
                stream.write(content)
                temporary = Path(stream.name)
            os.replace(temporary, path)
        retained_hashes = {row["sha256"] for row in new_manifest["files"].values()}
        for change in changes:
            if change.get("admitted"):
                continue
            old_hash = change["previousSha256"]
            if old_hash not in retained_hashes:
                old_object = contained(collection, object_path(old_hash))
                if old_object not in removed:
                    removed[old_object] = plain_file(old_object)
                    old_object.unlink()
        SharedAssetSource(collection).verify()
    except Exception:
        for path, content in backups.items():
            if content is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(content)
        for path, content in removed.items():
            path.write_bytes(content)
        for path in created:
            path.unlink()
        raise
    print(json.dumps({"applied": len(changes), "version": context["nextVersion"]}))


def validate(policy_path: Path, plan_path: Path, collection: Path, repo: Path) -> None:
    policy_bytes = plain_file(policy_path)
    policy = json.loads(policy_bytes)
    if already_applied(policy, collection):
        print(json.dumps({"validated": 0, "version": policy["nextVersion"]}))
        return
    _, context, changes = expected(policy, collection, repo)
    saved = read_json(plan_path)
    if saved != {"schemaVersion": "mk8dx.collection-update-plan.v1",
                 "policySha256": digest(policy_bytes), **context, "changes": changes}:
        raise ValueError("Stale or altered update plan")
    SharedAssetSource(collection).verify()
    print(json.dumps({"validated": len(changes), "nextVersion": context["nextVersion"]}))


def already_applied(policy: dict, collection: Path) -> bool:
    if policy.get("schemaVersion") != "mk8dx.collection-update-policy.v1":
        raise ValueError("Unknown update policy")
    source = SharedAssetSource(collection)
    if source.manifest["releaseVersion"] != policy.get("nextVersion"):
        return False
    root = Path(policy["sourceRoot"])
    if (not root.is_dir() or not root.resolve().is_relative_to(collection.parents[3].resolve())
            or root.resolve().is_relative_to(collection.parents[2].resolve())):
        raise ValueError("Source must be a separate task-owned review copy")
    pinned = [(change, change["nextSha256"]) for change in policy.get("changes", [])]
    pinned += [(entry, entry["sha256"]) for entry in policy.get("admissions", [])]
    for change, expected_hash in pinned:
        payload = plain_file(contained(root, safe_relative(change["sourceRelative"])))
        row = source.files.get(safe_relative(change["logical"]))
        if row is None or row["sha256"] != expected_hash or digest(payload) != row["sha256"]:
            raise ValueError("Applied collection or source changed")
    source.verify()
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("plan", "validate", "apply"))
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--repository", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    repo = args.repository.resolve()
    collection = repo / "packages/assets/collection"
    if args.command == "plan":
        plan(args.policy, args.plan, collection, repo)
    elif args.command == "validate":
        validate(args.policy, args.plan, collection, repo)
    else:
        apply(args.policy, args.plan, collection, repo)


if __name__ == "__main__":
    main()
