from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

from .paths import DIAGNOSTICS_ROOT, EXPORT_ROOT, assert_write_allowed
from .performance import PerformanceTracker
from .race_ordering import chronological_tournament_rows
from .session import LiveSession, build_final_rows


CURRENT_EXPORT_DIR = EXPORT_ROOT / "current"
WORKBOOK_UPDATE_LOG = DIAGNOSTICS_ROOT / "live_workbook_update_log.jsonl"
WORKBOOK_SUMMARY = DIAGNOSTICS_ROOT / "live_workbook_export_summary.json"


def _atomic_write(path: Path, writer: Any) -> None:
    path = assert_write_allowed(path)
    tmp = assert_write_allowed(path.with_name(f".{path.name}.tmp"))
    writer(tmp)
    os.replace(tmp, path)


def _copy_rows(rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    return [{str(key): "" if value is None else str(value) for key, value in row.items()} for row in rows]


def _apply_identity_finalization(tournament_rows: list[dict[str, str]]) -> list[dict[str, str]]:
    if not tournament_rows:
        return []
    # Consensus jobs intentionally run in parallel, so adjacent races can finish
    # OCR out of order. The preserved identity-reconciliation pipeline assumes
    # chronological input; feeding it completion order can relabel every player
    # in two adjacent races even though the selected frames and OCR rows are
    # correct. Always establish the canonical video/race/position order before
    # any continuity or identity pass.
    rows = chronological_tournament_rows(tournament_rows)
    try:
        # Temporary-player-drop (connection error) exclusion first, so totals are
        # corrected before identity reconciliation — same decision as the live
        # scoreboard, so the export matches what was shown.
        from .live_scoring_policy import apply_drop_exclusions_to_tournament_rows

        rows = apply_drop_exclusions_to_tournament_rows(rows)
    except Exception:
        pass
    try:
        # Connection-reset continuity: keep tournament totals running across a
        # whole-lobby reset and mark the reset races so the identity reconciliation
        # can relink a reconnect that returned under a different OCR name.
        from .live_connection_reset import apply_connection_reset_continuity

        rows, _resets = apply_connection_reset_continuity(rows)
    except Exception:
        pass
    try:
        from .baseline_identity_reconciliation import reconcile_tournament_identities

        rows = reconcile_tournament_identities(rows)
    except Exception:
        pass
    rows = _stamp_player_count_review(rows)
    # Final authoritative totals: recompute the running tournament total from race
    # points per *reconciled* player. This mirrors the original's tournament_total
    # (cumulative race points seeded from the first race's old total), is naturally
    # continuous across connection resets without a name-keyed offset, and is robust
    # to OCR name drift because it runs after identity reconciliation has settled.
    return _recompute_running_totals(rows)


def _stamp_player_count_review(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    """Flag races that ran with fewer players than the session's full field.

    Mirrors the original's session-validation "player_count_mismatch" export
    annotation ("Race screen player count mismatch: N shown, expected M."):
    the race still counts, but every row is marked for review. The live
    consensus can't stamp this per race (it has no session-wide expected
    player count), so the export finalization does. Idempotent."""
    result = [dict(row) for row in rows]
    by_video_race: dict[tuple[str, str], list[int]] = {}
    for index, row in enumerate(result):
        by_video_race.setdefault((str(row.get("Video", "")), str(row.get("Race", ""))), []).append(index)
    full_by_video: dict[str, int] = {}
    for (video, _race), indices in by_video_race.items():
        full_by_video[video] = max(full_by_video.get(video, 0), len(indices))
    for (video, _race), indices in by_video_race.items():
        count = len(indices)
        full = full_by_video.get(video, 0)
        if count >= full:
            continue
        reason = f"Race screen player count mismatch: {count} shown, expected {full}."
        for index in indices:
            row = result[index]
            if str(row.get("Counts Toward Totals", "True")).strip().lower() == "false":
                continue  # excluded races keep their exclusion note only
            row["Needs Review"] = "True"
            existing = str(row.get("Review Reason") or "").strip()
            if reason not in existing:
                row["Review Reason"] = f"{existing} | {reason}" if existing else reason
    return result


def _recompute_running_totals(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    def to_int(value: object) -> int:
        try:
            return int(str(value).strip())
        except Exception:
            return 0

    result = [dict(row) for row in rows]
    by_player: dict[tuple[str, str], list[int]] = {}
    for index, row in enumerate(result):
        by_player.setdefault((row.get("Video", ""), row.get("Player", "")), []).append(index)
    for indices in by_player.values():
        indices.sort(key=lambda i: to_int(result[i].get("Race")))
        running: int | None = None
        for i in indices:
            row = result[i]
            if running is None:
                # Seed the baseline from the first race's on-screen old total so a
                # video that starts mid-tournament keeps the carried-in points.
                running = to_int(row.get("Total Before Race"))
            counts = str(row.get("Counts Toward Totals", "True")).strip().lower() != "false"
            before = running
            if counts:
                running = before + to_int(row.get("Race Points"))
            row["Total Before Race"] = str(before)
            row["Total After Race"] = str(running)

    # Re-rank the post-race standing (Position After Race) from the recomputed
    # totals, ties sharing a rank — mirrors the original assign_shared_positions.
    if result and "Position After Race" in result[0]:
        by_race: dict[tuple[str, int], list[int]] = {}
        for index, row in enumerate(result):
            by_race.setdefault((row.get("Video", ""), to_int(row.get("Race"))), []).append(index)
        for indices in by_race.values():
            ordered = sorted(indices, key=lambda i: to_int(result[i].get("Total After Race")), reverse=True)
            previous_total: int | None = None
            rank = 0
            for position, i in enumerate(ordered, start=1):
                total = to_int(result[i].get("Total After Race"))
                if total != previous_total:
                    rank = position
                    previous_total = total
                result[i]["Position After Race"] = str(rank)
    return result


_RACE_CLASS_READER: list = []


def _annotate_race_classes(rows: list[dict[str, Any]]) -> None:
    """ADR-0217: each race's class from its track-intro frame (Live_Output/Frames/<video>/Race_NNN/0TrackName.jpg)
    into the rows' "Class"; the canonical export makes mode/mirror of it. No Clean Assets or no intro frame (a
    capture started mid-race) leaves it empty; it never stops an export."""
    from mk8dx_tournament_extraction.race_class import reader_from_environment

    from .live_frame_bundles import FRAME_BUNDLE_ROOT, sanitize_video_label

    if not _RACE_CLASS_READER:
        _RACE_CLASS_READER.append(reader_from_environment())
    reader = _RACE_CLASS_READER[0]
    if reader is None or not rows:
        return
    reader.annotate(rows, lambda video, race: FRAME_BUNDLE_ROOT / sanitize_video_label(str(video).rsplit("__", 1)[-1])
                    / f"Race_{int(race or 0):03d}" / "0TrackName.jpg")


def _export_files_for(prefix: str, export_root: Path) -> dict[str, Path]:
    return {
        "final_csv": export_root / f"{prefix}_Final_Standings.csv",
        "tournament_csv": export_root / f"{prefix}_Tournament_Results.csv",
        "workbook": export_root / f"{prefix}_Tournament_Results.xlsx",
        "metadata_json": export_root / f"{prefix}_metadata.json",
        "canonical_json": export_root / f"{prefix}_TournamentRaceResultsV1.json",
    }


def _current_export_files(export_root: Path = CURRENT_EXPORT_DIR) -> dict[str, Path]:
    return {
        "final_csv": export_root / "Current_Final_Standings.csv",
        "tournament_csv": export_root / "Current_Tournament_Results.csv",
        "workbook": export_root / "Current_Tournament_Results.xlsx",
        "metadata_json": export_root / "Current_export_metadata.json",
        "canonical_json": export_root / "Current_TournamentRaceResultsV1.json",
    }


def _late_starts(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per video: the first recorded race's prior totals, when any is above zero."""
    first_race: dict[str, int] = {}
    for row in rows:
        video = str(row.get("Video") or "")
        race = _int_or_none(row.get("Race"))
        if race is not None and (video not in first_race or race < first_race[video]):
            first_race[video] = race
    late: list[dict[str, Any]] = []
    for video, race in sorted(first_race.items()):
        carried = [
            {"player": str(row.get("Player") or ""), "points": _int_or_none(row.get("Total Before Race")) or 0}
            for row in rows
            if str(row.get("Video") or "") == video and _int_or_none(row.get("Race")) == race
        ]
        if any(entry["points"] > 0 for entry in carried):
            late.append({
                "video": video,
                "first_race": race,
                "carried": sorted(carried, key=lambda entry: (-entry["points"], entry["player"])),
            })
    return late


def _int_or_none(value: Any) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


class LiveWorkbookManager:
    """Maintains the operator-facing current and final live workbook exports."""

    def __init__(self, run_id: str, tracker: PerformanceTracker | None = None) -> None:
        self.run_id = run_id
        self.tracker = tracker or PerformanceTracker(
            DIAGNOSTICS_ROOT.parent / "performance_logs" / "live_workbook", enabled=True
        )
        self.session = LiveSession(session_id=run_id, tracker=self.tracker)
        self._lock = threading.RLock()
        self.last_export: dict[str, Any] | None = None

    def apply_scoreboard_update(
        self,
        *,
        stream_label: str,
        race_sequence: int,
        rows: list[dict[str, Any]],
        tournament_rows: list[dict[str, Any]],
    ) -> dict[str, Any]:
        with self._lock:
            applied = self.session.scoreboard.apply_consensus_rows(
                stream_id=stream_label,
                race_sequence=race_sequence,
                rows=_copy_rows(rows),
                tournament_rows=_copy_rows(tournament_rows) or _copy_rows(rows),
                tracker=self.tracker,
            )
            self._finalize_session_rows()
            return self.export_current(
                reason="scoreboard_update",
                stream_label=stream_label,
                race_sequence=race_sequence,
                applied_update=applied,
            )

    def export_current(
        self,
        *,
        reason: str = "manual_current_export",
        stream_label: str = "",
        race_sequence: int | None = None,
        applied_update: bool | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            self._finalize_session_rows()
            result = self._write_snapshot(
                files=_current_export_files(),
                export_type="current",
                reason=reason,
                stream_label=stream_label,
                race_sequence=race_sequence,
                applied_update=applied_update,
            )
            self.last_export = result
            return result

    def export_final(self, *, reason: str = "stop_all_final_export") -> dict[str, Any]:
        with self._lock:
            self._finalize_session_rows(refine_characters=True)
            result = self._write_snapshot(
                files=_export_files_for(self.run_id, EXPORT_ROOT),
                export_type="final",
                reason=reason,
                stream_label="",
                race_sequence=None,
                applied_update=None,
            )
            self.last_export = result
            return result

    def _finalize_session_rows(self, *, refine_characters: bool = False) -> None:
        # Always finalize from the *pristine* raw accumulator, never from the
        # previously-finalized tournament_rows. Re-finalizing finalized rows
        # compounds connection-reset continuity offsets (each newly-added raw race
        # looks like a fresh reset versus the already-offset prior race) and
        # re-splits relinked identities. Deriving from raw each time is idempotent.
        raw = self.session.scoreboard.raw_tournament_rows or self.session.scoreboard.tournament_rows
        if not raw:
            return
        if refine_characters:
            # Adopt the original's whole-tournament character finalization (colour
            # families + Mii) from the accumulated rich rows. Only at the final export
            # — it reopens the RaceScore frames, so it is too costly per incremental
            # update (and the per-race consensus characters are fine in the interim).
            from .baseline_character_finalize import apply_character_map, finalize_characters

            char_map = finalize_characters(self.session.scoreboard.raw_scoreboard_rows)
            raw = apply_character_map(raw, char_map)
        finalized_tournament_rows = _apply_identity_finalization(raw)
        self.session.scoreboard.tournament_rows = finalized_tournament_rows
        self.session.scoreboard.final_rows = build_final_rows(finalized_tournament_rows, fallback_rows=[])

    def _write_snapshot(
        self,
        *,
        files: dict[str, Path],
        export_type: str,
        reason: str,
        stream_label: str,
        race_sequence: int | None,
        applied_update: bool | None,
    ) -> dict[str, Any]:
        if not self.session.scoreboard.tournament_rows or not self.session.scoreboard.final_rows:
            self.session.export_status = "failed_empty_or_invalid_live_session_state"
            raise ValueError("Cannot export workbook: no validated live rows are available yet")

        for path in files.values():
            assert_write_allowed(path)
            path.parent.mkdir(parents=True, exist_ok=True)

        tournament_rows = _copy_rows(self.session.scoreboard.tournament_rows)
        final_rows = _copy_rows(self.session.scoreboard.final_rows)
        _annotate_race_classes(tournament_rows)
        metadata = {
            "generated_from": "live_session_state",
            "run_id": self.run_id,
            "session_id": self.session.session_id,
            "export_type": export_type,
            "reason": reason,
            "stream_label": stream_label,
            "race_sequence": race_sequence,
            "applied_update": applied_update,
            "scoreboard_update_count": self.session.scoreboard.update_count,
            "tournament_rows": len(tournament_rows),
            "final_rows": len(final_rows),
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

        # Write the workbook + both CSVs in the original project's exact format
        # (columns, order, value types, Points Segment N) so downstream systems that
        # consume the original's structured export keep working.
        from tournament_live.workbook_export import write_compatible_workbook

        write_compatible_workbook(
            workbook_path=files["workbook"],
            tournament_csv_path=files["tournament_csv"],
            final_csv_path=files["final_csv"],
            rows=tournament_rows,
        )
        from mk8dx_tournament_extraction import races_with_missing_track
        from tournament_live.canonical_export import write_final_live_results

        # A race without a track card (a recording that starts after it, an
        # unreadable card) keeps the placeholder in the workbook. It stays out
        # of the canonical results and the feed until the Director fills it in;
        # every other race keeps exporting.
        metadata["tracks_not_filled_in"] = [
            {"video": video, "race": race} for video, race in races_with_missing_track(tournament_rows)
        ]
        # A recording that starts after the first race(s): the first race
        # already shows prior totals. The workbook carries them, but the race
        # results (and so a standings sum of races) do not.
        metadata["late_starts"] = _late_starts(tournament_rows)
        write_final_live_results(
            tournament_rows,
            files["canonical_json"],
            session_id=self.session.session_id,
            producer_version="tournament-live-0.4.0",
            created_at_ms=time.time_ns() // 1_000_000,
            skip_missing_tracks=True,
        )
        if export_type == "current" and applied_update:
            # Optional and best-effort: the complete locally finalized race
            # remains in JSON/XLSX/CSV even when no target/session/network exists.
            try:
                from mk8dx_tournament_connected.client import (
                    ConnectionContextStore,
                    ConnectionTargetStore,
                    publish_incremental_results,
                )
                from mk8dx_tournament_connected.session import SessionStore

                connected = (
                    ConnectionContextStore().load() is not None
                    or ConnectionTargetStore().load() is not None
                    or SessionStore().load() is not None
                )
                if connected:
                    uploaded = publish_incremental_results(files["canonical_json"])
                    metadata["connected_feed"] = (
                        f"uploaded:{uploaded}" if uploaded > 0 else "offline_or_queued"
                    )
                else:
                    metadata["connected_feed"] = "offline"
            except Exception as error:
                metadata["connected_feed"] = f"offline_or_queued:{type(error).__name__}"
        _atomic_write(
            files["metadata_json"],
            lambda path: path.write_text(json.dumps(metadata, indent=2, sort_keys=True), encoding="utf-8"),
        )

        self.session.export_status = "exported"
        result = {
            **metadata,
            "files": {key: str(value) for key, value in files.items()},
        }
        self.tracker.record_export(**result)
        self._append_log(result)
        self._write_summary(result)
        return result

    def _append_log(self, result: dict[str, Any]) -> None:
        WORKBOOK_UPDATE_LOG.parent.mkdir(parents=True, exist_ok=True)
        path = assert_write_allowed(WORKBOOK_UPDATE_LOG)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(result, sort_keys=True) + "\n")

    def _write_summary(self, result: dict[str, Any]) -> None:
        path = assert_write_allowed(WORKBOOK_SUMMARY)
        path.write_text(json.dumps(result, indent=2, sort_keys=True), encoding="utf-8")
