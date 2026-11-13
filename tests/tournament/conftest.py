"""Runtime data for the engine-backed Tournament tests.

The engine reads its game catalog, name-character data and character templates from the folders the
Tools package ships as ``runtime-assets/recorded``. Unless the caller already points the engine at
such a folder, materialize the same public collection groups into a temporary one (needs node), and
keep generated output out of the checkout. Tests that need it skip with a reason when neither is
available."""
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MATERIALIZER = ROOT / "tooling" / "assets" / "materialize_collection.mjs"
RECORDED_GROUPS = ("tournament", "tournament-text")
SKIP_REASON = ("needs the recorded runtime assets: set MK8DX_RECORDED_ASSETS to a folder with the "
               "'tournament' and 'tournament-text' collection groups, or install node to materialize them")


def recorded_assets() -> Path | None:
    value = os.environ.get("MK8DX_RECORDED_ASSETS")
    return Path(value) if value else None


def _use(folder: Path) -> None:
    os.environ["MK8DX_RECORDED_ASSETS"] = str(folder)
    os.environ.setdefault("MK8DX_TOURNAMENT_ASSETS_ROOT", str(folder / "assets"))
    os.environ.setdefault("MK8DX_TOURNAMENT_REFERENCE_ROOT", str(folder))
    os.environ.setdefault("MK8DX_TOURNAMENT_ENGINE_DATA_ROOT", str(folder))


def pytest_configure(config):
    scratch = Path(tempfile.mkdtemp(prefix="mk8dx-tournament-tests-"))
    config.add_cleanup(lambda: shutil.rmtree(scratch, ignore_errors=True))
    os.environ.setdefault("MK8DX_TOURNAMENT_RUNTIME_ROOT", str(scratch / "runtime"))
    given = recorded_assets()
    if given is not None:
        _use(given)
        return
    node = shutil.which("node")
    if node is None:
        return
    target = scratch / "recorded-assets"
    for group in RECORDED_GROUPS:
        subprocess.run([node, str(MATERIALIZER), group, str(target)], cwd=ROOT, check=True,
                       stdout=subprocess.DEVNULL)
    _use(target)
