from __future__ import annotations

import json
import time
import hashlib
from dataclasses import dataclass, field
from pathlib import Path

from .detection import DetectionEvent
from .ocr import OcrResult
from .paths import DIAGNOSTICS_ROOT, assert_write_allowed
from .performance import PerformanceTracker


@dataclass
class Scoreboard:
    final_rows: list[dict[str, str]] = field(default_factory=list)
    tournament_rows: list[dict[str, str]] = field(default_factory=list)
    # Pristine, never-finalized accumulator. ``tournament_rows`` may be overwritten
    # with the *finalized* rows (drop exclusions + connection-reset continuity +
    # identity reconciliation), which must always be derived fresh from this raw
    # accumulator — finalizing already-finalized rows compounds reset offsets and
    # re-splits relinked identities.
    raw_tournament_rows: list[dict[str, str]] = field(default_factory=list)
    # Rich per-race scoreboard rows (with character-match metadata + frame paths)
    # accumulated across the tournament, used for the original's whole-df character
    # finalization (colour-variant families + Mii fallback) at export time.
    raw_scoreboard_rows: list[dict[str, str]] = field(default_factory=list)
    accepted_totals: set[tuple[str, str]] = field(default_factory=set)
    update_count: int = 0
    frozen: bool = False

    def apply_total_score(
        self,
        stream_id: str,
        race_id: str,
        rows: list[dict[str, str]],
        tracker: PerformanceTracker,
    ) -> bool:
        with tracker.track("scoreboard.apply_total_score", stream_id=stream_id):
            key = (stream_id, race_id)
            if self.frozen or key in self.accepted_totals:
                return False
            self.accepted_totals.add(key)
            self.final_rows = rows
            self.update_count += 1
            return True

    def apply_consensus_rows(
        self,
        stream_id: str,
        race_sequence: int,
        rows: list[dict[str, str]],
        tournament_rows: list[dict[str, str]],
        tracker: PerformanceTracker,
    ) -> bool:
        with tracker.track("scoreboard.apply_consensus_rows", stream_id=stream_id):
            key = (stream_id, f"race:{race_sequence}")
            if self.frozen or key in self.accepted_totals:
                return False
            if not rows:
                return False
            if len(rows) < 6 or len(rows) > 12:
                return False
            self.accepted_totals.add(key)
            rows_to_add = tournament_rows or rows
            self.raw_tournament_rows.extend(rows_to_add)
            self.raw_scoreboard_rows.extend(rows)
            # Default (un-finalized) view mirrors the raw accumulator; the workbook
            # finalizer overwrites tournament_rows/final_rows from raw_tournament_rows.
            self.tournament_rows = list(self.raw_tournament_rows)
            self.final_rows = build_final_rows(self.raw_tournament_rows, fallback_rows=rows)
            self.update_count += 1
            return True

    def apply_live_ocr_result(
        self,
        candidate: DetectionEvent,
        ocr_result: OcrResult,
        tracker: PerformanceTracker,
    ) -> bool:
        with tracker.track("scoreboard.apply_live_ocr_result", stream_id=candidate.stream_id):
            if candidate.screen_type != "total_score":
                return False
            if not candidate.complete or candidate.confidence < 0.75:
                return False
            if not ocr_result.validation_status:
                return False
            if not ocr_result.parsed_rows:
                return False
            race_id = f"{candidate.stream_id}:{candidate.event_id}"
            key = (candidate.stream_id, race_id)
            if self.frozen or key in self.accepted_totals:
                return False
            self.accepted_totals.add(key)
            self.final_rows = ocr_result.parsed_rows
            self.tournament_rows = ocr_result.parsed_rows
            self.raw_tournament_rows = list(ocr_result.parsed_rows)
            self.update_count += 1
            return True

    def freeze(self) -> None:
        self.frozen = True

    def state_hash(self) -> str:
        payload = json.dumps(
            {
                "final_rows": self.final_rows,
                "tournament_rows": self.tournament_rows,
                "accepted_totals": sorted(list(self.accepted_totals)),
                "update_count": self.update_count,
            },
            sort_keys=True,
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_final_rows(tournament_rows: list[dict[str, str]], fallback_rows: list[dict[str, str]]) -> list[dict[str, str]]:
    if not tournament_rows:
        return fallback_rows
    if not all("Video" in row and "Total After Race" in row for row in tournament_rows):
        return fallback_rows
    latest: dict[tuple[str, str], dict[str, str]] = {}
    race_counts: dict[tuple[str, str], int] = {}
    for row in tournament_rows:
        video = row.get("Video", "")
        player = row.get("Player", "")
        if not video or not player:
            continue
        key = (video, player)
        race_counts[key] = race_counts.get(key, 0) + 1
        current_race = parse_int(row.get("Race", "0"))
        previous_race = parse_int(latest.get(key, {}).get("Race", "0"))
        if current_race >= previous_race:
            latest[key] = row
    by_video: dict[str, list[dict[str, str]]] = {}
    for (video, player), row in latest.items():
        by_video.setdefault(video, []).append(
            {
                "VideoName": video,
                "Races": str(race_counts.get((video, player), 0)),
                "Position": "",
                "PlayerName": player,
                "TotalPoints": row.get("Total After Race", ""),
                "Character": row.get("Character", ""),
                "CharacterRosterName": row.get("Character Roster", ""),
            }
        )
    final_rows: list[dict[str, str]] = []
    for video in sorted(by_video):
        rows = sorted(by_video[video], key=lambda item: parse_int(item.get("TotalPoints", "0")), reverse=True)
        previous_total: int | None = None
        previous_rank = 0
        for index, row in enumerate(rows, start=1):
            total = parse_int(row.get("TotalPoints", "0"))
            if previous_total is None or total != previous_total:
                previous_rank = index
                previous_total = total
            row["Position"] = str(previous_rank)
            final_rows.append(row)
    return final_rows


def parse_int(value: str) -> int:
    try:
        return int(str(value).strip())
    except Exception:
        return 0


@dataclass
class LiveSession:
    session_id: str
    tracker: PerformanceTracker
    scoreboard: Scoreboard = field(default_factory=Scoreboard)
    source_states: dict[str, str] = field(default_factory=dict)
    fixture_videos: list[str] = field(default_factory=list)
    detection_candidate_count: int = 0
    ocr_success_count: int = 0
    ocr_failure_count: int = 0
    export_status: str = "not_started"

    @classmethod
    def create(cls, tracker: PerformanceTracker) -> "LiveSession":
        return cls(session_id=time.strftime("%Y%m%d_%H%M%S"), tracker=tracker)

    def save_state(self) -> Path:
        (DIAGNOSTICS_ROOT / "sessions").mkdir(parents=True, exist_ok=True)
        path = assert_write_allowed(DIAGNOSTICS_ROOT / "sessions" / f"{self.session_id}_session_state.json")
        payload = {
            "session_id": self.session_id,
            "scoreboard_update_count": self.scoreboard.update_count,
            "accepted_totals": [list(item) for item in sorted(self.scoreboard.accepted_totals)],
            "final_rows": self.scoreboard.final_rows,
            "tournament_rows": self.scoreboard.tournament_rows,
            "source_states": self.source_states,
            "fixture_videos": self.fixture_videos,
            "detection_candidate_count": self.detection_candidate_count,
            "ocr_success_count": self.ocr_success_count,
            "ocr_failure_count": self.ocr_failure_count,
            "export_status": self.export_status,
            "frozen": self.scoreboard.frozen,
        }
        path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        return path
