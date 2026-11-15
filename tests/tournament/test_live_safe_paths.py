"""Tournament Live's copy of the central safe-path check and the two places that serve files by a page's name.

The full behaviour table (links, drives, UNC names) is in apps/timetrials-desktop/tests/test_safe_paths.py, which
also proves every copy has this module's text.
"""

from __future__ import annotations

import os
from pathlib import Path
import sys

import pytest

from live_processor import display_assets
from live_processor.safe_paths import UnsafePathError, file_within, resolve_within


@pytest.fixture
def tree(tmp_path: Path) -> Path:
    base = tmp_path / "assets"
    (base / "tracks").mkdir(parents=True)
    (base / "tracks" / "mks.png").write_bytes(b"png")
    (tmp_path / "secret.png").write_bytes(b"s")
    return base


def test_nested_file_is_returned_resolved(tree: Path) -> None:
    assert file_within(tree, "tracks/mks.png") == Path(os.path.realpath(tree / "tracks" / "mks.png"))


@pytest.mark.parametrize("name", ["../secret.png", "tracks/../../secret.png", "", "tracks"])
def test_outside_names_and_folders_are_not_files(tree: Path, name: str) -> None:
    assert file_within(tree, name) is None


def test_absolute_outside_is_refused(tree: Path) -> None:
    with pytest.raises(UnsafePathError):
        resolve_within(tree, str(tree.parent / "secret.png"))


@pytest.mark.skipif(sys.platform != "win32", reason="Windows drive and UNC names")
@pytest.mark.parametrize("name", ["Z:\\secret.png", "\\\\server\\share\\secret.png", "Z:secret.png"])
def test_windows_drive_and_unc_names_are_refused(tree: Path, name: str) -> None:
    with pytest.raises(UnsafePathError):
        resolve_within(tree, name)


def test_link_out_of_the_folder_is_refused(tree: Path) -> None:
    outside = tree.parent / "outside"
    outside.mkdir()
    (outside / "x.png").write_bytes(b"x")
    try:
        (tree / "escape").symlink_to(outside, target_is_directory=True)
    except (OSError, NotImplementedError):
        if sys.platform != "win32":
            pytest.skip("this system cannot make links")
        import _winapi
        _winapi.CreateJunction(str(outside), str(tree / "escape"))
    assert file_within(tree, "escape/x.png") is None


def test_canonical_asset_file_serves_only_catalogued_files_inside_clean_assets(tree: Path, monkeypatch) -> None:
    relative = sorted(display_assets.canonical_asset_paths())[0]
    target = tree / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"png")
    monkeypatch.setenv("MK8_CLEAN_ASSETS_ROOT", str(tree))
    assert display_assets.canonical_asset_file(relative) == Path(os.path.realpath(target))
    assert display_assets.canonical_asset_file("../secret.png") is None
    target.unlink()
    assert display_assets.canonical_asset_file(relative) is None
