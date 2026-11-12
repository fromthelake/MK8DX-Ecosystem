"""Pure, GUI-free state model for the live broadcast scoreboard.

This module turns the raw ``LiveEvent`` payloads emitted by the analysis
pipeline into a clean, serialisable shape that the browser-based scoreboard
overlay (served by :mod:`live_processor.broadcast_server`) can render directly.

It is deliberately free of any Tkinter / pipeline imports so it can be unit
tested in isolation and reused by any front-end.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from .baseline_export_metadata import character_index
from .groups import DEFAULT_GROUP, group_color, text_color_for
from .live_connection_reset import RaceTotals, evaluate_connection_resets
from .live_scoring_policy import RaceDropInfo, evaluate_player_drops
from .track_times import next_update_seconds

# Icon URLs are resolved against routes served by ``broadcast_server`` rather
# than absolute filesystem paths, so the page stays portable and the absolute
# paths in the event payloads (which point at the *baseline* project) are never
# trusted.
CHARACTER_ICON_ROUTE = "/assets/character"
TRACK_ICON_ROUTE = "/assets/track"
CUP_ICON_ROUTE = "/assets/cup"
UNKNOWN_CHARACTER_ICON = f"{CHARACTER_ICON_ROUTE}/unknown.png"


def _to_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


_REFINED_METHOD_MARKER = "variant_family_aligned_color_refine"
# The shared field reader ("shared_field_<version>", ADR recognition pipeline) reads the colour
# from the shared colour profile itself; its accepted rows are settled even without the old
# family refinement. Only the fast per-race read (no method) stays on the neutral root.
_SHARED_READER_PREFIX = "shared_field_"


def _colour_settled(method: str) -> bool:
    return _REFINED_METHOD_MARKER in method or method.startswith(_SHARED_READER_PREFIX)
# Characters whose colour is a variant of a shared base; OCR returns the bare root (e.g.
# "Yoshi") until the family refinement commits the colour. Grouping a player's reads by
# these roots lets a committed colour beat the provisional early reads. Distinct-character
# families (Mario/Peach/Baby ...) are deliberately excluded — those are real choices.
_VARIANT_FAMILY_ROOTS = ("Yoshi", "Shy Guy", "Birdo", "Inkling")


def _family_root(character: str) -> str:
    for root in _VARIANT_FAMILY_ROOTS:
        if character == root or character.endswith(" " + root):
            return root
    return character


def _to_float(value: Any) -> float:
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return 0.0


def _first(row: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = row.get(key)
        if value not in (None, ""):
            return str(value).strip()
    return ""


def character_icon_url(character_value: str | None) -> str:
    """Map an OCR'd character name (e.g. ``"Black Yoshi"``) to an icon URL.

    Unknown / unmatched names fall back to the shared ``unknown.png`` so the
    scoreboard never shows an empty avatar slot.
    """

    name = str(character_value or "").strip()
    if not name:
        return UNKNOWN_CHARACTER_ICON
    # Mii is the open-set fallback identity (not a catalog roster index), so it has
    # no numbered icon — use the dedicated Mii.png asset.
    if name.lower() == "mii":
        return f"{CHARACTER_ICON_ROUTE}/Mii.png"
    index = character_index(name)
    if index is None or index < 0:
        return UNKNOWN_CHARACTER_ICON
    return f"{CHARACTER_ICON_ROUTE}/{index}.png"


def _driver_key(driver: str, character: str) -> str:
    """Stable identity for a row across races (used for position deltas)."""

    name = driver.strip().lower()
    if name:
        return f"name:{name}"
    return f"char:{character.strip().lower()}"


def _char_norm(character: str | None) -> str:
    return str(character or "").strip().lower()


def _norm_name(driver: str | None) -> str:
    return str(driver or "").strip().lower()


@dataclass
class StandingRow:
    position: int
    driver: str
    character: str
    character_icon: str
    race_points: int | None
    total: int
    delta: int = 0  # +n moved up n places, -n moved down, 0 unchanged/new
    dropped: bool = False  # didn't score this race during a suspected connection error
    disconnected: bool = False  # absent this race (disconnected) — carried over, frozen total

    def to_payload(self) -> dict[str, Any]:
        return {
            "position": self.position,
            "driver": self.driver,
            "character": self.character,
            "character_icon": self.character_icon,
            "race_points": self.race_points,
            "total": self.total,
            "delta": self.delta,
            "dropped": self.dropped,
            "disconnected": self.disconnected,
        }


@dataclass
class TrackInfo:
    name_uk: str = ""
    name_nl: str = ""
    cup_uk: str = ""
    cup_nl: str = ""
    track_icon: str | None = None
    cup_icon: str | None = None
    id: str | None = None
    cup_id: str | None = None

    def to_payload(self) -> dict[str, Any]:
        return {
            "name_uk": self.name_uk,
            "name_nl": self.name_nl,
            "cup_uk": self.cup_uk,
            "cup_nl": self.cup_nl,
            "track_icon": self.track_icon,
            "cup_icon": self.cup_icon,
            "id": self.id,
            "cup_id": self.cup_id,
        }


def build_track_info(data: dict[str, Any]) -> TrackInfo:
    from .display_assets import resolve_track_assets

    assets = resolve_track_assets(data)
    return TrackInfo(
        name_uk=_first(data, "track_name"),
        name_nl=_first(data, "track_name_nl"),
        cup_uk=_first(data, "cup_name"),
        cup_nl=_first(data, "cup_name_nl"),
        track_icon=f"/assets/{assets['previewPath']}" if assets else None,
        cup_icon=f"/assets/{assets['cupIconPath']}" if assets else None,
        id=assets["id"] if assets else None,
        cup_id=assets["cupId"] if assets else None,
    )


def _row_total(row: dict[str, Any]) -> int:
    for key in ("TotalPoints", "Total", "NewTotalRacePoint", "DetectedNewTotalScore"):
        value = _to_int(row.get(key))
        if value is not None:
            return value
    return 0


def build_standings(
    rows: list[dict[str, Any]],
    previous_ranks: dict[str, int] | None = None,
) -> list[StandingRow]:
    """Build confirmed standings sorted by running total, with ▲▼ deltas.

    ``previous_ranks`` maps a driver key to its 1-based rank in the prior
    confirmed standings snapshot; positions that improve get a positive delta.
    """

    previous_ranks = previous_ranks or {}
    ordered = sorted(rows, key=_row_total, reverse=True)
    standings: list[StandingRow] = []
    previous_total: int | None = None
    current_rank = 0
    for index, row in enumerate(ordered, start=1):
        total = _row_total(row)
        if previous_total is None or total != previous_total:
            current_rank = index
            previous_total = total
        driver = _first(row, "Player", "player_name")
        character = _first(row, "Character", "character_icon")
        key = _driver_key(driver, character)
        previous_rank = previous_ranks.get(key)
        delta = (previous_rank - current_rank) if previous_rank is not None else 0
        standings.append(
            StandingRow(
                position=current_rank,
                driver=driver,
                character=character,
                character_icon=character_icon_url(character),
                race_points=_to_int(
                    _first(row, "RacePoints", "race_points") or None
                ),
                total=total,
                delta=delta,
            )
        )
    return standings


def _fuzzy_roster_match(
    driver: str, character: str, roster: dict[str, StandingRow], exclude: set[str]
) -> str | None:
    """Find the roster key whose name closely matches this driver (OCR name drift
    across races), skipping already-matched keys. Returns None if no confident match —
    reuses the original project's OCR-tuned name similarity."""
    driver = driver or ""
    if not driver:
        return None
    try:
        from mk8dx_tournament_extraction.engine.ocr_name_matching import weighted_similarity  # noqa: WPS433
    except Exception:
        return None
    best_key: str | None = None
    best_score = 0.0
    for key, last in roster.items():
        if key in exclude:
            continue
        score = float(weighted_similarity(driver, last.driver or ""))
        # A matching character corroborates the link; require a stronger name match when
        # characters differ, to avoid merging two genuinely different players.
        threshold = 0.80 if (character and character == last.character) else 0.88
        if score >= threshold and score > best_score:
            best_score = score
            best_key = key
    return best_key


