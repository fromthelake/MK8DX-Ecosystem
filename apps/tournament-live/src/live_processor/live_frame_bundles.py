from __future__ import annotations

import json
import re
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import cv2  # type: ignore

from .paths import LIVE_ROOT, assert_write_allowed
from .run_context import current_run_id


FRAME_BUNDLE_ROOT = LIVE_ROOT / "Live_Output" / "Frames"
DIAGNOSTICS_ROOT = LIVE_ROOT / "Live_Output" / "diagnostics"
EXPORT_IMAGE_SUFFIX = ".jpg"


@dataclass(frozen=True)
class BundleImageRecord:
    run_id: str
    video_label: str
    stream_id: str
    race_number: int
    screenshot_kind: str
    frame_index: int
    timestamp: float | None
    layout_id: str
    output_path: str
    frame_hash: str
    source_rule: str
    generated_at: str


@dataclass(frozen=True)
class LiveBundleRaceGroup:
    video_label: str
    race_number: int
    track_name_path: Path | None
    race_score_anchor_path: Path | None
    total_score_anchor_path: Path | None
    race_score_context_paths: list[Path] = field(default_factory=list)
    total_score_consensus_paths: list[Path] = field(default_factory=list)

    @property
    def key(self) -> tuple[str, int]:
        return self.video_label, self.race_number

    def to_grouped_images(self) -> tuple[tuple[str, int], list[tuple[str, str]]]:
        images: list[tuple[str, str]] = []
        if self.track_name_path is not None:
            images.append(("0TrackName", str(self.track_name_path)))
        if self.race_score_anchor_path is not None:
            images.append(("2RaceScore", str(self.race_score_anchor_path)))
        if self.total_score_anchor_path is not None:
            images.append(("3TotalScore", str(self.total_score_anchor_path)))
        return self.key, images

    def to_report(self) -> dict[str, Any]:
        return {
            "video_label": self.video_label,
            "race_number": self.race_number,
            "track_name_path": str(self.track_name_path) if self.track_name_path else "",
            "race_score_anchor_path": str(self.race_score_anchor_path) if self.race_score_anchor_path else "",
            "total_score_anchor_path": str(self.total_score_anchor_path) if self.total_score_anchor_path else "",
            "race_score_context_count": len(self.race_score_context_paths),
            "race_score_context_paths": [str(path) for path in self.race_score_context_paths],
            "total_score_consensus_count": len(self.total_score_consensus_paths),
            "total_score_consensus_paths": [str(path) for path in self.total_score_consensus_paths],
            "has_race_score": self.race_score_anchor_path is not None,
            "has_total_score": self.total_score_anchor_path is not None,
            "has_track_name": self.track_name_path is not None,
        }


