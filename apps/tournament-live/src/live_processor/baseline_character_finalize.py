"""Original-faithful whole-tournament character finalization for the live path.

The original project resolves characters in a final whole-df pass (extract_text.py):
``refine_character_variant_families`` (colour-variant families such as Yoshi/Shy Guy
shades) then ``apply_mii_character_fallback`` (label a player "Mii" when the closed-set
evidence is unstable across races). The live consensus only does a per-race variant
refinement and never runs the Mii fallback, so e.g. an unread player flickers between
Pauline/Link instead of settling on Mii.

This module runs the vendored original passes over the accumulated rich scoreboard rows
(which carry the character-match metadata + frame anchor paths) and returns the final
Character per (video stem, race, position) so the export can adopt it.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from mk8dx_tournament_extraction.engine import extract_common
from .live_frame_bundles import FRAME_BUNDLE_ROOT

# The vendored frame lookup defaults to Output_Results/Frames; the live writes frames
# under Live_Output/Frames. Point it there so the family refinement finds 2RaceScore.
extract_common.FRAMES_ROOT = FRAME_BUNDLE_ROOT

from .baseline_export_metadata import character_index, character_roster_name  # noqa: E402
from .shared_export_characters import is_mii  # noqa: E402
from mk8dx_tournament_extraction.engine.extract_text import (  # noqa: E402
    apply_mii_character_fallback,
    refine_character_variant_families,
)

_META_COLS = (
    "CharacterMatchConfidence", "CharacterMatchMethod", "CharacterMatchRawBest",
    "CharacterMatchRawMargin", "CharacterMatchRawTop5Spread", "CharacterMatchRawTop5FamilyCount",
    "CharacterFamilyName", "CharacterFamilyBest", "CharacterFamilyBestIndex",
    "CharacterFamilyBestCoeff", "CharacterFamilySecond", "CharacterFamilySecondCoeff",
    "CharacterFamilyMargin",
)


def _to_int(value: Any) -> int:
    try:
        return int(str(value).strip())
    except Exception:
        return 0


def _rich_rows_to_df(rows: list[dict[str, Any]]) -> pd.DataFrame:
    records = []
    for row in rows:
        character = str(row.get("Character") or "")
        record = {
            "RaceClass": str(row.get("video_context") or ""),
            "RaceIDNumber": _to_int(row.get("race_sequence")),
            "RacePosition": _to_int(row.get("Position")),
            "FixPlayerName": str(row.get("Player") or ""),
            "Character": character,
            "CharacterRosterName": row.get("Character Roster") or character_roster_name(character),
            "CharacterIndex": row.get("CharacterIndex") or character_index(character),
        }
        for col in _META_COLS:
            record[col] = row.get(col, "")
        records.append(record)
    return pd.DataFrame(records)


def finalize_characters(rich_rows: list[dict[str, Any]]) -> dict[tuple[str, int, int], tuple[str, str]]:
    """Run the original's colour-variant + Mii finalization over the accumulated rich
    rows. Returns {(video_stem, race, position): (Character, CharacterRosterName)}.
    Best-effort: returns an empty map (no change) on any failure."""
    if not rich_rows:
        return {}
    try:
        df = _rich_rows_to_df(rich_rows)
        if df.empty:
            return {}
        df = refine_character_variant_families(df, str(extract_common.FRAMES_ROOT))
        df = apply_mii_character_fallback(df)
    except Exception:
        return {}
    mapping: dict[tuple[str, int, int], tuple[str, str]] = {}
    for _index, row in df.iterrows():
        key = (str(row["RaceClass"]), int(row["RaceIDNumber"]), int(row["RacePosition"]))
        character = str(row.get("Character") or "")
        roster = str(row.get("CharacterRosterName") or "") or character_roster_name(character)
        mapping[key] = (character, roster)
    # A shared field decision (shared_export_characters) is the final character of
    # its row; the whole-event passes still used it as evidence for the others.
    # Only their Mii decision wins: the shared catalog has no Miis.
    for row in rich_rows:
        shared = str(row.get("SharedFieldCharacter") or "")
        if shared:
            key = (str(row.get("video_context") or ""), _to_int(row.get("race_sequence")),
                   _to_int(row.get("Position")))
            if not is_mii((mapping.get(key) or ("", ""))[0]):
                mapping[key] = (shared, character_roster_name(shared))
    return mapping


def apply_character_map(
    tournament_rows: list[dict[str, str]],
    mapping: dict[tuple[str, int, int], tuple[str, str]],
) -> list[dict[str, str]]:
    """Adopt the finalized Character/Character Roster onto the tournament rows, joining
    by (video context, race, position). Export labels replace spaces with underscores
    and may prefix date/stage; rich contexts retain the frame-directory name.
    Ambiguous exported labels must never transfer evidence between feeds."""
    if not mapping:
        return tournament_rows
    contexts = {key[0] for key in mapping}
    exported_contexts = {context: context.replace(" ", "_") for context in contexts if context}
    resolved: dict[str, str | None] = {}
    result = [dict(row) for row in tournament_rows]
    for row in result:
        video = str(row.get("Video", ""))
        if video not in resolved:
            candidates = [context for context, label in exported_contexts.items()
                          if video == label or video.endswith("__" + label)]
            resolved[video] = candidates[0] if len(candidates) == 1 else None
        context = resolved[video]
        if context is None:
            continue
        key = (context, _to_int(row.get("Race")), _to_int(row.get("Position")))
        refined = mapping.get(key)
        if refined is None:
            continue
        character, roster = refined
        if character:
            row["Character"] = character
            row["Character Roster"] = roster
    return result
