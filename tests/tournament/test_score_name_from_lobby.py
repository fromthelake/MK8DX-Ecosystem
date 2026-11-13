"""A score row takes the cleaner lobby reading of its name, but never a shortened one (issue #137).

All names here are invented."""
from types import SimpleNamespace

import pytest
from conftest import SKIP_REASON, recorded_assets

from mk8dx_tournament_extraction.shared_characters import SharedExportCharacters

# Reads the engine's name-character data from the recorded runtime assets.
pytestmark = pytest.mark.skipif(recorded_assets() is None, reason=SKIP_REASON)

link = SharedExportCharacters._link_to_lobby_name


def _roster(*names):
    return [SimpleNamespace(name=name, slot=slot) for slot, name in enumerate(names)]


def test_a_noisy_score_reading_takes_the_lobby_name_and_keeps_its_own_reading():
    row = {"PlayerName": "Turbo Tes5"}
    assert link(row, _roster("Turbo Tess", "Lily Lap", "Max Drift"))
    assert row == {"PlayerName": "Turbo Tess", "PlayerNameOcr": "Turbo Tes5"}


def test_a_complete_score_name_is_not_shortened_by_a_truncated_lobby_reading():
    # The lobby OCR lost the last letter and read a stray mark instead; the score screen read it.
    row = {"PlayerName": "Nova Jet K"}
    assert link(row, _roster("Nova Jet €", "Lily Lap", "Max Drift"))
    assert row == {"PlayerName": "Nova Jet K"}


def test_a_stray_mark_of_the_lobby_never_replaces_a_correct_reading():
    row = {"PlayerName": "Kiki"}
    assert link(row, _roster("Kiki <", "Lily Lap"))
    assert row == {"PlayerName": "Kiki"}


def test_no_clear_lobby_match_leaves_the_row_unchanged():
    row = {"PlayerName": "Zzyzx"}
    assert not link(row, _roster("Lily Lap", "Max Drift"))
    assert row == {"PlayerName": "Zzyzx"}
