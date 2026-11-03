"""Track names and OCR languages per game locale for Tournament track recognition (languages roadmap A2).

The track card shows the name in the console's game locale. Without a chosen locale ("auto") recognition stays as
it always was: EasyOCR with English and Dutch, matched against the UK English and Dutch names. A chosen locale
(one of the 15 in `game_messages.GAME_LOCALES`, per console in Live or `MK8DX_TOURNAMENT_GAME_LOCALE` for recorded
video) adds that locale's names and reads with that locale's script — the same script groups the results-banner
OCR uses. Names come from `track-names-v1.json`, generated from Clean Assets (tooling/tournament/build_track_names.py).
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from importlib.resources import files
from typing import Iterable

from . import game_messages

ENVIRONMENT_LOCALE = "MK8DX_TOURNAMENT_GAME_LOCALE"
DEFAULT_OCR_LANGUAGES = ("en", "nl")
BUILT_IN_NAME_LOCALES = ("en-GB", "nl-NL")

# Game locale -> the Clean Assets names locale that the track card prints.
NAME_LOCALE = {
    "EUen": "en-GB", "USen": "en-US", "EUfr": "fr-FR", "USfr": "fr-CA", "EUde": "de-DE", "EUes": "es-ES",
    "USes": "es-419", "EUit": "it-IT", "EUnl": "nl-NL", "EUpt": "pt-PT", "EUru": "ru-RU", "JPja": "ja-JP",
    "KRko": "ko-KR", "CNzh": "zh-CN", "TWzh": "zh-TW",
}
# Game locale -> EasyOCR languages for the track card. Latin locales keep English and Dutch beside their own
# language; the other scripts pair with English, as EasyOCR requires.
OCR_LANGUAGES = {
    "EUen": ("en", "nl"), "USen": ("en", "nl"), "EUnl": ("en", "nl"),
    "EUfr": ("en", "nl", "fr"), "USfr": ("en", "nl", "fr"), "EUde": ("en", "nl", "de"),
    "EUes": ("en", "nl", "es"), "USes": ("en", "nl", "es"), "EUit": ("en", "nl", "it"), "EUpt": ("en", "nl", "pt"),
    "EUru": ("ru", "en"), "JPja": ("ja", "en"), "KRko": ("ko", "en"),
    "CNzh": ("ch_sim", "en"), "TWzh": ("ch_tra", "en"),
}

_STREAM_LOCALES: dict[str, str] = {}


@lru_cache(maxsize=1)
def _table() -> dict[str, dict[str, str]]:
    document = json.loads(files("mk8dx_tournament_extraction").joinpath("track-names-v1.json").read_text(encoding="utf-8"))
    return {track["names"]["en-GB"]: track["names"] for track in document["tracks"]}


def set_stream_locale(stream_id: str, locale: object) -> None:
    """The operator's choice for one console (Live); `auto` clears it."""
    _STREAM_LOCALES[str(stream_id)] = game_messages.normalize_game_locale(locale)


def game_locale(stream_id: str | None = None, explicit: object = None) -> str:
    """The game locale for a read: an explicit value, else the console's choice, else the environment, else auto."""
    for candidate in (explicit, _STREAM_LOCALES.get(str(stream_id)) if stream_id is not None else None,
                      os.environ.get(ENVIRONMENT_LOCALE)):
        locale = game_messages.normalize_game_locale(candidate)
        if locale != game_messages.AUTO:
            return locale
    return game_messages.AUTO


def ocr_languages(locale: str) -> tuple[str, ...]:
    return OCR_LANGUAGES.get(locale, DEFAULT_OCR_LANGUAGES)


def vocabulary(track_list: Iterable[tuple], locale: str) -> list[tuple[str, str]]:
    """(key, name) pairs for the central title matcher; the key is `<UK name>#<names locale>`.

    Always the UK English and Dutch names (as before); a chosen locale adds its own name for every track."""
    extra = NAME_LOCALE.get(locale)
    table = _table()
    pairs: list[tuple[str, str]] = []
    for track in track_list:
        english_name, dutch_name = track[1], track[2]
        if english_name:
            pairs.append((f"{english_name}#en-GB", english_name))
        if dutch_name:
            pairs.append((f"{english_name}#nl-NL", dutch_name))
        if extra and extra not in BUILT_IN_NAME_LOCALES and english_name:
            localized = table.get(english_name, {}).get(extra, "")
            if localized:
                pairs.append((f"{english_name}#{extra}", localized))
    return pairs
