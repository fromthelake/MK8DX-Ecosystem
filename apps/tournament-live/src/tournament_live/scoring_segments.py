"""Project confirmed Live reset markers into the existing scoring segments."""

from __future__ import annotations

from collections import defaultdict
from typing import Mapping, Sequence


def live_session_indices(rows: Sequence[Mapping[str, object]]) -> list[int]:
    # Match the workbook's established video label and race normalization.
    keys = []
    resets: dict[str, set[int]] = defaultdict(set)
    for row in rows:
        video = str(row.get("Video", "") or "").rsplit("__", 1)[-1]
        try:
            race = int(str(row.get("Race", "")).strip())
        except (TypeError, ValueError):
            race = 0
        keys.append((video, race))
        if str(row.get("Session Reset Detected", "")).strip().lower() == "true":
            resets[video].add(race)
    return [1 + sum(reset <= race for reset in resets[video]) for video, race in keys]
