from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


# The installed shell owns writable runtime state; source/package paths are
# never treated as output roots.
PROJECT_ROOT = Path(os.environ.get("MK8DX_TOURNAMENT_LIVE_ROOT", Path.cwd())).resolve()
LIVE_ROOT = PROJECT_ROOT

# The baseline extractor is an external, read-only sibling project. The live
# runtime never imports it; it only supplies (a) read-only fixture videos for
# heavy validation and (b) banned write targets for the safety guards below.
# Default to a sibling of the project root (the canonical layout) and allow an
# override via MK8DX_BASELINE_ROOT for other machines / CI.
BASELINE_ROOT = Path(
    os.environ.get("MK8DX_BASELINE_ROOT") or (PROJECT_ROOT / "private-baseline")
).resolve()
PRIVATE_ASSETS_ROOT = Path(
    os.environ.get("MK8DX_TOURNAMENT_ASSETS_ROOT", PROJECT_ROOT / "assets")
).resolve()
PRIVATE_REFERENCE_ROOT = Path(
    os.environ.get("MK8DX_TOURNAMENT_REFERENCE_ROOT", PROJECT_ROOT)
).resolve()

BASELINE_INPUT = BASELINE_ROOT / "Input_Videos"
BASELINE_OUTPUT = BASELINE_ROOT / "Output_Results"
BASELINE_CODE = BASELINE_ROOT / "mk8dx_video_result_extractor"
BASELINE_CONFIG = BASELINE_ROOT / "config"
BASELINE_TESTS = BASELINE_ROOT / "tests"

LIVE_OUTPUT = LIVE_ROOT / "Live_Output"
DIAGNOSTICS_ROOT = LIVE_OUTPUT / "diagnostics"
PERFORMANCE_ROOT = LIVE_OUTPUT / "performance_logs"
EXPORT_ROOT = LIVE_OUTPUT / "exports"
FIXTURE_FOLDER = BASELINE_INPUT / "2026-03-28" / "kwalificatie"
REFERENCE_RESULTS_DIRNAME = "Expected" + "_Results"
REFERENCE_RESULTS_ROOT = LIVE_ROOT / REFERENCE_RESULTS_DIRNAME

def _resolve(path: Path | str) -> Path:
    return Path(path).expanduser().resolve()


def is_relative_to(path: Path | str, parent: Path | str) -> bool:
    try:
        _resolve(path).relative_to(_resolve(parent))
        return True
    except ValueError:
        return False


class PathSafetyError(ValueError):
    """Raised when a requested path violates live/baseline separation."""


@dataclass(frozen=True)
class ProjectPaths:
    live_root: Path = LIVE_ROOT
    baseline_root: Path = BASELINE_ROOT
    live_output: Path = LIVE_OUTPUT
    diagnostics_root: Path = DIAGNOSTICS_ROOT
    performance_root: Path = PERFORMANCE_ROOT
    export_root: Path = EXPORT_ROOT
    reference_results_root: Path = REFERENCE_RESULTS_ROOT
    fixture_folder: Path = FIXTURE_FOLDER

    def ensure_output_dirs(self) -> None:
        for path in (self.live_output, self.diagnostics_root, self.performance_root, self.export_root):
            assert_write_allowed(path)
            path.mkdir(parents=True, exist_ok=True)


def get_project_paths() -> ProjectPaths:
    return ProjectPaths()


def assert_live_root() -> None:
    if _resolve(LIVE_ROOT) != _resolve(Path.cwd()):
        # The package can be imported from tests, but scripts should run from the live root.
        return


def assert_write_allowed(path: Path | str) -> Path:
    resolved = _resolve(path)
    banned_exact = {
        _resolve(BASELINE_ROOT),
        _resolve(BASELINE_INPUT),
        _resolve(BASELINE_OUTPUT),
        _resolve(BASELINE_CODE),
        _resolve(BASELINE_CONFIG),
        _resolve(BASELINE_TESTS),
        _resolve(REFERENCE_RESULTS_ROOT),
    }
    if resolved in banned_exact:
        raise PathSafetyError(f"Refusing to write to protected path: {resolved}")
    if is_relative_to(resolved, BASELINE_INPUT) or is_relative_to(resolved, BASELINE_OUTPUT):
        raise PathSafetyError(f"Refusing to write under baseline input/output path: {resolved}")
    if is_relative_to(resolved, BASELINE_CODE) or is_relative_to(resolved, BASELINE_CONFIG):
        raise PathSafetyError(f"Refusing to write under baseline code/config path: {resolved}")
    if is_relative_to(resolved, BASELINE_TESTS):
        raise PathSafetyError(f"Refusing to write under baseline tests path: {resolved}")
    if is_relative_to(resolved, REFERENCE_RESULTS_ROOT):
        raise PathSafetyError(f"Refusing to write under protected reference results: {resolved}")
    if not is_relative_to(resolved, LIVE_OUTPUT):
        raise PathSafetyError(f"Live output must be under Live_Output: {resolved}")
    return resolved


def assert_read_allowed(path: Path | str) -> Path:
    resolved = _resolve(path)
    if is_relative_to(resolved, BASELINE_INPUT):
        return resolved
    if is_relative_to(resolved, REFERENCE_RESULTS_ROOT):
        return resolved
    if is_relative_to(resolved, PRIVATE_ASSETS_ROOT):
        return resolved
    if is_relative_to(resolved, PRIVATE_REFERENCE_ROOT):
        return resolved
    if is_relative_to(resolved, LIVE_ROOT):
        return resolved
    raise PathSafetyError(f"Read path is outside approved live/baseline inputs: {resolved}")
