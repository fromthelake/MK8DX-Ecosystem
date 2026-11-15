"""The one place that turns a page- or file-supplied name into a path inside a known folder.

Each Python product keeps its own copy of this small module (package boundaries); the copies have the same body:
``apps/tournament-live/src/live_processor/safe_paths.py``, ``apps/timetrials-desktop/livetrial_safe_paths.py`` and
the LiveTrial engine's ``livetrial/safe_paths.py`` (engine-overlay and vision-runtime).

The check is written in the shape CodeQL's path-injection query recognises as a barrier: the candidate is resolved
with ``os.path.realpath`` (symlinks and ``..`` followed) and accepted only when the resolved text starts with the
resolved folder plus a separator. Only that resolved path is returned, so callers never touch the raw name.
"""

from __future__ import annotations

import os
from pathlib import Path


class UnsafePathError(ValueError):
    """The name does not lead to a place inside the folder (no path in the message)."""


def resolve_within(base: str | os.PathLike[str], relative: str | os.PathLike[str], *,
                   strict: bool = False, refuse_symlink: bool = False) -> Path:
    """``base / relative`` after following every link, refused unless it lies strictly inside ``base``.

    - ``..``, an absolute path, another drive or a UNC name that leaves ``base`` is refused;
    - a symlink or junction that points outside ``base`` is refused (the resolved target is what is compared);
    - ``base`` itself is not "inside" ``base`` and is refused;
    - ``strict``: a missing file (or folder) is refused instead of resolved as far as possible;
    - ``refuse_symlink``: the named entry may not itself be a symlink, even one that stays inside ``base``.

    Raises ``UnsafePathError`` for every refusal.
    """
    try:
        root = os.path.realpath(base, strict=strict)
        joined = os.path.join(root, relative)
    except (OSError, ValueError, TypeError):
        raise UnsafePathError("the name does not resolve") from None
    if refuse_symlink and os.path.islink(joined):
        raise UnsafePathError("the name is a link")
    try:
        candidate = os.path.realpath(joined, strict=strict)
    except (OSError, ValueError):
        raise UnsafePathError("the name does not resolve") from None
    prefix = root if root.endswith(os.sep) else root + os.sep
    if candidate.startswith(prefix):
        return Path(candidate)
    raise UnsafePathError("the name leads outside its folder")


def file_within(base: str | os.PathLike[str], relative: str | os.PathLike[str], *,
                refuse_symlink: bool = False) -> Path | None:
    """An existing regular file inside ``base`` (see ``resolve_within``), or ``None``."""
    try:
        path = resolve_within(base, relative, refuse_symlink=refuse_symlink)
        return path if path.is_file() else None
    except (UnsafePathError, OSError):
        return None
