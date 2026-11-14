"""The Live spectator dashboard's viewer settings: Overall only and track/cup names in a chosen language.

Both are display choices in the page. The state keeps serving confirmed standings only and the canonical
track/cup IDs the page looks names up by; the chosen language never reaches recognition."""
import shutil
import subprocess
from pathlib import Path

import pytest
from conftest import SKIP_REASON, recorded_assets

from live_processor.broadcast_state import FeedScoreboard
from live_processor.display_assets import display_name_catalog, track_presentations
from mk8dx_tournament_extraction import game_messages, track_names

ROOT = Path(__file__).resolve().parents[2]
LOCALES = ("en-GB", "en-US", "nl-NL", "fr-FR", "fr-CA", "de-DE", "es-ES", "es-419",
           "it-IT", "pt-PT", "ru-RU", "ja-JP", "ko-KR", "zh-CN", "zh-TW")


def test_the_page_tests_pass_on_the_real_app_script():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    result = subprocess.run([node, "--test", str(ROOT / "tests/tournament/broadcast_dashboard_view.test.mjs")],
                            cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=False)
    assert result.returncode == 0, result.stdout + result.stderr


def test_every_presented_track_and_cup_has_its_names_in_all_15_locales():
    catalog = display_name_catalog()
    assert tuple(catalog["locales"]) == LOCALES
    for track in track_presentations():
        assert set(catalog["tracks"][track["id"]]) == set(LOCALES), track["id"]
        assert set(catalog["cups"][track["cupId"]]) == set(LOCALES), track["cupId"]
        # The English fallback is the name the default presentation shows.
        assert catalog["tracks"][track["id"]]["en-GB"] == track["names"]["en-GB"]
    assert catalog["tracks"]["track.mario_kart_stadium"]["ja-JP"] == "マリオカートスタジアム"
    assert catalog["cups"]["cup.mushroom_cup"]["ru-RU"] == "Кубок гриба"


def test_the_track_payload_carries_the_canonical_ids():
    board = FeedScoreboard(feed="g1")
    board.apply_track({"track_name": "Mario Kart Stadium"}, 1, now=100.0)
    track = board.to_payload()["track"]
    assert (track["id"], track["cup_id"]) == ("track.mario_kart_stadium", "cup.mushroom_cup")
    assert (track["name_uk"], track["name_nl"]) == ("Mario Kart Stadium", "")


def test_the_display_catalog_leaves_recognition_languages_alone():
    display_name_catalog()
    assert track_names.game_locale("dashboard-feed") == game_messages.AUTO
    assert track_names.ocr_languages(track_names.game_locale("dashboard-feed")) == ("en", "nl")
    pairs = track_names.vocabulary([(0, "Mario Kart Stadium", "Mario Kart-Stadion")], game_messages.AUTO)
    assert pairs == [("Mario Kart Stadium#en-GB", "Mario Kart Stadium"), ("Mario Kart Stadium#nl-NL", "Mario Kart-Stadion")]


def _confirmed_rows(points):
    return [{"Player": name, "Character": "Mario", "RacePoints": str(pts), "TotalPoints": str(total)}
            for name, pts, total in points]


@pytest.mark.skipif(recorded_assets() is None, reason=SKIP_REASON)
def test_a_pending_race_keeps_the_last_confirmed_standings():
    board = FeedScoreboard(feed="g1", races_total=12)
    board.apply_track({"track_name": "Mario Kart Stadium"}, 1, now=100.0)
    board.apply_provisional([{"Position": "1", "Player": "Anna", "RacePoints": "15"},
                             {"Position": "2", "Player": "Bram", "RacePoints": "12"}], 1)
    first = board.to_payload()
    # Race 1 finished, nothing confirmed: the page must not show overall standings yet.
    assert (first["phase"], first["totals_ready"], first["total_rows"]) == ("review", False, [])
    board.apply_confirmed(_confirmed_rows([("Anna", 15, 15), ("Bram", 12, 12)]), 1)
    confirmed = board.to_payload()
    assert (confirmed["phase"], confirmed["totals_ready"], confirmed["races_completed"]) == ("review", True, 1)
    assert [(r["driver"], r["total"]) for r in confirmed["total_rows"]] == [("Anna", 15), ("Bram", 12)]

    board.apply_track({"track_name": "Water Park"}, 2, now=200.0)
    racing = board.to_payload()
    assert (racing["phase"], racing["display_race"], racing["total_rows"]) == ("racing", 2, confirmed["total_rows"])
    board.apply_provisional([{"Position": "1", "Player": "Bram", "RacePoints": "15"},
                             {"Position": "2", "Player": "Anna", "RacePoints": "12"}], 2)
    pending = board.to_payload()
    # Race 2's finishing order is known but unconfirmed: the overall standings still hold race 1 only,
    # and the counters tell the page which race is pending ("after race 1 of 12 · race 2 awaiting ...").
    assert (pending["phase"], pending["totals_ready"], pending["races_completed"], pending["display_race"],
            pending["races_total"]) == ("review", False, 1, 2, 12)
    assert pending["total_rows"] == confirmed["total_rows"]
    assert pending["track"]["id"] == "track.water_park"
