"""The owner's lobby Mii rule; moved to `mk8dx_tournament_extraction.lobby_mii` (01-11), Live's import path."""

from mk8dx_tournament_extraction.lobby_mii import *  # noqa: F401,F403
from mk8dx_tournament_extraction.lobby_mii import (  # noqa: F401
    NAME_BOX_EXTRA_HEIGHT, NAME_MIN_GAP, NAME_MIN_SIMILARITY, LobbyGeometry, LobbyPlayer, character_names,
    face_reference, is_cpu_player, own_face_score, player_for_name, template_lobby_boxes,
)
