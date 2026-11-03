from __future__ import annotations

import json
from pathlib import Path

from .paths import PRIVATE_ASSETS_ROOT, PRIVATE_REFERENCE_ROOT, assert_read_allowed

IMPORTED_REFERENCE_ROOT = PRIVATE_REFERENCE_ROOT / "reference_data"
LIVE_ASSETS_ROOT = PRIVATE_ASSETS_ROOT
IMPORTED_ASSETS_ROOT = LIVE_ASSETS_ROOT
IMPORTED_CHARACTER_TEMPLATE_ROOT = IMPORTED_ASSETS_ROOT / "character"
IMPORTED_GAME_CATALOG = IMPORTED_REFERENCE_ROOT / "game_catalog.json"

INITIAL_SCAN_TEMPLATE_LOAD_ORDER = [
    "Trackname_template.png",
    "Race_template.png",
    "12th_pos_template.png",
    "ignore.png",
    "albumgallery_ignore.png",
    "ignore_2.png",
    "Race_template_NL_final.png",
    "12th_pos_templateNL.png",
]


def baseline_asset_roots() -> dict[str, Path]:
    return {
        "reference_root": IMPORTED_REFERENCE_ROOT,
        "assets_root": IMPORTED_ASSETS_ROOT,
        "templates_root": IMPORTED_ASSETS_ROOT / "templates",
        "character_template_root": IMPORTED_CHARACTER_TEMPLATE_ROOT,
        "track_asset_root": IMPORTED_ASSETS_ROOT / "track",
        "cup_asset_root": IMPORTED_ASSETS_ROOT / "cup",
        "gui_asset_root": IMPORTED_ASSETS_ROOT / "gui",
        "game_catalog": IMPORTED_GAME_CATALOG,
    }


def resolve_live_asset_file(category: str, name: str) -> Path:
    if not category or any(part in {"", ".", ".."} for part in Path(category).parts):
        raise ValueError(f"Invalid asset category: {category!r}")
    if not name or any(part in {"", ".", ".."} for part in Path(name).parts):
        raise ValueError(f"Invalid asset name: {name!r}")
    path = assert_read_allowed(IMPORTED_ASSETS_ROOT / category / name)
    if not path.exists():
        raise FileNotFoundError(path)
    return path


def live_template_paths_in_baseline_order() -> list[Path]:
    """The engine's eight templates, then the locale/class templates of the manifest beside them, registered at the
    indices the engine gives them (extract_frames does the same). Without this Live matched only the eight: the other
    game locales' race counters and the class badges were skipped as indices past the end of its list."""
    from mk8dx_tournament_extraction import locale_templates  # type: ignore  # noqa: WPS433

    paths = [resolve_live_asset_file("templates", name) for name in INITIAL_SCAN_TEMPLATE_LOAD_ORDER]
    entries = locale_templates.load_for_engine(lambda: paths[1].parent)
    return paths + [entry.file for entry in entries]


def load_imported_game_catalog() -> dict[str, object]:
    path = assert_read_allowed(IMPORTED_GAME_CATALOG)
    return json.loads(path.read_text(encoding="utf-8"))


def imported_character_template_paths() -> list[Path]:
    root = assert_read_allowed(IMPORTED_CHARACTER_TEMPLATE_ROOT)
    if not root.exists():
        return []
    return sorted(root.glob("*.png"), key=lambda p: p.name)
