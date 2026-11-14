"""The central printed-name matcher (CENTRAL_RECOGNITION section 8.6, phase 3).

One specification in Python (this reference), TypeScript (``ts/sharedNameMatch.ts``) and Java
(``NameMatch.java``): the vocabulary matcher the Web scanner and Android each carried (Android
``TextEvidence.matchVocab``). An OCR line is normalized (full-width digits to ASCII, lower case, letters and decimal digits
only), compared with every name by ``1 - Levenshtein / longer length`` on UTF-16 code units, the
first best name wins, and the margin is measured against the best name **spelled differently**
(the same part in another language is no rival). A match is strong at fuzzy >= 0.85 with margin
>= 0.08, or fuzzy >= 0.78 with margin >= 0.25.

The vocabulary is an ordered list of ``(key, name)`` (keys such as ``"11#en-GB"``); order matters
for ties, exactly as in the products.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass

FUZZY_MIN = 0.85
MARGIN_MIN = 0.08
WEAK_FUZZY_MIN = 0.78
WEAK_MARGIN_MIN = 0.25


def _letter_or_digit(ch: str) -> bool:
    category = unicodedata.category(ch)
    return category.startswith("L") or category == "Nd"


# Full-width digits (U+FF10-FF19) become ASCII here, before any context rule sees the text; numeric
# clue IDs are ASCII 0-9 only (context.ascii_index). Other digit scripts stay as they are.
_FULLWIDTH_DIGITS = {code: ord("0") + code - 0xFF10 for code in range(0xFF10, 0xFF1A)}


def normalize(text: str | None) -> str:
    if not text:
        return ""
    return "".join(ch for ch in text.translate(_FULLWIDTH_DIGITS).lower() if _letter_or_digit(ch))


def _units(text: str) -> list[int]:
    data = text.encode("utf-16-le")
    return [data[i] | (data[i + 1] << 8) for i in range(0, len(data), 2)]


def similarity(a: str, b: str) -> float:
    """1 - Levenshtein / longer length, on UTF-16 code units (as JavaScript and Java)."""
    ua, ub = _units(a), _units(b)
    if not ua or not ub:
        return 0.0
    prev = list(range(len(ub) + 1))
    for i in range(1, len(ua) + 1):
        cur = [i] + [0] * len(ub)
        for j in range(1, len(ub) + 1):
            cur[j] = min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (0 if ua[i - 1] == ub[j - 1] else 1))
        prev = cur
    return 1.0 - prev[len(ub)] / max(len(ua), len(ub))


@dataclass(frozen=True)
class NameMatch:
    key: str | None = None
    name: str | None = None
    fuzzy: float = 0.0
    margin: float = 0.0

    def strong(self) -> bool:
        return (self.fuzzy >= FUZZY_MIN and self.margin >= MARGIN_MIN) or \
            (self.fuzzy >= WEAK_FUZZY_MIN and self.margin >= WEAK_MARGIN_MIN)


def filter_locale(vocab: list[tuple[str, str]], locale: str | None) -> list[tuple[str, str]]:
    """The names of one locale (keys ``"<id>#<locale>"``; keys without a locale always stay);
    the whole vocabulary when the locale has none."""
    if not locale:
        return vocab
    kept = [(key, name) for key, name in vocab if key.endswith(f"#{locale}") or "#" not in key]
    return kept or vocab


def vocab_locales(vocab: list[tuple[str, str]]) -> list[str]:
    return sorted({key[key.index("#") + 1:] for key, _ in vocab if "#" in key})


def locale_vote(rows: list[tuple[str, str]], vocabs: dict[str, list[tuple[str, str]]], locales: list[str],
                preferred: list[str] | None = None) -> dict:
    """The console language from every printed name of one card at once.

    ``rows``: ``(kind, text)`` per legible row (kart first); each locale scores the sum of the rows'
    best fuzzy match among that locale's names. The highest sum wins; on a tie the earlier locale in
    ``preferred + sorted(rest)`` wins, so a remembered language only breaks ties and a screen in
    another language still wins on its own evidence. Returns the locale, its score, every locale
    tied with it and the first row's match in the winning locale."""
    order = [loc for loc in (preferred or []) if loc in locales] + sorted(loc for loc in locales
                                                                         if loc not in (preferred or []))
    scores = {}
    first_matches = {}
    for locale in order:
        joint = 0.0
        for index, (kind, text) in enumerate(rows):
            if not text:
                continue
            found = match_name(text, filter_locale(vocabs[kind], locale))
            joint += found.fuzzy
            if index == 0:
                first_matches[locale] = found
        scores[locale] = joint
    best_locale, best = None, -1.0
    for locale in order:
        if scores[locale] > best + 1e-9:
            best_locale, best = locale, scores[locale]
    tied = [loc for loc in order if abs(scores[loc] - best) <= 1e-9]
    return {"locale": best_locale, "score": best, "tied": tied,
            "firstMatch": first_matches.get(best_locale), "scores": scores}


def match_name(text: str | None, vocab: list[tuple[str, str]]) -> NameMatch:
    query = normalize(text)
    if len(_units(query)) < 3 or not vocab:
        return NameMatch()
    best, best_key, best_name = -1.0, None, None
    for key, name in vocab:
        score = similarity(query, normalize(name))
        if score > best:
            best, best_key, best_name = score, key, name
    second = -1.0
    best_normal = normalize(best_name)
    for _key, name in vocab:
        other = normalize(name)
        if other == best_normal:
            continue
        score = similarity(query, other)
        if score > second:
            second = score
    return NameMatch(best_key, best_name, max(0.0, best), best if second < 0.0 else best - second)


