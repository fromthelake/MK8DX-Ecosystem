import os
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = Path(os.environ.get("MK8DX_TOURNAMENT_RUNTIME_ROOT", Path.cwd())).resolve()
