"""The product languages of Tournament Live (roadmap LANGUAGES_15, part B) and their catalogs.

The same module as LiveTrial's livetrial_languages.py (tests/tournament/test_product_languages.py keeps the two
language lists equal), with catalogs beside this file and a reverse lookup for re-translating widget text.

The game's 15 localisations, the same codes as the website and the Android app. English and Dutch are the reviewed
source languages whose text lives in the code; the other 13 come from catalogs in `dashboard/i18n/<code>.json`
(built by tooling/i18n/build_web_catalogs.mjs; here `i18n/<code>.json` beside this module). English is the key: a text is looked up exactly, then against the
message templates (English with `{0}`, `{1}` where the code inserts a value) whose captured values fill the
translated template — the rule of the website's product-catalog.ts. A missing catalog leaves the text English.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

# code, label in its own language, Clean Assets template folder (images/hud/templates/<bucket>/)
LANGUAGES: tuple[tuple[str, str, str], ...] = (
    ("en", "English (UK)", "en"), ("nl", "Nederlands", "nl"), ("en-US", "English (US)", "en-us"),
    ("fr", "Français", "fr"), ("fr-CA", "Français (Canada)", "fr-ca"), ("de", "Deutsch", "de"),
    ("es", "Español (España)", "es"), ("es-419", "Español (Latinoamérica)", "es-419"),
    ("it", "Italiano", "it"), ("pt", "Português", "pt"), ("ru", "Русский", "ru"), ("ja", "日本語", "ja"),
    ("ko", "한국어", "ko"), ("zh-CN", "简体中文", "zh-cn"), ("zh-TW", "繁體中文", "zh-tw"),
)
CODES = frozenset(code for code, _, _ in LANGUAGES)
_BY_LOWER = {code.lower(): code for code in CODES}
_PLACEHOLDER = re.compile(r"\{(\d+)\}")
_DROPPABLE = re.compile(r"[A-Za-z]{0,3}")
CATALOG_ROOT = Path(__file__).resolve().parent / "i18n"


def parse_language(value: object) -> str | None:
    """A product language code in any case, else None."""
    return _BY_LOWER.get(str(value).strip().lower()) if isinstance(value, str) else None


def template_bucket(code: str) -> str:
    return next((bucket for known, _, bucket in LANGUAGES if known == code), "en")


def label(code: str) -> str:
    return next((name for known, name, _ in LANGUAGES if known == code), code)


def uses_catalog(code: str) -> bool:
    return code in CODES and code not in {"en", "nl"}


class _Catalog:
    def __init__(self, document: dict) -> None:
        self.exact: dict[str, str] = {}
        self.templates: list[tuple[re.Pattern[str], str, int]] = []
        for source, translation in (document.get("messages") or {}).items():
            if not isinstance(translation, str) or not translation:
                continue
            count = len(_PLACEHOLDER.findall(source))
            if count == 0:
                self.exact[source] = translation
                continue
            literals = _PLACEHOLDER.split(source)[::2]
            pattern = re.compile("^" + r"([\s\S]*?)".join(re.escape(part) for part in literals) + "$")
            self.templates.append((pattern, translation, count))
        names = document.get("gameNames") or {}
        self.game_names = sorted(
            ((english, local) for english, local in names.items() if english and local and english != local),
            key=lambda pair: -len(pair[0]),
        )

    def reverse(self) -> dict[str, str]:
        if not hasattr(self, "_reverse"):
            self._reverse = {translated: english for english, translated in self.exact.items()}
        return self._reverse

    def translate(self, text: str) -> str | None:
        if text in self.exact:
            return self.exact[text]
        for pattern, translation, count in self.templates:
            match = pattern.match(text)
            # A left-out placeholder may only have carried an English plural ("{0} player{1}").
            if match and len(match.groups()) == count and _keeps_dropped_values_short(translation, match.groups()):
                values = [self.translate(value) or value for value in match.groups()]
                return _PLACEHOLDER.sub(lambda found: values[int(found.group(1))] if int(found.group(1)) < len(values) else found.group(0), translation)
        return next((local for english, local in self.game_names if english == text), None)


def _keeps_dropped_values_short(translation: str, values: tuple[str, ...]) -> bool:
    used = {int(found) for found in _PLACEHOLDER.findall(translation)}
    return all(index in used or _DROPPABLE.fullmatch(value) for index, value in enumerate(values))


@lru_cache(maxsize=16)
def _catalog(code: str, root: str) -> _Catalog | None:
    path = Path(root) / f"{code}.json"
    try:
        return _Catalog(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return None


def translate(code: str, english: str, root: Path = CATALOG_ROOT) -> str:
    """The text of `english` in `code`; English when the language has no catalog or the catalog lacks it."""
    if not english or not uses_catalog(code):
        return english
    catalog = _catalog(code, str(root))
    if catalog is None:
        return english
    translated = catalog.translate(english.strip())
    if translated is None:
        return english
    start = english.find(english.strip())
    return english[:start] + translated + english[start + len(english.strip()):]


def english_for(code: str, text: str, root: Path = CATALOG_ROOT) -> str | None:
    """The English source of an exact catalog text in `code` (widgets keep their translated text), else None."""
    if not uses_catalog(code):
        return None
    catalog = _catalog(code, str(root))
    if catalog is None:
        return None
    return catalog.reverse().get(text)


def english_for_any_language(text: str, root: Path = CATALOG_ROOT) -> str | None:
    """The English source of `text` in whichever catalog language it is written, else None.

    A language switch sets the new language before the widgets are re-translated, so their text is still in the
    language switched away from (German "Alle starten" when switching to English). A text that already is an English
    source of some catalog stays as it is."""
    catalogs = [catalog for code, _, _ in LANGUAGES if uses_catalog(code)
                for catalog in (_catalog(code, str(root)),) if catalog is not None]
    if not text or any(text in catalog.exact for catalog in catalogs):
        return None
    return next((catalog.reverse()[text] for catalog in catalogs if text in catalog.reverse()), None)