def _rerank_standings(
    standings: list[StandingRow], previous_ranks: dict[str, int] | None = None
) -> list[StandingRow]:
    """Re-sort standings by total (desc) and reassign positions + deltas with ties
    sharing a rank — used after carried-over disconnected players are appended."""
    previous_ranks = previous_ranks or {}
    ordered = sorted(standings, key=lambda standing: standing.total, reverse=True)
    previous_total: int | None = None
    current_rank = 0
    for index, standing in enumerate(ordered, start=1):
        if previous_total is None or standing.total != previous_total:
            current_rank = index
            previous_total = standing.total
        standing.position = current_rank
        previous_rank = previous_ranks.get(_driver_key(standing.driver, standing.character))
        standing.delta = (previous_rank - current_rank) if previous_rank is not None else 0
    return ordered


def build_race_results(rows: list[dict[str, Any]]) -> list[StandingRow]:
    """Build this-race finishing order (by position) from provisional OCR rows."""

    results: list[StandingRow] = []
    for fallback, row in enumerate(rows, start=1):
        position = _to_int(_first(row, "Position", "position")) or fallback
        driver = _first(row, "Player", "player_name")
        character = _first(row, "Character", "character_icon")
        # Until the colour family is refined, the per-race base match can't tell Yoshi
        # colours apart (shape only) — show the neutral family root instead of an
        # unconfirmed, often-wrong colour.
        if not _colour_settled(_first(row, "CharacterMatchMethod")):
            root = _family_root(character)
            if root != character and root in _VARIANT_FAMILY_ROOTS:
                character = root
        total = _to_int(
            _first(row, "NewTotalRacePoint", "new_total_race_points", "TotalPoints", "Total")
        )
        results.append(
            StandingRow(
                position=position,
                driver=driver,
                character=character,
                character_icon=character_icon_url(character),
                race_points=_to_int(_first(row, "RacePoints", "race_points") or None),
                total=total if total is not None else 0,
                delta=0,
            )
        )
    results.sort(key=lambda r: r.position)
    return results


