"""A new account has no published Time Trial standing yet."""

from livetrial_ecosystem import player_progress_view


def test_new_player_progress_accepts_zero_standing() -> None:
    bootstrap = {
        "comeback": {
            "player": {"playerId": "player.new", "displayName": "New player"},
            "timeTrials": {"standing": 0, "of": 0, "totalMs": 0},
            "rivals": [],
        },
        "focus": {"rows": []},
        "trackBests": {"players": []},
    }
    view = player_progress_view(
        {"fetchedAtMs": 1_900_000_000_000, "bootstrap": bootstrap},
        {},
    )
    assert view["standing"] == {"rank": 0, "of": 0, "totalMs": 0, "averageMs": 0}
    assert view["publishedBests"] == 0
    assert all(mode["driven"] == 0 for mode in view["modes"])
