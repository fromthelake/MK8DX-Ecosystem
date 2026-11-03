"""Race-ending messages on the LAN score screen (Race.msbt 9105-9113).

When a LAN race is decided the game rolls a black banner over the bottom of
the score screen with one of these messages, in the game's locale:

* 9105 "The results are in! The race is over." (the usual ending)
* 9106 five minutes passed, 9107 the player was too far behind,
* 9108 / 9113 the battle equivalents.

The texts of all 15 game locales come from Clean Assets `gameMessages`
(sources and checks recorded there). Two questions are kept apart:

1. Could a banner be on screen? A cheap, language-independent prefilter
   (`banner_candidate`): dark side margins with bright pixels on the text line.
   It only decides whether OCR is worth trying — scenery passes it too
   (measured on 2026-10-27: four of four frames with 0.07-0.15 bright text-line
   pixels were scenery, real banners scored 0.22-0.29).
2. Which message is it? OCR of the band, compared as a whole sentence with
   every locale's text (`classify_message`). Only a clear match says a banner
   is present. Any of these messages covers scoreboard row 12 the same way,
   and none means the scoreboard is complete or stable: row 12 is read from
   a later frame. A match reports the message
   identity (file + MID) and every locale that prints that exact text —
   EUen/USen and EUes/USes share their 9105 text, so the banner alone never
   names one region.

Normalisation (Unicode NFKC, case, whitespace, punctuation, markup) is only
for the comparison; the stored display text is never replaced.
"""

from __future__ import annotations

import difflib
import json
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable

# The banner band at 1280x720 (measured on tournament recordings 2024-2026: a
# dark, hatched full-width band from y~645 to y~712, white text centred on
# x=640 around y~677; it can still be sliding over row 12).
BANNER_BAND = (100, 646, 1080, 64)   # x, y, w, h: what OCR reads
MARGINS = ((15, 652, 95, 56), (1170, 652, 95, 56))   # the outer edges: long sentences reach x~190/1090
TEXT_LINE = (300, 668, 680, 24)
MARGIN_MEAN_MAX = 75.0               # the band is dark beside the scoreboard...
MARGIN_STD_MAX = 26.0                # ...and even (scenery is textured)
TEXT_BRIGHT = 200
TEXT_BRIGHT_MIN = 0.05               # some glyph pixels (a short CJK sentence is narrow)

MATCH_MIN = 0.80                     # whole-sentence similarity to accept a message
MATCH_MARGIN = 0.10                  # lead over the best DIFFERENT message
MIN_LENGTH_SHARE = 0.6               # a read must cover most of the sentence (no single words)

# EasyOCR language lists per script, in the order they are tried.
OCR_SCRIPTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("latin", ("en", "nl", "de", "fr", "es", "it", "pt")),
    ("cyrillic", ("ru", "en")),
    ("japanese", ("ja", "en")),
    ("korean", ("ko", "en")),
    ("chinese_simplified", ("ch_sim", "en")),
    ("chinese_traditional", ("ch_tra", "en")),
)

# The game's 15 localisations (Clean Assets gameLocales) in the Switch language
# list's order, the European and American variant of en/fr/es side by side
# (the system region picks one), each named in its own language. An operator
# picks one per console; the code is the game's text locale.
GAME_LOCALES: tuple[tuple[str, str], ...] = (
    ("EUen", "English (UK)"), ("USen", "English (US)"),
    ("EUfr", "Français (France)"), ("USfr", "Français (Canada)"),
    ("EUde", "Deutsch"),
    ("EUes", "Español (España)"), ("USes", "Español (Latinoamérica)"),
    ("EUit", "Italiano"), ("EUnl", "Nederlands"), ("EUpt", "Português"), ("EUru", "Русский"),
    ("JPja", "日本語"), ("TWzh", "繁體中文"), ("CNzh", "简体中文"), ("KRko", "한국어"),
)
# The 12 console languages, the locales each can show and the OCR script that reads them.
LOCALES_FOR_CONSOLE_LANGUAGE: dict[str, tuple[str, ...]] = {
    "en": ("EUen", "USen"), "fr": ("EUfr", "USfr"), "de": ("EUde",), "es": ("EUes", "USes"),
    "it": ("EUit",), "nl": ("EUnl",), "pt": ("EUpt",), "ru": ("EUru",), "ja": ("JPja",),
    "zh-tw": ("TWzh",), "zh-cn": ("CNzh",), "ko": ("KRko",),
}
SCRIPT_FOR_CONSOLE_LANGUAGE: dict[str, str] = {
    "en": "latin", "fr": "latin", "de": "latin", "es": "latin", "it": "latin", "nl": "latin",
    "pt": "latin", "ru": "cyrillic", "ja": "japanese", "ko": "korean",
    "zh-cn": "chinese_simplified", "zh-tw": "chinese_traditional",
}
AUTO = "auto"