def _connection_error_payload(drop: "object") -> dict[str, Any] | None:
    """Overlay-facing connection-error status, or None when there's nothing to flag."""
    suspected = bool(getattr(drop, "suspected", False))
    excluded = sorted(getattr(drop, "excluded_races", set()) or set())
    if not suspected and not excluded:
        return None
    return {
        "suspected": suspected,
        "adjusted": bool(excluded),
        "race": getattr(drop, "latest_race", None) if suspected else None,
        "excluded_races": excluded,
        "full_count": int(getattr(drop, "full_count", 0)),
        "latest_count": int(getattr(drop, "latest_count", 0)),
    }


def _connection_reset_payload(reset: "object", latest_race: int) -> dict[str, Any] | None:
    """Overlay-facing connection-reset status, or None when no reset was detected."""
    races = sorted(getattr(reset, "reset_races", set()) or set())
    if not races:
        return None
    return {"detected": True, "races": races, "latest": int(latest_race) in races}


def ranks_from_standings(standings: list[StandingRow]) -> dict[str, int]:
    return {
        _driver_key(row.driver, row.character): row.position for row in standings
    }


def _describe_view(
    phase: str, kind: str, display_race: int | None, completed: int, plural: str
) -> tuple[str, str]:
    """Plain-English (eyebrow, caption) for a phase + shown list.

    Kept in lockstep with the client's ``describeView`` so the header reads the
    same whether the server or the rotating client picks the strings.
    """

    # Canonical vocabulary (see docs/broadcast_dashboard_redesign.md): exactly two
    # nouns — "Race result" (one race) and "Overall standings" (cumulative). Never
    # introduce "Total standings" / "Standings so far" as competing phrasings.
    if phase == "standby":
        return "Standby", "Waiting for the first race"
    if phase == "racing":
        caption = (
            f"Overall standings · after {completed} race{plural}"
            if completed
            else f"Race {display_race} · in progress"
        )
        return f"Race {display_race} in progress", caption
    if phase == "review" and kind == "race":
        return "Race result", f"Race {display_race} result"
    # review/total and the totals-only phase both show the cumulative table.
    return "Overall standings", f"Overall standings · after {completed} race{plural}"


