"""Small, invented score rows shared by the Windows-client boundary tests."""

from mk8dx_tournament_extraction import SourceDescriptor


def confirmed_rows() -> list[dict[str, object]]:
    return [
        {"Video": "synthetic-feed", "Race": 1, "Track": "Toad Harbour", "Position": 1,
         "Player": "Player Alpha", "Character": "Mario", "Race Points": 15,
         "Total Before Race": 0, "Total After Race": 15, "Session": 1},
        {"Video": "synthetic-feed", "Race": 1, "Track": "Toad Harbour", "Position": 2,
         "Player": "Player Bravo", "Character": "Luigi", "Race Points": 12,
         "Total Before Race": 0, "Total After Race": 12, "Session": 1},
    ]


def source() -> SourceDescriptor:
    return SourceDescriptor("tournament_recorded_video", "synthetic-session", "test-1",
                            source_media_id="synthetic-media")