class LiveFrameBundleWriter:
    """Live-owned copy of baseline frame-bundle path/write behavior.

    This intentionally mirrors the baseline Output_Results/Frames shape, but
    writes under Live_Output/Frames only.
    """

    def __init__(self, root: Path = FRAME_BUNDLE_ROOT) -> None:
        self.root = assert_write_allowed(root)
        self.records: list[BundleImageRecord] = []

    def write_anchor(
        self,
        *,
        frame: Any,
        video_label: str,
        stream_id: str,
        race_number: int,
        frame_content: str,
        frame_index: int,
        timestamp: float | None = None,
        layout_id: str | None = None,
        frame_hash: str = "",
        source_rule: str = "",
    ) -> Path:
        if frame_content in {"0TrackName", "1RaceNumber"}:
            path = self.race_anchor_frame_path(video_label, race_number, frame_content)
        else:
            if frame_content not in {"2RaceScore", "3TotalScore", "4CupFinal"}:
                raise ValueError(f"Unsupported score bundle anchor kind: {frame_content}")
            self.clean_score_bundle(video_label, race_number, frame_content)
            path = self.score_bundle_anchor_path(video_label, race_number, frame_content, frame_index, layout_id)
        return self._write(
            path=path,
            frame=frame,
            video_label=video_label,
            stream_id=stream_id,
            race_number=race_number,
            screenshot_kind=frame_content,
            frame_index=frame_index,
            timestamp=timestamp,
            layout_id=layout_id or "",
            frame_hash=frame_hash,
            source_rule=source_rule,
        )

    def write_race_context(
        self,
        *,
        frame: Any,
        video_label: str,
        stream_id: str,
        race_number: int,
        frame_index: int,
        timestamp: float | None = None,
        layout_id: str | None = None,
        frame_hash: str = "",
        source_rule: str = "",
    ) -> Path:
        path = self.score_bundle_race_context_path(video_label, race_number, "2RaceScore", frame_index, layout_id)
        return self._write(
            path=path,
            frame=frame,
            video_label=video_label,
            stream_id=stream_id,
            race_number=race_number,
            screenshot_kind="2RaceScoreContext",
            frame_index=frame_index,
            timestamp=timestamp,
            layout_id=layout_id or "",
            frame_hash=frame_hash,
            source_rule=source_rule,
        )

    def write_total_consensus(
        self,
        *,
        frame: Any,
        video_label: str,
        stream_id: str,
        race_number: int,
        frame_index: int,
        timestamp: float | None = None,
        layout_id: str | None = None,
        frame_hash: str = "",
        source_rule: str = "",
    ) -> Path:
        path = self.score_bundle_consensus_path(video_label, race_number, "3TotalScore", frame_index)
        return self._write(
            path=path,
            frame=frame,
            video_label=video_label,
            stream_id=stream_id,
            race_number=race_number,
            screenshot_kind="3TotalScoreConsensus",
            frame_index=frame_index,
            timestamp=timestamp,
            layout_id=layout_id or "",
            frame_hash=frame_hash,
            source_rule=source_rule,
        )

    def write_manifest(self) -> Path:
        manifest_path = assert_write_allowed(DIAGNOSTICS_ROOT / "live_frame_bundle_manifest.json")
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "run_id": current_run_id(),
            "bundle_root": str(self.root),
            "generated_at": _now(),
            "records": [asdict(record) for record in self.records],
        }
        existing = _load_existing_manifest(manifest_path)
        if existing:
            payload["records"] = _dedupe_records(existing + payload["records"])
        manifest_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        return manifest_path

    def race_frames_dir(self, video_label: str, race_number: int) -> Path:
        return self.root / sanitize_video_label(video_label) / f"Race_{int(race_number):03d}"

    def race_anchor_frame_path(self, video_label: str, race_number: int, frame_content: str) -> Path:
        return self.race_frames_dir(video_label, race_number) / f"{frame_content}{EXPORT_IMAGE_SUFFIX}"

    def score_bundle_dir(self, video_label: str, race_number: int, frame_content: str) -> Path:
        return self.race_frames_dir(video_label, race_number) / str(frame_content)

    def score_bundle_anchor_path(
        self,
        video_label: str,
        race_number: int,
        frame_content: str,
        actual_frame: int,
        score_layout_id: str | None = None,
    ) -> Path:
        layout_suffix = f"_{score_layout_filename_tag(score_layout_id)}" if score_layout_id else ""
        return self.score_bundle_dir(video_label, race_number, frame_content) / (
            f"anchor_{int(actual_frame)}{layout_suffix}{EXPORT_IMAGE_SUFFIX}"
        )

    def score_bundle_consensus_path(self, video_label: str, race_number: int, frame_content: str, actual_frame: int) -> Path:
        return self.score_bundle_dir(video_label, race_number, frame_content) / f"frame_{int(actual_frame)}{EXPORT_IMAGE_SUFFIX}"

    def score_bundle_race_context_path(
        self,
        video_label: str,
        race_number: int,
        frame_content: str,
        actual_frame: int,
        score_layout_id: str | None = None,
    ) -> Path:
        layout_suffix = f"_{score_layout_filename_tag(score_layout_id)}" if score_layout_id else ""
        return self.score_bundle_dir(video_label, race_number, frame_content) / (
            f"Race_{int(race_number):03d}_F{int(actual_frame)}{layout_suffix}{EXPORT_IMAGE_SUFFIX}"
        )

    def clean_score_bundle(self, video_label: str, race_number: int, frame_content: str) -> None:
        bundle_dir = self.score_bundle_dir(video_label, race_number, frame_content)
        if not bundle_dir.exists():
            return
        patterns = ["anchor_*"]
        if frame_content == "2RaceScore":
            patterns.extend([f"Race_{int(race_number):03d}_F*", "frame_*", "12point_*", "12point_frame_*"])
        elif frame_content == "3TotalScore":
            patterns.append("frame_*")
        for pattern in patterns:
            for path in bundle_dir.glob(pattern):
                if path.is_file():
                    path.unlink()

    def _write(
        self,
        *,
        path: Path,
        frame: Any,
        video_label: str,
        stream_id: str,
        race_number: int,
        screenshot_kind: str,
        frame_index: int,
        timestamp: float | None,
        layout_id: str,
        frame_hash: str,
        source_rule: str,
    ) -> Path:
        path = assert_write_allowed(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        if frame is None:
            raise ValueError(f"Cannot write empty frame for {screenshot_kind} race {race_number}")
        ok = cv2.imwrite(str(path), frame)
        if not ok:
            raise OSError(f"Could not write live frame bundle image: {path}")
        self.records.append(
            BundleImageRecord(
                run_id=current_run_id(),
                video_label=sanitize_video_label(video_label),
                stream_id=stream_id,
                race_number=int(race_number),
                screenshot_kind=screenshot_kind,
                frame_index=int(frame_index),
                timestamp=timestamp,
                layout_id=layout_id,
                output_path=str(path),
                frame_hash=frame_hash,
                source_rule=source_rule,
                generated_at=_now(),
            )
        )
        return path


def sanitize_video_label(value: str | Path) -> str:
    label = Path(value).stem if isinstance(value, Path) else str(value)
    label = re.sub(r'[<>:"/\\|?*]+', "_", label).strip().strip(".")
    return label or "unknown_video"


def score_layout_filename_tag(score_layout_id: str | None) -> str:
    if not score_layout_id:
        return ""
    normalized = str(score_layout_id).strip().replace("/", "_").replace("\\", "_")
    aliases = {
        "lan2": "2p",
        "2p": "2p",
        "lan2_split_2p": "2p",
        "lan1": "1p",
        "1p": "1p",
        "lan1_full_1p": "1p",
    }
    return aliases.get(normalized, normalized)


def group_live_bundle_images(frames_root: Path = FRAME_BUNDLE_ROOT) -> list[tuple[tuple[str, int], list[tuple[str, str]]]]:
    return [group.to_grouped_images() for group in load_live_bundle_race_groups(frames_root)]


def load_live_bundle_race_groups(frames_root: Path = FRAME_BUNDLE_ROOT) -> list[LiveBundleRaceGroup]:
    root = Path(frames_root)
    grouped: list[LiveBundleRaceGroup] = []
    if not root.exists():
        return grouped
    for video_dir in sorted(path for path in root.iterdir() if path.is_dir()):
        for race_dir in sorted(path for path in video_dir.iterdir() if path.is_dir() and path.name.startswith("Race_")):
            try:
                race_number = int(race_dir.name.split("_", 1)[1])
            except (IndexError, ValueError):
                continue
            track = race_dir / f"0TrackName{EXPORT_IMAGE_SUFFIX}"
            race_score = find_score_bundle_anchor(race_dir / "2RaceScore")
            total_score = find_score_bundle_anchor(race_dir / "3TotalScore")
            if race_score is None:
                continue
            grouped.append(
                LiveBundleRaceGroup(
                    video_label=video_dir.name,
                    race_number=race_number,
                    track_name_path=track if track.exists() else None,
                    race_score_anchor_path=race_score,
                    total_score_anchor_path=total_score,
                    race_score_context_paths=find_race_score_context_paths(race_dir, race_number),
                    total_score_consensus_paths=find_total_score_consensus_paths(race_dir),
                )
            )
    return grouped


def find_score_bundle_anchor(bundle_dir: Path) -> Path | None:
    if not bundle_dir.exists():
        return None
    matches = sorted(bundle_dir.glob(f"anchor_*{EXPORT_IMAGE_SUFFIX}"))
    return matches[0] if matches else None


def find_race_score_context_paths(race_dir: Path, race_number: int) -> list[Path]:
    bundle_dir = race_dir / "2RaceScore"
    if not bundle_dir.exists():
        return []
    return sorted(bundle_dir.glob(f"Race_{int(race_number):03d}_F*{EXPORT_IMAGE_SUFFIX}"))


def find_total_score_consensus_paths(race_dir: Path) -> list[Path]:
    bundle_dir = race_dir / "3TotalScore"
    if not bundle_dir.exists():
        return []
    return sorted(bundle_dir.glob(f"frame_*{EXPORT_IMAGE_SUFFIX}"))


def _load_existing_manifest(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    records = payload.get("records") if isinstance(payload, dict) else None
    return [item for item in records if isinstance(item, dict)] if isinstance(records, list) else []


def _dedupe_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, str, str, int]] = set()
    deduped: list[dict[str, Any]] = []
    for record in records:
        key = (
            str(record.get("run_id", "")),
            str(record.get("output_path", "")),
            str(record.get("screenshot_kind", "")),
            int(record.get("frame_index") or 0),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(record)
    return deduped


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
