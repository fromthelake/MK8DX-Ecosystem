"""Remove this package's container images, but only those nothing else on this computer still uses.

    python tooling/remove_images.py [--dry-run]

Run it from the package folder after `docker compose ... down -v` removed this installation's containers.
The images come from PACKAGE_MANIFEST.json. An image stays when any container on this computer, running or
stopped and of any Compose project (another MK8DX installation, a QA database, another program), was
created from it or names its tag. Docker itself refuses only images of running containers, and an earlier
package could have re-pointed a shared tag; this check keeps both cases safe.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT_LABEL = "com.docker.compose.project"


def docker(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["docker", *args], capture_output=True, text=True, check=False)


def image_id(tag: str, run=docker) -> str | None:
    result = run("image", "inspect", "--format", "{{.Id}}", tag)
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


def containers(run=docker) -> list[dict]:
    """Every container on this computer: its name, Compose project, image ID and the image name it was given."""
    listed = run("ps", "-a", "-q", "--no-trunc")
    if listed.returncode != 0:
        raise SystemExit(f"Docker is not reachable: {listed.stderr.strip()}")
    ids = listed.stdout.split()
    if not ids:
        return []
    inspected = run("inspect", *ids)
    if inspected.returncode != 0:
        raise SystemExit(f"Could not inspect the containers: {inspected.stderr.strip()}")
    rows = []
    for item in json.loads(inspected.stdout):
        config = item.get("Config") or {}
        rows.append({"name": item.get("Name", "").lstrip("/"), "image": item.get("Image", ""),
                     "imageName": config.get("Image", ""),
                     "project": (config.get("Labels") or {}).get(PROJECT_LABEL, "")})
    return rows


def plan(images: list[str], run=docker) -> list[dict]:
    """For each image: remove, keep (and who uses it) or absent."""
    users = containers(run)
    decisions = []
    for tag in images:
        identity = image_id(tag, run)
        if identity is None:
            decisions.append({"image": tag, "action": "absent", "usedBy": []})
            continue
        using = sorted({row["project"] or row["name"] for row in users
                        if row["image"] == identity or row["imageName"] == tag})
        decisions.append({"image": tag, "action": "keep" if using else "remove", "usedBy": using})
    return decisions


def main(argv=None, run=docker) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="only show what would be removed")
    parser.add_argument("--manifest", type=Path, default=ROOT / "PACKAGE_MANIFEST.json")
    args = parser.parse_args(argv)
    images = json.loads(args.manifest.read_text(encoding="utf-8"))["images"]
    failed = False
    for decision in plan(images, run):
        tag = decision["image"]
        if decision["action"] == "absent":
            print(f"not present: {tag}")
        elif decision["action"] == "keep":
            print(f"kept, still used by {', '.join(decision['usedBy'])}: {tag}")
        elif args.dry_run:
            print(f"would remove: {tag}")
        else:
            result = run("image", "rm", tag)
            if result.returncode == 0:
                print(f"removed: {tag}")
            else:
                failed = True
                print(f"not removed: {tag}: {result.stderr.strip()}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
