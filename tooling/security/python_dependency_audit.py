"""Prepare and evaluate the pinned Python manifest audit used by Verify.

OSV-Scanner scans exact versions without resolving or installing the projects.
Every tracked requirements*.txt and pyproject.toml is inventoried. Ranged
requirements must have an exact pin in another tracked manifest.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tomllib
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ALLOWLIST = ROOT / "tooling" / "security" / "python_audit_allowlist.toml"
REQUIREMENT = re.compile(r"^([A-Za-z0-9_.-]+)(?:\[[^]]+\])?(.+)?$")


def tracked_manifests() -> list[Path]:
    names = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0")
    paths = [ROOT / name for name in names if name and
             ((Path(name).name.startswith("requirements") and name.endswith(".txt")) or
              Path(name).name == "pyproject.toml")]
    return sorted(path for path in paths if path.is_file())


def entries(path: Path) -> list[str]:
    if path.name == "pyproject.toml":
        doc = tomllib.loads(path.read_text(encoding="utf-8"))
        project = doc.get("project", {})
        result = list(doc.get("build-system", {}).get("requires", []))
        result.extend(project.get("dependencies", []))
        for extra in project.get("optional-dependencies", {}).values():
            result.extend(extra)
        return result
    return [line.split("#", 1)[0].strip() for line in
            path.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")]


def normalized(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def prepare(out: Path) -> None:
    manifests = tracked_manifests()
    if not manifests:
        raise ValueError("no tracked Python manifests")
    all_entries = {path: entries(path) for path in manifests}
    exact: dict[str, set[str]] = {}
    parsed: dict[Path, list[tuple[str, str]]] = {}
    for path, lines in all_entries.items():
        parsed[path] = []
        for line in lines:
            match = REQUIREMENT.fullmatch(line)
            if not match:
                raise ValueError(f"unsupported requirement in {path.relative_to(ROOT)}: {line}")
            name, spec = normalized(match[1]), (match[2] or "").strip()
            if name.startswith("mk8dx-"):
                continue  # internal wheels are built from the audited source tree
            parsed[path].append((name, spec))
            if spec.startswith("==") and ";" not in spec:
                exact.setdefault(name, set()).add(spec[2:])
    out.mkdir(parents=True, exist_ok=True)
    inventory = []
    for index, (path, values) in enumerate(parsed.items()):
        pins: dict[str, str] = {}
        for name, spec in values:
            if spec.startswith("==") and ";" not in spec:
                pins[name] = spec[2:]
            else:
                choices = exact.get(name, set())
                if len(choices) != 1:
                    raise ValueError(f"range has no single exact companion pin: {name} {spec} in {path.relative_to(ROOT)}")
                pins[name] = next(iter(choices))
        dest = out / f"manifest-{index}" / "requirements.txt"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text("".join(f"{name}=={version}\n" for name, version in sorted(pins.items())),
                        encoding="utf-8")
        inventory.append({"source": path.relative_to(ROOT).as_posix(),
                          "scan": dest.relative_to(out).as_posix(), "pins": len(pins)})
    (out / "inventory.json").write_text(json.dumps(inventory, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {len(inventory)} tracked Python manifests and {sum(x['pins'] for x in inventory)} exact scan entries")


def evaluate(report: Path) -> None:
    data = json.loads(report.read_text(encoding="utf-8-sig"))
    allow = tomllib.loads(ALLOWLIST.read_text(encoding="utf-8"))
    exceptions = allow.get("exception", [])
    today = date.today()
    for item in exceptions:
        if not item.get("reason") or not isinstance(item.get("expires"), date):
            raise ValueError("audit exception needs reason and expiry date")
        if item["expires"] < today:
            raise ValueError(f"expired audit exception: {item['id']}")
    uncovered = set()
    accepted = set()
    for result in data.get("results", []):
        for package in result.get("packages", []):
            name = normalized(package["package"]["name"])
            for group in package.get("groups", []):
                score = group.get("max_severity")
                if score is None:
                    raise ValueError(f"unknown advisory severity: {name} {group.get('ids')}")
                if float(score) < 7.0:
                    continue
                ids = set(group.get("ids", [])) | set(group.get("aliases", []))
                key = (name, sorted(ids)[0])
                if any(normalized(item["package"]) == name and item["id"] in ids
                       for item in exceptions):
                    accepted.add(key)
                else:
                    uncovered.add((name, ",".join(sorted(ids)), score))
    print(f"Python audit: {len(accepted)} allowlisted high/critical findings; {len(uncovered)} unallowlisted")
    for name, ids, score in sorted(uncovered):
        print(f"FAIL {name} {ids} CVSS {score}", file=sys.stderr)
    if uncovered:
        raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("prepare").add_argument("output", type=Path)
    sub.add_parser("evaluate").add_argument("report", type=Path)
    args = parser.parse_args()
    if args.command == "prepare":
        prepare(args.output)
    else:
        evaluate(args.report)


if __name__ == "__main__":
    main()
