"""The colour-variant refinement writes numbers into columns it creates (pandas 3 regression).

pandas 3 infers a strict string dtype from a column filled with "", so writing an index or a score into it
raised TypeError and stopped the whole recorded analysis (TN13 qualification run, 2026-11-13)."""
import pandas as pd

from mk8dx_tournament_extraction.engine import extract_text


def test_created_family_columns_accept_numbers(monkeypatch, tmp_path):
    monkeypatch.setattr(extract_text, "load_character_templates", lambda: [])
    df = pd.DataFrame({"Character": ["Yoshi", "Mario"], "FixPlayerName": ["Nova", "Kiki"]})
    out = extract_text.refine_character_variant_families(df, tmp_path)
    out.at[0, "CharacterFamilyBestIndex"] = 23
    out.at[0, "CharacterFamilyBestCoeff"] = 91.5
    out.at[0, "CharacterFamilyMargin"] = 4.2
    out.at[0, "CharacterFamilyBest"] = "Light-Blue Yoshi"
    assert out.at[0, "CharacterFamilyBestIndex"] == 23
    assert out.at[1, "CharacterFamilyBestIndex"] == ""
