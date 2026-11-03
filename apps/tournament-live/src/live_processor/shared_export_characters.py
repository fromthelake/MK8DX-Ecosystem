"""Tournament Live's character export route: the shared field reader now lives in
`mk8dx_tournament_extraction.shared_characters` (one decision for Live and the post-analysis tool); this module keeps
Live's import path and the Live-only post-step that re-applies a shared decision after prior replay/refinement.
"""

from __future__ import annotations

from typing import Any

from mk8dx_tournament_extraction.shared_characters import (  # noqa: F401 - Live's import path
    DEFAULT_ROUTE,
    MII_CHARACTER_INDEX,
    MII_CHARACTER_NAME,
    MII_ROSTER_INDEX,
    MII_SIGNAL,
    MIN_AGREEING_FRAMES,
    ROUTES,
    SharedExportCharacters,
    _READERS,
    apply_export_field_reader,
    clear_character,
    field_reader_route,
    is_mii,
    suggest_mii,
)


def reassert_shared_characters(rows: list[dict[str, Any]], method_prefix: str = "shared_field_"
                               ) -> list[dict[str, Any]]:
    """Put back a shared decision that a later post-step rewrote.

    Prior replay and colour-variant refinement still see the shared rows as
    evidence for the other races; they only may not overwrite the row itself.
    """
    from .baseline_export_metadata import character_roster_name

    out = []
    for row in rows:
        row = dict(row)
        decided = str(row.get("SharedFieldCharacter") or "")
        if decided and is_mii(row.get("Character")):
            # The shared catalog has no Miis, so a Mii face can just clear its
            # bar on a real character (TN08 Ronald read as Champion Link at
            # 0.80). Tournament's player-history Mii decision wins.
            row["SharedFieldYieldedTo"] = str(row.get("Character") or "")
        elif decided and row.get("Character") != decided:
            row["SharedFieldOverride"] = str(row.get("Character") or "")
            row["Character"] = decided
            row["CharacterIndex"] = str(row.get("SharedFieldCharacterIndex") or "")
        if decided and not is_mii(row.get("Character")):
            row["Character Roster"] = character_roster_name(decided)
            if not str(row.get("CharacterMatchMethod") or "").startswith(method_prefix):
                row["CharacterMatchMethod"] = str(row.get("SharedFieldMethod") or "")
        out.append(row)
    return out


