"""Player names in every script a Switch profile name can use.

The scoreboard name reader is a Latin EasyOCR reader. A Switch profile name can
also be Cyrillic, Japanese, Korean or Chinese, which that reader cannot read.
EasyOCR combines at most one of those scripts with English in a reader, so each
script gets its own reader: Cyrillic, Japanese, Korean, simplified Chinese and
traditional Chinese.

The script readers are a fallback that needs the tournament's own roster
(``MK8DX_TOURNAMENT_ROSTER``, a file with the participants' names):

1. The Latin reading is kept whenever it matches a roster name.
2. Otherwise the readers for the scripts the roster itself uses read the same
   name box, and a reading replaces the Latin one only when it shows its
   reader's script, matches one roster Player unambiguously at the same name-only
   threshold Tournament Live uses to relink a driver
   (``broadcast_state._fuzzy_roster_match``), and matches better than the Latin
   reading.
3. Anything else keeps the Latin reading: the Director matches it as before.

The output is still what was read, never the roster name: identities are
matched by the Director (Step 5 / Step 9 / Incoming results), not here.
"""
from __future__ import annotations

import csv
import json
import os
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Mapping, Sequence

ROSTER_ENV = "MK8DX_TOURNAMENT_ROSTER"

# Name-only roster threshold of Tournament Live's driver relinking
# (broadcast_state._fuzzy_roster_match, characters not corroborating).
ROSTER_MATCH_THRESHOLD = 0.88

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


def shows_reader_script(text: str | None, script: str) -> bool:
    """Whether a reading contains characters of its reader's own script."""
    return bool(text_classes(text) & READER_CLASSES[script])


def scripts_for_names(names: Iterable[str]) -> tuple[str, ...]:
    """The script readers worth trying for a roster, in fallback order."""
    classes: set[str] = set()
    for name in names:
        classes |= text_classes(name)
    wanted = {script for script, own in READER_CLASSES.items() if own & classes}
    return tuple(script for script in SCRIPT_ORDER if script in wanted)


def _default_similarity(left: str, right: str) -> float:
    from .ocr_name_matching import weighted_similarity

    return float(weighted_similarity(left, right))


@dataclass(frozen=True)
class RosterMatch:
    score: float
    player: int  # index of the roster entry, -1 for none
    name: str


NO_MATCH = RosterMatch(0.0, -1, "")


@dataclass(frozen=True)
class PlayerRoster:
    """Participants as name tuples: display name first, then the names they also answer to."""

    players: tuple[tuple[str, ...], ...]

    @classmethod
    def from_names(cls, players: Iterable[str | Sequence[str]]) -> "PlayerRoster":
        entries: list[tuple[str, ...]] = []
        for player in players:
            names = (player,) if isinstance(player, str) else tuple(player)
            cleaned = tuple(dict.fromkeys(" ".join(str(name).split()) for name in names if str(name).strip()))
            if cleaned:
                entries.append(cleaned)
        return cls(tuple(entries))

    @property
    def names(self) -> tuple[str, ...]:
        return tuple(name for player in self.players for name in player)

    @property
    def scripts(self) -> tuple[str, ...]:
        return scripts_for_names(self.names)

    def best_match(self, text: str | None, similarity: Callable[[str, str], float] | None = None) -> RosterMatch:
        # Spacing is not compared: a reader may split "김민수" into "김 민수".
        reading = "".join(str(text or "").split())
        if not reading:
            return NO_MATCH
        similarity = similarity or _default_similarity
        best = NO_MATCH
        for index, player in enumerate(self.players):
            for name in player:
                score = float(similarity(reading, "".join(name.split())))
                if score > best.score:
                    best = RosterMatch(score, index, name)
        return best


def _json_players(value: object) -> list[str | tuple[str, ...]]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, Mapping):
        if "displayName" in value or "name" in value:
            first = str(value.get("displayName") or value.get("name") or "")
            aliases = value.get("aliases") or []
            return [tuple([first, *[str(alias) for alias in aliases if isinstance(alias, str)]])]
        players: list[str | tuple[str, ...]] = []
        for nested in value.values():  # e.g. {"1": [...], "2": [...]} per group
            players.extend(_json_players(nested))
        return players
    if isinstance(value, list):
        players = []
        for nested in value:
            players.extend(_json_players(nested))
        return players
    return []


def load_roster(path: str | os.PathLike[str]) -> PlayerRoster:
    """Read a roster file.

    ``.json``: a list of names, a list of ``{"displayName", "aliases"}`` objects, or
    an object of such lists per group. ``.csv``: one Player per row, the other
    cells are names the Player also answers to. Anything else: one Player per
    line, other names after ``|``; empty lines and lines starting with ``#`` are
    skipped.
    """
    file = Path(path)
    text = file.read_text(encoding="utf-8-sig")
    suffix = file.suffix.lower()
    if suffix == ".json":
        return PlayerRoster.from_names(_json_players(json.loads(text)))
    if suffix == ".csv":
        rows = csv.reader(text.splitlines(), delimiter=";" if text.count(";") > text.count(",") else ",")
        return PlayerRoster.from_names(tuple(cell for cell in row if cell.strip()) for row in rows)
    players: list[tuple[str, ...]] = []
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        players.append(tuple(part for part in line.split("|")))
    return PlayerRoster.from_names(players)


