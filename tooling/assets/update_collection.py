"""Review an exact asset replacement, then apply it to the internal collection.

The policy and plan live outside the release tree. Each policy entry names an
existing logical resource and pins both its previous and proposed SHA-256.
Unknown files, new roles, catalog/seed JSON and model changes require a separate
reviewed admission. This command never executes code in an upstream directory.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile

from shared_asset_source import SharedAssetSource, contained, json_bytes, object_path, safe_relative

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico"}
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
    changes = policy.get("changes")
    if not isinstance(changes, list) or not changes:
        raise ValueError("Explicit replacements are required")
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
    for name in VIEWS:
        view = read_json(repo / "packages/assets" / f"{name}-selection-v1.json")
        if view["collectionVersion"] != manifest["releaseVersion"]:
            raise ValueError("Consumer view has drifted")
    if read_json(repo / "compatibility.json")["assetCollectionVersion"] != manifest["releaseVersion"]:
        raise ValueError("Compatibility record has drifted")
    return manifest, {"baseManifestSha256": source.manifest_sha256,
                      "baseVersion": manifest["releaseVersion"], "nextVersion": version}, resolved


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
        new_manifest["files"][logical]["sha256"] = change["nextSha256"]
        new_manifest["files"][logical]["sizeBytes"] = change["sizeBytes"]
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
    backups = {path: path.read_bytes() for path in outputs}
    created = []
    removed = {}
    try:
        for change in changes:
            payload = plain_file(contained(Path(policy["sourceRoot"]), change["sourceRelative"]))
            target = contained(collection, object_path(change["nextSha256"]))
            if target.exists():
                if digest(plain_file(target)) != change["nextSha256"]:
                    raise ValueError("Existing object has changed")
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(payload)
                created.append(target)
        for path, content in outputs.items():
            with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
                stream.write(content)
                temporary = Path(stream.name)
            os.replace(temporary, path)
        retained_hashes = {row["sha256"] for row in new_manifest["files"].values()}
        for change in changes:
            old_hash = change["previousSha256"]
            if old_hash not in retained_hashes:
                old_object = contained(collection, object_path(old_hash))
                if old_object not in removed:
                    removed[old_object] = plain_file(old_object)
                    old_object.unlink()
        SharedAssetSource(collection).verify()
    except Exception:
        for path, content in backups.items():
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
    for change in policy["changes"]:
        payload = plain_file(contained(root, safe_relative(change["sourceRelative"])))
        row = source.files.get(safe_relative(change["logical"]))
        if row is None or row["sha256"] != change["nextSha256"] or digest(payload) != row["sha256"]:
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
