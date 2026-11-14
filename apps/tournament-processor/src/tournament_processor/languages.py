"""The 15 game languages of the Tournament Analysis window and their catalogs.

The same languages and labels as Tournament Live (live_processor/product_languages.py) and the website; this
package does not import Tournament Live, so the small logic is repeated here (a test keeps the lists equal).
English and Dutch are the reviewed source languages whose texts live in ``gui.TEXTS``; the other 13 read
``i18n/<code>.json`` beside this module (built by tooling/i18n/build_web_catalogs.mjs from
apps/tournament-processor/i18n/messages.source.json, which tooling/i18n/extract_processor_messages.py writes).
English is the key and named placeholders such as ``{count}`` stay as they are, so a text is looked up by its
English template before the values are filled in. A missing catalog or text leaves it English.

The language: ``--language``, else ``MK8DX_LANGUAGE``, else ``MK8DX_TOURNAMENT_LANGUAGE`` (en, nl, any of the 15
codes, or auto), else the language saved by Tournament Live's language choice, else the Windows display
language matched exactly, then by region (es-MX -> es-419, zh-Hant/TW/HK/MO -> zh-TW, other zh -> zh-CN), then
by base language; English otherwise.
"""

from __future__ import annotations

import json
import locale
import os
import sys
from functools import lru_cache
from pathlib import Path
from typing import Callable, Iterable, Mapping

# code, label in its own language (the order of Tournament Live's language list)
LANGUAGES: tuple[tuple[str, str], ...] = (
    ("en", "English (UK)"), ("nl", "Nederlands"), ("en-US", "English (US)"),
    ("fr", "Français"), ("fr-CA", "Français (Canada)"), ("de", "Deutsch"),
    ("es", "Español (España)"), ("es-419", "Español (Latinoamérica)"),
    ("it", "Italiano"), ("pt", "Português"), ("ru", "Русский"), ("ja", "日本語"),
    ("ko", "한국어"), ("zh-CN", "简体中文"), ("zh-TW", "繁體中文"),
)
CODES = frozenset(code for code, _ in LANGUAGES)
_BY_LOWER = {code.lower(): code for code in CODES}
CATALOG_ROOT = Path(__file__).resolve().parent / "i18n"
# Older Windows/Python locale names ("Dutch_Netherlands") carry the language's English name.
_ENGLISH_NAMES = {
    "english": "en", "dutch": "nl", "french": "fr", "german": "de", "spanish": "es", "italian": "it",
    "portuguese": "pt", "russian": "ru", "japanese": "ja", "korean": "ko", "chinese": "zh",
}


def parse_language(value: object) -> str | None:
    """A product language code in any case, else None."""
    return _BY_LOWER.get(value.strip().lower()) if isinstance(value, str) else None


def label(code: str) -> str:
    return next((name for known, name in LANGUAGES if known == code), code)


def uses_catalog(code: str) -> bool:
    return code in CODES and code not in {"en", "nl"}


def match_tag(tag: object) -> str | None:
    """The product language of an OS/locale tag: exact, then regional, then base language; else None."""
    if not isinstance(tag, str):
        return None
    cleaned = tag.strip().split(".")[0].split("@")[0].replace("_", "-").lower()
    parts = cleaned.split("-")
    if not parts[0] or parts[0] == "*":
        return None
    parts[0] = _ENGLISH_NAMES.get(parts[0], parts[0])
    exact = _BY_LOWER.get("-".join(parts))
    if exact:
        return exact
    if parts[0] == "zh":
        return "zh-TW" if any(part in {"hant", "tw", "hk", "mo", "taiwan"} for part in parts[1:]) else "zh-CN"
    if parts[0] == "es" and len(parts) > 1 and parts[1] not in {"es", "spain"}:
        return "es-419"
    if parts[0] == "fr" and len(parts) > 1 and parts[1] == "canada":
        return "fr-CA"
    return _BY_LOWER.get(parts[0])


def _windows_ui_languages() -> list[str]:
    """The Windows display languages, most preferred first, then the regional format's locale name."""
    found: list[str] = []
    try:
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.windll.kernel32
        count, size = wintypes.ULONG(0), wintypes.ULONG(0)
        MUI_LANGUAGE_NAME = 0x8
        if kernel32.GetUserPreferredUILanguages(MUI_LANGUAGE_NAME, ctypes.byref(count), None, ctypes.byref(size)):
            buffer = ctypes.create_unicode_buffer(size.value)
            if kernel32.GetUserPreferredUILanguages(MUI_LANGUAGE_NAME, ctypes.byref(count), buffer,
                                                    ctypes.byref(size)):
                found += [name for name in buffer[:size.value].split("\x00") if name]
        locale_name = ctypes.create_unicode_buffer(85)
        if kernel32.GetUserDefaultLocaleName(locale_name, len(locale_name)):
            found.append(locale_name.value)
    except (AttributeError, OSError, ImportError, ValueError):
        pass
    return found


def system_languages(environ: Mapping[str, str] | None = None) -> list[str]:
    environ = os.environ if environ is None else environ
    candidates = _windows_ui_languages() if sys.platform == "win32" else []
    for name in ("LANGUAGE", "LC_ALL", "LC_MESSAGES", "LANG"):
        candidates += [part for part in str(environ.get(name, "") or "").split(":") if part]
    try:
        candidates.append(locale.getlocale()[0] or "")
    except ValueError:
        pass
    return candidates


def tournament_live_saved_language() -> str | None:
    """The language chosen in Tournament Live's window (its QSettings "MK8DX"/"TournamentLive" "language")."""
    try:
        if sys.platform == "win32":
            import winreg

            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\MK8DX\TournamentLive") as key:
                value, _ = winreg.QueryValueEx(key, "language")
            return parse_language(value)
        from PySide6.QtCore import QSettings  # elsewhere QSettings keeps its own file

        return parse_language(QSettings("MK8DX", "TournamentLive").value("language"))
    except (ImportError, OSError, RuntimeError):
        return None


def choose_language(explicit: object = None, environ: Mapping[str, str] | None = None,
                    saved: Callable[[], str | None] = tournament_live_saved_language,
                    preferred: Iterable[str] | None = None) -> str:
    environ = os.environ if environ is None else environ
    for value in (explicit, environ.get("MK8DX_LANGUAGE"), environ.get("MK8DX_TOURNAMENT_LANGUAGE")):
        code = parse_language(value)
        if code:
            return code
    code = saved() if saved is not None else None
    if code in CODES:
        return code
    for tag in system_languages(environ) if preferred is None else preferred:
        code = match_tag(tag)
        if code:
            return code
    return "en"


@lru_cache(maxsize=16)
def _messages(code: str, root: str) -> dict[str, str]:
    try:
        document = json.loads((Path(root) / f"{code}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    messages = document.get("messages") if isinstance(document, dict) else None
    return {english: text for english, text in (messages or {}).items()
            if isinstance(english, str) and isinstance(text, str) and text.strip()}


def translate(code: str, english: str, root: Path = CATALOG_ROOT) -> str:
    """The text of the English template ``english`` in ``code``; English when there is no translation."""
    if not english or not uses_catalog(code):
        return english
    return _messages(code, str(root)).get(english, english)
