import json
from pathlib import Path

import pytest

from mk8dx_local_outbox import LocalOutboxConflictError, LocalTimeTrialOutbox


ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "packages/domain/examples/timetrial-livetrial.example.json"


def test_outbox_state_transitions_are_append_only(tmp_path):
    outbox = LocalTimeTrialOutbox(tmp_path / "canonical", tmp_path / "private",
                                  lambda doc: None)
    submission = json.loads(FIXTURE.read_text(encoding="utf-8"))
    pending = outbox.create(submission, 1000, {"note": "synthetic"})
    key = pending["entry"]["entryKey"]
    assert pending["state"]["state"] == "pending"
    failed = outbox.mark_failed(key, 1, 1001, "synthetic.failure")
    assert failed["state"]["state"] == "failed"
    with pytest.raises(LocalOutboxConflictError):
        outbox.mark_synced(key, 1, 1002)
    retry = outbox.request_retry(key, 2, 1003)
    synced = outbox.mark_synced(key, 3, 1004)
    assert retry["state"]["state"] == "pending"
    assert synced["state"]["state"] == "synced"
    assert len(list((tmp_path / "canonical" / key / "states").glob("*.json"))) == 4
    assert "privateEvidence" not in outbox.read(key)
