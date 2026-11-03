from copy import deepcopy

import pytest

from livetrial_corrections import LiveTrialCorrectionError, create_corrected_revision


class Outbox:
    def create(self, submission, _created_at_ms, _evidence):
        self.created = deepcopy(submission)
        return {"canonicalSubmission": self.created}


def prior_record():
    return {"entry": {"privateEvidencePresent": False}, "canonicalSubmission": {
        "schemaVersion": "mk8dx.time-trial-submission.v1", "submissionId": "synthetic",
        "revision": 1, "source": {"kind": "livetrial_capture"},
        "trackId": "track.big_blue", "totalTimeMs": 90_000,
        "laps": [{"lapNumber": n, "timeMs": 30_000} for n in (1, 2, 3)],
        "timestamps": {"capturedAtMs": 100, "createdAtMs": 200},
    }}


def test_correction_creates_revision_and_field_provenance():
    outbox = Outbox()
    result, fields = create_corrected_revision(outbox, prior_record(),
                                               {"trackId": "track.mute_city"}, 300)
    assert result["canonicalSubmission"]["revision"] == 2
    assert fields == ("track",)
    assert result["canonicalSubmission"]["verification"]["correctedFields"] == ["track"]


def test_correction_rejects_changed_laps_with_wrong_total():
    with pytest.raises(LiveTrialCorrectionError):
        create_corrected_revision(Outbox(), prior_record(),
                                  {"laps": [{"lapNumber": 1, "timeMs": 1}]}, 300)