def normalize_game_locale(value: Any) -> str:
    """A known game locale code (EUen, USfr, ...; any case), else `auto`."""
    text = str(value or "").strip().casefold()
    return next((code for code, _ in GAME_LOCALES if code.casefold() == text), AUTO)


def script_for_game_locale(locale: str) -> str:
    language = next(lang for lang, locales in LOCALES_FOR_CONSOLE_LANGUAGE.items() if locale in locales)
    return SCRIPT_FOR_CONSOLE_LANGUAGE[language]


@dataclass(frozen=True)
class GameMessage:
    file: str
    mid: int
    key: str
    locale: str
    display_text: str
    normalized: str


@dataclass(frozen=True)
class MessageMatch:
    file: str
    mid: int
    key: str
    locales: tuple[str, ...]
    display_text: str
    ratio: float
    margin: float
    read: str
    script: str | None = None

    @property
    def regional_identification(self) -> str:
        """`established` when one locale prints this text, else `not_distinguishable`
        (EUen/USen share 9105): the region is then kept open, never guessed."""
        return "established" if len(self.locales) == 1 else "not_distinguishable"

    def as_dict(self) -> dict[str, Any]:
        return {"file": self.file, "mid": self.mid, "key": self.key, "locales": list(self.locales),
                "localeBasis": "game_image", "regionalIdentification": self.regional_identification,
                "displayText": self.display_text, "ratio": round(self.ratio, 3),
                "margin": round(self.margin, 3), "read": self.read, "script": self.script}


def normalize_for_compare(text: str) -> str:
    """Comparison form only: markup removed, NFKC, casefolded, without whitespace,
    punctuation or symbols (OCR line breaks, full-width forms, ! vs ！)."""
    text = re.sub(r"<[^>]*>", "", text or "")
    text = unicodedata.normalize("NFKC", text).casefold()
    return "".join(ch for ch in text if unicodedata.category(ch)[0] in "LN")


def load_messages(database_path: str | Path) -> list[GameMessage]:
    """All locale texts of Clean Assets `gameMessages` (empty when the database has none)."""
    db = json.loads(Path(database_path).read_text(encoding="utf-8"))
    out: list[GameMessage] = []
    for record in (db.get("gameMessages") or {}).get("messages") or []:
        for locale, entry in (record.get("texts") or {}).items():
            shown = entry.get("displayText") if isinstance(entry, dict) else None
            if shown:
                out.append(GameMessage(record["file"], int(record["mid"]), record.get("key", ""), locale,
                                       shown, normalize_for_compare(shown)))
    return out


def _similarity(query: str, target: str) -> float:
    """Whole-sentence similarity; a read longer than the sentence is compared by
    its best-matching stretch of the sentence's length, because a banner still
    sliding over row 12 adds that row's digits to the read ("...is over: 1 69")."""
    if not query or not target:
        return 0.0
    whole = difflib.SequenceMatcher(None, query, target, autojunk=False).ratio()
    if len(query) <= len(target):
        return whole
    width = len(target)
    best = whole
    for start in range(0, len(query) - width + 1):
        best = max(best, difflib.SequenceMatcher(None, query[start:start + width], target, autojunk=False).ratio())
    return best


