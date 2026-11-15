"""The central safe-path check: the LiveTrial desktop copy and the engine's copy (engine-overlay and vision-runtime).

Every copy must have the same text as the Tournament Live one, so one fix reaches all of them.
"""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import sys

import pytest

DESKTOP = Path(__file__).resolve().parents[1]
REPOSITORY = DESKTOP.parents[1]
COPIES = {
    "desktop": DESKTOP / "livetrial_safe_paths.py",
    "engine-overlay": DESKTOP / "engine-overlay/livetrial/livetrial/safe_paths.py",
    "vision-runtime": DESKTOP / "vision-runtime/livetrial/livetrial/safe_paths.py",
}
TOURNAMENT_LIVE = REPOSITORY / "apps/tournament-live/src/live_processor/safe_paths.py"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(f"safe_paths_{name.replace('-', '_')}", COPIES[name])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(params=sorted(COPIES))
def safe(request):
    return _load(request.param)


@pytest.fixture
def tree(tmp_path: Path) -> Path:
    base = tmp_path / "base"
    (base / "session").mkdir(parents=True)
    (base / "session" / "clip.mp4").write_bytes(b"x")
    (tmp_path / "outside").mkdir()
    (tmp_path / "outside" / "secret.png").write_bytes(b"s")
    return base


def _link(link: Path, target: Path) -> None:
    try:
        link.symlink_to(target, target_is_directory=target.is_dir())
    except (OSError, NotImplementedError):
        if sys.platform == "win32" and target.is_dir():
            import _winapi
            _winapi.CreateJunction(str(target), str(link))
        else:
            pytest.skip("this system cannot make links")


def test_every_copy_has_the_same_text() -> None:
    reference = TOURNAMENT_LIVE.read_bytes().replace(b"\r\n", b"\n")
    for name, path in COPIES.items():
        assert path.read_bytes().replace(b"\r\n", b"\n") == reference, name


def test_an_allowed_nested_path_is_returned_resolved(safe, tree: Path) -> None:
    path = safe.resolve_within(tree, "session/clip.mp4")
    assert path == Path(os.path.realpath(tree / "session" / "clip.mp4"))
    assert safe.file_within(tree, "session/clip.mp4") == path
    assert safe.resolve_within(tree, "session/./other/../clip.mp4", strict=True) == path


@pytest.mark.parametrize("name", ["../outside/secret.png", "session/../../outside/secret.png", "..", ".", ""])
def test_traversal_and_the_folder_itself_are_refused(safe, tree: Path, name: str) -> None:
    with pytest.raises(safe.UnsafePathError):
        safe.resolve_within(tree, name)
    assert safe.file_within(tree, name) is None


def test_an_absolute_path_outside_is_refused(safe, tree: Path) -> None:
    outside = tree.parent / "outside" / "secret.png"
    with pytest.raises(safe.UnsafePathError):
        safe.resolve_within(tree, str(outside))
    with pytest.raises(safe.UnsafePathError):
        safe.resolve_within(tree, outside)


def test_an_absolute_path_inside_is_allowed(safe, tree: Path) -> None:
    inside = tree / "session" / "clip.mp4"
    assert safe.resolve_within(tree, str(inside)) == Path(os.path.realpath(inside))


def test_a_sibling_with_the_same_prefix_is_refused(safe, tree: Path) -> None:
    sibling = tree.parent / (tree.name + "-other")
    sibling.mkdir()
    (sibling / "x.png").write_bytes(b"x")
    with pytest.raises(safe.UnsafePathError):
        safe.resolve_within(tree, f"../{tree.name}-other/x.png")


def test_strict_refuses_a_missing_name(safe, tree: Path) -> None:
    assert safe.resolve_within(tree, "session/missing.mp4").name == "missing.mp4"
    with pytest.raises(safe.UnsafePathError):
        safe.resolve_within(tree, "session/missing.mp4", strict=True)
    with pytest.raises(safe.UnsafePathError):
        safe.resolve_within(tree / "missing-base", "x", strict=True)
    assert safe.file_within(tree, "session") is None  # a folder is not a file


def test_a_link_that_leads_outside_is_refused(safe, tree: Path) -> None:
    _link(tree / "escape", tree.parent / "outside")
    with pytest.raises(safe.UnsafePathError):
        safe.resolve_within(tree, "escape/secret.png")
    assert safe.file_within(tree, "escape/secret.png") is None


def test_a_link_inside_is_followed_unless_links_are_refused(safe, tree: Path) -> None:
    _link(tree / "alias", tree / "session")
    target = Path(os.path.realpath(tree / "session" / "clip.mp4"))
    assert safe.resolve_within(tree, "alias/clip.mp4") == target
    assert safe.resolve_within(tree, "alias", refuse_symlink=False) == target.parent
    if os.path.islink(tree / "alias"):
        with pytest.raises(safe.UnsafePathError):
            safe.resolve_within(tree, "alias", refuse_symlink=True)
    else:  # a junction is not a symlink, as for Path.is_symlink(); its target still has to be inside
        assert safe.resolve_within(tree, "alias", refuse_symlink=True) == target.parent


def test_a_linked_base_is_resolved_first(safe, tree: Path) -> None:
    linked = tree.parent / "linked-base"
    _link(linked, tree)
    assert safe.file_within(linked, "session/clip.mp4") == Path(os.path.realpath(tree / "session" / "clip.mp4"))


@pytest.mark.skipif(sys.platform != "win32", reason="Windows drive and UNC names")
@pytest.mark.parametrize("name", ["Z:\\outside\\secret.png", "Z:secret.png", "\\\\server\\share\\secret.png",
                                  "\\\\?\\C:\\Windows\\win.ini", "\\outside\\secret.png", "/outside/secret.png"])
def test_windows_drive_and_unc_names_are_refused(safe, tree: Path, name: str) -> None:
    with pytest.raises(safe.UnsafePathError):
        safe.resolve_within(tree, name)


@pytest.mark.skipif(sys.platform != "win32", reason="Windows separators")
def test_windows_backslash_traversal_is_refused_and_nesting_allowed(safe, tree: Path) -> None:
    with pytest.raises(safe.UnsafePathError):
        safe.resolve_within(tree, "session\\..\\..\\outside\\secret.png")
    assert safe.file_within(tree, "session\\clip.mp4") is not None


def test_a_nul_byte_is_never_a_file(safe, tree: Path) -> None:
    assert safe.file_within(tree, "session/clip.mp4\x00.png") is None
