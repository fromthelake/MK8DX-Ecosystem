"""Player names in every script a Switch profile name can use.

The scoreboard name reader is a Latin EasyOCR reader. A Switch profile name can also be Cyrillic,
Japanese, Korean or Chinese; the Latin reader turns those into garbage that differs from frame to
frame and race to race, so the per-group identity tracking cannot link that player across races.
EasyOCR combines at most one of those scripts with English in a reader, so each script has its own
reader (Cyrillic, Japanese, Korean, simplified Chinese, traditional Chinese).

This module only decides, per name box, between the Latin reading and the script readings:

1. A Latin reading that is plausible for a Switch name is passed on unchanged, exactly as before.
2. When a script reading could still clear the margin below (the Latin confidence leaves room for
   it), the script readers read the box too. The Latin reading's shape is no guide: the Latin
   reader turns Cyrillic into plausible words ("Onbra" for Ольга, at full confidence) and kana into
   digits ("1235" for たろう).
3. A script reading replaces it only when it is plausible itself: its own script dominates, every
   character is a Switch name character, and its confidence is clearly better than the Latin one.
   Two plausible readings in different scripts are a doubt: the Latin reading is passed on.

Nothing downstream changes: consensus, identity tracking across races and the Director's workflow
receive a reading as they always did. No roster, setting or review step is involved.
"""
from __future__ import annotations

import threading
import unicodedata
from dataclasses import dataclass
from typing import Mapping, Sequence


# One reader per non-Latin script, each with English (EasyOCR's rule), tried in this order.
SCRIPT_READERS: dict[str, tuple[str, ...]] = {
    "cyrillic": ("ru", "en"),
    "japanese": ("ja", "en"),
    "korean": ("ko", "en"),
    "simplified_chinese": ("ch_sim", "en"),
    "traditional_chinese": ("ch_tra", "en"),
}
SCRIPT_ORDER: tuple[str, ...] = tuple(SCRIPT_READERS)

# The character classes a reader's script shows (Han is shared by Japanese and Chinese).
READER_CLASSES: dict[str, frozenset[str]] = {
    "cyrillic": frozenset({"cyrillic"}),
    "japanese": frozenset({"kana", "han"}),
    "korean": frozenset({"hangul"}),
    "simplified_chinese": frozenset({"han"}),
    "traditional_chinese": frozenset({"han"}),
}

# A script reading must be at least this confident and beat the Latin reading by this margin.
MIN_SCRIPT_CONFIDENCE = 50
SCRIPT_MARGIN = 15

_RANGES: tuple[tuple[int, int, str], ...] = (
    (0x0400, 0x052F, "cyrillic"),
    (0x1C80, 0x1C8F, "cyrillic"),
    (0x2DE0, 0x2DFF, "cyrillic"),
    (0xA640, 0xA69F, "cyrillic"),
    (0x1100, 0x11FF, "hangul"),
    (0x3130, 0x318F, "hangul"),
    (0xA960, 0xA97F, "hangul"),
    (0xAC00, 0xD7AF, "hangul"),
    (0xD7B0, 0xD7FF, "hangul"),
    (0xFFA0, 0xFFDC, "hangul"),
    (0x3040, 0x309F, "kana"),
    (0x30A0, 0x30FF, "kana"),
    (0x31F0, 0x31FF, "kana"),
    (0xFF66, 0xFF9F, "kana"),
    (0x3400, 0x4DBF, "han"),
    (0x4E00, 0x9FFF, "han"),
    (0xF900, 0xFAFF, "han"),
    (0x20000, 0x2FA1F, "han"),
)


def character_class(char: str) -> str | None:
    code = ord(char)
    for start, end, name in _RANGES:
        if start <= code <= end:
            return name
    return None


def text_classes(text: str | None) -> set[str]:
    return {name for name in (character_class(char) for char in str(text or "")) if name}


def visible_name_characters(text: str | None) -> list[str]:
    return [char for char in " ".join(str(text or "").split()) if not char.isspace()]


def script_share(text: str | None, script: str) -> float:
    """Share of the visible characters that belong to the reader's own script."""
    visible = visible_name_characters(text)
    if not visible:
        return 0.0
    own = READER_CLASSES[script]
    return sum(1 for char in visible if character_class(char) in own) / len(visible)


