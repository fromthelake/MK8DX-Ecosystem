"""Build A3 Windows and B2 Passenger ZIPs from this one clean repository."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCS = ("docs/install/MK8DX_Handleiding_NL.docx", "docs/install/MK8DX_Handleiding_NL.txt",
        "docs/install/MK8DX_User_Guide_EN.docx", "docs/install/MK8DX_User_Guide_EN.txt")


def digest(path):
    with path.open("rb") as stream: return hashlib.file_digest(stream, "sha256").hexdigest()


def copy_file(source, target):
    if not source.is_file() or source.is_symlink(): raise ValueError(f"Missing or linked package input: {source}")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


def copy_tree(source, target):
    if not source.is_dir() or source.is_symlink(): raise ValueError(f"Missing or linked directory: {source}")
    for path in source.rglob("*"):
        if path.is_symlink(): raise ValueError(f"Linked package input: {path}")
        if path.is_file(): copy_file(path, target / path.relative_to(source))


def content(stage):
    copy_tree(ROOT / "backend/api/dist", stage / "api/dist")
    for name in ("package.json", "package-lock.json"):
        copy_file(ROOT / "backend/api" / name, stage / "api" / name)
    for name in ("index.html", "manifest.webmanifest", "sw.js", "assetlinks.json"):
        copy_file(ROOT / "apps/timetrials-web" / name, stage / "web" / name)
    copy_tree(ROOT / "apps/timetrials-web/styles", stage / "web/styles")
    copy_tree(ROOT / "apps/timetrials-web/dist", stage / "web/dist")
    copy_tree(ROOT / "apps/timetrials-scanner-web/dist", stage / "scanner")
    copy_file(ROOT / "packages/assets/schema9-asset-catalog-v1.json",
              stage / "packages/assets/schema9-asset-catalog-v1.json")
    copy_file(ROOT / "infrastructure/mysql/migration-catalog-v1.json", stage / "mysql/migration-catalog-v1.json")
    copy_tree(ROOT / "infrastructure/mysql/migrations", stage / "mysql/migrations")
    copy_tree(ROOT / "infrastructure/mysql/reference", stage / "mysql/reference")
    for name in ("tooling/install.py", "tooling/native_install.py", "LICENSE",
                 "LICENSE_SCOPE.md", "SOURCE_FOR_BINARIES.txt",
                 "docs/THIRD_PARTY_MATERIALS.md", *DOCS):
        copy_file(ROOT / name, stage / name)
    copy_file(ROOT / "infrastructure/native/apache-mk8dx-local.conf",
              stage / "apache/apache-mk8dx-local.conf")
    subprocess.run(["node", str(ROOT / "tooling/assets/materialize_collection.mjs"),
                    "web", str(stage / "assets")], cwd=ROOT, check=True)


def write_zip(stage, output, route, revision):
    files = sorted(p for p in stage.rglob("*") if p.is_file() and p.name != "PACKAGE_MANIFEST.json")
    receipt = {"schemaVersion": "mk8dx.non-docker-bundle.v1", "route": route,
               "revision": revision, "files": {
                   p.relative_to(stage).as_posix(): {"bytes": p.stat().st_size, "sha256": digest(p)} for p in files}}
    (stage / "PACKAGE_MANIFEST.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    with zipfile.ZipFile(output, "x", allowZip64=True) as archive:
        for path in sorted(stage.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(stage).as_posix(),
                              compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
    return {"name": output.name, "bytes": output.stat().st_size, "sha256": digest(output),
            "entries": len(files) + 1}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--mailpit-archive", type=Path, required=True)
    parser.add_argument("--mariadb-archive", type=Path, required=True)
    parser.add_argument("--revision", required=True, help="package revision shown to users, for example r14")
    args = parser.parse_args()
    output = args.output_dir.resolve()
    if output.is_relative_to(ROOT) or not output.is_dir(): raise SystemExit("Existing output folder outside repository required")
    with tempfile.TemporaryDirectory(prefix="mk8dx-native-package-", dir=output) as temp:
        base = Path(temp) / "base"
        content(base)
        hosted = Path(temp) / "hosted"
        shutil.copytree(base, hosted)
        (hosted / "README-FIRST.txt").write_text(
            f"MK8DX B2 Passenger/MariaDB package {args.revision}\n"
            "Open docs/install/MK8DX_Handleiding_NL.docx or MK8DX_User_Guide_EN.docx.\n"
            "Keep the application root outside public_html; run npm ci --omit=dev in api.\n",
            encoding="utf-8")
        hosted_result = write_zip(hosted, output / f"mk8dx-mijnhost-node-{args.revision}.zip", "B2", args.revision)
        windows = Path(temp) / "windows"
        shutil.copytree(base, windows)
        with zipfile.ZipFile(args.mailpit_archive) as mailpit:
            expected = ("mailpit.exe", "LICENSE")
            if any(name not in mailpit.namelist() for name in expected): raise ValueError("Mailpit archive is incomplete")
            (windows / "bin").mkdir()
            for name in expected:
                (windows / "bin" / name).write_bytes(mailpit.read(name))
        if digest(args.mariadb_archive) != "d62986d433eeebfde218560b276103831604a61e929e87f1a17f5aebd80257e2":
            raise ValueError("MariaDB 11.4.13 download differs from its official SHA-256")
        copy_file(args.mariadb_archive, windows / "bin/mariadb-11.4.13-winx64.zip")
        (windows / "README-FIRST.txt").write_text(
            f"MK8DX A3 Windows/XAMPP/Node package {args.revision}\n"
            "Open docs/install/MK8DX_Handleiding_NL.docx or MK8DX_User_Guide_EN.docx.\n"
            "Your installation data belongs outside this folder.\n",
            encoding="utf-8")
        copy_file(ROOT / "Start-MK8DX-No-Docker.cmd", windows / "Start-MK8DX-No-Docker.cmd")
        copy_file(ROOT / "tooling/configure_xampp.ps1", windows / "tooling/configure_xampp.ps1")
        subprocess.run(["npm.cmd", "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
                       cwd=windows / "api", check=True)
        windows_result = write_zip(windows, output / f"mk8dx-xampp-node-windows-{args.revision}.zip", "A3", args.revision)
    print(json.dumps({"B2": hosted_result, "A3": windows_result}, indent=2))


if __name__ == "__main__": main()
