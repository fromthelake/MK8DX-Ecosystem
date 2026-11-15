"""The LiveTrial package ships the engine from vision-runtime; engine-overlay is the working copy where engine fixes
are made. A fix that lands in only one of the two copies either never ships or is lost at the next edit, so every
overlay file must have the same text as its vision-runtime counterpart (line ends may differ: some engine files keep
their CRLF bytes, see .gitattributes)."""

from pathlib import Path

DESKTOP = Path(__file__).resolve().parents[1]
OVERLAY = DESKTOP / "engine-overlay"
RUNTIME = DESKTOP / "vision-runtime"

# Files that exist only in the overlay on purpose: the engine's own test, which the package does not ship.
OVERLAY_ONLY = frozenset({
    "livetrial/tests/test_names.py",
})


def _overlay_files() -> list[str]:
    return sorted(
        path.relative_to(OVERLAY).as_posix()
        for path in OVERLAY.rglob("*")
        if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc"
    )


def _text(path: Path) -> bytes:
    return path.read_bytes().replace(b"\r\n", b"\n")


def test_every_overlay_file_matches_the_shipped_engine_copy() -> None:
    files = _overlay_files()
    assert files, "engine-overlay is empty"
    missing = [name for name in files if name not in OVERLAY_ONLY and not (RUNTIME / name).is_file()]
    different = [
        name for name in files
        if name not in OVERLAY_ONLY and (RUNTIME / name).is_file() and _text(OVERLAY / name) != _text(RUNTIME / name)
    ]
    assert not missing, f"overlay files without a vision-runtime counterpart: {missing}"
    assert not different, f"overlay and vision-runtime copies differ (bring both in line): {different}"


def test_the_overlay_only_list_has_no_stale_entries() -> None:
    files = set(_overlay_files())
    stale = sorted(name for name in OVERLAY_ONLY if name not in files or (RUNTIME / name).is_file())
    assert not stale, f"OVERLAY_ONLY entries that are gone or now shipped: {stale}"