@dataclass
class FeedScoreboard:
    """Mutable per-feed scoreboard state assembled from incoming events."""

    feed: str
    title: str = ""
    group: str = DEFAULT_GROUP
    race_sequence: int | None = None
    races_found: int = 0
    races_completed: int = 0
    # Y in the "Race X of Y" counter — the number of races in this group/cup,
    # configured by the operator in the GUI. ``None`` hides the "of Y" suffix.
    races_total: int | None = None
    # Overlay highlight mode: "end_round" (podium top 3) or "qualifier" (split the
    # standings into Kampioen/Talent/Wild advancement bands). Purely visual.
    highlight_mode: str = "end_round"
    status: str = "waiting"  # waiting | provisional | confirmed
    # Per-race lifecycle for the header: "" (no race) | "ongoing" | "finished".
    race_status: str = ""
    # True once the race total is confirmed — the overlay then swaps the track
    # banner for an "Overall standings" placeholder.
    totals_ready: bool = False
    track: TrackInfo = field(default_factory=TrackInfo)
    standings: list[StandingRow] = field(default_factory=list)
    race_rows: list[StandingRow] = field(default_factory=list)  # this-race finishing order
    # The race that actually went through track detection — the one whose finishing order
    # is legitimately "this race". A provisional for any other race is a spurious score-
    # screen re-detection (extra anchors after the real races) and must not become the
    # displayed race result.
    _review_race: int | None = None
    # Next-update countdown: starts when a track is detected (world record + 30s)
    # and stops as soon as results arrive ("in sync").
    countdown_seconds: int | None = None
    countdown_started_at: float | None = None
    synced: bool = False
    confirmed_status: str = "idle"
    confirmed_detail: str = ""
    confirmed_queue_size: int = 0
    confirmed_pending_race: int | None = None
    confirmed_started_at: float | None = None
    confirmed_duration_seconds: float | None = None
    _previous_ranks: dict[str, int] = field(default_factory=dict)
    # Most recent confirmed standing per driver key, the race it was last seen in,
    # and the established field size, so a player who disconnects (absent from a later
    # race) can be carried over into the overall standings with their last total —
    # without OCR name drift inflating the roster. Purely visual; no scoring effect.
    _last_standing_by_key: dict[str, "StandingRow"] = field(default_factory=dict)
    _last_seen_race: dict[str, int] = field(default_factory=dict)
    _full_field: int = 0
    # Per-player (canonical key) character usage counts and carried-in baseline, so the
    # overall standings show the most-used character and a total computed from cumulative
    # race points (robust to on-screen total OCR errors, continuous across resets) — the
    # same basis as the export.
    _char_counts: dict[str, dict[str, int]] = field(default_factory=dict)
    _char_conf: dict[str, dict[str, float]] = field(default_factory=dict)
    # Reads whose colour the family refinement actually committed. Early races (before the
    # refinement has 3 races of support) arrive as the bare family root ("Yoshi") default;
    # tracking which reads are refined lets the dominant ignore those provisional roots.
    _char_refined: dict[str, dict[str, int]] = field(default_factory=dict)
    _baseline: dict[str, int] = field(default_factory=dict)
    # After a reset rename, the renamed player keeps re-entering under the borrowed
    # (name, character) for the rest of the tournament — remember the link so every later
    # race maps it back to the recovered identity, not just the reset race.
    _reset_aliases: dict[tuple[str, str], str] = field(default_factory=dict)
    # Per-race scored-player history (race -> RaceDropInfo) and the resulting
    # connection-error / temporary-player-drop status surfaced to the overlay.
    _race_history: dict[int, RaceDropInfo] = field(default_factory=dict)
    _race_totals: dict[int, RaceTotals] = field(default_factory=dict)
    connection_error: dict[str, Any] | None = None
    connection_reset: dict[str, Any] | None = None

    def apply_track(
        self, data: dict[str, Any], race_sequence: int | None, now: float | None = None
    ) -> None:
        self.track = build_track_info(data)
        if race_sequence is not None:
            self.race_sequence = race_sequence
        self._review_race = self.race_sequence  # this race had a track screen — it's real
        self.race_status = "ongoing"
        self.totals_ready = False
        self.race_rows = []  # clear last race's finishing order for the new race
        self.countdown_seconds = next_update_seconds(data.get("track_id"))
        self.countdown_started_at = (
            (time.time() if now is None else now) if self.countdown_seconds else None
        )
        self.synced = False

    def apply_anchor(self) -> None:
        self.races_found += 1

    def _mark_synced(self) -> None:
        # A score update arrived — stop the countdown and flag the feed in sync.
        self.synced = True
        self.countdown_started_at = None

    def _apply_established_mii_to_race_rows(self) -> None:
        """Override a race row's character with Mii when that player is already established
        as a Mii in the cumulative standings (so the per-race result follows the settled
        TotalScore identity instead of a stray open-set guess)."""
        for row in self.race_rows:
            slot = self._last_standing_by_key.get(_driver_key(row.driver, row.character))
            if slot is None:
                slot = self._last_standing_by_key.get(_driver_key(row.driver, ""))
            if slot is not None and _char_norm(slot.character) == "mii" and _char_norm(row.character) != "mii":
                row.character = "Mii"
                row.character_icon = character_icon_url("Mii")

    def apply_provisional(
        self, rows: list[dict[str, Any]], race_sequence: int | None
    ) -> None:
        # Ignore a provisional for a race that never had a track screen — a spurious
        # score-screen re-detection (an extra anchor after the real races) would otherwise
        # leave its stale finishing order showing as the latest race result.
        if (
            race_sequence is not None
            and self._review_race is not None
            and int(race_sequence) != int(self._review_race)
        ):
            return
        # Provisional results only refresh the "this race" view; confirmed
        # standings (with running totals) remain the source of truth, so we do
        # not disturb the ranking or deltas here.
        if race_sequence is not None:
            self.race_sequence = race_sequence
        if self.status != "confirmed" or not self.standings:
            self.status = "provisional"
        # The race itself is over (finishing order is visible) even though the
        # running totals are not confirmed yet. Keep the finishing order so the
        # overlay can show the race result until the total is confirmed.
        self.race_rows = build_race_results(rows)
        # Once a player is established as a Mii in the cumulative standings, show the Mii
        # icon for them on the per-race result too — the per-race OCR keeps trying to fit a
        # real character to a Mii, but the settled identity is authoritative.
        self._apply_established_mii_to_race_rows()
        self.race_status = "finished"
        self._mark_synced()

    def _is_reset_race(self, rows: list[dict[str, Any]]) -> bool:
        """A connection reset this race shows as a broad drop in on-screen totals versus
        the roster's last-known totals (the game restarts its on-screen tally)."""
        if not self._last_standing_by_key:
            return False
        current = {_norm_name(_first(row, "Player", "player_name")): _row_total(row) for row in rows}
        comparable = drops = 0
        for slot in self._last_standing_by_key.values():
            name = _norm_name(slot.driver)
            if name in current:
                comparable += 1
                if current[name] + 2 < slot.total:
                    drops += 1
        return comparable >= 4 and drops >= comparable * 0.7

    def _relink_reset_renames(
        self, parsed: list[list[Any]], roster: dict[str, StandingRow], matched: set[str], race_no: int
    ) -> None:
        """Relink rows that couldn't match by name to a prior identity that disappeared at
        this reset (present in the immediately prior race, absent now). Mirrors the
        original reconcile_connection_reset_identities: prefer a same-character pairing,
        then fall back to elimination when exactly one player changed."""
        disappeared = [
            key
            for key in roster
            if key not in matched and self._last_seen_race.get(key) == race_no - 1
        ]
        unmatched = [index for index, row in enumerate(parsed) if row[4] is None]
        # (a) same character — disambiguates when several players rename at once.
        for index in list(unmatched):
            target = _char_norm(parsed[index][1])
            if not target:
                continue
            candidates = [
                key for key in disappeared
                if key not in matched and _char_norm(roster[key].character) == target
            ]
            if len(candidates) == 1:
                self._link_alias(parsed[index], candidates[0])
                matched.add(candidates[0])
                unmatched.remove(index)
        # (b) single-change fallback — exactly one unmatched row + one disappeared identity.
        remaining = [key for key in disappeared if key not in matched]
        if len(unmatched) == 1 and len(remaining) == 1:
            self._link_alias(parsed[unmatched[0]], remaining[0])
            matched.add(remaining[0])

    def _link_alias(self, row: list[Any], canonical: str) -> None:
        """Relink a row to a recovered identity and remember the borrowed (name,
        character) so later races map straight to it without another reset."""
        row[4] = canonical
        self._reset_aliases[(_norm_name(row[0]), _char_norm(row[1]))] = canonical

    def _dominant_character(self, canonical: str) -> str:
        """The character this identity has been read as most often across races — the
        final-standings character the original export uses.

        Most-used wins, ties broken by summed match confidence. Two wrinkles from running
        live: the colour-variant family refinement only commits after a few races, and the
        per-race base match can only tell Yoshis apart by shape — so before refinement it
        confidently picks an arbitrary *wrong* colour (e.g. green/orange Yoshis read as
        "Yellow Yoshi"). Until a colour family has a refined read we therefore show the bare
        family root ("Yoshi"), the neutral default, rather than that unconfirmed colour.
        Different base characters (e.g. Kamek vs Pink Yoshi) are still decided by count +
        confidence.
        """
        counts = self._char_counts.get(canonical)
        if not counts:
            return ""
        confs = self._char_conf.get(canonical, {})
        refined = self._char_refined.get(canonical, {})
        # Group reads by colour-variant family (non-variant characters are their own group).
        groups: dict[str, list[str]] = {}
        for name in counts:
            groups.setdefault(_family_root(name), []).append(name)
        best_rep, best_key = "", None
        for root, names in groups.items():
            total = sum(counts[name] for name in names)
            group_conf = sum(confs.get(name, 0.0) for name in names)
            refined_names = [name for name in names if refined.get(name, 0)]
            if refined_names:
                # A colour was committed — show it (and let refined reads outweigh raw ones).
                rep = max(refined_names, key=lambda name: (refined.get(name, 0), counts[name], confs.get(name, 0.0), name))
            elif root in _VARIANT_FAMILY_ROOTS:
                # Colour not yet confirmed: show the neutral default, not an arbitrary
                # shape-matched colour the base OCR happened to pick.
                rep = root
            else:
                rep = max(names, key=lambda name: (counts[name], confs.get(name, 0.0), name))
            # Across families the most-used family wins, ties broken by summed confidence.
            key = (total, group_conf, rep)
            if best_key is None or key > best_key:
                best_rep, best_key = rep, key
        return best_rep

    def apply_confirmed(
        self, rows: list[dict[str, Any]], race_sequence: int | None
    ) -> None:
        # Track per-race scored players so the original temporary-player-drop
        # policy can decide if a connection-error race must be discounted.
        race_no = int(race_sequence) if race_sequence is not None else self.races_completed + 1

        # Reconcile this race's players to the persistent roster up front, collapsing OCR
        # name drift (e.g. "Daphne"->"Daplne") onto one stable canonical identity. Keying
        # the per-race points/totals — and the connection-reset continuity offset — by
        # the canonical key (not the drifting OCR name) is what makes the live total
        # correct across a reset: otherwise a renamed player misses the offset and shows
        # only their post-reset session total. A roster slot left unmatched is a real
        # disconnect; the roster can't exceed the established field size.
        roster = self._last_standing_by_key
        reset_active = self._is_reset_race(rows)
        # Pass 1: match each row to a roster identity by name (exact, then OCR name drift).
        matched: set[str] = set()
        parsed: list[list[Any]] = []  # [driver, character, points, onscreen, canonical|None]
        for row in rows:
            driver = _first(row, "Player", "player_name")
            character = _first(row, "Character", "character_icon")
            key = _driver_key(driver, character)
            alias = self._reset_aliases.get((_norm_name(driver), _char_norm(character)))
            if alias is not None and alias in roster and alias not in matched:
                # A player who re-entered under a borrowed name after a past reset — the
                # (name, character) was relinked once and keeps mapping to that identity.
                canonical: str | None = alias
            elif key in roster and key not in matched:
                canonical = key
            else:
                canonical = _fuzzy_roster_match(driver, character, roster, exclude=matched)
            if canonical is not None:
                matched.add(canonical)
            parsed.append([
                driver, character,
                _to_int(_first(row, "RacePoints", "race_points")) or 0,
                _row_total(row), canonical,
                _to_float(_first(row, "CharacterMatchConfidence")),
                _REFINED_METHOD_MARKER in _first(row, "CharacterMatchMethod"),
            ])
        # Pass 2: connection-reset rename relink — a row that couldn't match by name is a
        # player who re-entered under a new name after the reset; merge it back to the one
        # prior identity that disappeared this race (the original's rule: same character,
        # or by elimination when exactly one player changed).
        if reset_active:
            self._relink_reset_renames(parsed, roster, matched, race_no)
        entries: list[tuple[str, str, str, int, int, float, bool]] = []  # +conf, refined
        for driver, character, points, onscreen, canonical, conf, refined in parsed:
            if canonical is not None and canonical != _driver_key(driver, character):
                # Matched to a *different* prior identity (OCR name drift, or a reset
                # rename) — adopt that identity's established name (e.g. Willem, not Bonno).
                display = roster[canonical].driver
            else:
                if canonical is None:
                    canonical = _driver_key(driver, character)
                display = driver
            entries.append((display, character, canonical, points, onscreen, conf, refined))

        # Accumulate per-identity character usage (with summed match confidence to break
        # count ties, and a refined-read tally so provisional early roots can defer to a
        # committed colour) + the carried-in baseline so the standings can show the
        # most-used character and a points-based total.
        for _display, character, canonical, points, onscreen, conf, refined in entries:
            if str(character).strip():
                counts = self._char_counts.setdefault(canonical, {})
                counts[character] = counts.get(character, 0) + 1
                confs = self._char_conf.setdefault(canonical, {})
                confs[character] = confs.get(character, 0.0) + conf
                if refined:
                    rcounts = self._char_refined.setdefault(canonical, {})
                    rcounts[character] = rcounts.get(character, 0) + 1
            if canonical not in self._baseline:
                self._baseline[canonical] = max(0, onscreen - points)

        points = {canonical: pts for (_d, _c, canonical, pts, _t, _cf, _r) in entries}
        totals = {canonical: tot for (_d, _c, canonical, _p, tot, _cf, _r) in entries}
        scored = sum(1 for value in points.values() if value > 0)
        self._race_history[race_no] = RaceDropInfo(race=race_no, scored_count=scored, points=points)
        self._race_totals[race_no] = RaceTotals(race=race_no, totals=totals, points=points)

        drop = evaluate_player_drops([self._race_history[k] for k in sorted(self._race_history)])
        reset = evaluate_connection_resets([self._race_totals[k] for k in sorted(self._race_totals)])
        self.connection_error = _connection_error_payload(drop)
        self.connection_reset = _connection_reset_payload(reset, race_no)

        # Total = carried-in baseline + cumulative race points for this identity, minus any
        # temporary-drop discount. Computing from race points (not the on-screen total)
        # matches the export, is continuous across connection resets without an offset, and
        # is robust to a misread running total on screen.
        cumulative: dict[str, int] = {}
        for history in self._race_history.values():
            for key, pts in history.points.items():
                cumulative[key] = cumulative.get(key, 0) + pts

        rows_for_standings = [
            {
                "Player": display,
                "Character": self._dominant_character(canonical) or character,
                "RacePoints": pts,
                "Total": self._baseline.get(canonical, 0)
                + cumulative.get(canonical, 0)
                - drop.discount_by_player.get(canonical, 0),
            }
            for (display, character, canonical, pts, _onscreen, _conf, _r) in entries
        ]

        new_standings = build_standings(rows_for_standings, self._previous_ranks)
        # While a drop is suspected, mark the players who didn't score this race
        # (race points 0/none) so the overlay can flag them in the standings.
        if drop.suspected:
            for standing in new_standings:
                if not standing.race_points:
                    standing.dropped = True

        # Update the roster (canonical) + last-seen, then carry over disconnected players
        # (a canonical slot absent this race) with their last total — frozen, greyed,
        # marked — bounded by the field size so drift can't inflate the roster.
        present: set[str] = set()
        for standing in new_standings:
            canonical = _driver_key(standing.driver, standing.character)
            present.add(canonical)
            roster[canonical] = standing
            self._last_seen_race[canonical] = race_no
        self._full_field = max(self._full_field, len(new_standings))
        carry_slots = self._full_field - len(new_standings)
        if carry_slots > 0:
            absent = [(key, last) for key, last in roster.items() if key not in present]
            # Most recently seen first, then highest total — a player who just dropped
            # wins a slot over a name that drifted away (and was re-linked) races ago.
            absent.sort(key=lambda item: (self._last_seen_race.get(item[0], 0), item[1].total), reverse=True)
            for _key, last in absent[:carry_slots]:
                new_standings.append(
                    StandingRow(
                        position=0,
                        driver=last.driver,
                        character=last.character,
                        character_icon=last.character_icon,
                        race_points=None,
                        total=last.total,
                        delta=0,
                        disconnected=True,
                    )
                )
            new_standings = _rerank_standings(new_standings, self._previous_ranks)
        self.standings = new_standings
        self._previous_ranks = ranks_from_standings(new_standings)
        self.races_completed += 1
        self.status = "confirmed"
        self.race_status = "finished"
        self.totals_ready = True
        # If a race result is already being shown (the provisional seeded it), replace it
        # with this race's confirmed (refined) finishing order so the Race Score shows the
        # same correct colours / Mii as the Total Score instead of the raw fast read.
        if self.race_rows:
            self.race_rows = build_race_results(rows)
            self._apply_established_mii_to_race_rows()
        if race_sequence is not None:
            self.race_sequence = race_sequence
        self.confirmed_status = "updated"
        self.confirmed_detail = "confirmed standings updated"
        self.confirmed_queue_size = 0
        self.confirmed_pending_race = None
        self.confirmed_started_at = None
        self._mark_synced()

    def apply_consensus_status(
        self,
        status: str,
        data: dict[str, Any] | None = None,
        race_sequence: int | None = None,
        now: float | None = None,
    ) -> None:
        data = data or {}
        self.confirmed_status = status
        self.confirmed_detail = str(data.get("message") or data.get("worker_status") or status)
        self.confirmed_queue_size = int(data.get("queue_size") or len(data.get("pairs") or []) or 0)
        self.confirmed_pending_race = race_sequence
        if status == "running":
            self.confirmed_started_at = float(data.get("started_at") or now or time.time())
            self.confirmed_duration_seconds = None
        elif status in {"completed", "failed", "updated"}:
            if data.get("duration_seconds") is not None:
                try:
                    self.confirmed_duration_seconds = float(data.get("duration_seconds"))
                except (TypeError, ValueError):
                    self.confirmed_duration_seconds = None
            self.confirmed_started_at = None

    def _phase(self) -> str:
        """Which lifecycle phase the feed is in — drives the overlay's behaviour.

        - ``standby``  : nothing has happened yet.
        - ``racing``   : a race is being played right now (track detected, no
          result in yet). The overlay shows the running totals only.
        - ``review``   : a race just finished and its finishing order is known.
          The overlay rotates between that race's result and the totals, and
          keeps doing so (through confirmation) until the next race starts.
        - ``totals``   : a race is over/confirmed but no per-race finishing order
          is available, so only the cumulative totals can be shown.
        """

        if self.race_status == "" and not self.standings:
            return "standby"
        if self.race_status == "ongoing":
            return "racing"
        if self.race_rows:
            return "review"
        if self.standings:
            return "totals"
        return "standby"

    def to_payload(self) -> dict[str, Any]:
        badge_color = group_color(self.group)
        # Unassigned (default group) shows the app brand rather than "Onbekend".
        badge_label = "MK8DX" if self.group == DEFAULT_GROUP else self.group

        phase = self._phase()
        # The race result stays available the whole "review" window so the client
        # can rotate between it and the totals; the new-race ("racing") trigger,
        # not confirmation, is what ends that window.
        completed = self.races_completed
        plural = "" if completed == 1 else "s"
        # ``display_race`` (the "Race X of Y" counter) = the race the viewer is
        # currently watching: the one being played (racing) or the one whose
        # result is under review. It stays put across confirmation in review.
        if phase == "standby":
            display_race: int | None = None
        elif phase == "racing":
            display_race = completed + 1
        elif phase == "review":
            display_race = completed if self.totals_ready else completed + 1
        else:  # totals
            display_race = completed

        # The default (non-rotating) view per phase: review leads with the fresh
        # race result; every other phase shows the cumulative totals. The client
        # rotates review between "race" and "total"; other consumers (the grid,
        # first paint) use this default.
        default_kind = "race" if phase == "review" else "total"
        display_rows = self.race_rows if default_kind == "race" else self.standings

        # Plain-English header strings for the default view (the client recomputes
        # these per sub-view while rotating; these stay in sync for that kind).
        view_label, board_caption = _describe_view(phase, default_kind, display_race, completed, plural)

        return {
            "feed": self.feed,
            "title": self.title,
            "badge": {
                "label": badge_label,
                "color": badge_color,
                "text_color": text_color_for(badge_color),
            },
            "race_sequence": self.race_sequence,
            "races_found": self.races_found,
            "races_completed": self.races_completed,
            "races_total": self.races_total,
            "highlight_mode": self.highlight_mode,
            "connection_error": self.connection_error,
            "connection_reset": self.connection_reset,
            "display_race": display_race,
            "board_caption": board_caption,
            "view_label": view_label,
            "phase": phase,
            "status": self.status,
            "race_status": self.race_status,
            "totals_ready": self.totals_ready,
            "rows_kind": default_kind,
            "track": self.track.to_payload(),
            "rows": [row.to_payload() for row in display_rows],
            "total_rows": [row.to_payload() for row in self.standings],
            "race_rows": [row.to_payload() for row in self.race_rows],
            "countdown": {
                "seconds": self.countdown_seconds,
                "started_at": self.countdown_started_at,
            },
            "synced": self.synced,
            "confirmed": {
                "status": self.confirmed_status,
                "detail": self.confirmed_detail,
                "queue_size": self.confirmed_queue_size,
                "pending_race": self.confirmed_pending_race,
                "started_at": self.confirmed_started_at,
                "duration_seconds": self.confirmed_duration_seconds,
            },
        }


class BroadcastState:
    """Holds the scoreboard state for every feed in a session."""

    def __init__(self) -> None:
        self._feeds: dict[str, FeedScoreboard] = {}

    def feed(self, feed_id: str, title: str = "") -> FeedScoreboard:
        board = self._feeds.get(feed_id)
        if board is None:
            board = FeedScoreboard(feed=feed_id, title=title)
            self._feeds[feed_id] = board
        elif title and not board.title:
            board.title = title
        return board

    def feeds(self) -> dict[str, FeedScoreboard]:
        return dict(self._feeds)

    def payloads(self) -> list[dict[str, Any]]:
        return [board.to_payload() for board in self._feeds.values()]

    def reset(self) -> None:
        self._feeds.clear()
