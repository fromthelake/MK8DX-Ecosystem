from __future__ import annotations

from collections import defaultdict
from typing import Any, Callable


TrackKey = tuple[str, int]


def assign_track_entries_to_completed_races(
    selected: list[dict[str, Any]],
    *,
    classify: Callable[[dict[str, Any]], str],
) -> dict[TrackKey, dict[str, Any]]:
    """Pair each completed race with its latest unused preceding track screen.

    A lobby can select a course and then abort before a result scoreboard is
    produced. Track and score detections therefore cannot safely be paired by
    independent ordinal counters. Temporal pairing also works for incremental
    processing where only one completed race is currently in scope.

    A track screen belongs only to the race that follows it: one shown before
    the previous race's scoreboard is never borrowed. A race whose own track
    screen was missed (or never recorded) therefore stays unassigned, so its
    row says the placeholder instead of silently repeating the previous track.
    Pass every race score of the stream, not only the races in scope, so the
    previous race's scoreboard is known.
    """
    tracks_by_stream: dict[str, list[dict[str, Any]]] = defaultdict(list)
    races_by_stream: dict[str, dict[int, list[dict[str, Any]]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for item in selected:
        stream = str(item.get("stream_id") or "unknown")
        kind = classify(item)
        if kind == "track_name":
            tracks_by_stream[stream].append(item)
        elif kind == "race_score":
            races_by_stream[stream][int(item.get("race_sequence") or 0)].append(item)

    assigned: dict[TrackKey, dict[str, Any]] = {}
    for stream, race_groups in races_by_stream.items():
        available = sorted(
            tracks_by_stream.get(stream, []),
            key=lambda item: (
                int(item.get("frame_index") or item.get("selected_track_name_frame") or 0),
                float(item.get("confidence") or 0.0),
            ),
        )
        consumed: set[int] = set()
        previous_score_frame = -1
        for race_sequence in sorted(race_groups):
            score = max(
                race_groups[race_sequence],
                key=lambda item: float(item.get("confidence") or 0.0),
            )
            score_frame = int(
                score.get("frame_index") or score.get("selected_race_score_frame") or 0
            )
            eligible = [
                (index, item)
                for index, item in enumerate(available)
                if index not in consumed
                and previous_score_frame
                < int(
                    item.get("frame_index")
                    or item.get("selected_track_name_frame")
                    or 0
                )
                < score_frame
            ]
            previous_score_frame = max(previous_score_frame, score_frame)
            if not eligible:
                continue
            # The last course shown before a completed result is authoritative;
            # any earlier unconsumed course was abandoned without a scoreboard.
            index, track = max(
                eligible,
                key=lambda pair: (
                    int(
                        pair[1].get("frame_index")
                        or pair[1].get("selected_track_name_frame")
                        or 0
                    ),
                    float(pair[1].get("confidence") or 0.0),
                ),
            )
            consumed.add(index)
            assigned[(stream, race_sequence)] = track
    return assigned
