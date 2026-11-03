from tournament_processor.recorded_export import canonicalize_recorded_rows

from rows import confirmed_rows


def test_recorded_export_preserves_source_and_score():
    result, = canonicalize_recorded_rows(confirmed_rows(), session_id="synthetic-session",
                                         producer_version="test-1", created_at_ms=1000,
                                         source_media_id="synthetic-media")
    assert result["source"]["kind"] == "tournament_recorded_video"
    assert result["source"]["sourceMediaId"] == "synthetic-media"
    assert result["placements"][0]["scoring"]["racePoints"] == 15
