"""Temporal state machine: MENU -> ARMED -> RACING.

Ported from tools/timetrial_analyzer.py (validated reference implementation,
see docs/example_analysis/). Reconstructs per run: track-confirm context
(cc mode, solo/ghost), race start, coin events, mushroom uses, lap events,
finish or abort. Handles aborts (race HUD lost / menu gate reappears),
in-race restarts (fresh countdown closes the current run as aborted), and
track/cc changes between runs (context resets on the cup screen; the values
that count are the LAST seen before the countdown).
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import cv2

from . import hudcounters, hudtimes
from .ghostmenu import (GhostMenuScreens, GhostPanelReader, GhostRecords, mark_staff_ghost,
                        mark_world_record, merge_panel, replay_finish_ms, replay_hud_lap_times,
                        same_ghost)
from .consolelang import AUTO, CONFIRM_ROWS, ConsoleLanguage, OcrProbe, glyph_image, reader_key
from .templates import Template, TemplateDb

T = "hud_template."
COINS = [f"{T}hud_coins_{i:02d}" for i in range(11)]
LAP3 = [f"{T}hud_lap3_{i}" for i in (1, 2, 3)]
LAP7 = [f"{T}hud_lap7_{i}" for i in range(1, 8)]
MUSH = [f"{T}hud_items_mushrooms_{i}" for i in (3, 2, 1)]

# Pause hysteresis window (ms). Once the pause-hint bar is confidently seen, the
# run stays "paused" for this long after it last matched, bridging the few
# fade-in/out frames where the hint bar dips below threshold while the race HUD
# is still absent — so no abort timer can start mid-pause. Short enough that a
# genuine quit-to-menu (pause overlay replaced by a cup/menu screen) still
# aborts promptly once the hold lapses.
PAUSE_HOLD_MS = 1500
# How often to read the race clock off the HUD to anchor the event timeline.
# In MILLISECONDS, not frames: the production path feeds `fno` as ms
# (RunProcessor: "Analyzer fps=1000 -> fno==ms"), so a frame-count modulo here
# sampled at whatever rate fps rounding happened to produce — 983 samples on
# one clip and none on the next. The offset barely moves between samples, and
# read_clock costs ~9.4 ms of a 33 ms frame budget, so ~8/s is both plenty and
# affordable.
CLOCK_SAMPLE_MS = 120
# How many CONSECUTIVE legible reads of the next lap number it takes to accept
# the crossing. The counter flashes the new digit in, so the illegible frames
# between are the flash and do not reset the count; seeing the CURRENT lap
# again does, because that is evidence we have not crossed.
LAP_STABLE_READS = 3
# How long the item ring must be gone, with the rest of the HUD still up,
# before it counts as the LAST mushroom being used. See the ring-exit block.
RING_EXIT_MS = 900

# A run that has lost the HUD and shows NO menu evidence is kept alive (a dark
# track section must never end a live race). This is the stop-loss for the case
# where the evidence never arrives at all — console switched off, capture pulled,
# an unrecognised screen. Far beyond any real gap: measured mid-race dropouts on
# the clip corpus max out at 67 ms.
LOST_TRACK_MS = 120000
HUD_FREEZE_FRAMES = 6     # same-value frames that make a freeze, not a tint
HUD_WINDOW_GAP = 45       # ...and the tint pulses, so bridge gaps. Measured on
                          # Baby Park: laps 2-6 fragment with ~0.2 s gaps but
                          # lap 1 has a 1.3 s interruption, and at 12 frames its
                          # pieces never merged — no single piece reached the
                          # freeze threshold, so 5 of 6 laps reported. 45 frames
                          # (1.5 s) bridges it and stays far under the ~10 s
                          # between Baby Park laps, the tightest spacing there is.

# GO-signal fallback (see _armed_frame). Measured on the 14-clip corpus with
# the in-race clock as ground truth: the countdown digits drop below threshold
# 409-639 ms BEFORE the race actually starts, and the GO template first matches
# 666-800 ms after that (i.e. 161-273 ms AFTER the true start — the word scales
# in). So the fallback must wait longer than 800 ms or it pre-empts a perfectly
# good GO and back-dates every event; 1500 ms clears the measured maximum
# ~2x while still recovering a genuinely dropped GO within a lap's first turn.
GO_FALLBACK_MS = 1500
# Median offset from "countdown no longer matches" to the real start, used only
# when the clock itself can't be decoded to date the start exactly.
GO_ESTIMATE_OFFSET_MS = 470

# Debounce gap: a candidate must keep being seen at roughly frame cadence. The
# per-frame counters used to persist for the whole run, so two matches MINUTES
# apart satisfied a "2-frame" debounce (frames that don't match simply don't
# call the debounce, so nothing reset it). 400 ms tolerates a live drop to ~12
# fps (~3 frames) while making isolated noise frames non-cumulative.
DEBOUNCE_GAP_MS = 400

# Ghost menu (see ghostmenu.py). The replay's countdown follows the "Start
# Replay?" OK after a load of ~12 s (measured 12.5 s twice on the owner's
# capture); a countdown this long after the prompt is still that replay.
REPLAY_ARM_WINDOW_MS = 30000
# Closing the replay menu is NOT choosing its highlighted row: + / B dismisses
# it and the replay simply continues (owner capture 8:15.9: closed on "Quit
# Replay", replay went on). What follows decides. "Race against Ghost" and
# "Replay from Start" are real only when a countdown follows within this
# window (measured 7.9 s to the race's countdown); "Quit Replay" only when the
# race HUD stays gone this long after the menu closed.
REPLAY_CHOICE_WINDOW_MS = 15000
REPLAY_QUIT_CONFIRM_MS = 1500
# A frame or two without the menu (a row change) does not close it.
REPLAY_MENU_GONE_MS = 400
# The panel is read at most this often while the ghost menu is up; a full
# read (name OCR, icons, part names) only when the ghost or its state changes.
PANEL_READ_EVERY_MS = 500


def fmt_t(ms):
    s = ms / 1000.0
    return f"{int(s // 60)}:{s % 60:06.3f}"


def context_at_start(ctx: dict) -> dict:
    """Use a matching ghost panel's cc when the confirmation badge was absent."""
    result = dict(ctx)
    panel = result.get("ghostPanel") or {}
    track = (result.get("trackName") or {}).get("trackId")
    if (result.get("cc") is None and track and panel.get("trackId") == track
            and panel.get("cc") in ("150", "200")):
        result["cc"] = panel["cc"]
    return result


def _stamp_race_time(run: dict) -> None:
    """Give every event a `race` offset: where it sits on the GAME clock.

    `t` is wall-ms since GO, and the game clock is not the same thing — it
    stops while paused, and it starts a beat before we detect GO. Anything
    that lines events up against the RESULT CARD (pure race time) mixes the
    two: after a 6-minute pause every coin landed past the end of a 79-second
    run, so the timeline drew them off the chart and the per-lap attribution
    put them all in the last lap.

    Preferred source is the clock ON SCREEN, sampled during the race: the
    offset between wall time and the game clock is constant between samples,
    so `race = clock + (t - t_of_that_sample)` is exact to the frame, absorbs
    a pause without bookkeeping, and removes the ~100 ms GO-detection lag that
    the subtraction below cannot see. A single misread digit would poison a
    whole span, so samples more than 400 ms off their neighbourhood median are
    dropped before use.

    Fallback, for runs recorded before the sampling existed or where the clock
    was never readable: `t` minus the pause ahead of it.

    `t` is left alone — it is what the recording is indexed by."""
    events = run.get("events") or []
    paused = 0
    for e in events:
        if e.get("type") == "resume":
            paused += int(e.get("heldMs") or 0)
        e["race"] = max(0, int(e.get("t") or 0) - paused)
    run["pausedMs"] = paused

    keep = clean_clock_samples(run.pop("_clockSamples", None))
    if not keep:
        return
    for e in events:
        e["race"] = race_at(int(e.get("t") or 0), keep)
    run["raceClockSamples"] = len(keep)