_ROSTER_CACHE: dict[tuple[str, int], PlayerRoster | None] = {}
_ROSTER_OVERRIDE: list[PlayerRoster | None] = []


def set_roster(roster: PlayerRoster | None) -> None:
    """Use this roster instead of ``MK8DX_TOURNAMENT_ROSTER`` (tests, embedding callers)."""
    _ROSTER_OVERRIDE[:] = [roster]


def clear_roster_override() -> None:
    _ROSTER_OVERRIDE.clear()


def active_roster() -> PlayerRoster | None:
    if _ROSTER_OVERRIDE:
        return _ROSTER_OVERRIDE[0]
    value = os.environ.get(ROSTER_ENV, "").strip().strip('"')
    if not value:
        return None
    path = Path(value)
    try:
        key = (str(path.resolve()), path.stat().st_mtime_ns)
    except OSError:
        return None
    if key not in _ROSTER_CACHE:
        try:
            roster = load_roster(path)
        except (OSError, ValueError, UnicodeDecodeError):
            roster = None
        _ROSTER_CACHE[key] = roster if roster is not None and roster.players else None
    return _ROSTER_CACHE[key]


@dataclass(frozen=True)
class NameChoice:
    text: str
    confidence: int
    script: str  # "latin" or the script reader that won
    match: RosterMatch


def needs_script_readers(latin_text: str, roster: PlayerRoster | None,
                         similarity: Callable[[str, str], float] | None = None) -> bool:
    if roster is None or not roster.scripts:
        return False
    return roster.best_match(latin_text, similarity).score < ROSTER_MATCH_THRESHOLD


def choose_player_name(
    latin_text: str,
    latin_confidence: int,
    script_readings: Mapping[str, Sequence[tuple[str, int]]],
    roster: PlayerRoster | None,
    similarity: Callable[[str, str], float] | None = None,
) -> NameChoice:
    """Keep the Latin reading unless one script reading unambiguously matches the roster better."""
    if roster is None:
        return NameChoice(latin_text, latin_confidence, "latin", NO_MATCH)
    latin_match = roster.best_match(latin_text, similarity)
    keep = NameChoice(latin_text, latin_confidence, "latin", latin_match)
    if latin_match.score >= ROSTER_MATCH_THRESHOLD:
        return keep
    qualifying: list[tuple[float, int, int, str, str, RosterMatch]] = []
    for order, script in enumerate(SCRIPT_ORDER):
        for text, confidence in script_readings.get(script, ()):
            if not text or not shows_reader_script(text, script):
                continue
            match = roster.best_match(text, similarity)
            if match.score >= ROSTER_MATCH_THRESHOLD and match.score > latin_match.score:
                qualifying.append((match.score, int(confidence), -order, text, script, match))
    if not qualifying:
        return keep
    if len({entry[5].player for entry in qualifying}) > 1:
        return keep  # two readers point at different Players: the Director decides
    score, confidence, _order, text, script, match = max(qualifying, key=lambda entry: entry[:3])
    return NameChoice(text, confidence, script, match)


class ScriptMemory:
    """Which script reader resolved a Latin reading to which roster Player, for the run.

    Keyed by what the Latin reader saw, never by a result position, and written only after a full,
    unambiguous roster match over every roster script. The remembered reader is tried first and
    accepted only when it names the same Player again; anything else re-reads with every script and
    replaces the memory (the evidence changed). A new roster starts an empty memory.
    """

    def __init__(self) -> None:
        import threading

        self._lock = threading.Lock()
        self._roster: PlayerRoster | None = None
        self._entries: dict[str, tuple[int, str]] = {}

    @staticmethod
    def key(latin_text: str) -> str:
        return "".join(unicodedata.normalize("NFKC", str(latin_text or "")).split())

    def recall(self, roster: PlayerRoster, latin_text: str) -> tuple[int, str] | None:
        with self._lock:
            if self._roster is not roster:
                self._roster, self._entries = roster, {}
            return self._entries.get(self.key(latin_text))

    def remember(self, roster: PlayerRoster, latin_text: str, player: int, script: str) -> None:
        with self._lock:
            if self._roster is not roster:
                self._roster, self._entries = roster, {}
            self._entries[self.key(latin_text)] = (player, script)

    def forget(self, roster: PlayerRoster, latin_text: str) -> None:
        with self._lock:
            if self._roster is roster:
                self._entries.pop(self.key(latin_text), None)

    def clear(self) -> None:
        with self._lock:
            self._roster, self._entries = None, {}


SCRIPT_MEMORY = ScriptMemory()
