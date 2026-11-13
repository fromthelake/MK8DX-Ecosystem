"""Shared field reader for the Tournament character exports (Tournament Live and the post-analysis tool).

Moved from `live_processor.shared_export_characters` (01-11) so the post-analysis tool makes the same character
decision, the owner's lobby Mii rule included; Live keeps importing it from there.

The official CSV/Excel character comes from the bundle consensus over the
~7 RaceScore frames of a race. The shared
MK8DX field reader (``packages/icon-matcher``) reads the same 48x52 row cell on
every one of those frames; a character it accepts on at least two frames, with
no frame accepting another one, replaces the consensus character for that row
and stays fixed through prior replay and colour-variant refinement. A row it
is not accepted is unknown, unless the central open-set rule finds no clear winner
on at least two frames: then it carries Tournament's "Mii" with the Mii signal its
decision over races counts. The shared catalog has no Miis, so when Tournament's
player-history Mii handling calls a row Mii, that wins. ``shared`` is the default; ``legacy`` leaves
the export exactly as before and ``shadow`` records the shared decision without
applying it.
"""

from __future__ import annotations

import json
import os
from collections import Counter
from pathlib import Path
from typing import Any, Mapping

import cv2  # type: ignore
import numpy as np


# The central reader is the only route; the previous character route ("legacy") and its comparison
# ("shadow") were removed on 2026-10-30. Mii rows keep Tournament's Mii decision (the central
# references hold no Miis) - a gap in the central reader, not a fallback.
ROUTES = ("shared",)
DEFAULT_ROUTE = "shared"
MIN_AGREEING_FRAMES = 2
# CPU name snapping (owner 01-11): OCR name vs the decided character's names. 01-11 cups: "IgBY"/Iggy 0.75,
# "Shv Guv"/Shy Guy 0.67, "Rozegouden P"/Rozegouden Peach 0.73, "Tanook? Mario" 0.92.
CPU_NAME_MIN_SIMILARITY = 0.6
CPU_NAME_MIN_SIMILARITY_NO_LOBBY = 0.75
# Tournament's own Mii label and the marker its decision over races counts as a Mii signal
# (extract_text.apply_mii_character_fallback).
MII_CHARACTER_NAME = "Mii"
MII_CHARACTER_INDEX = 80
MII_ROSTER_INDEX = 47
MII_SIGNAL = "open_set_mii_reject"


def _field_package():
    """The central field package (mk8dx_icon_matcher), staged from the repository when it is not installed."""
    import sys

    try:
        import mk8dx_icon_matcher
        return mk8dx_icon_matcher
    except ModuleNotFoundError as error:
        if error.name != "mk8dx_icon_matcher":
            raise
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "packages" / "icon-matcher" / "python"
        if (candidate / "mk8dx_icon_matcher" / "field_reader.py").is_file():
            sys.path.insert(0, str(candidate))
            import mk8dx_icon_matcher
            return mk8dx_icon_matcher
    raise ModuleNotFoundError("Shared field package is not staged")


def _character_box(layout_id: str, row: int) -> tuple[int, int, int, int]:
    """A score row's character cell on the 1280x720 board (central scoreboard frames, engine score layouts)."""
    from mk8dx_icon_matcher.frame_geometry import scoreboard_frames
    from .engine.score_layouts import get_score_layout

    board = scoreboard_frames()["scoreboard"]
    character = board["character"]
    return (int(get_score_layout(layout_id).character_roi_left),
            int(character["top"]) + (row - 1) * int(board["rowHeight"]),
            int(character["width"]), int(character["height"]))


def _working_frame(frame: np.ndarray) -> np.ndarray:
    """Bundle frames are already on the 1280x720 working canvas; anything else is resized onto it."""
    if frame.shape[:2] == (720, 1280):
        return frame
    return cv2.resize(frame, (1280, 720), interpolation=cv2.INTER_LINEAR)


def field_reader_route(environment: Mapping[str, str] | None = None) -> str:
    """Always the central reader; no setting selects another route (switch removed 2026-11-02)."""
    return DEFAULT_ROUTE