def clean_clock_samples(samples) -> list:
    """(wall t, game clock) pairs with the misreads dropped, or [] if too few.

    The offset (t - clock) is constant while the race runs and steps up by the
    pause when one happens, so a sample is judged against the offset of its
    SEGMENT — samples with no long wall gap before them.

    It used to be judged against a +-4 neighbourhood median, and that is not
    enough: the clock freezes for ~3 s on every lap report, which at 8
    samples/s is ~25 consecutive readings that all agree on the WRONG offset
    and outvote the local median. Measured cost of getting this wrong: a lap-3
    event stamped 43.6 s into an 84 s race, because the frozen clock was still
    showing lap 2's time. A whole segment's median cannot be captured that way
    — a freeze is seconds, a segment is the whole race.

    Segments are split on a wall gap, because that is what a pause looks like
    (the HUD is covered, so nothing is sampled) and a freeze is not (sampling
    continues at its normal rate throughout)."""
    s = sorted((int(a), int(b)) for a, b in (samples or []))
    if len(s) < 3:
        return []
    segs, cur = [], [s[0]]
    for prev, nxt in zip(s, s[1:]):
        if nxt[0] - prev[0] <= 2000:
            cur.append(nxt)
        else:
            segs.append(cur)
            cur = [nxt]
    segs.append(cur)
    keep = []
    for seg in segs:
        offs = sorted(t - c for t, c in seg)
        mid = offs[len(offs) // 2]
        keep += [p for p in seg if abs((p[0] - p[1]) - mid) <= 400]
    return keep if len(keep) >= 3 else []


def race_at(t: int, keep: list) -> int:
    """Wall-ms since GO -> the game clock, via the nearest surviving sample.
    Exposed so anything JUDGING the timeline converts the way the engine does
    instead of subtracting its own idea of the pause."""
    st, sc = min(keep, key=lambda s: abs(s[0] - t))
    return max(0, sc + (t - st))


def load_nameplates(root):
    """The Clean Assets nameplates through the central package (packages/icon-matcher
    nameplates, the matcher for printed names on HDMI sources); None without it."""
    try:
        from .shared_field_shadow import _field_package
        module = __import__(_field_package().__name__ + ".nameplates", fromlist=["load"])
    except Exception:
        return None
    return module.load(root)


def _central_name_match():
    """The staged central name matcher (packages/icon-matcher name_match)."""
    from .shared_field_shadow import _field_package
    return __import__(_field_package().__name__ + ".name_match", fromlist=["match_title"])


class Analyzer:
    def __init__(self, tdb: TemplateDb, fps: float, out_dir: Path, use_easyocr=True,
                 console_language: str = AUTO):
        self.tdb = tdb
        self.flow = tdb.flow
        self.fps = fps
        self.out = out_dir
        self.runs = []
        self.state = "MENU"
        self.ctx = self._fresh_context()
        self.run = None
        self.hud_lost_since = None
        self.ring_lost_since = None
        # pause hysteresis: wall-ms until which the run is still treated as
        # paused after the last confident pause-hint frame (see _racing_frame).
        self.pause_hold_until = None
        # rate limit for the race-clock sampling (ms of the pipeline clock)
        self._clock_sample_ms = -10 ** 9
        # wall-ms the current pause began, so resuming can report its length.
        # A pause is invisible in the game clock but not in the recording, and
        # a 6-minute hole in the ticker with no explanation reads as a fault.
        self.pause_started_at = None
        # ARMED: first frame with no countdown digit (GO-signal fallback)
        self.armed_nocd_since = None
        # last late-finish escape-hatch probe (rate limit, see _racing_frame)
        self._late_finish_ms = -10000
        # last early-race lap-count re-check (rate limit, see _racing_frame)
        self._lapcount_ms = -10000
        # debounce state: _debounced -> (candidate, count, last_ms),
        #                 _debounced_ms -> (candidate, since_ms)
        self.stable = {}
        # second, independent finish evidence: the circled lap-index "1" on
        # the result card (crops from the RF-DETR lap-index dataset; x is
        # rock-stable at 1018, four y slots for player/ghost x top/bottom).
        # Calibrated on real capture video: result screens 0.95+, race/menu
        # frames <=0.28 -> threshold 0.80
        self.lapindex: list[Template] = []
        cfg = Path(__file__).resolve().parent.parent / "config" / "lapindex"
        # dataset y-clusters for the four card slots, PLUS the footer-shift
        # variants (+30 race3 / -32 race7: no "new ghost" footer -> the card
        # sits one lap row lower) applied to every slot
        base = (115, 203, 419, 439)
        ys = sorted({y + d for y in base for d in (0, 30, -32)} & set(range(0, 688)))
        try:
            for fname, rec in json.loads((cfg / "anchors.json").read_text()).items():
                for y in ys:
                    self.lapindex.append(Template(f"lapindex.{fname}:{y}", Path(fname),
                                                  {"x": rec["x"], "y": y}, cfg))
        except Exception:
            self.lapindex = []
        # canonical discrete lap-index probe (same one the ResultReader uses):
        # it matches the player circle at the FIXED slot positions incl. the
        # -30 new-ghost/record offset with search=3. The baked lapindex stack
        # above misses the new-record layout (its y-set has 83/115/145 but the
        # record card's circle sits at 92 = 122-30), so this probe is the finish
        # backup that catches the 7-lap-win-with-new-ghost result screen.
        from .results import _LapIndexProbe
        self._result_probe = _LapIndexProbe()
        self._reader = None
        if use_easyocr:
            try:
                import easyocr
                self._reader = easyocr.Reader(["en", "nl"], gpu=False, verbose=False)
            except Exception:
                self._reader = None
        # Console language (consolelang.py): chosen, or detected once at the
        # start of the session. Automatic detection reads the track name with
        # each script's reader in the background; a chosen language needs that
        # probe only for its own non-Latin reader.
        probe = None
        if self._reader is not None and (console_language == AUTO or reader_key(console_language) != "latin"):
            try:
                probe = OcrProbe(tdb.db)
            except Exception:
                probe = None
        self._lang_probe_ms = -10 ** 9
        # Nameplates (Clean Assets v5.7): the printed menu names as language
        # evidence without OCR; per console language the locales of all its game
        # variants (fr: fr-FR and fr-CA, ...). None for an older Clean Assets.
        # The Mii picked on the character select (owner, 2026-10-30): the face in the cell with the
        # yellow corners. The result card's character compares it as one extra candidate.
        self.mii_pick = None
        self.nameplates = None
        self._plate_languages = {}
        if console_language == AUTO:
            try:
                self.nameplates = load_nameplates(tdb.root)
            except Exception:
                self.nameplates = None
            for variant in (tdb.db.get("gameLocales") or {}).get("locales") or []:
                locales = self._plate_languages.setdefault(variant.get("consoleLanguage"), [])
                locales += [loc for loc in variant.get("nameLocales") or [] if loc not in locales]
        self.language = ConsoleLanguage(tdb, console_language, probe)
        self.language.on_change = self._language_changed
        self._language_changed(self.language.state())
        # Ghost menu: the Select-a-Ghost panel and ghost replays (ghostmenu.py).
        # `ghost_log` is the screen timeline (panel reads, prompts, replay-menu
        # rows) — what the player did on the ghost menu, in order.
        self.ghost_screens = GhostMenuScreens(tdb)
        self.ghost_panel = GhostPanelReader(tdb, self._reader)
        self.ghost_log: list[dict] = []
        # DETECTED GHOSTS (ADR-0210): every ghost seen becomes one record — never
        # the player's run, never linked to anybody. The desktop app shows them
        # in This session and the Player decides which are theirs.
        self.ghost_records = GhostRecords()
        # The first finished loop of each ghost's replay, whole (events, laps,
        # coins, mushrooms), for the run history's ghost entry: the same chart
        # and lap table as a run. Kept apart from `runs` (ADR-0210 rule 11).
        self.ghost_replays: list[dict] = []
        self.ghost_replays_version = 0
        self._panel_ms = -10 ** 9
        self._panel_quick = None
        # Ordinary recognition retains the most complete record. Paired QA
        # separately follows the currently visible collapsed/expanded state.
        self.qa_panel_display = False
        self.panel_display = None
        self._panel_display_key = None
        self.replay_pending = None   # {"ms", "ghost"}: "Start Replay?" was confirmed
        self.replay_row = None       # highlighted replay-menu row while the menu is up
        self.replay_choice = None    # {"row", "ms"}: the row the replay menu closed on
        self._menu_gone_since = None

    # -- context (menu phase) -------------------------------------------------
    def _fresh_context(self):
        return {"cc": None, "mode": None, "trackKnown": False, "ocrSaved": False,
                "ocrTries": 0, "ocrLastMs": -10000, "ghostPanel": None}

    # -- ghost menu -------------------------------------------------------------
    def _ghost_event(self, ms, kind, **data):
        self.ghost_log.append({"ms": ms, "type": kind, **data})

    def _note_replay_row(self, row, ms):
        """Follow the replay menu. The row it closes on is only a CANDIDATE
        choice (see REPLAY_CHOICE_WINDOW_MS); _arm and the replay's quit check
        confirm it from what happens next."""
        if row is None:
            if self.replay_row is None:
                return
            if self._menu_gone_since is None:
                self._menu_gone_since = ms
                return
            if ms - self._menu_gone_since < REPLAY_MENU_GONE_MS:
                return
            closed = self._menu_gone_since
            self.replay_choice = {"row": self.replay_row, "ms": closed}
            self._ghost_event(closed, "replay_menu_closed", row=self.replay_row)
            self.replay_row, self._menu_gone_since = None, None
            return
        self._menu_gone_since = None
        if row == self.replay_row:
            return
        self._ghost_event(ms, "replay_menu_open" if self.replay_row is None else "replay_menu_row",
                          row=row)
        self.replay_row = row

    def _replay_choice(self, ms, *rows):
        """The replay-menu row the menu closed on, if it is one of `rows` and
        still recent enough to be what the player chose."""
        c = self.replay_choice
        if c and c["row"] in rows and ms - c["ms"] <= REPLAY_CHOICE_WINDOW_MS:
            return c["row"]
        return None

    def _ghost_menu_frame(self, frame, ms, banner_cc):
        self.ghost_panel.wide_edge_probe = bool(self.qa_panel_display)
        gs = self.ghost_screens
        if not gs.available:
            return
        # a clip (or a session) can start inside a replay's menu
        self._note_replay_row(gs.replay_menu(frame), ms)
        if gs.start_replay_prompt(frame):
            if self._debounced("replay_prompt", True, 2, ms) and not (
                    self.replay_pending and ms - self.replay_pending["ms"] < 5000):
                ghost = self.ctx.get("ghostPanel")
                # panelSinceMs: when this ghost's panel came up, so a ghost-replay
                # clip opens on the chosen ghost and not on the browsing before it
                self.replay_pending = {"ms": ms, "ghost": dict(ghost) if ghost else None,
                                       "panelSinceMs": self.ctx.get("ghostPanelSinceMs")}
                self._ghost_event(ms, "start_replay_prompt",
                                  ghost=(ghost or {}).get("name"), total=(ghost or {}).get("total"))
        else:
            self.stable.pop("replay_prompt", None)
        # backing out of "Start Replay?" returns to the ghost menu (its View
        # Ghost row or the panel shows again); after OK the game goes straight
        # to loading, so either sign after the prompt cancels it
        backed_out = False
        if gs.view_ghost_selected(frame):
            if self._debounced("view_ghost", True, 2, ms) and not any(
                    e["type"] == "view_ghost" and ms - e["ms"] < 3000 for e in self.ghost_log[-5:]):
                self._ghost_event(ms, "view_ghost")
            backed_out = True
        else:
            self.stable.pop("view_ghost", None)
        # the panel: only on the ghost menu (the track banner is up), rate-limited
        if banner_cc is None or ms - self._panel_ms < PANEL_READ_EVERY_MS:
            self._cancel_replay_prompt(ms, backed_out)
            return
        self._panel_ms = ms
        bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
        quick = self.ghost_panel.read(bgr, identity=False)
        prev_quick, self._panel_quick = self._panel_quick, quick
        self._cancel_replay_prompt(ms, backed_out or quick is not None)
        if quick is None:
            return
        # an expanded panel counts once its laps close on the total; a fading
        # panel reads as collapsed or not at all, and the header is stable
        state = quick["state"] if quick.get("lapSumOk", True) else "collapsed"
        settled = prev_quick is not None and prev_quick.get("totalMs") == quick["totalMs"] \
            and prev_quick.get("state") == quick["state"]
        cur = self.ctx.get("ghostPanel")
        if not settled:
            return
        # The QA evidence follows the visible panel, even when an OCR lap
        # error prevents the product reader from accepting its details.
        display_key = (quick.get("totalMs"), quick["state"] if self.qa_panel_display else state)
        display_changed = self.qa_panel_display and display_key != self._panel_display_key
        if (same_ghost(cur, quick)
                and (state != "expanded" or (cur or {}).get("state") == "expanded")
                and not display_changed):
            return
        full = self.ghost_panel.read(bgr)
        if full is None:
            return
        qa_visible = dict(full) if self.qa_panel_display else None
        if full.get("state") == "expanded" and not full.get("lapSumOk"):
            full = {k: v for k, v in full.items()
                    if k not in ("lapTimes", "lapTimesMs", "lapSumOk", "body", "tire", "glider")}
            full["state"] = "collapsed"
        track_id = (self.ctx.get("trackName") or {}).get("trackId")
        cc = self.ctx.get("cc") or banner_cc
        full = mark_staff_ghost(self.tdb, full, track_id, cc)
        full = mark_world_record(self.tdb, full, track_id, cc)
        full["cc"] = cc
        full["trackId"] = track_id
        full["seenMs"] = ms
        if self.qa_panel_display:
            if qa_visible["state"] == "expanded" and not qa_visible.get("lapSumOk"):
                qa_visible.update(cc=cc, trackId=track_id, seenMs=ms)
                self.panel_display = qa_visible
            else:
                self.panel_display = dict(full)
            self._panel_display_key = (self.panel_display.get("totalMs"),
                                       self.panel_display.get("state"))
        if not same_ghost(cur, full):
            # a panel counts once two reads agree, PANEL_READ_EVERY_MS apart
            self.ctx["ghostPanelSinceMs"] = ms - PANEL_READ_EVERY_MS
        self.ctx["ghostPanel"] = merge_panel(cur, full)
        g = self.ctx["ghostPanel"]
        self.ghost_records.note_panel(dict(g), ms, int(time.time() * 1000))
        display = self.panel_display if self.qa_panel_display else g
        self._ghost_event(ms, "ghost_panel", state=display.get("state"),
                          name=display.get("name"), total=display.get("total"),
                          cc=display.get("cc"))

    def _cancel_replay_prompt(self, ms, ghost_menu_seen: bool) -> None:
        p = self.replay_pending
        if p and ghost_menu_seen and ms - p["ms"] > 1000:
            self.replay_pending = None
            self._ghost_event(ms, "start_replay_cancelled", ghost=(p.get("ghost") or {}).get("name"))

    def _replay_kind(self, ms) -> dict:
        """What the run about to arm is: another loop of the replay on screen,
        a replay just started from the panel, or a race (possibly against the
        ghost the replay menu or the panel showed)."""
        prev = self.run
        choice = self._replay_choice(ms, "race_against_ghost", "replay_from_start")
        self.replay_choice = None
        if prev and prev.get("kind") == "replay":
            if choice == "race_against_ghost":
                return {"ghostPanel": prev.get("replayOf"), "startedFrom": "replay_menu"}
            return {"kind": "replay", "replayOf": prev.get("replayOf"),
                    "replayLoop": int(prev.get("replayLoop", 1)) + 1,
                    **({"replayFromStart": True} if choice == "replay_from_start" else {})}
        pending, self.replay_pending = self.replay_pending, None
        if pending and ms - pending["ms"] <= REPLAY_ARM_WINDOW_MS:
            return {"kind": "replay", "replayOf": pending.get("ghost"), "replayLoop": 1}
        panel = self.ctx.get("ghostPanel")
        if panel and self.ctx.get("mode") == "ghost":
            return {"ghostPanel": panel}
        return {}

    def _debounced(self, key, candidate, need=2, ms=None, gap=DEBOUNCE_GAP_MS):
        """Frame-count debounce that also requires the sightings to be CLOSE
        TOGETHER. Callers only invoke this on frames where the candidate
        matched, so a plain counter never reset on the frames in between and
        two isolated noise frames minutes apart passed a 2-frame debounce. With
        `ms` given, a gap longer than `gap` starts the count over."""
        prev, count, last, first = self.stable.get(key, (None, 0, None, None))
        fresh = candidate != prev or (
            ms is not None and last is not None and ms - last > gap)
        count = 1 if fresh else count + 1
        first = ms if fresh else first
        self.stable[key] = (candidate, count, ms if ms is not None else last, first)
        return candidate if count >= need else None

    def _first_seen(self, key, ms):
        """When the accepted candidate FIRST appeared, not when it convinced us.

        A debounce is evidence-gathering, and dating an event to the end of it
        is dating it wrong — by up to `hold` for coins (130 ms) and by however
        long three legible reads take for a lap. The user spotted it by eye:
        a coin appears in the log slightly after the counter changes on screen.
        """
        v = self.stable.get(key)
        if not v:
            return ms
        f = v[3] if len(v) > 3 else v[1]
        return f if isinstance(f, int) else ms

    def _debounced_ms(self, key, candidate, ms, hold=130):
        """Time-based debounce: accept once the SAME candidate has been seen
        for `hold` ms. Frame-count debounce under-detects live: when the loop
        drops to ~12fps (clip encoding, OCR) 5 frames = 400ms+, and quick coin
        pickups never held that long. Gaps (frames below match threshold)
        don't reset the timer — only a DIFFERENT candidate does."""
        prev, since = self.stable.get(key, (None, None))
        if candidate != prev or since is None:
            self.stable[key] = (candidate, ms)
            return None
        return candidate if ms - since >= hold else None

    # -- per-frame ------------------------------------------------------------
    def feed(self, frame, fno):
        ms = int(fno / self.fps * 1000)
        # language evidence only in the menus: never during countdown or race
        self.language.tick(ms, in_menu=self.state == "MENU")
        if self.state == "MENU":
            self._menu_frame(frame, fno, ms)
        elif self.state == "ARMED":
            self._armed_frame(frame, fno, ms)
        elif self.state == "RACING":
            self._racing_frame(frame, fno, ms)

    # -- console language -------------------------------------------------------
    LANGUAGE_PROBE_MS = 200

    def _language_probe(self, frame, ms, records):
        """Score records the engine does not otherwise check, for language
        evidence only, at most 5x a second, while the language is open or was
        detected (a chosen language needs no evidence)."""
        if not self.language.observing or ms - self._lang_probe_ms < self.LANGUAGE_PROBE_MS:
            return
        self._lang_probe_ms = ms
        for rec_id in records:
            if rec_id in self.tdb.templates:
                self.tdb.corr(frame, rec_id, 2)

    # The name banner at the bottom of the cup screen and the select screens
    # (cup, character and part names) and the cup screen's four track labels,
    # measured on the 2026-10-27 language recordings at 1280x720.
    NAME_BANNER = (645, 685, 300, 980)
    CUP_TRACK_LABELS = (563, 592, (66, 361, 657, 953), 258)
    PLATE_SCALE = 1.5    # 1280x720 -> the nameplates' 1920x1080

    def _language_menu_text(self, frame):
        """Menu names as language evidence while the language is observed: the
        nameplates first, OCR in the background for what they leave undecided."""
        plates = self.nameplates is not None and self.language.wants_nameplates()
        ocr = self.language.wants_ocr()
        if not (plates or ocr):
            return
        m = self.tdb
        y0, y1, x0, x1 = self.NAME_BANNER
        if m.corr(frame, T + "menu_banner_cup_select", 1) >= 0.80:
            crops = [(frame[y0:y1, x0:x1].copy(), "names")]
            if m.match(frame, T + "menu_button_l", 0.75) and m.match(frame, T + "menu_button_r", 0.75):
                ty0, ty1, starts, width = self.CUP_TRACK_LABELS
                crops += [(frame[ty0:ty1, x:x + width].copy(), "tracks") for x in starts]
        elif self.nameplates is not None and (
                m.match(frame, T + "charselect_roster_top6", 0.8)
                or (m.match(frame, T + "vehicleselect_frame", 0.8)
                    and m.match(frame, T + "vehicleselect_details_hint", 0.8))):
            # the same banner names the highlighted character or part
            crops = [(frame[y0:y1, x0:x1].copy(), "names")]
        else:
            return
        if self.nameplates is not None:
            undecided = []
            for crop, kind in crops:
                hit = self.nameplates.crop_languages(crop, kind, self._plate_languages, self.PLATE_SCALE)
                if hit:
                    self.language.submit_nameplate(hit)
                else:
                    undecided.append((crop, kind))
            self.language.nameplates_checked()
            crops = undecided
        if ocr and crops:
            self.language.submit_menu_text(crops)

    def _language_changed(self, state):
        """Decided (or chosen): printed names prefer that language's locales;
        the state is kept beside the session's runs."""
        try:
            from . import identity as _id
            locales = self.language.name_locales()
            if locales:
                _id.set_locales(locales)
        except Exception:
            pass
        if state.get("code"):
            print(f"[livetrial] console language: {state['code']} ({state['status']})", flush=True)
            self._rematch_track()
        self._write_language_state(state)

    def _rematch_track(self):
        """A track name read before the language was known is matched again
        against that language's names — in the menu context and in the run
        that is already going (the first run of a session usually is)."""
        for ctx in (self.ctx, (self.run or {}).get("context")):
            tn = (ctx or {}).get("trackName") or {}
            if not tn.get("raw") or tn.get("trackId"):
                continue
            again = self._match_track(tn["raw"])
            if again.get("trackId"):
                ctx["trackName"] = again
                ctx["trackKnown"] = True

    def _write_language_state(self, state):
        """console-language.json beside the runs: the decision and its evidence
        (rewritten at the end, so an undecided session keeps its evidence too)."""
        try:
            self.out.mkdir(parents=True, exist_ok=True)
            (self.out / "console-language.json").write_text(json.dumps(state, ensure_ascii=False, indent=1),
                                                             encoding="utf-8")
        except OSError:
            pass

    def _confirm_screen_cc(self, frame, thr=0.7):
        """Track-confirm screen gate: the cc banner+badge agreement IS the
        gate. (The cc-toggle hint template does not match live captures — the
        bottom hint bar is right-aligned and shifts with the hint count, so it
        is unreliable; measured max 0.375 on a live recording while banner/
        badge/buttons all matched 0.97+.) Requires a clear winner between the
        two cc classes.

        Menu build-order shortcut: the KNOWN cc is checked first; a strong hit
        (>=0.85 min of banner+badge) accepts without scoring the other class
        — halves the per-frame template work on the common browsing frames.
        A toggle to the other class drops this score, falling back to the
        full two-class comparison on that same frame."""
        m = self.tdb
        known = self.ctx.get("cc")
        if known in ("150", "200"):
            spec = self.flow["ccMode"][known]
            s = min(m.corr(frame, spec["banner"], 1), m.corr(frame, spec["badge"], 1))
            if s >= 0.85:
                return known
        scores = {}
        for cc in ("150", "200"):
            spec = self.flow["ccMode"][cc]
            scores[cc] = min(m.corr(frame, spec["banner"], 1), m.corr(frame, spec["badge"], 1))
        top, other = sorted(scores, key=scores.get, reverse=True)
        if scores[top] >= thr and scores[top] - scores[other] >= 0.03:
            return top
        return None

    # The hint marks a screen that HAS a cc switch, which is what makes the
    # banner colour meaningful — and it is absent on the transition frames the
    # banner-alone rule was rejected for. It sits exactly on its stored anchor:
    # measured 0.984 there with no search at all.
    #
    # It reads 0.31 when the console's language renders "150 cc" instead of
    # "150cc". The bar is wider then, and a rigid correlation of the narrower
    # template lands ~14 px off as a compromise. That is a language variant to
    # cut when it matters, NOT a reason to search — the position never moves.
    CC_HINT_THR = 0.70

    def _cc_toggle_visible(self, frame) -> bool:
        return self.tdb.corr(frame, T + "menu_hint_cc_toggle", 1) >= self.CC_HINT_THR

    def _menu_cc(self, frame, thr=0.72):
        """Menu-phase cc gate from the track-name BANNER alone (006 blue=150cc,
        007 red=200cc). The banner sits at the bottom on BOTH the cc-confirm
        screen AND the ghost menu, so the track + cc are read on both — unlike
        banner+badge, whose badge only exists on the cc screen (that gap made a
        clip starting at the ghost menu miss the track). The two banners are
        opposite colours so the 150/200 margin is huge (>1.0); off-menu the
        banner stays < 0.72 (race max 0.71) and this is only called in MENU."""
        m = self.tdb
        b150 = m.corr(frame, T + "menu_banner_150cc", 1)
        b200 = m.corr(frame, T + "menu_banner_200cc", 1)
        best = max(b150, b200)
        if best < thr:
            return None
        # reject the CUP-SELECT screen. Its cup-name banner (005) sits at the
        # SAME position as the cc track banners (006/007) and cross-matches
        # them at ~0.86, so the cup label ("Paddenstoelbeker") would be OCR'd
        # and fuzzy-matched to a track (Mushroom Cup -> Wii Mushroom Gorge).
        # The 005 banner wins on the picker (0.88-0.92 vs 006 0.85-0.87) and
        # loses on the real confirm/ghost screen (0.70 vs 006 0.96-1.00), so
        # requiring the cc banner to beat 005 cleanly separates them. This
        # keeps the ghost-menu read (006 high, 005 low there) intact.
        if m.corr(frame, T + "menu_banner_cup_select", 1) >= best:
            return None
        return "150" if b150 >= b200 else "200"

    def _ghost_row(self, frame):
        """(mode, best, runner-up) of the highlighted solo/ghost option row.
        The row exists ONLY on the time-trial track-confirm screen, so besides
        reading the mode it is the positive marker for "that screen is up"."""
        m = self.tdb
        gm = self.flow["ghostMode"]
        row = m.templates[gm["template"]][0]
        best_mode, best_c, second = None, 0.0, 0.0
        for mode, a in gm["anchors"].items():
            shifted = Template.__new__(Template)
            shifted.__dict__ = dict(row.__dict__)
            shifted.anchor = a
            c = shifted.corr(frame)
            if c > best_c:
                best_mode, best_c, second = mode, c, best_c
            elif c > second:
                second = c
        return best_mode, best_c, second

    def _pause_score(self, frame):
        """Best match of the icon-only, language-independent pause controller
        hint bar (052/053/054). It never shows during normal racing."""
        return max((self.tdb.corr(frame, p, search=1)
                    for p in self.flow["pause"]["hintStates"]), default=0.0)

    # The Mii picker on the character select (1280x720): a 3x3 grid of Mii faces right of the
    # roster; the picked Mii's cell carries yellow corners. Measured on the 2026-10-30 recording
    # (mii-session-20261030): cells 82x80 at x 838/943/1048, y 195/300/405; the picked cell's
    # corners held 385 yellow pixels, its neighbour 24.
    MII_PICKER_CELLS = tuple((838 + 105 * col, 195 + 105 * row, 82, 80) for row in range(3) for col in range(3))
    MII_PICKER_MIN_YELLOW = 120

    def _observe_mii_picker(self, frame, ms) -> None:
        """Remember the face of the picked Mii while the Mii picker is open (the cell with the
        yellow corners). A stale pick is harmless: the result card only takes it when the face
        beats every character on the card's icon."""
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        yellow = ((hsv[:, :, 0] >= 20) & (hsv[:, :, 0] <= 35) & (hsv[:, :, 1] > 150)
                  & (hsv[:, :, 2] > 180)).astype("uint8")

        def corners(x, y, w, h):
            return sum(int(yellow[max(0, cy):cy + 16, max(0, cx):cx + 16].sum())
                       for cx, cy in ((x - 10, y - 10), (x + w - 6, y - 10), (x - 10, y + h - 6),
                                      (x + w - 6, y + h - 6)))

        counts = [corners(*cell) for cell in self.MII_PICKER_CELLS]
        best = max(range(len(counts)), key=counts.__getitem__)
        others = sorted(counts)[-2] if len(counts) > 1 else 0
        if counts[best] < self.MII_PICKER_MIN_YELLOW or counts[best] < 4 * max(1, others):
            return
        try:
            from .shared_field_shadow import _field_package
            open_set = __import__(_field_package().__name__ + ".open_set", fromlist=["own_face_reference"])
        except Exception:
            return
        x, y, w, h = self.MII_PICKER_CELLS[best]
        face = open_set.own_face_reference(frame[y + 3:y + h - 3, x + 3:x + w - 3])
        if face is not None:
            self.mii_pick = {"face": face, "cell": best, "ms": int(ms)}

    def _menu_evidence(self, frame):
        """Positive proof that a MENU screen — not a race — is on screen, i.e.
        the player really did leave the run. Covers every screen a race can be
        quit to (database detection.timeTrialFlow.screens): the cup/track
        picker, character select, vehicle select and the single-player mode
        select. Only checked once a run has already lost the HUD for its whole
        budget, so the extra templates cost nothing during racing.

        Measured over 6150 race frames from the clip corpus (max correlation on
        a frame that is definitely racing):
            menu_timetrial_mode_selected 0.915   menu_banner_cup_select 0.865
            menu_timetrial_mode_icon     0.662   menu_button_l/r        0.39/0.31
            vehicleselect_details_hint   0.402   vehicleselect_frame    0.175
            charselect_roster_top6       0.202
        Two of these DO cross-match scenery above 0.8, so neither is trusted
        alone: mode-select needs icon AND highlight (the icon never gets near
        the gate), and the caller debounces this decision over consecutive
        frames — a real menu stays up for seconds, a scenery peak does not.
        """
        m = self.tdb
        if m.match(frame, T + "menu_banner_cup_select", 0.8):
            return "cup_banner"
        if m.match(frame, T + "menu_button_l") and m.match(frame, T + "menu_button_r"):
            return "cup_buttons"
        if m.match(frame, T + "charselect_roster_top6", 0.8):
            return "character_select"
        if m.match(frame, T + "vehicleselect_frame", 0.8) and \
                m.match(frame, T + "vehicleselect_details_hint", 0.8):
            return "vehicle_select"
        if m.match(frame, T + "menu_timetrial_mode_icon", 0.8) and \
                m.match(frame, T + "menu_timetrial_mode_selected", 0.8):
            return "mode_select"
        return None

    def _menu_frame(self, frame, fno, ms):
        m = self.tdb
        # cup / track PICKER resets the locked context (the only place the track
        # can change). Primary signal: the cup-select banner (005) at >=0.80.
        # This is far more reliable than the L/R bumper hints, whose LEFT hint
        # (000) scores only 0.76 on live captures and misses the 0.8 gate -> the
        # reset never fired -> the track FROZE: OCR stops after 20 reads and ONLY
        # a context reset re-arms it, so a newly-picked track kept the old name
        # (cc/mode still updated because they don't depend on the reset).
        # DEBOUNCED, like every other menu gate. This was the last single-frame
        # trigger in the engine: one stray frame matching the L/R bumper hints
        # wiped the locked context — and the RESULT screen carries L/R hints
        # too, so "Cup screen - context reset" could fire while a finished run
        # was still having its times read (observed live on DS Rosalina's Ice
        # World, 2026-07-27). Losing the context there is recoverable, but it is
        # never correct: if the player retries straight from the result screen
        # the next run can arm with no track. A genuine cup screen persists for
        # far longer than three frames, so the debounce costs nothing.
        self._language_menu_text(frame)
        if m.match(frame, T + "charselect_roster_top6", 0.8):
            self._observe_mii_picker(frame, ms)
        on_cup = (m.match(frame, T + "menu_banner_cup_select", 0.80)
                  or (m.match(frame, T + "menu_button_l")
                      and m.match(frame, T + "menu_button_r")))
        if not on_cup:
            self.stable.pop("cup_reset", None)
        elif self._debounced("cup_reset", True, 3, ms):
            self.ctx = self._fresh_context()
            return
        # cc from banner+badge (the reliable in-game source: the 150/200 badge
        # is on-screen in the normal flow). Banner alone is NOT used for cc —
        # the 200cc banner (red) mis-matches on transition frames (measured on
        # the Baby Park menus), so it would flip a 150 run to 200.
        cc = self._confirm_screen_cc(frame)
        # Debounce cc before committing it. A single transition frame (a menu
        # fade / near-black just before a cup-screen context reset) can mis-read
        # the badge+banner as the OTHER class and flip a stable 150 to 200,
        # firing a spurious "CC class detected: 200" on a 150cc setup. Require the
        # same class to hold ~300ms; None gaps (uncertain frames) don't reset the
        # timer (they're skipped), only a genuinely different class does, so a
        # brief transient never commits and a real L/R toggle still lands fast.
        if cc is None and self._cc_toggle_visible(frame):
            # The badge only exists on the cc-confirm screen. On the GHOST menu
            # it is a faint watermark (measured 0.684 against a 0.70 gate), so
            # banner+badge can never agree there and the cc could not change at
            # all until you happened to pass a screen with a solid badge. That
            # is the "switching to 200cc takes seconds" the user reported, and
            # why it felt asymmetric: whichever class you were already on kept
            # itself.
            #
            # The cc-toggle hint is the missing gate. Its presence means this
            # screen HAS a cc switch, which is exactly the condition under
            # which the banner colour means something — and it is absent on the
            # transition frames the banner-alone rule was rejected for. The
            # banner then supplies the value, and it is not a close call:
            # measured 0.997 for the class shown against -0.514 for the other.
            cc = self._menu_cc(frame)
        if cc is not None:
            stable_cc = self._debounced_ms("cc_confirm", cc, ms, hold=300)
            if stable_cc is not None:
                self.ctx["cc"] = stable_cc
        # track + mode gate: banner-only, so the ghost menu (no cc badge) ALSO
        # reads the track. The banner is on both the cc screen and the ghost
        # menu; the OCR quality race guards against transition-frame garbage.
        # cc for the OCR-zone lookup falls back to the banner colour when no
        # confirmed cc yet (the track-name zone is identical for both banners).
        banner_cc = cc or self._menu_cc(frame)
        if banner_cc is not None:
            # the track-confirm option rows name the console language (086-090)
            self._language_probe(frame, ms, CONFIRM_ROWS)
            # solo/ghost from the highlighted option row (same gated frames).
            # ARGMAX with a margin: both rows can clear 0.7 at once, and the
            # old "last >= 0.7 wins" made the mode flap solo/ghost per frame
            best_mode, best_c, second = self._ghost_row(frame)
            if best_mode and best_c >= 0.7 and best_c - second >= 0.02:
                self.ctx["mode"] = best_mode
            # OCR immediately on gated frames (rate-limited): the track name
            # can flash by in <1s (track grid before a quick start), so a
            # stability wait misses it. The quality race protects against
            # mid-fade garbage: a read only replaces the stored name at equal
            # or better match ratio, so ties resolve to the LATEST read — the
            # track the user actually confirms. Empty reads cost no retry.
            if self.ctx["ocrTries"] < 20 and ms - self.ctx["ocrLastMs"] >= 700:
                got_text = self._save_ocr_zones(frame, self.flow["ccMode"][banner_cc]["banner"], ms)
                self.ctx["ocrSaved"] = True
                self.ctx["ocrLastMs"] = ms
                if got_text:
                    self.ctx["ocrTries"] += 1
        # ghost menu: the panel, "Start Replay?", View Ghost, the replay menu
        self._ghost_menu_frame(frame, ms, banner_cc)
        # the result screen's new-ghost footer is language evidence only
        self._language_probe(frame, ms, (T + "sidebar_ghost_footer",))
        # arming: ANY countdown digit visible (3, 2 or 1). The live real-time
        # pipeline can drop the brief "3" (~1 s window) during the load->race
        # transition, so keying arm on "3" alone silently misses races; "2"/"1"
        # are equally valid start evidence (measured 0.975 on a live "2") and
        # the race clock still starts on the GO signal, not on the digit.
        cid, _ = m.best_state(frame, self.flow["raceStart"]["countdownSequence"], 0.8)
        if cid is not None:
            self._arm(fno, ms, frame)

    def _arm(self, fno, ms, frame):
        m = self.tdb
        rs = self.flow["raceStart"]
        # corroborate the countdown with the race-start HUD, but tolerate one
        # miss: the coin/lap icons animate in during the countdown and often sit
        # just under threshold on the exact digit frame (measured coins_00 0.66
        # on a clean live "2"). >=2 of the 3 anchors is decisive once paired
        # with the already-matched giant central countdown digit.
        hud = [r for r in rs["requiresAllOf"] if "countdown" not in r]
        hits = {r: m.match(frame, r, 0.7) for r in hud}
        if sum(hits.values()) < 2:
            return
        # TIME-TRIAL gate. A Grand Prix / VS start has the same countdown, coin
        # counter and item-slot ring, so the 2-of-3 corroboration alone armed a
        # run for any race — which can never finish (no time-trial result
        # sidebar) and littered the session with phantom runs and clips. The
        # 3-mushroom stack is time-trial-exclusive, and the solo/ghost setup
        # screen (ctx.mode) proves it too — a clip that starts AT the countdown
        # has no context, so either signal on its own is enough.
        if not hits.get(T + "hud_items_mushrooms_3") and not self.ctx.get("mode"):
            return
        # A ghost replay arms exactly like a race (same countdown, same HUD),
        # so decide here what this run is: a replay loop, a replay just started
        # from the panel, or a race — never let a replay become the player's run.
        kind = self._replay_kind(ms)
        if self.run:  # in-race restart: close current run as aborted
            reason = "restart"
            if self.run.get("kind") == "replay":
                reason = "replay_loop" if kind.get("kind") == "replay" else "replay_to_race"
            self._close_run(aborted=True, reason=reason, ms=ms)
        # 3 vs 7 from the counter's denominator (ON/OFF segment test, see
        # TemplateDb.read_lap_count). The old best_state over lap3_1/lap7_1 was
        # a constant "7" predictor — measured 0/40 on clear "1/3" footage — so
        # it is only the last resort now, and the race re-checks below anyway.
        laps = m.read_lap_count(frame)
        if laps is None:
            # Counter not readable on this frame (still animating in). Take the
            # database default rather than the lap3_1-vs-lap7_1 correlation:
            # that comparison is a constant "7" predictor (see read_lap_count),
            # so it was WORSE than the default — 41 of 42 courses are 3 laps,
            # and the in-race re-check plus the sidebar fix the rest.
            laps = int(self.flow.get("lapCount", {}).get("default", 3))
        # the 1/3-vs-1/7 counter can lie on live captures (Switch upscaling
        # smears the thin segments; measured lap7 0.986 vs lap3 0.926 on a
        # clear "1/3"). A HIGH-confidence resolved track (ratio >= 0.9 — a
        # 0.7-level misread once cascaded 7->3 wrongly) may override it; the
        # result reader also cross-checks via the lap sum (runner fallback).
        tn = self.ctx.get("trackName") or {}
        if tn.get("trackId") and float(tn.get("ratio") or 0.0) >= 0.9:
            seven = set(self.flow.get("lapCount", {}).get("sevenLapTrackIds") or [])
            laps = 7 if tn["trackId"] in seven else 3
        self.run = {
            "run": len(self.runs) + 1,
            "context": context_at_start(self.ctx),
            "lapCount": laps,
            "armedAtMs": ms,
            "goAtMs": None,
            "events": [],
            "coins": 0, "lap": 1, "mushrooms": 3,
            "finished": False,
        }
        self.run.update(kind)
        if kind.get("kind") == "replay":
            g = kind.get("replayOf") or {}
            self._ghost_event(ms, "replay_start", loop=kind.get("replayLoop"),
                              ghost=g.get("name"), total=g.get("total"))
        elif kind.get("startedFrom") == "replay_menu":
            self._ghost_event(ms, "race_against_ghost", ghost=(kind.get("ghostPanel") or {}).get("name"))
        self.state = "ARMED"
        self.armed_nocd_since = None

    def _start_racing(self, ms, at_ms, estimated=False):
        self.run["goAtMs"] = at_ms
        if estimated:
            self.run["goEstimated"] = True
        self.run["events"].append({"t": 0, "type": "go"})
        self.state = "RACING"
        self.hud_lost_since = None
        self.ring_lost_since = None
        self.pause_hold_until = None
        # a run that ended while paused must not leak a "resumed" into the next
        self.pause_started_at = None

    def _armed_frame(self, frame, fno, ms):
        m = self.tdb
        go = self.flow["raceStart"]["goSignal"]["template"]
        if m.match(frame, go, 0.75):
            self._start_racing(ms, ms)
            return
        cds = self.flow["raceStart"]["countdownSequence"]
        if any(m.match(frame, c, 0.7) for c in cds):
            self.armed_nocd_since = None
            return
        # Pausing during the 3-2-1 is legal and hides the countdown; without
        # this the armed run aborted as "countdown_vanished" and the resumed
        # race was recorded as a second, separate run. Only tested once the
        # countdown is off screen (a pause covers it), so the normal 3-2-1
        # frames don't pay for it.
        if self._pause_score(frame) >= 0.8:
            self.run["armedAtMs"] = ms       # freeze the arm deadline
            self.armed_nocd_since = None
            return
        # GO-SIGNAL FALLBACK. "GO!" is a single ~1 s event on a language-variant
        # template; the live pipeline drops frames, and a dropped GO used to
        # abort a perfectly good race 6 s later with no way back (RACING is only
        # reachable through this one gate). Arming already tolerates a missing
        # "3" for exactly this reason. So: countdown long gone + the race HUD
        # clearly up = the flag dropped, start the race anyway.
        if self.armed_nocd_since is None:
            self.armed_nocd_since = ms
        rs = self.flow["raceStart"]
        hud = [r for r in rs["requiresAllOf"] if "countdown" not in r]
        if ms - self.armed_nocd_since >= GO_FALLBACK_MS and \
                sum(m.match(frame, r, 0.7) for r in hud) >= 2:
            # Date the start from the game's OWN clock (it is frozen at
            # 0:00.000 until GO and counts from there), so a recovered run's
            # event timeline lines up with the result card exactly like a
            # normally-detected one. Motion-blurred ms digits decode to None —
            # then fall back to the measured countdown->start offset.
            at = self.armed_nocd_since + GO_ESTIMATE_OFFSET_MS
            try:
                from .clock import read_clock
                from .results import time_to_ms
                txt = read_clock(frame)
                elapsed = time_to_ms(txt) if txt else None
                if elapsed is not None and 0 < elapsed < 30000:
                    at = ms - elapsed
            except Exception:
                pass
            self._start_racing(ms, at, estimated=True)
            return
        # armed but countdown vanished without GO and without a race HUD for
        # 6s -> the player backed out during the countdown
        if ms - self.run["armedAtMs"] > 6000:
            self._close_run(aborted=True, reason="countdown_vanished", ms=ms)
            self.state = "MENU"

    def _racing_frame(self, frame, fno, ms):
        m = self.tdb
        r = self.run
        rel = ms - r["goAtMs"]

        # -- 1. read the race HUD FIRST ------------------------------------
        # coins / lap counter / item ring are the cheap per-frame reads and the
        # definition of "the race is on screen". Everything below keys off them,
        # so they run before any state decision. (Values are only turned INTO
        # events further down, in the original order.)
        # Coins from the calibrated grid, both digits. The template reader is
        # the fallback, so an uncalibrated or occluded counter still keeps the
        # run alive — `val` is part of the definition of "the HUD is on screen",
        # and a stricter reader silently failing here would abort races.
        val = hudcounters.read_coins(frame, is_rgb=True)
        if val is None:
            val, _ = m.read_coins(frame)
        # The digit gives the lap VALUE. It must NOT also stand in for "the HUD
        # is on screen": the lap counter stays readable straight through the
        # PAUSE overlay (measured read_lap = 1 with the pause bar at 0.938),
        # so letting it set `lap_seen` kept hud_alive true for the whole pause
        # and the engine skipped the pause block entirely — no pause events, and
        # the recorder stopped trimming the pause menu out of clips. Saving the
        # 0.59 ms these two correlations cost is not worth that.
        seen_lap = hudcounters.read_lap(frame, is_rgb=True)
        fam = LAP7 if r["lapCount"] == 7 else LAP3
        c_cur = m.corr(frame, fam[r["lap"] - 1], search=2)
        c_next = m.corr(frame, fam[r["lap"]], search=2) if r["lap"] < r["lapCount"] else -1.0
        lap_seen = c_cur >= 0.6 or c_next >= 0.6
        rules = self.flow["raceRules"]["mushrooms"]
        ring = m.match(frame, rules["ring"], 0.7)
        hud_alive = val is not None or lap_seen or ring

        # EARLY LAP-COUNT RE-CHECK. The arm frame catches the counter mid
        # animate-in, so it is the worst frame to read it on; a settled in-race
        # counter is the best. Re-read at ~2 Hz over the first 10 s and correct
        # a wrong arm-time decision while it is still harmless (lap 1, nothing
        # binned yet). Getting this right matters: lapCount picks the whole
        # result-screen workflow (race3 vs race7), so a wrong value can cost the
        # times entirely. Cheap — three array means over ~1500 px.
        if rel < 10000 and r["lap"] == 1 and hud_alive and ms - self._lapcount_ms >= 500:
            self._lapcount_ms = ms
            got = m.read_lap_count(frame)
            if got is not None and got != r["lapCount"] and \
                    self._debounced("lapcount", got, 3, ms, gap=1600):
                r["lapCount"] = got
                r["lapCountCorrected"] = "in_race"

        # -- 2. pause ------------------------------------------------------
        # Pausing mid-run is LEGAL — the player resumes and the SAME run
        # continues. The pause overlay covers the race HUD, which would
        # otherwise read as HUD-loss and abort the run as "returned to the
        # menus". The pause screen has its own icon-only, language-independent
        # controller-hint bar (052/053/054) that never shows during racing.
        # Measured on a real 16 s paused run: the bar sits at pmax 0.948
        # throughout and only dips below 0.8 during the ~1-frame fade-in and
        # ~4-frame (~130 ms) fade-out — exactly the frames where the race HUD is
        # ALSO gone. So a confident hit freezes the frame (no finish/abort/coin/
        # lap logic runs) and arms a short hysteresis hold that bridges those
        # fades; the hold is dropped the instant the real HUD returns and lapses
        # on its own, so a genuine quit still aborts once menu evidence appears.
        #
        # Checked only while the HUD is ABSENT: a paused frame has no race HUD
        # by definition, so this both skips 3 correlations on every normal racing
        # frame and makes it impossible for a scenery cross-match to freeze a
        # live race (which would silently stop coin/lap/finish detection).
        # (You can't pause on the result screen, so no real finish is masked.)
        paused = False
        if hud_alive:
            # The replay went on. A replay menu still open in our books was
            # DISMISSED (+/B), whatever row was highlighted: the race HUD is back
            # within a frame or two, while every real choice goes through a
            # screen without it first. It closes here, with no choice (owner
            # capture 8:15.9: closed on "Quit Replay", the replay continued).
            if r.get("kind") == "replay" and self.replay_row is not None:
                self._ghost_event(self._menu_gone_since or ms, "replay_menu_dismissed",
                                  row=self.replay_row)
                self.replay_row, self._menu_gone_since = None, None
            # a menu that did close on "Quit Replay" but the replay went on
            # (race/from-start choices stay: their countdown shows the HUD too)
            if (self.replay_choice or {}).get("row") == "quit_replay":
                self._ghost_event(ms, "replay_menu_dismissed", row="quit_replay")
                self.replay_choice = None
            if self.pause_started_at is not None:
                r["events"].append({"t": rel, "type": "resume",
                                    "heldMs": ms - self.pause_started_at})
                self.pause_started_at = None
            self.pause_hold_until = None
        else:
            # A replay has its own pause menu (Continue Replay / Replay from
            # Start / Race against Ghost / Quit Replay). It freezes the run like
            # a pause; the row it closes on is the player's choice. Quit ends the
            # replay here; the other two show up as the next countdown (_arm).
            if r.get("kind") == "replay":
                row = self.ghost_screens.replay_menu(frame)
                self._note_replay_row(row, ms)
                if row is not None:
                    self.hud_lost_since = None
                    if self.pause_started_at is None:
                        self.pause_started_at = ms
                        r["events"].append({"t": rel, "type": "pause", "screen": "replay_menu"})
                    self.pause_hold_until = ms + PAUSE_HOLD_MS
                    return
                # Quit is real once the race HUD stays away after the menu
                # closed; a dismissed menu brings the HUD straight back.
                quit_at = (self.replay_choice or {}).get("ms")
                if self._replay_choice(ms, "quit_replay") and ms - quit_at >= REPLAY_QUIT_CONFIRM_MS:
                    self.replay_choice = None
                    self._close_run(aborted=True, reason="replay_quit", ms=quit_at)
                    self.state = "MENU"
                    return
            if self._pause_score(frame) >= 0.8:
                self.hud_lost_since = None
                if self.pause_started_at is None:
                    self.pause_started_at = ms
                    r["events"].append({"t": rel, "type": "pause"})
                self.pause_hold_until = ms + PAUSE_HOLD_MS
                return
            paused = self.pause_hold_until is not None and ms <= self.pause_hold_until

        # -- 2b. anchor the event timeline to the clock ON SCREEN -----------
        # Wall time and the game clock run at the same RATE, so one sample
        # every CLOCK_SAMPLE_EVERY frames pins the offset and wall time
        # interpolates the gaps exactly. Sampling every frame would cost
        # ~9.4 ms of a 33 ms budget for no accuracy at all.
        #
        # Two frames must never be sampled: a paused one (the HUD is covered —
        # handled by the early return above) and one inside a lap report, where
        # the clock FREEZES on the lap time. That test comes from hudtimes,
        # which is what freezes on it; 0.13 ms, so it is cheap enough to run
        # only on the frames we were going to decode anyway.
        if hud_alive and not paused and ms - self._clock_sample_ms >= CLOCK_SAMPLE_MS \
                and not hudtimes.clock_is_lap_time(frame, is_rgb=True):
            self._clock_sample_ms = ms
            from .clock import read_clock
            from .results import time_to_ms
            txt = read_clock(frame)
            v = time_to_ms(txt) if txt else None
            # a race clock is minutes, not hours; anything else is a misread
            if v is not None and 0 < v < 1_800_000:
                r.setdefault("_clockSamples", []).append([rel, v])

        # finish gate: a result screen can ONLY exist once the in-race HUD is
        # gone, so the whole finish block (sidebar + banners) is checked only
        # while the HUD is absent. Measured: the sidebar templates (best_state,
        # search=2) NEVER match with the HUD up (max 0.27 over thousands of race
        # frames) and the 3 banner matches likewise — together the bulk of the
        # per-frame correlation, all wasted during normal racing. Gating them on
        # hud_lost (set on the previous frame) costs one frame of latency, which
        # is nothing next to the ~3s the result screen takes to build.
        hud_gone = self.hud_lost_since is not None
        sid = None
        if hud_gone:
            # sidebar = primary evidence; lap-index circles = backup, gated
            # harder still (24-template stack is expensive): a sustained HUD-loss
            # (>=400ms, not a 1-frame ghost-occlusion dip) past a race-time floor.
            fin = self.flow["finish"]["gate"]["anyOf"]
            sid, _ = m.best_state(frame, fin, 0.72, search=2)
            if sid is None and self.lapindex and ms - self.hud_lost_since >= 400 and rel >= 20000:
                if max(t.corr(frame, search=2) for t in self.lapindex) >= 0.80:
                    sid = "lapindex_stack"
            # canonical discrete-slot probe backup: the baked stack misses the
            # new-record footer layout (circle at y=92); the probe checks the
            # fixed top/bottom slots incl. the -30 offset and locks the player
            # circle at ~0.96 there. Gate identically (sustained HUD-loss + late).
            if sid is None and ms - self.hud_lost_since >= 400 and rel >= 20000:
                cp, yp, _slot = self._result_probe._match_slot(frame, "player", r["lapCount"])
                if yp is not None and cp >= 0.85:
                    sid = "result_laps"
        elif rel >= 30000 and ms - self._late_finish_ms >= 200:
            # ESCAPE HATCH. Every finish path above hangs off hud_lost_since, so
            # anything that keeps read_coins()/the lap template alive on the
            # result screen (a stuck locked coin offset, a footer that scores as
            # a digit) means the gate never even runs and the run hangs open for
            # ever. The sidebar is unambiguous — measured max 0.27 across
            # thousands of race frames — so a STRONG late match closes the run
            # regardless. Rate-limited to 5 Hz: it only runs deep into a race
            # while the HUD reads alive, where a couple of ms is affordable.
            self._late_finish_ms = ms
            sid, _ = m.best_state(frame, self.flow["finish"]["gate"]["anyOf"], 0.85, search=2)
        if sid and self._debounced("finish", True, 2, ms):
            # The result-screen sidebar is the authority on the lap count: when
            # it clears its own gate it does so at 0.96-0.99 while the other
            # variant sits at <=0.15 (12-cell fixture measurement), so a
            # disagreement means the in-race decision was wrong. Correct it
            # BEFORE the result reader picks its race3/race7 workflow.
            for n in (3, 7):
                if sid.endswith(f"sidebar_laps_{n}") and r["lapCount"] != n:
                    r["lapCount"] = n
                    r["lapCountCorrected"] = "sidebar"
            r["events"].append({"t": rel, "type": "finish", "sidebar": sid.split(".")[-1]})
            # the result screen is up: its banners are language evidence, read
            # once here (the race itself is never scored for other languages)
            if self.language.observing:
                self.language.tick(ms, in_menu=True)
                for rec_id in (T + "finish_banner_won", T + "finish_banner_lost",
                               T + "finish_banner_new_record", T + "finish_banner_finish"):
                    if rec_id in self.tdb.templates:
                        self.tdb.corr(frame, rec_id, 2)
            for key, ref in (("ghostBeaten", "won"), ("ghostLost", "lost"), ("newRecord", "new_record")):
                tid = self.flow["finish"]["banners"].get(key)
                if isinstance(tid, str) and m.match(frame, tid, 0.7):
                    r["events"].append({"t": rel, "type": f"banner_{ref}"})
            self._close_run(aborted=False, ms=ms)
            self.state = "MENU"
            return

        # finish banners can appear a MOMENT BEFORE the sidebar, while the HUD is
        # still fading — so unlike the sidebar they can't be gated on hud_gone
        # (that dropped them). They only ever appear near the finish though, so
        # gate on a race-time floor: no banner can show in the first ~15s, which
        # skips the whole early race (the frames that dominate the count) while
        # still catching every real finish banner.
        if rel >= 15000:
            for key, name in (("ghostBeaten", "banner_won"), ("ghostLost", "banner_lost"),
                              ("newRecord", "banner_new_record")):
                tid = self.flow["finish"]["banners"].get(key)
                if isinstance(tid, str) and m.match(frame, tid, 0.75):
                    if self._debounced(name, True, 2, ms) and not any(
                            e["type"] == name for e in r["events"]):
                        r["events"].append({"t": rel, "type": name})

        # coins: read the counter's LAST digit on its diff-region (subset-safe:
        # fixes the 7-in-3 miss) + orange colour for 10. Small gated region ->
        # ~0.2 margin, so a plain read suffices. TIME-based debounce (~130ms) so
        # live frame drops don't stretch the hold and miss quick pickups.
        # (`val` was read at the top of the frame.)
        if val is not None:
            if self._debounced_ms("coins", val, ms, 130) == val and val != r["coins"]:
                # dated to when the counter CHANGED, not to when 130 ms of it
                # had convinced us — the difference is visible against the
                # race clock on screen
                at = self._first_seen("coins", ms) - r["goAtMs"]
                r["events"].append({"t": at, "type": "coin",
                                    "from": r["coins"], "to": val})
                r["coins"] = val

        # laps: strictly increasing BY ONE, so only the NEXT lap needs checking —
        # that strong prior allows a lower threshold (the ghost sometimes drives
        # through the counter corner and depresses the correlation). search=2:
        # the live lap counter sits a couple of px off the baked anchor, so
        # search=0 missed real crossings (measured lap "2/3" 0.60@s0 vs 0.74@s2)
        # -> whole runs got zero lap events. Only 2 templates are checked, so the
        # wider sweep costs ~0.5ms/frame — negligible next to the ~9ms racing mean.
        # (`c_cur`/`c_next`/`lap_seen` were read at the top of the frame.)
        #
        # Correlation alone cannot finish the job, because a digit whose
        # segments are a SUBSET of the next one matches the next one perfectly.
        # Of all six adjacent lap pairs exactly one is such a subset, and it is
        # the one that failed: a 7-segment "6" is a "5" plus the bottom-left
        # stroke (lit only in 5: 3 px; lit only in 6: 61 px, against 58..310
        # for every other pair). So "6/7" reached 0.661 against a 0.66
        # threshold while the counter plainly showed 5/7 — lap 6 fired 1.3 s
        # into lap 5 on Baby Park and swallowed the real crossing 8.5 s later.
        # Requiring c_next > c_cur cannot fix it: on a 6 frame the SUBSET "5"
        # still scores higher (0.914 vs 0.850).
        #
        # So ask the one question that separates them — are the strokes only
        # the NEXT digit lights actually lit — scored against ON/OFF references
        # so the HUD's transparency and the scenery behind it drop out.
        # Measured 0.47..0.52 while it still shows 5, 0.87..0.91 once it shows
        # 6. This is an EXTRA condition, never a replacement, so it can only
        # remove a fire: corpus 38/40 with 2 spurious -> 40/40 with none, at
        # every threshold from 0.55 to 0.80 (_lap_counter_check.py).
        # PREFERRED: read the digit. A segment reader cannot make the subset
        # mistake at all — you ask whether the bottom-left stroke is lit, and a
        # "5" that is a subset of "6" is simply a different digit.
        #
        # The counter FLASHES the new number in after a crossing: absent on
        # some frames, present on others, on 3-lap and 7-lap tracks alike. So
        # wait for the value to be STABLE rather than count frames — a frame
        # counter cannot tell a flashing new digit from a settled one, and the
        # illegible frames in between are the flash, not evidence against.
        # Seeing the CURRENT lap again resets the count: that is positive
        # evidence we have not crossed yet.
        if r["lap"] < r["lapCount"] and seen_lap is not None:
            if seen_lap == r["lap"] + 1:
                if self._debounced("lap", seen_lap, LAP_STABLE_READS, ms):
                    r["lap"] = seen_lap
                    at = self._first_seen("lap", ms) - r["goAtMs"]
                    r["events"].append({"t": at, "type": "lap", "lap": r["lap"]})
            elif seen_lap == r["lap"]:
                self.stable.pop("lap", None)
        elif seen_lap is None and r["lap"] < r["lapCount"]:
            # FALLBACK for a counter the grid cannot read (never calibrated, or
            # occluded): the correlation stack with the subset veto. Kept
            # because losing a lap is worse than a late one, and measured at
            # 40/40 crossings on the corpus in its own right.
            adv = m.lap_advanced(frame, r["lapCount"], r["lap"])
            vetoed = adv is not None and adv < m.LAP_ADV_MIN
            if c_next >= 0.66 and not vetoed \
                    and self._debounced("lap", r["lap"] + 1, 3, ms):
                r["lap"] += 1
                r["events"].append({"t": rel, "type": "lap", "lap": r["lap"]})

        # LAP TIME + GHOST DELTA — at every non-final lap crossing the game
        # freezes the clock on that lap's time (yellow) and, in a ghost race,
        # shows the signed gap centre-screen. Both are read as DIGITS: the delta
        # templates are mostly transparent, so masked correlation scores 0.87 on
        # empty scenery and 0.93 on a real delta and cannot discriminate at all.
        #
        # Trigger is the FREEZE, not the colour — colour alone fires on sandy
        # scenery behind the clock (Wii Daisy Circuit: 17 candidate windows for
        # 2 real deltas), so a window only counts once the decoded value repeats.
        # The tint also pulses, so short gaps are bridged rather than splitting
        # one report into fragments that each fall under the threshold.
        #
        # NOTE the frame here is RGB (runner.py converts before feed) — reading
        # the channels as BGR inverts the yellow test and it never fires.
        #
        # Cost: one mean over a small crop per frame; the digit decodes run only
        # inside a window, which is ~3 s per lap.
        if hudtimes.clock_is_lap_time(frame, is_rgb=True):
            w = r.setdefault("_hudwin", {"clock": [], "delta": [], "gap": 0})
            w["gap"] = 0
            # Every frame of the window, deliberately. Capping this at the
            # first 15 reads to save time cost 7 of 18 lap times and 7 of 18
            # deltas: the earliest reads sit in the tint's FADE-IN, where the
            # delta is still pulsing, so the cap handed the vote its worst
            # samples instead of a cross-section. The window is expensive
            # (10.2 ms for the clock, 4.1 ms for the delta, on a quarter of a
            # race's frames) and that is where the p99 goes — but any scheme
            # that reads fewer frames has to SPREAD them across the window,
            # not take the first N, and has to prove itself on the corpus.
            v = hudtimes.read_clock_time(frame, is_rgb=True)
            if v:
                w["clock"].append(v)
            d = hudtimes.read_delta(frame, is_rgb=True)
            if d:
                w["delta"].append(d)
        elif r.get("_hudwin") is not None:
            r["_hudwin"]["gap"] += 1
            if r["_hudwin"]["gap"] >= HUD_WINDOW_GAP:
                w = r.pop("_hudwin")
                from collections import Counter
                vals = Counter(w["clock"])
                val, n = vals.most_common(1)[0] if vals else (None, 0)
                # Attribute the report by its VALUE, not by the lap counter.
                # The counter may not have advanced when the window closes: on
                # Baby Park (~9.4 s laps) lap 4's report was labelled lap 5, and
                # the lap-index dedup then ate lap 5's own report — 5 of 6. On
                # 40 s laps the counter always catches up, which is why only
                # 7-lap runs showed it. Deduping on the value cannot make that
                # mistake: two laps with an identical time are indistinguishable
                # anyway, and one report each is what the game showed.
                seen = r.setdefault("_hud_seen", [])
                if val and n >= HUD_FREEZE_FRAMES and val not in seen:
                    seen.append(val)
                    lap_of = len(seen)          # the Nth report IS the Nth lap
                    r["events"].append({"t": rel, "type": "lapTime", "lap": lap_of,
                                        "text": val, "frames": n})
                    dv = hudtimes.vote(w["delta"], max_dist=1)
                    if dv:
                        r["events"].append({"t": rel, "type": "delta", "lap": lap_of,
                                            "ms": dv["ms"], "text": dv["text"],
                                            "side": "behind" if dv["ms"] > 0 else "ahead"})

        # mushrooms: count states + use triggers + ring-exit
        for trig, name in ((rules["useTriggers"]["3to2"], "mushroom_use_3to2"),
                           (rules["useTriggers"]["2to1"], "mushroom_use_2to1")):
            if m.match(frame, trig, 0.8) and self._debounced(name, True, 2, ms):
                if not any(e["type"] == name for e in r["events"]):
                    r["events"].append({"t": rel, "type": name})
        mid, _ = m.best_state(frame, MUSH, 0.78)
        if mid is not None:
            n = int(mid.rsplit("_", 1)[1])
            if self._debounced("mush", n, 3, ms) == n and n < r["mushrooms"]:
                at = self._first_seen("mush", ms) - r["goAtMs"]
                r["events"].append({"t": at, "type": "mushrooms",
                                    "from": r["mushrooms"], "to": n})
                r["mushrooms"] = n
        if r["mushrooms"] == 1:
            if ring:
                self.ring_lost_since = None
            elif val is not None or lap_seen:
                # The ring leaving means the LAST mushroom was used — but only
                # while the rest of the HUD is still there. At the finish, and in
                # any dropout, the ring disappears because the whole HUD does:
                # that fired a phantom "last mushroom used" on every run that
                # ended holding one (and wrote it into submissions.json). With
                # the HUD gone the timer is neither started nor cleared, so a
                # genuine use during a gap is still reported when the HUD is back.
                # 350 ms was not long enough. The coin and lap counters OUTLIVE
                # the item ring at the finish, so the gate above still held
                # while the race was already over: measured on tonight's six
                # runs, three of the ring-exits landed at -173 ms, -95 ms and
                # 0 ms relative to the finish — the race had ended and the
                # player still had a mushroom, exactly as reported. A genuine
                # use keeps the whole HUD up for far longer than the finish
                # does. Cost of the longer wait: a last mushroom used inside
                # the final RING_EXIT_MS is not reported. That is the right way
                # round — this event is written into submissions.json.
                self.ring_lost_since = self.ring_lost_since or ms
                if ms - self.ring_lost_since > RING_EXIT_MS:
                    r["events"].append({"t": rel, "type": "mushroom_use_1to0_ring_exit"})
                    r["mushrooms"] = 0
                    self.ring_lost_since = None

        # abort detection: race HUD gone past its budget (6s, or 10s/25s once a
        # finish/new-record banner was seen), or a menu gate reappears.
        # A seen finish banner means the line WAS crossed: the HUD legitimately
        # disappears while the result screen builds up (sidebar can take ~3s),
        # so allow 10s then close honestly as "result screen missed" instead
        # of pretending the run was quit.
        # (`hud_alive` was computed at the top of the frame; the pause hold was
        # already dropped there the instant the real HUD came back.)
        have_banner = any(e["type"].startswith("banner_") for e in r["events"])
        # A NEW RECORD plays a long celebration (new-ghost creation) before the
        # result screen settles — measured ~15-17s after the HUD goes, vs ~a few
        # seconds for a normal finish. The result-screen finish gate (sidebar /
        # lap-index) can only fire once that screen is up, so give a new-record
        # run a much wider abort window or it aborts as "result_skipped" and the
        # times are never read (seen live: 7-lap win + new record).
        have_record = any(e["type"] == "banner_new_record" for e in r["events"])
        # `paused` (pause-hint hold, incl. the post-resume fade grace) keeps the
        # HUD-lost timer parked so the blackout between "pause overlay gone" and
        # "race HUD back" can't start the abort countdown on a legal pause.
        if hud_alive or paused:
            self.hud_lost_since = None
        else:
            self.hud_lost_since = self.hud_lost_since or ms
            gone = ms - self.hud_lost_since
            budget = 25000 if have_record else (10000 if have_banner else 6000)
            if gone > budget:
                if have_banner:
                    # A finish banner WAS seen -> the result screen is up but its
                    # gate didn't fire; close honestly as "result screen missed"
                    # (still handed to the result reader, see _close_run).
                    self._close_run(aborted=True, reason="result_skipped", ms=ms)
                    self.state = "MENU"
                    return
                # No finish seen: only abort a LIVE race when a menu screen is
                # actually on screen -- positive proof the player quit. A mere
                # HUD-anchor dropout (tunnel / dark / reflective section) must
                # NOT abort; the run stays alive and keeps reading until it
                # really finishes or the player genuinely backs out.
                # NOTE: leaving RACING here without closing the run used to
                # happen unconditionally, which orphaned the run — the race went
                # untracked, the finish was never detected and the times were
                # lost. Leave the state machine in RACING unless we actually
                # decided something.
                where = self._menu_evidence(frame)
                if not where:
                    self.stable.pop("abort_menu", None)
                elif self._debounced("abort_menu", where, 3, ms):
                    self._close_run(aborted=True, reason="hud_lost", ms=ms)
                    self.runs[-1]["abortScreen"] = where  # which screen proved it
                    self.state = "MENU"
                    return
                if gone > LOST_TRACK_MS:
                    # Nothing recognisable for two minutes: the feed is gone
                    # (console off, capture unplugged, an unknown screen). Close
                    # honestly rather than keep a zombie run open for ever.
                    self._close_run(aborted=True, reason="lost_track", ms=ms)
                    self.state = "MENU"
                    return
        # menu-gate abort: cup screen, or a DEBOUNCED confirm screen at a
        # stricter threshold — a single race frame that happens to correlate
        # with the banner/badge must never abort a run (seen on Baby Park).
        # A genuine quit-to-menu / cup / confirm screen has NO race HUD, so this
        # can only be trusted while the HUD is absent: the confirm-screen cc
        # banner+badge cross-matches a themed race background (measured on 3DS
        # Rosalina's Ice World: the cc confirm gate fired at rel=1.6s while the
        # lap AND ring HUD anchors were both live), so require hud_alive to be
        # False before either menu template is allowed to abort a live run.
        # ...and never while `paused`: during the post-resume grace the HUD is
        # briefly absent, so this menu-gate would otherwise be free to fire if a
        # pause-menu frame cross-matched. A genuine quit shows the cup/menu with
        # NO pause hint, so the hold lapses and this still aborts once it does.
        # ...and the cc banner+badge alone is NOT enough. Those two cross-match
        # themed scenery, and they do it on exactly the dark/reflective stretches
        # where the HUD anchors also drop out — so "HUD gone + cc confirm" can be
        # one and the same track section rather than a quit. The solo/ghost option
        # row only exists on the real track-confirm screen, so requiring it as
        # corroboration separates the two (one extra template at two anchors).
        # 0.8, not the 0.7 the menu reader uses: the row peaks at 0.732 on race
        # scenery (6150-frame corpus measurement) and sits at ~0.90 on the real
        # screen, so the gate goes in that gap.
        on_confirm = ((not hud_alive) and not paused
                      and self._confirm_screen_cc(frame, thr=0.8) is not None
                      and self._ghost_row(frame)[1] >= 0.8)
        confirm_stable = on_confirm and self._debounced("abort_confirm", True, 3, ms)
        if not on_confirm:
            self.stable.pop("abort_confirm", None)
        if (not paused and not hud_alive and m.match(frame, T + "menu_button_l")
                and m.match(frame, T + "menu_button_r")) or confirm_stable:
            self._close_run(aborted=True,
                            reason="result_skipped" if have_banner else "menu_gate", ms=ms)
            self.ctx = self._fresh_context()
            self.state = "MENU"
            return
        # A fresh countdown while racing = restart (never mid-pause: a resume
        # countdown could momentarily look like a race-start "3").
        # Arming deliberately accepts ANY of 3/2/1 because the live pipeline
        # drops the brief "3" — a restart has exactly the same problem, and a
        # missed restart is worse: the old run keeps running through the new
        # race, mixing both timelines. For 2/1 the counter must also read a
        # fresh "00": mid-race the coin count is whatever the player collected,
        # so that pins the digit to a real race start instead of noise.
        if not paused:
            cid, _ = m.best_state(frame, self.flow["raceStart"]["countdownSequence"], 0.85)
            if cid is not None and (cid.endswith("countdown_3")
                                    or m.match(frame, T + "hud_coins_00", 0.7)):
                self._arm(fno, ms, frame)

    def _save_ocr_zones(self, frame, banner_id, ms=0):
        slug = banner_id.split(".")[-1]
        zones = self.tdb.ocr_zones.get(slug, [])
        run_no = len(self.runs) + 1
        self.out.mkdir(parents=True, exist_ok=True)
        texts = []
        name_crop = None
        for i, z in enumerate(zones):
            x1, x2 = z["x"], z["x"] + z["w"]
            if z["role"] == "track_name":
                # full name strip INCLUDING the console-prefix block: retro
                # names render as "SNES | Bowsers Kasteel 3" with the prefix
                # at ~x336-392, left of the old zone (x480+). The database
                # names carry the prefix, so the merged read matches exactly.
                # Right edge stays before the track thumbnail (~x840).
                # Measured on a live confirm frame (3DS Rosalina's IJsplaneet).
                x1, x2 = 310, min(frame.shape[1], 838)
            crop = frame[z["y"]:z["y"] + z["h"], x1:x2]
            p = self.out / f"run_{run_no:02d}_ocr_{z['role']}_{i}.png"
            cv2.imwrite(str(p), cv2.cvtColor(crop, cv2.COLOR_RGB2BGR))
            if self._reader and z["role"] in ("track_name", "cup_name"):
                reader = self._reader
                if z["role"] == "track_name":
                    name_crop = crop
                    # the decided language's own script reader, when it has one
                    reader = self.language.track_reader() or self._reader
                    if self.language.wants_ocr():
                        self.language.submit_ocr(crop.copy())
                if reader is not self._reader:
                    # that reader sees only the characters of its own track names,
                    # on the white glyphs alone (consolelang.glyph_image): 马力欧赛道
                    # read 马刀欧赛迫 plain, 马D欧赛道 restricted, exact with both
                    res = reader.readtext(glyph_image(crop), allowlist=self.language.track_allowlist())
                else:
                    res = reader.readtext(crop)
                texts.append(" ".join(x[1] for x in res))
        name = texts[0].strip() if texts else ""
        if len(name) < 3:
            return False
        tn = self._match_track(name)
        # diagnosis trail: every read (raw text + match + ratio), capped
        reads = self.ctx.setdefault("ocrReads", [])
        reads.append({"ms": ms, "raw": tn["raw"], "trackId": tn["trackId"], "ratio": tn["ratio"]})
        del reads[:-20]
        # quality race across retries: whether a read names a track is the central matcher's
        # decision; among resolved reads the best ratio wins, a later equal read replaces it
        prev = self.ctx.get("trackName") or {}
        prev_tid = prev.get("trackId")
        if tn["trackId"] and (not prev_tid or tn["ratio"] >= float(prev.get("ratio") or 0.0)):
            self.ctx["trackName"] = tn
        elif not prev:
            self.ctx["trackName"] = {"raw": tn["raw"], "trackId": None, "ratio": tn["ratio"]}
        # a read that CHANGES the resolved track gets its crop preserved —
        # the evidence for "why did it briefly say Mushroom Gorge?"
        new_tid = (self.ctx.get("trackName") or {}).get("trackId")
        if new_tid != prev_tid and name_crop is not None:
            tag = (new_tid or "none").split(".")[-1]
            cv2.imwrite(str(self.out / f"run_{run_no:02d}_ocr_switch_{tag}.png"),
                        cv2.cvtColor(name_crop, cv2.COLOR_RGB2BGR))
        # informational only — OCR keeps running while menus are visible so
        # the LATEST equal-or-better read wins (the track the user confirms)
        self.ctx["trackKnown"] = bool((self.ctx.get("trackName") or {}).get("trackId"))
        return True

    def _match_track(self, raw):
        """The track a title strip names: the central title matcher (packages/icon-matcher
        name_match.match_title, the same rule as every product; CENTRAL_RECOGNITION section 8.6)
        over the console language's track names. Without the central package no track is set."""
        language = getattr(self, "language", None)
        # without a console language: the vocabulary the engine always used
        locales = language.track_locales() if language is not None else ("en-US", "en-GB", "nl-NL")
        vocab = [(f"{t['id']}#{lang}", t["names"][lang])
                 for t in self.tdb.db["collections"]["tracks"] for lang in locales if t["names"].get(lang)]
        try:
            name_match = _central_name_match()
        except Exception:
            return {"raw": raw, "trackId": None, "ratio": 0.0, "rule": "central_matcher_unavailable"}
        found = name_match.match_title(raw, vocab)
        track_id = found.key.split("#", 1)[0] if found.key else None
        return {"raw": raw, "trackId": track_id, "ratio": round(found.fuzzy, 3), "rule": found.rule}

    def _close_run(self, aborted, ms, reason=None):
        r = self.run
        if not r:
            return
        r["aborted"] = aborted
        if reason:
            r["abortReason"] = reason
        r["endMs"] = ms
        r["finished"] = not aborted
        # "result_skipped" means a finish banner was seen and the HUD stayed
        # gone: the line WAS crossed and the result screen IS up, only the
        # sidebar/lap-index gate didn't fire. Dropping it as a plain abort threw
        # away a readable result screen, so flag it — the runner still hands it
        # to the result reader, and a lap-sum-closed read promotes it back to a
        # finished run (finishGateMissed keeps the provenance).
        if reason == "result_skipped":
            r["resultScreenLikely"] = True
        if r.get("kind") == "replay":
            # A replay is the GHOST's run, never the player's: it never joins
            # `runs` (so never results, submissions or clips). What it showed —
            # coins and mushrooms per lap, their moments — goes to the ghost's
            # record. A replay shows no banner and no result screen; it FINISHED
            # when the race clock froze on the ghost's total (owner 2026-09-28).
            ghost = r.get("replayOf") or {}
            finish = replay_finish_ms(r, ghost.get("totalMs"))
            _stamp_race_time(r)
            rec = self.ghost_records.note_replay(r, ghost, ms, int(time.time() * 1000), finish)
            if finish is not None and not any(same_ghost(k.get("replayOf"), ghost) for k in self.ghost_replays):
                known = rec or {}
                keep = {k: v for k, v in r.items() if not str(k).startswith("_")}
                keep["closedAt"] = time.time()
                laps = known.get("lapTimesMs") if known.get("lapSumOk") else None
                laps_from = "panel" if laps else None
                if not laps:
                    laps = replay_hud_lap_times(r, ghost.get("totalMs"))
                    laps_from = "replay_hud" if laps else None
                keep["ghostResult"] = {"totalMs": ghost.get("totalMs"), "lapTimesMs": laps,
                                       "lapTimesFrom": laps_from}
                if known.get("key"):
                    keep["ghostKey"] = known["key"]
                self.ghost_replays.append(keep)
                self.ghost_replays_version += 1
            self._ghost_event(ms, "replay_end", loop=r.get("replayLoop"), reason=reason,
                              completed=finish is not None,
                              usable=bool(rec and rec["replays"] and rec["replays"][-1]["usable"]))
            self.run = None
            self.stable.clear()
            return
        _stamp_race_time(r)
        self.runs.append(r)
        self.run = None
        self.stable.clear()

    def finalize(self, ms):
        if self.run:
            self._close_run(aborted=True, reason="video_end", ms=ms)
        self._write_language_state(self.language.state())
