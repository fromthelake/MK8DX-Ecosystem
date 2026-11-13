"""The recorded analysis after the text reading runs end to end on the installed dependencies (issue #169).

Drives tooling/tournament/recorded_post_analysis_smoke.py in a fresh interpreter (the engine resolves its
runtime paths at import time) against the public recorded-asset groups the Tools package ships. All rows
and names are synthetic."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

from conftest import SKIP_REASON, recorded_assets

ROOT = Path(__file__).resolve().parents[2]
SMOKE = ROOT / "tooling" / "tournament" / "recorded_post_analysis_smoke.py"

for module in ("pandas", "cv2", "openpyxl", "mk8dx_tournament_extraction", "tournament_processor"):
    pytest.importorskip(module, reason=f"{module} is part of the Tournament Tools runtime (tooling/tournament/requirements.lock.txt)")


def test_ocr_rows_to_results_csv_and_canonical_json(tmp_path):
    assets = recorded_assets()
    if assets is None:
        pytest.skip(SKIP_REASON)
    completed = subprocess.run(
        [sys.executable, str(SMOKE), "--recorded-assets", str(assets),
         "--runtime-root", str(tmp_path / "runtime"), "--summary", str(tmp_path / "summary.json")],
        cwd=tmp_path, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    assert completed.returncode == 0, completed.stdout[-4000:] + completed.stderr[-8000:]
    summary = json.loads((tmp_path / "summary.json").read_text(encoding="utf-8"))
    assert summary["problems"] == []
    # The colour variants the OCR rows only knew by family name are settled from the score frames.
    assert summary["characters"]["Nova Jet"] == ["Pink Yoshi"]
    assert summary["characters"]["Kiki Loop"] == ["Orange Shy Guy"]
    assert summary["csvRows"] == 48 and summary["canonicalRaces"] == 4
