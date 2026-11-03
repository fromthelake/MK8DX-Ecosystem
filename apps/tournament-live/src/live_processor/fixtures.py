from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .paths import DIAGNOSTICS_ROOT, FIXTURE_FOLDER, assert_read_allowed, assert_write_allowed

VIDEO_EXTENSIONS = {".mkv", ".mp4", ".mov", ".avi"}


@dataclass(frozen=True)
class ReplayFixture:
    path: Path
    stream_id: str
    label: str


def stream_label_from_filename(path: Path) -> str:
    stem = path.stem
    label = stem.replace("Kwalificatie_", "").replace("_2026-03-27 20-00-33", "")
    return label.replace("_", " ")


def stream_id_from_filename(path: Path) -> str:
    return stream_label_from_filename(path).lower().replace(" ", "_")


def discover_replay_fixtures(folder: Path = FIXTURE_FOLDER) -> list[ReplayFixture]:
    folder = assert_read_allowed(folder)
    if not folder.exists():
        raise FileNotFoundError(f"Replay fixture folder is missing: {folder}")
    fixtures: list[ReplayFixture] = []
    for path in sorted(folder.iterdir(), key=lambda p: p.name.lower()):
        if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS:
            assert_read_allowed(path)
            fixtures.append(
                ReplayFixture(
                    path=path,
                    stream_id=stream_id_from_filename(path),
                    label=stream_label_from_filename(path),
                )
            )
    return fixtures


def write_discovery_diagnostics(fixtures: list[ReplayFixture]) -> Path:
    DIAGNOSTICS_ROOT.mkdir(parents=True, exist_ok=True)
    path = assert_write_allowed(DIAGNOSTICS_ROOT / "fixture_discovery.txt")
    lines = [f"{fixture.stream_id}\t{fixture.label}\t{fixture.path}" for fixture in fixtures]
    path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    return path
