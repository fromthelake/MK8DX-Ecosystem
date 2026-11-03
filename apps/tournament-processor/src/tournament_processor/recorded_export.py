from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Iterable, Mapping

from mk8dx_tournament_extraction import SourceDescriptor, canonicalize_confirmed_rows


def canonicalize_recorded_rows(
    rows: Iterable[Mapping[str, object]],
    *,
    session_id: str,
    producer_version: str,
    created_at_ms: int,
    source_media_id: str | None = None,
) -> list[dict[str, object]]:
    by_video: dict[str, list[Mapping[str, object]]] = defaultdict(list)
    for row in rows:
        label = str(row.get("Video") or row.get("RaceClass") or "recorded-video").strip()
        by_video[label].append(row)
    results: list[dict[str, object]] = []
    for label in sorted(by_video):
        results.extend(
            canonicalize_confirmed_rows(
                by_video[label],
                source=SourceDescriptor(
                    kind="tournament_recorded_video",
                    session_id=session_id,
                    producer_version=producer_version,
                    source_media_id=source_media_id or f"source.{_opaque_label(label)}",
                ),
                created_at_ms=created_at_ms,
            )
        )
    return sorted(results, key=lambda result: (str(result["source"]["sourceMediaId"]), int(result["raceNumber"])))


def _opaque_label(label: str) -> str:
    import hashlib

    return hashlib.sha256(label.encode("utf-8")).hexdigest()[:16]


def write_recorded_results(
    rows: Iterable[Mapping[str, object]],
    output_path: Path,
    *,
    session_id: str,
    producer_version: str,
    created_at_ms: int,
    source_media_id: str | None = None,
) -> list[dict[str, object]]:
    results = canonicalize_recorded_rows(
        rows,
        session_id=session_id,
        producer_version=producer_version,
        created_at_ms=created_at_ms,
        source_media_id=source_media_id,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(results, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return results