class SharedExportCharacters:
    def __init__(self, asset_root: Path):
        from mk8dx_tournament_extraction.engine.game_catalog import load_game_catalog  # type: ignore

        self.api = _field_package()
        from mk8dx_icon_matcher import open_set  # noqa: WPS433 - staged by _field_package

        self.open_set = open_set
        self.matcher = self.api.IconMatcher(self.api.ReferenceBank(Path(asset_root)))
        from .lobby_mii import LobbyGeometry, character_names

        self.lobby = LobbyGeometry()
        self.version = self.api.FIELD_SEMANTICS_VERSION
        self.method = f"shared_field_{self.version}"
        db = json.loads((Path(asset_root) / "database.json").read_bytes())
        self.character_names = character_names(db)
        grid = db["detection"]["scoreboard"]
        if grid["frame"] != {"width": 1280, "height": 720} or grid["character"]["rows"] != 12:
            raise ValueError("Unsupported Tournament score grid")
        catalog = {int(item.character_index): item for item in load_game_catalog().characters}
        self.legacy = {}
        for item in [*db["collections"]["characters"], *db["relationships"]["characterVariants"]]:
            index = item.get("externalIds", {}).get("videoResultExtractor", {}).get("characterIndex")
            if index is not None and int(index) in catalog:
                entry = catalog[int(index)]
                self.legacy[item["id"]] = (int(index), entry.name_uk, int(entry.roster_index))

    def decide(self, frames: list[np.ndarray], layout_id: str, row: int,
               lobby_player: Any = None) -> dict[str, Any]:
        from .lobby_mii import own_face_score

        x, y, w, h = _character_box(layout_id, row)
        context = self.api.FieldContext("direct_game", "scoreboard", "row", "present")
        accepted: Counter[str] = Counter()
        top1: Counter[str] = Counter()
        best: dict[str, float] = {}
        mii_votes = 0
        face_wins = 0
        face_scores: list[float] = []
        for frame in frames:
            crop = _working_frame(frame)[y:y + h, x:x + w]
            if crop.shape[:2] != (h, w):
                continue
            read = self.api.read_field(crop, "characters", "scoreboard", context, self.matcher)
            if read.get("top1Id"):
                top1[read["top1Id"]] += 1
            ranked = read.get("rankedCandidates") or []
            if self.open_set.mii_suggestion("scoreboard", ranked, read.get("acceptedId")):
                mii_votes += 1
            if lobby_player is not None and ranked:
                # The owner's lobby rule: this player's own lobby Mii face as ONE extra candidate
                # next to the character references, scored as they are.
                face = own_face_score(self.matcher, crop, lobby_player)
                face_scores.append(round(face, 4))
                if face > float(ranked[0]["score"]):
                    face_wins += 1
            if read.get("acceptedId"):
                accepted[read["acceptedId"]] += 1
                score = float((read.get("visualRead") or {}).get("score") or 0.0)
                best[read["acceptedId"]] = max(best.get(read["acceptedId"], 0.0), score)
        winner = None
        lookalike = None
        if len(accepted) == 1:
            (candidate, count), = accepted.items()
            if count >= MIN_AGREEING_FRAMES and candidate in self.legacy:
                if candidate in self.open_set.MII_LOOKALIKES:
                    lookalike = candidate
                else:
                    winner = candidate
        # No clear winner on the frames of this race (central open-set rule): a Mii signal for
        # Tournament's decision over races, never a size and never certain on one race.
        lobby_mii = face_wins >= MIN_AGREEING_FRAMES
        if lobby_mii:
            # the player's own Mii face beat every character: the Mii wins over an accepted read
            winner = lookalike = None
        mii = lobby_mii or (not accepted and mii_votes >= MIN_AGREEING_FRAMES)
        return {"row": row, "frames": len(frames), "acceptedId": winner,
                "miiLookalikeKeptOldRoute": lookalike, "miiSuggested": mii, "miiVotes": mii_votes,
                "lobbyMii": lobby_mii, "lobbyFaceWins": face_wins, "lobbyFaceScores": face_scores,
                "lobbyName": getattr(lobby_player, "name", None),
                "acceptedVotes": dict(accepted), "top1Votes": dict(top1.most_common(3)),
                "score": round(best.get(winner, 0.0), 4) if winner else None}

    def _snap_cpu_name(self, row: dict[str, Any], character_id: str, lobby_known: bool) -> None:
        """A CPU's name is its character's name in the console language (owner 01-11). When the row's character is
        decided and its OCR name is close to one of that character's names (any locale), the row takes that exact
        spelling and keeps the OCR reading in PlayerNameOcr: the background behind the name text leaves noise such as
        "IgBY" for Iggy. Never for a lobby Mii player (a person; the caller checks) and never for a name with a digit
        (gamertags such as "Mario123"); without a lobby frame the match must be closer."""
        from mk8dx_icon_matcher.name_match import normalize, similarity

        name = str(row.get("PlayerName") or "")
        if not name or any(ch.isdigit() for ch in name):
            return
        family = self.matcher.references.family.get
        own = family(character_id) or character_id
        candidates = [label for cid, label in self.character_names if (family(cid) or cid) == own]
        if not candidates or any(normalize(label) == normalize(name) for label in candidates):
            return  # already one of the character's names (case/punctuation aside): keep the reading
        # closest by letters, then by the raw spelling (case, hyphens) so "Shy guy" never replaces "Shy Guy"
        score, _raw, label = max((similarity(normalize(name), normalize(label)), similarity(name, label), label)
                                 for label in candidates)
        if score >= (CPU_NAME_MIN_SIMILARITY if lobby_known else CPU_NAME_MIN_SIMILARITY_NO_LOBBY) and label != name:
            row["PlayerNameOcr"] = name
            row["PlayerName"] = label

    def _names_character(self, name: str, character_id: str) -> bool:
        """The row name strongly matches a name of the accepted character (or of its family)."""
        from mk8dx_icon_matcher.name_match import match_name, normalize

        found = match_name(name, self.character_names)
        if not found.strong():
            return False
        family = self.matcher.references.family.get
        named = {cid for cid, label in self.character_names if normalize(label) == normalize(found.name)}
        return (family(character_id) or character_id) in {family(cid) or cid for cid in named}

    def lobby_players(self, lobby_frame: np.ndarray | None) -> list[Any]:
        """The race's lobby players with a Mii face (CPU players - named after their character AND
        showing that character in the lobby - are left out)."""
        if lobby_frame is None:
            return []
        from mk8dx_tournament_extraction.engine.extract_text import extract_player_names_batched  # type: ignore

        from .lobby_mii import is_cpu_player

        def read_names(image, coords):
            names, _confidences = extract_player_names_batched(image, coords, bundle_kind="0TrackName",
                                                                field_name="lobby_name")
            return names

        family = self.matcher.references.family.get
        roster = self.lobby.players(lobby_frame, read_names, self.matcher)
        self._last_roster = roster  # all twelve names, for linking the score rows (apply)
        return [player for player in roster
                if player.is_mii_face and not is_cpu_player(player, self.character_names, family)]

    @staticmethod
    def _link_to_lobby_name(row: dict[str, Any], roster: list[Any]) -> bool:
        """The track-intro lobby shows the same names as the score screens on a solid background, so its OCR is the
        cleaner reading (owner 01-11): a score row takes the name of its clearly matching lobby slot and keeps its own
        reading in PlayerNameOcr. A reading that already equals the lobby name (case/punctuation aside) is kept, so a
        stray mark of the lobby OCR ("jord <") never replaces a correct name."""
        import re

        from mk8dx_icon_matcher.name_match import normalize
        from .engine.ocr_name_matching import weighted_similarity
        from .lobby_mii import player_for_name

        name = str(row.get("PlayerName") or "")
        player = player_for_name(name, roster, weighted_similarity) if name else None
        if player is None:
            return False
        lobby_name = re.sub(r"\s+[^\w]+$", "", str(player.name)).strip()
        score_key = normalize(name)
        lobby_key = normalize(lobby_name)
        # A fuzzy lobby match may have lost a real final character (for example
        # "Nova Jet €" against a score reading of "Nova Jet K"). Never shorten
        # a complete score name merely because the lobby OCR is incomplete.
        if lobby_key and score_key.startswith(lobby_key) and len(score_key) > len(lobby_key):
            return True
        if lobby_name and lobby_key != score_key:
            row["PlayerNameOcr"] = name
            row["PlayerName"] = lobby_name
        return True

    def apply(self, consensus: dict[str, Any], frames: list[np.ndarray], layout_id: str,
              route: str = "shared", lobby_frame: np.ndarray | None = None) -> dict[str, Any]:
        """Decide every consensus row and write the central decision into it. A row the central
        reader does not accept is unknown, except a Mii row (Tournament's Mii decision stays).
        With the race's lobby frame (0TrackName) each row's own lobby Mii face takes part."""
        self._last_roster = []
        players = self.lobby_players(lobby_frame)
        lobby_roster = list(getattr(self, "_last_roster", None) or [])
        if players:
            from mk8dx_tournament_extraction.engine.ocr_name_matching import weighted_similarity  # type: ignore

            from .lobby_mii import player_for_name
        decisions = {}
        for row in consensus.get("rows") or []:
            position = _int(row.get("RacePosition"))
            if position is None or not 1 <= position <= 12:
                continue
            linked = bool(lobby_roster) and self._link_to_lobby_name(row, lobby_roster)
            lobby_player = (player_for_name(str(row.get("PlayerName") or ""), players, weighted_similarity)
                            if players else None)
            decision = self.decide(frames, layout_id, position, lobby_player)
            if lobby_player is not None and decision["lobbyMii"]:
                # A CPU is named after its character and shows it. The lobby picture read can miss that (Funky
                # Kong's lobby face ranks below two Yoshis, 01-11), but the score row shows the character too: a row
                # whose icon is accepted as exactly the character its name names is that CPU, not a Mii. A person
                # called "Mario" shows a Mii icon, which is not accepted as Mario.
                plain = self.decide(frames, layout_id, position, None)
                if plain["acceptedId"] and self._names_character(str(row.get("PlayerName") or ""), plain["acceptedId"]):
                    decision = {**plain, "cpuByScoreRow": True, "lobbyName": lobby_player.name}
            decisions[position] = decision
            if decision["acceptedId"] is None:
                if decision["miiSuggested"] and not is_mii(row.get("Character")):
                    suggest_mii(row, f"{self.method}+{MII_SIGNAL}")
                elif not decision["miiLookalikeKeptOldRoute"] and not is_mii(row.get("Character")):
                    clear_character(row, "central_not_accepted")
                continue
            index, name, roster = self.legacy[decision["acceptedId"]]
            row["CharacterLegacy"] = row.get("Character")
            row["CharacterLegacyIndex"] = row.get("CharacterIndex")
            row["Character"] = name
            row["CharacterIndex"] = index
            row["CharacterRosterIndex"] = roster
            row["CharacterMatchConfidence"] = round(100.0 * decision["score"], 1)
            row["CharacterMatchMethod"] = self.method
            if not linked and (lobby_player is None or decision.get("cpuByScoreRow")):
                self._snap_cpu_name(row, decision["acceptedId"], lobby_known=bool(players))
        return {"route": route, "fieldSemanticsVersion": self.version,
                "catalogSha256": self.matcher.references.catalog_sha256,
                "lobbyPlayers": [player.name for player in players],
                "lobbyRoster": [player.name for player in lobby_roster],
                "rows": [decisions[key] for key in sorted(decisions)]}


