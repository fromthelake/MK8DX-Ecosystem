"""Build a complete local LiveTrial Windows package from this repository."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import zipfile
import time
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DESKTOP = REPOSITORY_ROOT / "apps" / "timetrials-desktop"
VISION_REQUIREMENTS = DESKTOP / "vision-runtime" / "requirements.txt"
PREPARE_ENGINE = REPOSITORY_ROOT / "tooling/livetrial/prepare_engine.py"

# Only what the product actually reads at runtime travels with it.
RESOURCE_FILES = (
    Path("packages/domain/schema-catalog-v1.json"),
    Path("packages/assets/schema9-asset-catalog-v1.json"),
)
RESOURCE_TREES = (
    Path("packages/domain/schemas"),
    Path("packages/local-outbox/reference/python"),
    Path("apps/timetrials-desktop/dashboard"),
)
# The calibration corpora are dashboard-only and account for most of the
# engine's size, so they stay out of an owner package.
ENGINE_EXCLUDED = ("runs", "__pycache__")


class BuildError(RuntimeError):
    """A bounded packaging failure."""


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--engine-venv", required=True)
    parser.add_argument("--version", default="1.0")
    parser.add_argument(
        "--product-icon",
        required=False,
        help="optional reviewed .png or .ico embedded in both executables",
    )
    parser.add_argument(
        "--embedded-python",
        required=False,
        help="python-3.12.x-embed-amd64.zip from python.org",
    )
    return parser.parse_args()


# The preserved engine snapshot is never edited; bounded product fixes to it
# live as a working copy under apps/timetrials-desktop/engine-overlay with the
# engine's own layout, and are laid over the copied snapshot at package time.
# An overlay file normally replaces an existing engine file (tests/integration
# checks that). A new engine module is allowed only when it is named here: the
# engine stays ONE engine (the owner's rule, 2026-09-28), and a feature that
# needs its own module gets it inside the engine instead of swelling engine.py.
ENGINE_OVERLAY = REPOSITORY_ROOT / "apps" / "timetrials-desktop" / "engine-overlay"
ENGINE_OVERLAY_ADDITIONS = frozenset({
    # the Select-a-Ghost panel and ghost replays (2026-09-28)
    "livetrial/livetrial/ghostmenu.py",
})
# A Clean Assets RELEASE is exactly these root entries (the schema-9 release
# baseline's `rootEntries`). The owner's working folder also holds input videos,
# label sets, cut-outs, backups and dist zips — tens of GB that must never ship
# (a first 3.25.0 build copied the whole folder: 28.6 GB). Copy the allow-list.
CLEAN_ASSETS_RELEASE_ENTRIES = ("database.json", "README.md", "images")


def _apply_engine_overlay(engine_target: Path) -> list[str]:
    applied: list[str] = []
    if not ENGINE_OVERLAY.is_dir():
        return applied
    for source in sorted(ENGINE_OVERLAY.rglob("*")):
        if not source.is_file() or "__pycache__" in source.parts:
            continue
        relative = source.relative_to(ENGINE_OVERLAY)
        target = engine_target / relative
        if relative.as_posix() in ENGINE_OVERLAY_ADDITIONS:
            if target.exists():
                raise BuildError(f"engine overlay addition already exists in the engine: {relative}")
            target.parent.mkdir(parents=True, exist_ok=True)
        elif not target.is_file():
            raise BuildError(f"engine overlay file has no engine counterpart: {relative}")
        shutil.copy2(source, target)
        applied.append(relative.as_posix())
    print(f"engine overlay applied: {len(applied)} file(s)")
    return applied


def _copy_tree(source: Path, target: Path) -> None:
    if not source.is_dir():
        raise BuildError(f"missing source directory: {source}")
    shutil.copytree(
        source,
        target,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        dirs_exist_ok=True,
    )


# Two executables share one ``_internal`` folder: the visual app a normal person
# double-clicks (a windowed program that opens the dashboard, ADR-0208), and the
# flag-driven command line for power users, scripted validation and the
# troubleshooting menu (``LiveTrialCli menu``). Both are the same product code.
PRODUCT_EXECUTABLES = (
    ("LiveTrial", "livetrial_desktop_app.py", False),
    ("LiveTrialCli", "livetrial_product_cli.py", True),
)
_HIDDEN_IMPORTS = (
    "jsonschema",
    "referencing",
    "livetrial_product_cli",
    "livetrial_accounts",
    "livetrial_runtime_root",
    "livetrial_capture_requirements",
    "livetrial_app",
    "livetrial_desktop_app",
)
# The canonical validator is imported through a path injected at runtime, so
# PyInstaller's static analysis never sees it: collect the whole validation
# stack explicitly.
_COLLECT_ALL = ("jsonschema", "jsonschema_specifications", "referencing", "rpds", "attrs")
# Build-time leftovers inside the engine's site-packages that no Python
# process ever loads: C headers and static import libraries. Leaving them out
# keeps the package well under the hosting budget without touching anything
# the engine imports.
INTERPRETER_EXCLUDED_DIRECTORIES = ("torch/include",)
INTERPRETER_EXCLUDED_SUFFIXES = (".lib",)


def _spec_text(product_icon: Path | None = None) -> str:
    """A PyInstaller spec with one Analysis per executable and one COLLECT."""
    collect_calls = "\n".join(
        f"    _d, _b, _h = collect_all({name!r}); datas += _d; binaries += _b; hiddenimports += _h"
        for name in _COLLECT_ALL
    )
    lines = [
        "# Generated by tooling/livetrial/build_windows_package.py",
        "from PyInstaller.utils.hooks import collect_all",
        "",
        f"desktop = {str(DESKTOP)!r}",
        f"hidden = {list(_HIDDEN_IMPORTS)!r}",
        f"product_icon = {str(product_icon)!r}" if product_icon is not None else "product_icon = None",
        "",
        "def _collected():",
        "    datas, binaries, hiddenimports = [], [], list(hidden)",
        collect_calls,
        "    return datas, binaries, hiddenimports",
        "",
        "exes = []",
        "collected = []",
    ]
    for name, script, console in PRODUCT_EXECUTABLES:
        lines += [
            "datas, binaries, hiddenimports = _collected()",
            f"a_{name} = Analysis([desktop + '/' + {script!r}], pathex=[desktop], "
            "binaries=binaries, datas=datas, hiddenimports=hiddenimports, "
            "noarchive=False)",
            f"pyz_{name} = PYZ(a_{name}.pure)",
            f"exes.append(EXE(pyz_{name}, a_{name}.scripts, [], exclude_binaries=True, "
            f"name={name!r}, console={console!r}, upx=False, icon=product_icon))",
            f"collected += [a_{name}.binaries, a_{name}.datas]",
        ]
    lines += [
        "COLLECT(*exes, *collected, strip=False, upx=False, name='LiveTrial')",
        "",
    ]
    return "\n".join(lines)


def _freeze_product(build_root: Path, output: Path, product_icon: Path | None = None) -> Path:
    """Freeze both product executables with PyInstaller into one folder."""
    work = build_root / "pyinstaller"
    work.mkdir(parents=True, exist_ok=True)
    spec = work / "LiveTrial.spec"
    spec.write_text(_spec_text(product_icon), encoding="utf-8")
    command = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm", "--clean",
        "--distpath", str(output.parent),
        "--workpath", str(work / "build"),
        str(spec),
    ]
    result = subprocess.run(command, check=False)
    if result.returncode != 0:
        raise BuildError("PyInstaller failed")
    frozen = output.parent / "LiveTrial"
    if not frozen.is_dir():
        raise BuildError("PyInstaller produced no output directory")
    for name, _script, _console in PRODUCT_EXECUTABLES:
        if not (frozen / f"{name}.exe").is_file():
            raise BuildError(f"PyInstaller produced no {name}.exe")
    return frozen



def _install_embedded_interpreter(
    embedded_zip: str | None,
    engine_venv: Path,
    resource_root: Path,
) -> dict:
    pins = [line.split("==", 1)[1].strip() for line in
            VISION_REQUIREMENTS.read_text(encoding="utf-8").splitlines()
            if line.lower().startswith("pillow==")]
    if len(pins) != 1:
        raise BuildError("LiveTrial vision manifest must have one exact Pillow pin")
    python = engine_venv / "Scripts" / "python.exe"
    try:
        installed = subprocess.run(
            [str(python), "-c",
             "import importlib.metadata as m; print(m.version('Pillow'))"],
            check=True, capture_output=True, text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as error:
        raise BuildError("cannot verify Pillow in --engine-venv") from error
    if installed != pins[0]:
        raise BuildError(f"engine venv Pillow {installed} does not match active manifest {pins[0]}")
    if not embedded_zip:
        raise BuildError(
            "--embedded-python is required: a copied virtual environment "
            "still depends on the Python that created it",
        )
    archive_path = Path(embedded_zip).resolve()
    if not archive_path.is_file():
        raise BuildError(f"missing embeddable Python archive: {archive_path}")
    runtime = resource_root / "python-runtime"
    if runtime.exists():
        shutil.rmtree(runtime)
    runtime.mkdir(parents=True)
    with zipfile.ZipFile(archive_path) as archive:
        archive.extractall(runtime)
    # The embeddable distribution ignores site-packages unless its path file
    # says otherwise.
    path_files = list(runtime.glob("python*._pth"))
    if not path_files:
        raise BuildError("embeddable Python archive has no ._pth file")
    lines = path_files[0].read_text(encoding="utf-8").splitlines()
    if "site-packages" not in lines:
        lines.append("site-packages")
    if "import site" not in [line.strip() for line in lines]:
        lines.append("import site")
    newline = chr(10)
    path_files[0].write_text(newline.join(lines) + newline, encoding="utf-8")
    shutil.copytree(
        engine_venv / "Lib" / "site-packages",
        runtime / "site-packages",
        ignore=shutil.ignore_patterns(
            "__pycache__", "*.pyc", "pip", "pip-*", "setuptools",
            "setuptools-*", "PyInstaller", "pyinstaller*", "wheel", "wheel-*",
            *(f"*{suffix}" for suffix in INTERPRETER_EXCLUDED_SUFFIXES),
        ),
        dirs_exist_ok=True,
    )
    for relative in INTERPRETER_EXCLUDED_DIRECTORIES:
        candidate = runtime / "site-packages" / Path(relative)
        if candidate.is_dir():
            shutil.rmtree(candidate)
    return {
        "fileName": archive_path.name,
        "bytes": archive_path.stat().st_size,
        "sha256": hashlib.sha256(archive_path.read_bytes()).hexdigest(),
    }


def _manifest(root: Path, version: str, embedded_python: dict | None) -> dict:
    files = []
    total = 0
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        payload = path.read_bytes()
        total += len(payload)
        files.append({
            "path": path.relative_to(root).as_posix(),
            "bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        })
    return {
        "manifestKind": "mk8dx.livetrial-windows-package.v1",
        "version": version,
        "builtAtMs": int(time.time() * 1000),
        "executables": [f"{name}.exe" for name, _script, _console in PRODUCT_EXECUTABLES],
        "embeddedPython": embedded_python,
        "fileCount": len(files),
        "totalBytes": total,
        "files": files,
    }


def main() -> int:
    arguments = _arguments()
    output = Path(arguments.output).resolve()
    if output.exists():
        raise BuildError(f"{output} already exists; packages are never overwritten")
    engine_venv = Path(arguments.engine_venv).resolve()
    product_icon = None
    if arguments.product_icon:
        product_icon = Path(arguments.product_icon).resolve()
        if not product_icon.is_file() or product_icon.suffix.lower() not in {".ico", ".png"}:
            raise BuildError("--product-icon must be an existing .png or .ico file")
    output.parent.mkdir(parents=True, exist_ok=True)

    build_root = output.parent / f"{output.name}-build"
    if build_root.exists():
        shutil.rmtree(build_root)
    build_root.mkdir(parents=True)
    engine_source = build_root / "engine-source"
    subprocess.run([sys.executable, str(PREPARE_ENGINE), "--output", str(engine_source)],
                   cwd=REPOSITORY_ROOT, check=True)

    frozen = _freeze_product(build_root, output, product_icon)
    frozen.rename(output)

    # The frozen application looks for its resources next to itself, which is
    # what livetrial_runtime_root.resource_root() resolves when frozen.
    internal = output / "_internal"
    resource_root = internal if internal.is_dir() else output
    for relative in RESOURCE_FILES:
        target = resource_root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPOSITORY_ROOT / relative, target)
    for relative in RESOURCE_TREES:
        _copy_tree(REPOSITORY_ROOT / relative, resource_root / relative)
    if product_icon is not None:
        icon_target = resource_root / "apps" / "timetrials-desktop" / "dashboard" / f"app-icon{product_icon.suffix.lower()}"
        icon_target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(product_icon, icon_target)

    engine_target = resource_root / "vision-runtime"
    for name in ("livetrial", "MK8DX Clean Assets", "ocr-models"):
        source = engine_source / name
        if not source.is_dir():
            raise BuildError(f"prepared engine is missing {name}")
        _copy_tree(source, engine_target / name)
    # Beside the Clean Assets folder: the shared card presence templates, the Time Trial frame geometry the engine's
    # time grid reads (ocr.py) and the record of the central recognition pack the engine carries.
    for name in ("card-anchors-v1.json", "frame-definitions-v1.json", "recognition-pack.json"):
        if not (engine_source / name).is_file():
            raise BuildError(f"prepared engine is missing {name}")
        shutil.copy2(engine_source / name, engine_target / name)
    # A clean, public-dependency interpreter travels with the engine.
    embedded_python = _install_embedded_interpreter(
        arguments.embedded_python, engine_venv, resource_root,
    )
    if not (engine_target.parent / "python-runtime" / "python.exe").is_file():
        raise BuildError("embedded interpreter is not where the product looks for it")

    for name in ("LICENSE", "LICENSE_SCOPE.md", "SOURCE_FOR_BINARIES.txt"):
        shutil.copy2(REPOSITORY_ROOT / name, output / name)
    notice = output / "docs" / "THIRD_PARTY_MATERIALS.md"
    notice.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(REPOSITORY_ROOT / "docs/THIRD_PARTY_MATERIALS.md", notice)

    manifest = _manifest(output, arguments.version, embedded_python)
    (output / "PACKAGE_MANIFEST.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8",
    )
    shutil.rmtree(build_root, ignore_errors=True)
    print(json.dumps({
        "package": str(output),
        "fileCount": manifest["fileCount"],
        "totalBytes": manifest["totalBytes"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BuildError as error:
        print(f"LiveTrial package build failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
