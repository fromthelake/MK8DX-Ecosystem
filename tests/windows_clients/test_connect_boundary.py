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