def classify_message(read: str, messages: Iterable[GameMessage], *, script: str | None = None,
                     minimum: float = MATCH_MIN, margin: float = MATCH_MARGIN) -> MessageMatch | None:
    """The message a read shows, or None when no message clearly matches.

    The best locale text must reach `minimum`, lead the best text of any OTHER
    message (file + MID) by `margin`, and the read must cover at least 60 % of
    that text: a fragment such as "race" or "results" is never enough."""
    query = normalize_for_compare(read)
    if len(query) < 4:
        return None
    scored = [(m, _similarity(query, m.normalized)) for m in messages]
    if not scored:
        return None
    best, best_ratio = max(scored, key=lambda item: item[1])
    if best_ratio < minimum or len(query) < MIN_LENGTH_SHARE * len(best.normalized):
        return None
    other = max((r for m, r in scored if (m.file, m.mid) != (best.file, best.mid)), default=0.0)
    if best_ratio - other < margin:
        return None
    locales = tuple(sorted(m.locale for m, r in scored
                           if (m.file, m.mid) == (best.file, best.mid) and m.normalized == best.normalized))
    return MessageMatch(best.file, best.mid, best.key, locales, best.display_text, best_ratio,
                        best_ratio - other, read, script)


def banner_band(frame_bgr: Any) -> Any:
    x, y, w, h = BANNER_BAND
    return frame_bgr[y:y + h, x:x + w]


def banner_features(frame_bgr: Any) -> dict[str, float]:
    import numpy as np
    grey = frame_bgr.mean(axis=2) if frame_bgr.ndim == 3 else frame_bgr
    margins = np.concatenate([grey[y:y + h, x:x + w].ravel() for x, y, w, h in MARGINS])
    x, y, w, h = TEXT_LINE
    text = grey[y:y + h, x:x + w]
    return {"marginMean": float(margins.mean()), "marginStd": float(margins.std()),
            "textBright": float(np.mean(text >= TEXT_BRIGHT))}


def banner_candidate(frame_bgr: Any) -> bool:
    """Worth an OCR read: dark, even margins and some glyph pixels on the text line."""
    if frame_bgr is None or frame_bgr.shape[0] < 712 or frame_bgr.shape[1] < 1260:
        return False
    f = banner_features(frame_bgr)
    return (f["marginMean"] <= MARGIN_MEAN_MAX and f["marginStd"] <= MARGIN_STD_MAX
            and f["textBright"] >= TEXT_BRIGHT_MIN)


def read_banner(frame_bgr: Any, reader: Any) -> str:
    """OCR of the banner band (2x upsampled), joined left to right."""
    import cv2
    band = banner_band(frame_bgr)
    band = cv2.resize(band, (band.shape[1] * 2, band.shape[0] * 2), interpolation=cv2.INTER_CUBIC)
    results = reader.readtext(band)
    results = sorted(results, key=lambda r: min(p[0] for p in r[0]))
    return " ".join(r[1] for r in results).strip()


def recognise_banner(frame_bgr: Any, messages: list[GameMessage],
                     reader_for: Callable[[tuple[str, ...]], Any], *,
                     scripts: tuple[tuple[str, tuple[str, ...]], ...] = OCR_SCRIPTS) -> dict[str, Any]:
    """The message a banner shows, or none; presence = a clear message match.

    `reader_for(languages)` returns an EasyOCR reader (the engine's cache).
    Scripts are tried in order until one read clearly matches a message; the
    result keeps the prefilter, the identity and every read apart."""
    candidate = banner_candidate(frame_bgr)
    result: dict[str, Any] = {"candidate": candidate, "bannerPresent": False, "message": None, "reads": []}
    if not candidate:
        return result
    for script, languages in scripts:
        reader = reader_for(languages)
        if reader is None:
            continue
        read = read_banner(frame_bgr, reader)
        result["reads"].append({"script": script, "text": read})
        match = classify_message(read, messages, script=script)
        if match is not None:
            result["message"] = match.as_dict()
            result["bannerPresent"] = True
            break
    return result


@dataclass
class BannerState:
    """Per race: the first sampled frame that read clearly, and its message.

    A banner says the race is decided; it does not say the scoreboard is
    complete — row 12 is under it — so callers keep reading rows from frames
    after the banner has rolled away."""
    first_frame: int | None = None
    message: dict[str, Any] | None = None
    reads: list[dict[str, Any]] = field(default_factory=list)
    attempts: int = 0
    max_attempts: int = 4
