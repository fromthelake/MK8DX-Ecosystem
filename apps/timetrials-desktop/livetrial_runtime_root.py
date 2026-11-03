"""Resolve the read-only LiveTrial resource root for source and packaged runs.

The desktop product must be shippable as a single frozen bundle, so no runtime
module may assume it is executing from inside the repository checkout. Every
bundled resource keeps the same repository-relative layout underneath one root:

    <root>/packages/domain/...                          canonical V1 schemas
    <root>/packages/assets/schema9-asset-catalog-v1.json runtime asset release
    <root>/packages/local-outbox/reference/python/...    shared outbox reference

Resolution order (first valid root wins):

1. the PyInstaller extraction directory when running frozen;
2. an explicit ``MK8DX_LIVETRIAL_RESOURCE_ROOT`` override, so a packaged build
   can be pointed at an unpacked resource tree for support or testing;
3. the repository checkout, which keeps developer behaviour unchanged.
"""

from __future__ import annotations

import os
from pathlib import Path
import sys
from typing import Mapping


RESOURCE_ROOT_VARIABLE = "MK8DX_LIVETRIAL_RESOURCE_ROOT"

# apps/timetrials-desktop/<module>.py -> repository root.
SOURCE_RESOURCE_ROOT = Path(__file__).resolve().parents[2]

_DOMAIN_PACKAGE = ("packages", "domain")
_ASSET_CATALOG = ("packages", "assets", "schema9-asset-catalog-v1.json")
_OUTBOX_REFERENCE = ("packages", "local-outbox", "reference", "python")


def _valid_root(candidate: object) -> Path | None:
    """Accept only a directory that actually carries the bundled layout."""
    if not isinstance(candidate, (str, Path)) or not str(candidate):
        return None
    try:
        root = Path(candidate)
        # A resource root without ``packages`` cannot answer any lookup below,
        # so treating it as invalid keeps a stale override from silently
        # shadowing the working repository or bundle.
        if root.is_symlink() or not root.is_dir() or not (root / "packages").is_dir():
            return None
        return root.resolve(strict=False)
    except (OSError, TypeError, ValueError):
        return None


def _frozen_resource_root() -> Path | None:
    if not getattr(sys, "frozen", False):
        return None
    # PyInstaller exposes the extraction directory as sys._MEIPASS for both
    # onefile and onedir builds; sys.executable's directory is the last resort.
    frozen = _valid_root(getattr(sys, "_MEIPASS", None))
    if frozen is not None:
        return frozen
    try:
        return _valid_root(Path(sys.executable).resolve(strict=False).parent)
    except (OSError, TypeError, ValueError):
        return None


def resource_root(environment: Mapping[str, str] = os.environ) -> Path:
    """Return the root that carries the bundled read-only LiveTrial resources."""
    frozen = _frozen_resource_root()
    if frozen is not None:
        return frozen
    try:
        override = environment.get(RESOURCE_ROOT_VARIABLE)
    except Exception:
        override = None
    overridden = _valid_root(override)
    if overridden is not None:
        return overridden
    return SOURCE_RESOURCE_ROOT


def domain_package_root(environment: Mapping[str, str] = os.environ) -> Path:
    """Locate the canonical domain package that validates submissions offline."""
    return resource_root(environment).joinpath(*_DOMAIN_PACKAGE)


def asset_catalog_path(environment: Mapping[str, str] = os.environ) -> Path:
    """Locate the schema-9 runtime asset catalogue release."""
    return resource_root(environment).joinpath(*_ASSET_CATALOG)


def outbox_reference_root(environment: Mapping[str, str] = os.environ) -> Path:
    """Locate the shared local-outbox Python reference implementation."""
    return resource_root(environment).joinpath(*_OUTBOX_REFERENCE)


def install_outbox_reference_path(
    environment: Mapping[str, str] = os.environ,
) -> Path:
    """Make the shared outbox reference importable exactly once per process.

    A frozen bundle already imports these modules from the bundle itself, so the
    injection is skipped there rather than adding a non-existent search path.
    """
    reference = outbox_reference_root(environment)
    try:
        importable = reference.is_dir()
    except OSError:
        importable = False
    if importable and str(reference) not in sys.path:
        sys.path.insert(0, str(reference))
    return reference

def bundled_vision_runtime_root(
    environment: Mapping[str, str] = os.environ,
) -> Path | None:
    """The vision engine shipped inside a frozen bundle, when there is one.

    A packaged installation carries the recognition engine next to the
    product so a normal user never installs Python, a virtual environment
    or a source checkout. Developers running from the checkout keep
    supplying ``--runtime-root`` themselves and get ``None`` here.
    """
    override = environment.get("MK8DX_LIVETRIAL_RUNTIME_ROOT")
    if override:
        candidate = Path(override)
        if (candidate / "livetrial" / "analyze.py").is_file():
            return candidate
    if not getattr(sys, "frozen", False):
        return None
    candidate = resource_root(environment) / "vision-runtime"
    return candidate if (candidate / "livetrial" / "analyze.py").is_file() else None


def bundled_vision_python(
    environment: Mapping[str, str] = os.environ,
) -> str | None:
    """The interpreter that can run the bundled vision engine.

    ``sys.executable`` is the product executable itself once frozen, so it
    must never be used to launch the engine. A packaged installation ships
    an interpreter beside the engine instead.
    """
    override = environment.get("MK8DX_LIVETRIAL_RUNTIME_PYTHON")
    if override and Path(override).is_file():
        return override
    root = bundled_vision_runtime_root(environment)
    if root is None:
        return None
    # The packaged interpreter is self-contained: a copied virtual environment
    # would still point at the Python that created it, which a normal user's
    # machine does not have.
    for relative in (
        "python-runtime/python.exe",
        "python-runtime/bin/python3",
        "python/Scripts/python.exe",
        "python/bin/python3",
    ):
        candidate = root.parent / relative
        if candidate.is_file():
            return str(candidate)
    return None