# Printed titles (track names): OCR of a title strip clips words and confuses letters, so the
# title profile accepts what the part-name rule above would refuse, measured on all 96 tracks in
# 11 game locales with typical OCR damage (2026-10-30: 0 wrong, 0 accepted non-titles).
TITLE_FUZZY_MIN = 0.65
TITLE_MARGIN_MIN = 0.08
TITLE_PREFIX_MIN_UNITS = 6
# Chinese, Japanese and Korean titles are 4-10 characters, so one misread character costs
# 0.1-0.25: a clear winner is accepted from 0.55 with a lead of 0.12 (LiveTrial's rule, measured
# leads 0.13-0.29 on the console-language recordings).
CJK_TITLE_FUZZY_MIN = 0.55
CJK_TITLE_MARGIN_MIN = 0.12


def _cjk(text: str | None) -> bool:
    """Whether a name is written in a Chinese, Japanese or Korean script."""
    return any(0x3040 <= ord(ch) <= 0x30FF or 0x4E00 <= ord(ch) <= 0x9FFF or 0xAC00 <= ord(ch) <= 0xD7AF
               for ch in text or "")


@dataclass(frozen=True)
class TitleMatch:
    """``key`` is None when refused; ``rule``: tokens | prefix | fuzzy | ambiguous | None."""
    key: str | None = None
    name: str | None = None
    fuzzy: float = 0.0
    margin: float = 0.0
    rule: str | None = None


def _tokens(text: str | None) -> list[str]:
    """Runs of letters and decimal digits, lower-cased (the same characters as ``normalize``)."""
    out, cur = [], []
    for ch in (text or "").lower():
        if _letter_or_digit(ch):
            cur.append(ch)
        elif cur:
            out.append("".join(cur))
            cur = []
    if cur:
        out.append("".join(cur))
    return out


def _item(key: str) -> str:
    return key.split("#", 1)[0]


def match_title(text: str | None, vocab: list[tuple[str, str]]) -> TitleMatch:
    """A printed title (a track name) in a vocabulary of ``(key, name)``, keys ``"<id>#<locale>"``.

    1. the same words in any order identify one item (OCR reorders a console prefix);
    2. the read words are the start of exactly one item's name (a clipped strip), at least two
       words and six letters;
    3. otherwise the best name by similarity, accepted at ``TITLE_FUZZY_MIN`` with a lead of
       ``TITLE_MARGIN_MIN`` over the best name of a different item (a Chinese, Japanese or Korean
       name at ``CJK_TITLE_FUZZY_MIN`` with ``CJK_TITLE_MARGIN_MIN``).
    Words matching several items refuse (``ambiguous``)."""
    words = _tokens(text)
    if not words or not vocab:
        return TitleMatch()
    key_of: dict[str, tuple[str, str]] = {}
    exact: dict[str, tuple[str, str]] = {}
    wanted = sorted(words)
    for key, name in vocab:
        item = _item(key)
        key_of.setdefault(item, (key, name))
        if sorted(_tokens(name)) == wanted and item not in exact:
            exact[item] = (key, name)
    if len(exact) > 1:
        return TitleMatch(rule="ambiguous")
    if len(exact) == 1:
        (key, name), = exact.values()
        return TitleMatch(key, name, 1.0, 1.0, "tokens")
    query = normalize(text)
    if len(words) >= 2 and len(_units(query)) >= TITLE_PREFIX_MIN_UNITS:
        starts: dict[str, tuple[str, str]] = {}
        for key, name in vocab:
            item = _item(key)
            if _tokens(name)[:len(words)] == words and item not in starts:
                starts[item] = (key, name)
        if len(starts) == 1:
            (key, name), = starts.values()
            return TitleMatch(key, name, similarity(query, normalize(name)), 1.0, "prefix")
    if len(_units(query)) < 3:
        return TitleMatch()
    best, best_key, best_name = -1.0, None, None
    for key, name in vocab:
        score = similarity(query, normalize(name))
        if score > best:
            best, best_key, best_name = score, key, name
    second = -1.0
    for key, name in vocab:
        if _item(key) == _item(best_key):
            continue
        score = similarity(query, normalize(name))
        if score > second:
            second = score
    margin = best if second < 0.0 else best - second
    if best >= TITLE_FUZZY_MIN and margin >= TITLE_MARGIN_MIN:
        return TitleMatch(best_key, best_name, best, margin, "fuzzy")
    if _cjk(best_name) and best >= CJK_TITLE_FUZZY_MIN and margin >= CJK_TITLE_MARGIN_MIN:
        return TitleMatch(best_key, best_name, best, margin, "fuzzy_cjk")
    return TitleMatch(None, best_name, max(0.0, best), margin, None)


_OWN_SCRIPT = {"ja-JP": "ja", "zh-CN": "zh", "zh-TW": "zh_tw", "ko-KR": "ko", "ru-RU": "ru"}


def script_for_locale(locale: str | None) -> str | None:
    """The OCR reader (script) that prints a game locale's names; None for no locale."""
    if not locale:
        return None
    return _OWN_SCRIPT.get(locale, "latin")


def same_name_locales(vocab: list[tuple[str, str]], key: str | None) -> list[str]:
    """Every locale whose name for the matched item is spelled like the match (normalized). A kart
    name that is the same in locales of different scripts ("GLA" in English and Japanese) does not
    settle which reader the other rows need."""
    if not key or "#" not in key:
        return []
    item = key[:key.index("#")]
    names = {k: n for k, n in vocab}
    target = normalize(names.get(key))
    return sorted({k[k.index("#") + 1:] for k, n in vocab
                   if "#" in k and k[:k.index("#")] == item and normalize(n) == target})