_READERS: dict[str, SharedExportCharacters] = {}


def apply_export_field_reader(consensus: dict[str, Any], race_frames: list[np.ndarray],
                              score_layout_id: str, lobby_frame: np.ndarray | None = None) -> dict[str, Any]:
    """Run the central field reader on one race's consensus rows.

    A reader that cannot load does not stop the export: the characters stay unknown (Mii rows keep
    Tournament's Mii decision) and the report says why. There is no previous route to fall back to.
    """
    requested = field_reader_route()
    try:
        root = str(os.environ.get("MK8_CLEAN_ASSETS_ROOT") or "")
        if not root:
            raise FileNotFoundError("MK8_CLEAN_ASSETS_ROOT is not set")
        reader = _READERS.get(root)
        if reader is None:
            reader = _READERS[root] = SharedExportCharacters(Path(root))
        report = reader.apply(consensus, race_frames, score_layout_id, requested, lobby_frame)
    except Exception as error:  # noqa: BLE001 - the export must keep working
        for row in consensus.get("rows") or []:
            if not is_mii(row.get("Character")):
                clear_character(row, "central_reader_unavailable")
        return {"requested": requested, "route": "unavailable",
                "unavailableReason": f"{type(error).__name__}: {error}"}
    return {"requested": requested, **report}


def clear_character(row: dict[str, Any], reason: str) -> None:
    """A row whose character the central reader did not decide: unknown, the previous value kept
    beside it for the record."""
    row["CharacterLegacy"] = row.get("Character")
    row["CharacterLegacyIndex"] = row.get("CharacterIndex")
    row["Character"] = ""
    row["CharacterIndex"] = ""
    row["CharacterMatchConfidence"] = ""
    row["CharacterMatchMethod"] = reason


def suggest_mii(row: dict[str, Any], method: str) -> None:
    """A row without a clear winner (central open-set rule): Tournament's Mii label with the Mii
    signal its decision over races counts; that decision may still settle a stable character."""
    row["CharacterLegacy"] = row.get("Character")
    row["CharacterLegacyIndex"] = row.get("CharacterIndex")
    row["Character"] = MII_CHARACTER_NAME
    row["CharacterIndex"] = MII_CHARACTER_INDEX
    row["CharacterRosterIndex"] = MII_ROSTER_INDEX
    row["CharacterMatchConfidence"] = ""
    row["CharacterMatchMethod"] = method


def is_mii(character: Any) -> bool:
    return str(character or "").strip().startswith("Mii")


def _int(value: Any) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None
