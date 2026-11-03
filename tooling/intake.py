"""Reviewed three-way software intake. Config and audit state stay outside the public tree.

Commands: init, plan, resolve, validate, apply, recover, migrate-policy. Plan is read-only
with respect to the public tree; apply requires a clean Git worktree.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path, PurePosixPath


OMIT = {".git", "node_modules", "dist", "coverage", ".cache", "__pycache__"}
DEFAULT_BLOCK = [r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
                 r"(?i)(?:C:\\Users\\|/Users/[^/]+/|/home/[^/]+/\.ssh/)",
                 r"(?i)(?:private[_ -]?marker|https?://[^\s/]*owner[-.]private)"]


def is_reparse(path):
    try:
        info = path.lstat()
    except OSError:
        return False
    return path.is_symlink() or bool(getattr(info, "st_file_attributes", 0) &
                                      getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0))


def canonical(data):
    return json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def safe_rel(value):
    if not isinstance(value, str) or not value or "\\" in value or ":" in value:
        raise ValueError("Invalid relative path")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("", ".", "..") or part in OMIT for part in path.parts):
        raise ValueError("Unsafe relative path")
    return value


def files(root):
    if is_reparse(root) or not root.is_dir():
        raise ValueError("Intake root is missing or unsafe")
    result = {}
    for directory, dirs, names in os.walk(root, followlinks=False):
        if any(is_reparse(Path(directory) / d) for d in dirs):
            raise ValueError("Symlink directory in intake tree")
        dirs[:] = sorted(d for d in dirs if d not in OMIT)
        for name in sorted(names):
            path = Path(directory) / name
            relative = path.relative_to(root).as_posix()
            if is_reparse(path) or not path.is_file():
                raise ValueError("Symlink or special file in intake tree")
            result[safe_rel(relative)] = path.read_bytes()
    lowered = [path.casefold() for path in result]
    if len(set(lowered)) != len(lowered):
        raise ValueError("Case-colliding intake paths")
    return result


def fingerprint(tree):
    return sha(canonical({path: sha(data) for path, data in sorted(tree.items())}))


def atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        stream.write(data)
        temp = Path(stream.name)
    os.replace(temp, path)


def config(path):
    raw = Path(path).read_bytes()
    data = json.loads(raw)
    for name in ("source", "public", "state"):
        data[name] = str(Path(data[name]).resolve())
    source, public, state = (Path(data[x]) for x in ("source", "public", "state"))
    if not source.is_dir() or not public.is_dir() or source == public or state == public or public in state.parents:
        raise ValueError("Intake roots are invalid")
    mapping = data["mapping"]
    if not isinstance(mapping, dict) or not mapping:
        raise ValueError("Explicit source-to-public mapping is required")
    for key, target in mapping.items():
        safe_rel(key); safe_rel(target)
    if len(set(x.casefold() for x in mapping.values())) != len(mapping):
        raise ValueError("Duplicate or case-colliding public target")
    for name in ("scanRoots", "deletions", "excluded"):
        data.setdefault(name, [])
        for path in data[name]:
            safe_rel(path)
    data.setdefault("replacements", {})
    data.setdefault("blockedPatterns", [])
    data.setdefault("commands", [])
    data.setdefault("impactRules", [])
    data.setdefault("componentCommands", {})
    data.setdefault("binaryPinned", {})
    data.setdefault("fixedContent", {})
    for path in (*data["binaryPinned"], *data["fixedContent"]):
        safe_rel(path)
        if path not in mapping:
            raise ValueError("Pinned or fixed source has no mapping")
    if not isinstance(data.get("policyVersion"), str) or not data["policyVersion"]:
        raise ValueError("Policy version is required")
    return data, sha(raw)


def pointer(state):
    return json.loads((state / "current.json").read_text(encoding="utf-8"))


def ensure_no_pending(state):
    for journal in (state / "plans").glob("*/journal.json") if (state / "plans").exists() else []:
        if json.loads(journal.read_text(encoding="utf-8"))["status"] == "applying":
            raise ValueError("Interrupted apply requires recover first")


def save_baseline(state, identifier, content):
    destination = state / "baselines" / identifier
    if destination.exists():
        if files(destination) != content:
            raise ValueError("Immutable baseline drift")
        return destination
    destination.mkdir(parents=True)
    for path, data in content.items():
        target = destination / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    return destination


def init(data, policy, baseline_dir):
    state = Path(data["state"])
    if (state / "current.json").exists():
        raise ValueError("Intake already initialised")
    baseline = files(baseline_dir)
    allowed = set(data["mapping"].values())
    if not baseline or not set(baseline).issubset(allowed):
        raise ValueError("Unmapped baseline content")
    identity = fingerprint(baseline)
    save_baseline(state, identity, baseline)
    atomic(state / "current.json", canonical({"baseline": identity, "policy": policy}))
    print(json.dumps({"baseline": identity, "files": len(baseline)}))


def source_snapshot(data):
    source = Path(data["source"])
    mapping = data["mapping"]
    observed = {}
    for root in data["scanRoots"]:
        folder = source / root
        if not folder.is_dir() or is_reparse(folder):
            raise ValueError("Source scan root is missing or unsafe")
        for path, content in files(folder).items():
            relative = f"{root}/{path}"
            if relative not in data["excluded"]:
                observed[relative] = content
    for relative in mapping:
        if relative in data["deletions"]:
            if (source / relative).exists():
                raise ValueError("Declared deletion still exists")
            continue
        path = source / relative
        if is_reparse(path) or not path.is_file():
            raise ValueError("Mapped source is missing or unreadable")
        observed[relative] = path.read_bytes()
    unknown = set(observed) - set(mapping)
    if unknown:
        raise ValueError("Unknown source file requires explicit admission: " + ", ".join(sorted(unknown)[:5]))
    if len(set(x.casefold() for x in observed)) != len(observed):
        raise ValueError("Case-colliding source paths")
    result = {}
    patterns = [re.compile(p) for p in (*DEFAULT_BLOCK, *data["blockedPatterns"])]
    for relative, content in observed.items():
        pinned_binary = data["binaryPinned"].get(relative)
        if pinned_binary is not None:
            if sha(content) != pinned_binary:
                raise ValueError("Pinned binary changed; separate admission required")
            result[mapping[relative]] = content
            continue
        fixed = data["fixedContent"].get(relative)
        if fixed is not None:
            if not isinstance(fixed, dict) or sha(content) != fixed.get("sourceSha256"):
                raise ValueError("Fixed private source changed; separate review required")
            content = fixed["publicText"].encode("utf-8")
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            raise ValueError("Binary source requires separate reviewed admission")
        for old, new in data["replacements"].items():
            if not old:
                raise ValueError("Empty replacement key")
            text = text.replace(old, new)
        if any(pattern.search(text) for pattern in patterns):
            raise ValueError("Private content or endpoint marker rejected")
        result[mapping[relative]] = text.encode("utf-8")
    return result


def merge_three(current, baseline, updated):
    with tempfile.TemporaryDirectory(prefix="mk8dx-merge-") as temporary:
        paths = [Path(temporary) / name for name in ("current", "baseline", "updated")]
        for path, data in zip(paths, (current, baseline, updated)):
            path.write_bytes(data)
        result = subprocess.run(["git", "merge-file", "-p", "--diff3", "-L", "PUBLIC",
                                 "-L", "BASELINE", "-L", "UPSTREAM", *map(str, paths)],
                                capture_output=True)
        # git merge-file exits with the number of conflicts (at most 127); an error is outside that range.
        if not 0 <= result.returncode <= 127:
            raise ValueError("Three-way merge failed")
        return result.returncode == 0, result.stdout


def select_checks(data, changed):
    rules = data["impactRules"]
    if not rules:
        return [], data["commands"], []
    components = set()
    for path in changed:
        matched = [rule for rule in rules if path.startswith(rule["prefix"])]
        if not matched:
            components.add("all")
        for rule in matched:
            components.update(rule["components"])
    commands = []
    missing = []
    for component in sorted(components):
        checks = data["componentCommands"].get(component)
        if not checks:
            missing.append(component)
        else:
            commands.extend(checks)
    return sorted(components), commands, missing


def plan(data, policy):
    state, public = Path(data["state"]), Path(data["public"])
    ensure_no_pending(state)
    previous = pointer(state)
    if previous["policy"] != policy:
        raise ValueError("Policy changed; migrate-policy requires reviewed baseline")
    old = files(state / "baselines" / previous["baseline"])
    live = files(public)
    upstream = source_snapshot(data)
    proposed, conflicts, conflict_details = {}, [], {}
    for target in sorted(set(old) | set(upstream)):
        before, current, after = old.get(target), live.get(target), upstream.get(target)
        if after == before:
            continue
        if target.endswith(".sql") and before is not None:
            conflicts.append(target + ": applied SQL migration is immutable")
            continue
        if before is None:
            if current == after:
                continue  # the public tree already holds exactly these bytes
            if current is not None:
                conflicts.append(target + ": new source collides with public file")
            else:
                proposed[target] = after
        elif after is None:
            if current == before:
                proposed[target] = None
            else:
                conflicts.append(target + ": modified public deletion")
        elif current == before:
            proposed[target] = after
        elif current == after:
            continue
        elif current is None or b"\0" in current + before + after:
            conflicts.append(target + ": removed or binary public file")
        else:
            clean, merged = merge_three(current, before, after)
            if clean:
                proposed[target] = merged
            else:
                conflicts.append(target + ": overlapping edits")
                conflict_details[target] = merged
    patterns = [re.compile(p) for p in (*DEFAULT_BLOCK, *data["blockedPatterns"])]
    # A binary-pinned source was admitted by its exact bytes; when those exact bytes are proposed unchanged, the
    # pattern check that source_snapshot already skipped for it is skipped here too (a merged variant is still checked).
    pinned = {data["mapping"][source]: digest for source, digest in data["binaryPinned"].items()}
    for target, content in proposed.items():
        if content is None:
            continue
        if target in pinned and sha(content) == pinned[target]:
            continue
        try:
            merged_text = content.decode("utf-8")
        except UnicodeDecodeError:
            raise ValueError("Merged binary content requires separate review")
        if any(pattern.search(merged_text) for pattern in patterns):
            raise ValueError("Private content detected after merge")
    components, commands, missing_checks = select_checks(data, proposed)
    identity_fields = {"policy": policy, "baseline": previous["baseline"],
                       "target": fingerprint(live), "source": fingerprint(upstream),
                       "changes": {k: None if v is None else sha(v) for k, v in proposed.items()},
                       "conflicts": conflicts, "components": components,
                       "commands": commands, "missingChecks": missing_checks}
    identity = sha(canonical(identity_fields))
    directory = state / "plans" / identity
    directory.mkdir(parents=True, exist_ok=True)
    for path, content in conflict_details.items():
        destination = directory / "conflicts" / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
    for name, content in (("u1", upstream), ("candidate", {**live, **proposed})):
        root = directory / name
        if root.exists():
            if fingerprint(files(root)) != fingerprint({k: v for k, v in content.items() if v is not None}):
                raise ValueError("Existing plan staging drifted")
            continue
        root.mkdir()
        for path, value in content.items():
            if value is not None:
                destination = root / path
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(value)
    status = "blocked" if conflicts or missing_checks else ("noop" if upstream == old and not proposed else "ready")
    report = {**identity_fields, "planId": identity, "status": status}
    atomic(directory / "plan.json", canonical(report))
    print(json.dumps({"planId": identity, "status": report["status"], "changes": list(proposed),
                      "components": components, "conflicts": conflicts,
                      "missingChecks": missing_checks}))


def load_plan(data, identifier):
    if not re.fullmatch(r"[a-f0-9]{64}", identifier):
        raise ValueError("Invalid plan ID")
    directory = Path(data["state"]) / "plans" / identifier
    report = json.loads((directory / "plan.json").read_text(encoding="utf-8"))
    if report["planId"] != identifier or sha(canonical({k: v for k, v in report.items() if k not in ("planId", "status")})) != identifier:
        raise ValueError("Plan identity drift")
    return directory, report


def resolve_plan(data, policy, identifier, resolution_dir):
    directory, report = load_plan(data, identifier)
    if report["status"] != "blocked" or not report["conflicts"]:
        raise ValueError("Plan has no file conflicts to resolve")
    recheck(data, policy, report)
    manifest = json.loads((resolution_dir / "resolutions.json").read_text(encoding="utf-8"))
    expected = {safe_rel(item.split(": ", 1)[0]) for item in report["conflicts"]}
    if not isinstance(manifest, dict) or set(manifest) != expected:
        raise ValueError("Resolution set must match every conflict exactly")
    resolved = {}
    resolution_files = files(resolution_dir)
    if set(resolution_files) != {"resolutions.json"} | {path for path, digest in manifest.items() if digest is not None}:
        raise ValueError("Unexpected resolution files")
    patterns = [re.compile(p) for p in (*DEFAULT_BLOCK, *data["blockedPatterns"])]
    for path, digest in manifest.items():
        if digest is None:
            resolved[path] = None
            continue
        if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError("Invalid resolution hash")
        content = resolution_files[path]
        if sha(content) != digest:
            raise ValueError("Resolution bytes changed")
        try:
            candidate_text = content.decode("utf-8")
        except UnicodeDecodeError:
            raise ValueError("Binary resolution requires separate admission")
        if any(pattern.search(candidate_text) for pattern in patterns):
            raise ValueError("Private content in resolution")
        resolved[path] = content
    fields = {k: v for k, v in report.items() if k not in ("planId", "status")}
    fields["parentPlan"] = identifier
    fields["conflicts"] = []
    fields["resolutions"] = {k: None if v is None else sha(v) for k, v in resolved.items()}
    fields["changes"] = {**fields["changes"], **fields["resolutions"]}
    new_id = sha(canonical(fields))
    target = Path(data["state"]) / "plans" / new_id
    if target.exists():
        raise ValueError("Resolution plan already exists")
    target.mkdir(parents=True)
    for name in ("u1", "candidate"):
        content = files(directory / name)
        if name == "candidate":
            content.update(resolved)
        for path, value in content.items():
            if value is None:
                continue
            destination = target / name / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(value)
    status = "blocked" if fields["missingChecks"] else "ready"
    atomic(target / "plan.json", canonical({**fields, "planId": new_id, "status": status}))
    print(json.dumps({"planId": new_id, "status": status,
                      "resolutions": list(resolved), "missingChecks": fields["missingChecks"]}))


def recheck(data, policy, report):
    current = pointer(Path(data["state"]))
    if current != {"baseline": report["baseline"], "policy": policy}:
        raise ValueError("Baseline or policy changed")
    if fingerprint(files(Path(data["public"]))) != report["target"]:
        raise ValueError("Public target changed since plan")
    if fingerprint(source_snapshot(data)) != report["source"]:
        raise ValueError("Source snapshot changed since plan")


def validate(data, policy, identifier):
    directory, report = load_plan(data, identifier)
    if report["status"] != "ready":
        raise ValueError("Conflicted plan cannot validate")
    recheck(data, policy, report)
    candidate = directory / "candidate"
    for command in report["commands"]:
        if not isinstance(command, list) or not command or not all(isinstance(x, str) for x in command):
            raise ValueError("Invalid validation command")
        executable = shutil.which(command[0])
        if executable is None:
            raise ValueError(f"Validation executable is unavailable: {command[0]}")
        subprocess.run([executable, *command[1:]], cwd=candidate, check=True)
    stamp = {"planId": identifier, "candidate": fingerprint(files(candidate)), "commands": report["commands"]}
    atomic(directory / "validated.json", canonical(stamp))
    print(json.dumps({"planId": identifier, "validated": True, "checks": len(report["commands"])}))


def git_clean(public):
    result = subprocess.run(["git", "-C", str(public), "status", "--porcelain", "--untracked-files=all"],
                            capture_output=True, text=True, check=True)
    return result.stdout == ""


def apply(data, policy, identifier):
    state, public = Path(data["state"]), Path(data["public"])
    ensure_no_pending(state)
    directory, report = load_plan(data, identifier)
    if report["status"] == "noop":
        recheck(data, policy, report)
        print(json.dumps({"planId": identifier, "applied": 0, "unchanged": True}))
        return
    if report["status"] != "ready":
        raise ValueError("Conflicted plan cannot apply")
    recheck(data, policy, report)
    if not git_clean(public):
        raise ValueError("Public Git target is dirty")
    stamp = json.loads((directory / "validated.json").read_text(encoding="utf-8"))
    candidate = directory / "candidate"
    if stamp != {"planId": identifier, "candidate": fingerprint(files(candidate)), "commands": report["commands"]}:
        raise ValueError("Validation evidence drift")
    updated = files(directory / "u1")
    if fingerprint(updated) != report["source"]:
        raise ValueError("Staged source drift")
    changes = report["changes"]
    backups = directory / "backups"
    backups.mkdir(exist_ok=True)
    live = files(public)
    for path in changes:
        if path in live:
            destination = backups / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(live[path])
    journal = {"status": "applying", "previous": {"baseline": report["baseline"], "policy": policy},
               "changes": list(changes), "existing": [p for p in changes if p in live]}
    atomic(directory / "journal.json", canonical(journal))
    for index, (path, expected) in enumerate(changes.items(), 1):
        destination = public / path
        if expected is None:
            destination.unlink()
        else:
            content = (candidate / path).read_bytes()
            if sha(content) != expected:
                raise ValueError("Candidate file drift")
            atomic(destination, content)
        if os.environ.get("MK8DX_INTAKE_TEST_INTERRUPT_AFTER") == str(index):
            raise RuntimeError("Simulated interrupted apply; run recover")
    save_baseline(state, identifier, updated)
    atomic(state / "current.json", canonical({"baseline": identifier, "policy": policy}))
    journal["status"] = "committed"
    atomic(directory / "journal.json", canonical(journal))
    print(json.dumps({"planId": identifier, "applied": len(changes), "baseline": identifier}))


def recover(data, identifier):
    state, public = Path(data["state"]), Path(data["public"])
    directory, _ = load_plan(data, identifier)
    journal = json.loads((directory / "journal.json").read_text(encoding="utf-8"))
    if journal["status"] == "committed":
        print(json.dumps({"planId": identifier, "recovery": "already_committed"}))
        return
    if journal["status"] != "applying":
        raise ValueError("Unknown journal state")
    for path in journal["changes"]:
        destination = public / path
        if path in journal["existing"]:
            atomic(destination, (directory / "backups" / path).read_bytes())
        elif destination.exists():
            destination.unlink()
    atomic(state / "current.json", canonical(journal["previous"]))
    journal["status"] = "recovered"
    atomic(directory / "journal.json", canonical(journal))
    print(json.dumps({"planId": identifier, "recovery": "rolled_back"}))


def migrate_policy(data, policy, baseline_dir, old_policy):
    state = Path(data["state"])
    ensure_no_pending(state)
    previous = pointer(state)
    if previous["policy"] != old_policy or old_policy == policy:
        raise ValueError("Policy migration confirmation mismatch")
    baseline = files(baseline_dir)
    if set(baseline) != set(files(state / "baselines" / previous["baseline"])):
        raise ValueError("Policy migration baseline mapping changed without explicit path review")
    identity = fingerprint(baseline)
    save_baseline(state, identity, baseline)
    atomic(state / "current.json", canonical({"baseline": identity, "policy": policy}))
    print(json.dumps({"policyMigration": True, "baseline": identity}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["init", "plan", "resolve", "validate", "apply", "recover", "migrate-policy"])
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--baseline-dir", type=Path)
    parser.add_argument("--plan-id")
    parser.add_argument("--old-policy-id")
    parser.add_argument("--resolution-dir", type=Path)
    args = parser.parse_args()
    try:
        data, policy = config(args.config)
        if args.action == "init":
            init(data, policy, args.baseline_dir)
        elif args.action == "plan":
            plan(data, policy)
        elif args.action == "resolve":
            if not args.plan_id or not args.resolution_dir:
                raise ValueError("resolve requires plan ID and resolution directory")
            resolve_plan(data, policy, args.plan_id, args.resolution_dir)
        elif args.action == "validate":
            validate(data, policy, args.plan_id)
        elif args.action == "apply":
            apply(data, policy, args.plan_id)
        elif args.action == "recover":
            recover(data, args.plan_id)
        else:
            migrate_policy(data, policy, args.baseline_dir, args.old_policy_id)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError, TypeError, KeyError) as error:
        print(f"Intake refused/failed: {error}", file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
