from __future__ import annotations

from typing import Any


def chronological_tournament_rows(rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Return canonical video/race/position order for parallel OCR results."""

    copied = [
        {str(key): "" if value is None else str(value) for key, value in row.items()}
        for row in rows
    ]

    def numeric(value: object) -> int:
        try:
            return int(str(value).strip())
        except Exception:
            return 0

    return sorted(
        copied,
        key=lambda row: (
            str(row.get("Video", "")),
            numeric(row.get("Race")),
            numeric(row.get("Position")),
        ),
    )
