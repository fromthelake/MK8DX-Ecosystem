import pytest

from mk8dx_tournament_connected import client


class Store:
    def load(self):
        return "synthetic-token"


def test_connect_requires_readback_before_acknowledging(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    responses = iter((
        {"results": [{"incomingResultId": "incoming.synthetic", "status": "pending"}]},
        {"results": []},
    ))
    monkeypatch.setattr(client, "_request", lambda *_args, **_kwargs: next(responses))
    target = client.ConnectionTarget("tournament.synthetic", "Practice", "group.synthetic",
                                     "Group", "final")
    with pytest.raises(client.ConnectedError, match="not yet visible"):
        client.ConnectedClient(Store()).upload_documents(
            [{"raceResultId": "race.synthetic", "raceNumber": 3, "timestamps": {}}], target)


@pytest.mark.parametrize(("live", "expected"), [
    ({"status": "requested", "mappings": []}, "requested"),
    ({"status": "active", "mappings": []}, "active"),
    ({"status": "something-new"}, None),
    (None, None),
])
def test_live_registration_reports_whether_the_feed_waits_for_the_director(monkeypatch, tmp_path, live, expected):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    record = {"recordId": "evidence.synthetic", "clientRecordId": "run.synthetic", "resultCount": 0, "complete": False}
    if live is not None:
        record["live"] = live
    monkeypatch.setattr(client, "_request", lambda *_args, **_kwargs: {"record": record})
    context = client.ConnectionContext(
        tournament_id="tournament.synthetic", tournament_name="Practice", start_at_ms=None, stage="qualifier",
        groups=({"groupId": "group.synthetic", "phase": "qualifier"},),
        source_group_ids={"card-a": "group.synthetic"},
    )
    receipt = client.ConnectedClient(Store()).register_live_run("run.synthetic", context, ["card-a"])
    assert receipt.record_id == "evidence.synthetic"
    assert receipt.live_status == expected
