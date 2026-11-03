"""The owner's lobby Mii rule (2026-10-30): a player who races as a Mii shows the same face on the
score screens as beside their name in the track-intro lobby (0TrackName); Mii racing suits do not
change it.

Per score row: the row's name picks that player's lobby slot, and the player's own lobby face is
compared as ONE extra candidate next to the character references, scored exactly as the
references are (``IconMatcher.score_references``). Not every Mii in the lobby is tried.

Geometry: the central scoreboard frames' lobby boxes, taken from the Clean Assets track-intro masks
``hud_template.lan_intro_zone_mii_faces`` (12 face slots) and
``hud_template.lan_intro_zone_player_names`` (12 name rows), both on the 1280x720 frame.
The lobby shows one card per player; empty slots (fewer players) carry no face.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import cv2  # type: ignore
import numpy as np

FACE_TEMPLATE = "hud_template.lan_intro_zone_mii_faces"
NAME_TEMPLATE = "hud_template.lan_intro_zone_player_names"
NAME_BOX_WIDTH = 330
NAME_BOX_HEIGHT = 42
# The name masks sit where a human's name sits, above the country line. A card without a country line (every CPU, a
# player without a country) centres its name lower, and the box cut the lower half off: "Funkv Kona", "Shv Guv",
# "Rowcor" (01-11 cups). 8-14 px more read all twelve names on both consoles and keep the name above a country line.
NAME_BOX_EXTRA_HEIGHT = 10
# A row's name must match a lobby name this well, and better than every other lobby name.
NAME_MIN_SIMILARITY = 0.6
NAME_MIN_GAP = 0.05


def _template_boxes(clean_assets: Path, template_id: str) -> list[tuple[int, int, int, int]]:
    db = json.loads((clean_assets / "database.json").read_bytes())
    entry = next(item for item in db["collections"]["hudTemplates"] if item["id"] == template_id)
    if entry.get("frameSize") != [1280, 720]:
        raise ValueError(f"{template_id}: unsupported frame size")
    alpha = cv2.imread(str(clean_assets / entry["assets"]["template"]["path"]), cv2.IMREAD_UNCHANGED)[:, :, 3]
    _count, _labels, stats, _centres = cv2.connectedComponentsWithStats((alpha > 0).astype(np.uint8))
    boxes = [(int(x) + entry["anchor"]["x"], int(y) + entry["anchor"]["y"], int(w), int(h))
             for x, y, w, h, area in stats[1:] if area > 200]
    if len(boxes) != 12:
        raise ValueError(f"{template_id}: expected 12 slots, found {len(boxes)}")
    # left column top to bottom, then the right column
    return sorted(boxes, key=lambda box: (box[0] > 640, box[1]))


@dataclass(frozen=True)
class LobbyPlayer:
    slot: int
    name: str
    face_bgra: np.ndarray
    # The lobby picture read as a character (a CPU player shows its character, not a Mii): the
    # face is a Mii reference only when the central open-set rule finds no clear winner on it.
    picture_top: tuple[str, float] | None = None
    is_mii_face: bool = True


class LobbyGeometry:
    """The lobby slots from the central scoreboard frames (frame_geometry.lobby_boxes), which were
    taken from the Clean Assets track-intro masks (``template_lobby_boxes`` re-derives them)."""

    def __init__(self):
        from mk8dx_icon_matcher.frame_geometry import lobby_boxes

        faces, names = lobby_boxes()
        self.faces = [tuple(box) for box in faces]
        self.names = [(x, y, w, h + NAME_BOX_EXTRA_HEIGHT) for x, y, w, h in names]

    def players(self, lobby_bgr: np.ndarray,
                read_names: Callable[[np.ndarray, list[tuple[tuple[int, int], tuple[int, int]]]], list[str]],
                matcher: Any = None) -> list[LobbyPlayer]:
        """The lobby's players: every slot with a face, its name as ``read_names`` reads the name
        boxes (one call for all twelve). With ``matcher`` each picture is also read as a character,
        so a CPU's character picture is not taken for a Mii face."""
        if lobby_bgr.shape[:2] != (720, 1280):
            lobby_bgr = cv2.resize(lobby_bgr, (1280, 720), interpolation=cv2.INTER_AREA)
        coords = [((x, y), (x + w, y + h)) for x, y, w, h in self.names]
        names = read_names(lobby_bgr, coords)
        players = []
        for slot, ((x, y, w, h), name) in enumerate(zip(self.faces, names)):
            crop = lobby_bgr[y:y + h, x:x + w]
            face = face_reference(crop)
            if face is None or not str(name or "").strip():
                continue
            top, is_mii = None, True
            if matcher is not None:
                from mk8dx_icon_matcher import open_set  # noqa: WPS433

                visual = matcher.match(crop, "characters", profile="scoreboard", search_mode="center_then_shortlist")
                top = (visual.top[0].id, float(visual.top[0].score))
                is_mii = open_set.mii_suggestion("scoreboard", visual.top, visual.id) is not None
            players.append(LobbyPlayer(slot, str(name).strip(), face, top, is_mii))
        return players


