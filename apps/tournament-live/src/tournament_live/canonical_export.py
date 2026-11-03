from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Iterable, Mapping

from mk8dx_tournament_extraction import SourceDescriptor, canonicalize_confirmed_rows, is_missing_track

from .scoring_segments import live_session_indices


def _stream_label(row: Mapping[str, object]) -> str:
    return str(row.get("Video") or row.get("RaceClass") or "live-stream").strip()


def _stream_id(label: str) -> str:
    import hashlib

    digest = hashlib.sha256(label.encode("utf-8")).hexdigest()[:16]
    return f"stream.{digest}"


def canonicalize_final_live_rows(
    rows: Iterable[Mapping[str, object]],
    *,
    session_id: str,
    producer_version: str,
    created_at_ms: int,
    skip_missing_tracks: bool = False,
) -> list[dict[str, object]]:
    """Canonicalize only the live workbook's finalized confirmed rows.

    The live shell must call this after identity/scoring finalization. Rolling
    provisional scoreboard rows are intentionally not accepted at this seam.

    With ``skip_missing_tracks`` a race whose Track is empty or the placeholder
    is left out (the workbook keeps it for the Director to fill in) instead of
    failing every race of the snapshot. Without it such a race fails closed.
    """
    by_stream: dict[str, list[Mapping[str, object]]] = defaultdict(list)
    for row in rows:
        by_stream[_stream_label(row)].append(row)
    results: list[dict[str, object]] = []
    for label in sorted(by_stream):
        stream_rows = []
        for row, segment in zip(by_stream[label], live_session_indices(by_stream[label]), strict=True):
            copied = dict(row)
            # Confirmed CSV/CLI input may already carry an authoritative index.
            # Raw Live rows instead retain the reset marker used by the workbook.
            if not any(str(row.get(key) or "").strip() for key in ("Session", "SessionIndex")):
                copied["SessionIndex"] = segment
            stream_rows.append(copied)
        if skip_missing_tracks:
            # After the segment indices: they are derived from the whole stream.
            missing = {
                str(row.get("Race") or row.get("RaceIDNumber") or "").strip()
                for row in stream_rows
                if is_missing_track(row.get("Track") or row.get("TrackName"))
            }
            stream_rows = [
                row for row in stream_rows
                if str(row.get("Race") or row.get("RaceIDNumber") or "").strip() not in missing
            ]
            if not stream_rows:
                continue
        results.extend(
            canonicalize_confirmed_rows(
                stream_rows,
                source=SourceDescriptor(
                    kind="tournament_live_capture",
                    session_id=session_id,
                    producer_version=producer_version,
                    stream_id=_stream_id(label),
                ),
                created_at_ms=created_at_ms,
            )
        )
    return sorted(results, key=lambda result: (str(result["source"]["streamId"]), int(result["raceNumber"])))


def write_final_live_results(
    rows: Iterable[Mapping[str, object]],
    output_path: Path,
    *,
    session_id: str,
    producer_version: str,
    created_at_ms: int,
    skip_missing_tracks: bool = False,
) -> list[dict[str, object]]:
    results = canonicalize_final_live_rows(
        rows,
        session_id=session_id,
        producer_version=producer_version,
        created_at_ms=created_at_ms,
        skip_missing_tracks=skip_missing_tracks,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(results, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return results