def is_switch_name_char(char: str, script: str | None = None) -> bool:
    """A character a Switch profile name can hold.

    ``mii_allowed_chars.json`` (Latin, Greek, kana, symbols) is the Mii table; a Switch profile name
    also takes the Hangul, Han and Cyrillic characters of the console's languages, so a script
    reading's own script counts as allowed too.
    """
    from .name_unicode import is_allowed_name_char  # reads the runtime data on first use

    if is_allowed_name_char(char):
        return True
    return script is not None and character_class(char) in READER_CLASSES[script]


@dataclass(frozen=True)
class NameChoice:
    text: str
    confidence: int
    script: str  # "latin" or the script reader that won


def plausible_script_reading(text: str, confidence: int, script: str, latin_confidence: int) -> bool:
    visible = visible_name_characters(text)
    if not visible or script_share(text, script) < 0.5:
        return False
    if any(not is_switch_name_char(char, script) for char in visible):
        return False
    return int(confidence) >= MIN_SCRIPT_CONFIDENCE and int(confidence) >= int(latin_confidence) + SCRIPT_MARGIN


def _family(text: str) -> str:
    classes = text_classes(text)
    if "hangul" in classes:
        return "hangul"
    if "cyrillic" in classes:
        return "cyrillic"
    return "cjk"  # kana and Han: the Japanese and Chinese readers compete on confidence


def choose_player_name(
    latin_text: str,
    latin_confidence: int,
    script_readings: Mapping[str, Sequence[tuple[str, int]]],
) -> NameChoice:
    """The most confident plausible script reading, or the Latin reading unchanged.

    A plausible reading in another script family (Cyrillic, Hangul, kana/Han) that comes within the
    margin of the best one is a doubt: the Latin reading is passed on as before.
    """
    keep = NameChoice(latin_text, latin_confidence, "latin")
    candidates: list[tuple[int, int, str, str]] = []
    for order, script in enumerate(SCRIPT_ORDER):
        for text, confidence in script_readings.get(script, ()):
            text = " ".join(str(text or "").split())
            if plausible_script_reading(text, confidence, script, latin_confidence):
                candidates.append((int(confidence), -order, text, script))
    if not candidates:
        return keep
    confidence, _order, text, script = max(candidates)
    family = _family(text)
    if any(_family(other) != family and other_confidence > confidence - SCRIPT_MARGIN
           for other_confidence, _, other, _ in candidates):
        return keep
    return NameChoice(text, confidence, script)


def may_need_script_readers(latin_text: str | None, latin_confidence: int) -> bool:
    """Whether a script reading could still win: only when the Latin reading leaves room for the margin.

    Empty readings keep their existing placeholder handling.
    """
    return bool(str(latin_text or "").strip()) and int(latin_confidence) <= 100 - SCRIPT_MARGIN


class ScriptMemory:
    """What the script readers made of a Latin reading earlier in the run.

    Keyed by what the Latin reader saw, never by a result position. A script that resolved the
    reading is tried first next time and kept only when its reading is plausible again (otherwise
    every script reads the box and the memory is replaced). A reading that stayed Latin on
    ``LATIN_CONFIRMATIONS`` boxes is not read again by the script readers.
    """

    LATIN_CONFIRMATIONS = 2

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._scripts: dict[str, str] = {}
        self._latin: dict[str, int] = {}

    @staticmethod
    def key(latin_text: str) -> str:
        return "".join(unicodedata.normalize("NFKC", str(latin_text or "")).split())

    def recall(self, latin_text: str) -> str | None:
        """The remembered script, "latin" for a settled Latin reading, or None."""
        key = self.key(latin_text)
        with self._lock:
            if key in self._scripts:
                return self._scripts[key]
            if self._latin.get(key, 0) >= self.LATIN_CONFIRMATIONS:
                return "latin"
        return None

    def remember(self, latin_text: str, script: str) -> None:
        key = self.key(latin_text)
        if not key:
            return
        with self._lock:
            if script == "latin":
                self._latin[key] = self._latin.get(key, 0) + 1
            else:
                self._scripts[key] = script
                self._latin.pop(key, None)

    def forget(self, latin_text: str) -> None:
        with self._lock:
            self._scripts.pop(self.key(latin_text), None)

    def clear(self) -> None:
        with self._lock:
            self._scripts.clear()
            self._latin.clear()


SCRIPT_MEMORY = ScriptMemory()