def template_lobby_boxes(clean_assets: Path) -> tuple[list, list]:
    """The lobby slots re-derived from the Clean Assets masks (contract check of the frames)."""
    faces = _template_boxes(clean_assets, FACE_TEMPLATE)
    names = [(x, y, NAME_BOX_WIDTH, NAME_BOX_HEIGHT) for x, y, _w, _h in _template_boxes(clean_assets, NAME_TEMPLATE)]
    return faces, names


def face_reference(crop_bgr: np.ndarray) -> np.ndarray | None:
    """The face as a BGRA reference (central open_set.own_face_reference)."""
    from mk8dx_icon_matcher.open_set import own_face_reference

    return own_face_reference(crop_bgr)


def is_cpu_player(player: LobbyPlayer, character_names: list[tuple[str, str]],
                  family_of: Callable[[str], str | None]) -> bool:
    """A CPU player is named after its character in the console's language AND shows that character
    in the lobby instead of a Mii face. Both must hold: a person may well be called "Mario", but then
    the lobby shows their Mii face, which does not read as Mario (owner, 2026-10-31). A name shared by
    several characters ("Dorpsbewoner": both villagers) accepts any of them."""
    from mk8dx_icon_matcher.name_match import match_name, normalize

    found = match_name(player.name, character_names)
    if not found.strong() or player.picture_top is None:
        return False
    named = {cid for cid, name in character_names if normalize(name) == normalize(found.name)}
    families = {family_of(cid) or cid for cid in named}
    picture = player.picture_top[0]
    return (family_of(picture) or picture) in families


def character_names(clean_assets_db: dict) -> list[tuple[str, str]]:
    """Every character name in every catalog language, as (id, name) for ``is_cpu_name``."""
    return [(item["id"], name) for item in clean_assets_db["collections"]["characters"]
            for name in sorted(set((item.get("names") or {}).values())) if name]


def player_for_name(name: str, players: list[LobbyPlayer], similarity: Callable[[str, str], float]
                    ) -> LobbyPlayer | None:
    """The lobby player whose name matches the row name clearly, or None."""
    scored = sorted(((similarity(name, player.name), player.slot, player) for player in players),
                    key=lambda item: (-item[0], item[1]))
    if not scored or scored[0][0] < NAME_MIN_SIMILARITY:
        return None
    if len(scored) > 1 and scored[0][0] - scored[1][0] < NAME_MIN_GAP:
        return None
    return scored[0][2]


def own_face_score(matcher: Any, crop_bgr: np.ndarray, player: LobbyPlayer) -> float:
    """The player's own lobby face scored on a score-row icon as the character references are."""
    from mk8dx_icon_matcher.open_set import FACE_SCALES as scales

    return matcher.score_references(crop_bgr, "characters", [player.face_bgra], profile="scoreboard",
                                    scales=scales)
