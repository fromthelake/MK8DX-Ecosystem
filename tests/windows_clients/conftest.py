"""Import the public client sources directly, without installing product packages."""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[2]
for relative in (
    "packages/icon-matcher/python",
    "packages/tournament-extraction/python/src",
    "apps/tournament-processor/src",
    "apps/tournament-live/src",
    "packages/tournament-connected/python/src",
    "packages/local-outbox/reference/python",
    "apps/timetrials-desktop",
):
    sys.path.insert(0, str(ROOT / relative))
