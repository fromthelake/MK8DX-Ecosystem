"""Shared per-frame processing for video-file and live capture modes.

Wraps the temporal Analyzer + ResultReader + IdentityReader into one
time-based pipeline: feed(bgr, ms). After a finish, result-screen times are
sampled from +2s to ~20s (slot-machine roll animation), merged per owner
until every visible owner's lap sum closes; identity runs per owner once its
time closed, with per-field best-score consensus over a few frames.
"""

from __future__ import annotations

from collections import deque
import json
from pathlib import Path

import cv2
import numpy as np

from .engine import Analyzer
from .field_reader import field_reader_route
from .identity import IdentityReader, identity_confident, merge_identity
from .results import ResultReader, central_scan_result, vote_reads
from .templates import TemplateDb

# Temporal median stack for identity. The capture card is deterministic, but
# the result cards are TRANSLUCENT: the race scene keeps moving behind them, so
# the same slot changes between frames. Measured on settled result screens:
# a player card over a static backdrop varies by a pixel-std of 0.97 (i.e. it is
# the same image every frame), while a card over a moving camera reaches 38.8 —
# and the true part then loses on 3 of 18 frames, with the margin swinging from
# +0.12 to -0.19. A per-pixel median over the frames the reader already visits
# cancels that: the icon is the only thing that does NOT move, so it survives
# while the scene behind averages out (6/6 measured cases rank-1, margin
# +0.075..+0.116). Cards live inside this band, so only it is stacked.
STACK_MIN = 3             # frames needed before stacking is worth it
STACK_MAX = 7
STACK_BAND = (95, 600, 520, 1260)   # y1, y2, x1, x2 — both result cards

READ_DELAY_MS = 2000      # skip the digit roll animation
READ_INTERVAL_MS = 330    # sample cadence on the result screen
READ_BUDGET_MS = 20000    # hard give-up window (ghost card can fade mid-way)
GHOST_GIVEUP_MS = 3000    # stop retrying an unreadable ghost this long after the player closed
ID_TRIES_MAX = 4


def _drop_events_past_the_finish(run: dict) -> None:
    """Remove in-race events dated at or after the player's finish.

    The card knows exactly when the race ended, so this needs no threshold.
    It exists for the item ring: the ring vanishes at the finish because the
    HUD does, which read as "the last mushroom was used" on every run that
    ended holding one — measured on six live runs, three landed at -173 ms,
    -95 ms and 0 ms relative to the finish, with a mushroom still in hand.
    The engine gates that on the rest of the HUD still being up, but the coin
    and lap counters OUTLIVE the ring, so the gate alone cannot close it.

    Only the ring-exit is dropped. A coin or a lap stamped slightly past the
    total is detection lag on a real event; a mushroom use after the race is
    over is not a late reading of anything.
    """
    total = (((run.get("results") or {}).get("player") or {}).get("totalMs"))
    if not total:
        return
    keep, dropped = [], 0
    for e in run.get("events") or []:
        if e.get("type") == "mushroom_use_1to0_ring_exit" \
                and e.get("race", e.get("t", 0)) >= total:
            dropped += 1
            continue
        keep.append(e)
    if dropped:
        run["events"] = keep
        run["droppedPastFinish"] = dropped


class RunProcessor:
    def __init__(self, db_root: Path, out_dir: Path, *, use_easyocr=True, on_run=None,
                 on_card=None, on_panel=None, on_timing=None, console_language="auto"):
        self.tdb = TemplateDb(Path(db_root))
        self.out = Path(out_dir)
        self.an = Analyzer(self.tdb, 1000.0, self.out, use_easyocr=use_easyocr,
                           console_language=console_language)
        self.reader = ResultReader()
        self.shared_candidate = None
        requested = field_reader_route()
        self.field_reader = {"requested": requested, "route": "unavailable"}
        try:
            from .shared_field_shadow import SharedFieldShadow
            self.shared_candidate = SharedFieldShadow(
                Path(db_root), self.out / "shared-field-candidate-unused.jsonl")
            self.an.ghost_panel.shared_candidate = self.shared_candidate
            self.field_reader.update(
                route="shared",
                matcherVersion=getattr(self.shared_candidate.api, "__version__", None),
                fieldSemanticsVersion=getattr(self.shared_candidate.api, "FIELD_SEMANTICS_VERSION", None))
        except Exception as error:
            # A capture never fails because the central reader could not load (a damaged install,
            # a missing reference): times are still read, the five identity fields stay unknown.
            # There is no previous reader to fall back to (removed 2026-10-30).
            self.shared_candidate = None
            self.an.ghost_panel.shared_candidate = None
            self.field_reader["unavailableReason"] = type(error).__name__
            print(f"[livetrial] central field reader unavailable ({type(error).__name__}); "
                  "identity fields stay unknown", flush=True)
        try:
            self.out.mkdir(parents=True, exist_ok=True)
            (self.out / "field-reader.json").write_text(
                json.dumps(self.field_reader, sort_keys=True) + "\n", encoding="utf-8")
        except OSError:
            pass
        self.identity = IdentityReader(easyocr_reader=self.an._reader,
                                       shared_candidate=self.shared_candidate)
        # The card prints names in the console's language; tell the matcher which
        # one so it does not have to search all 14 locales (see identity.py).
        try:
            from . import storage as _st
            from . import identity as _id
            _id.set_locales(_st.Settings.load().locales())
            # a chosen non-English console language prefers its own locales
            if self.an.language.name_locales():
                _id.set_locales(self.an.language.name_locales())
        except Exception:
            pass
        self.on_run = on_run
        self.on_card = on_card
        self.on_panel = on_panel
        self.an.qa_panel_display = bool(on_panel)
        self.on_timing = on_timing
        self._qa_lap_events: set[tuple] = set()
        self.pending = None
        self._last_state = "MENU"

    @property
    def state(self) -> str:
        return self.an.state

    @property
    def runs(self) -> list:
        return self.an.runs

    @property
    def ghost_log(self) -> list:
        """What happened on the ghost menu: panel reads, prompts, replay menu."""
        return self.an.ghost_log

    @property
    def ghost_records(self):
        """Every ghost seen, one record each (ADR-0210); never the player's."""
        return self.an.ghost_records

    def feed(self, bgr, ms: int) -> None:
        """Process one frame; ms = position in the source (video or wall)."""
        if bgr.shape[:2] != (720, 1280):
            bgr = cv2.resize(bgr, (1280, 720))
        frame = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        runs_before = len(self.an.runs)
        ghost_events_before = len(self.an.ghost_log)
        self.an.feed(frame, ms)  # Analyzer fps=1000 -> fno==ms
        if self.on_panel or self.on_timing:
            for event in self.an.ghost_log[ghost_events_before:]:
                if event.get("type") == "ghost_panel" and self.on_panel:
                    self.on_panel(dict(self.an.panel_display or {}), ms)
                elif (event.get("type") == "replay_end" and event.get("completed")
                      and self.on_timing):
                    self.on_timing("replay_finish", dict(event), ms)
        if self.on_timing:
            for active in (self.an.run, self.an.runs[-1] if self.an.runs else None):
                if not active:
                    continue
                for event in (active.get("events") or [])[-4:]:
                    if event.get("type") != "lapTime":
                        continue
                    key = (id(active), event.get("lap"), event.get("t"))
                    if key not in self._qa_lap_events:
                        self._qa_lap_events.add(key)
                        self.on_timing("lap_report", {"run": active.get("run"),
                                                       "lap": event.get("lap"),
                                                       "time": event.get("text")}, ms)
        if len(self.an.runs) > runs_before:
            new = self.an.runs[-1]
            # `resultScreenLikely`: a finish banner was seen and the HUD stayed
            # gone, so the result screen IS up even though the finish gate never
            # fired. Read it like a normal finish instead of discarding a run
            # whose times are sitting right there on screen.
            if new["finished"] or new.get("resultScreenLikely"):
                self.pending = {"run": new, "since": ms, "last": 0, "best": None,
                                "identity": {}, "id_tries": {}, "stack": deque(maxlen=STACK_MAX)}
            elif self.on_run:
                self.on_run(new)  # aborted runs complete immediately
        if self.pending is not None:
            self._pending_step(bgr, ms)

    # -- result screen sampling ----------------------------------------------
    def _pending_step(self, bgr, ms: int) -> None:
        p = self.pending
        age = ms - p["since"]
        if self.an.state != "MENU":  # next run arming: stop retrying
            self._close_pending()
            return
        if age < READ_DELAY_MS or ms - p["last"] < READ_INTERVAL_MS:
            return
        p["last"] = ms
        r = p["run"]
        first_card = p.get("endscreen") is None
        if not (p["best"] and p["best"]["accepted"]):
            read = self.reader.read(bgr, r["lapCount"], label=f"run{r['run']}_t{ms}")
            # every read votes per field (the Tournament way, central field_vote); see vote_reads
            p.setdefault("reads", []).append(read)
            p["best"] = vote_reads(p["reads"], r["lapCount"], p["best"])
            # lap-count self-check: if nothing closes after 6s, the arm-time
            # 3/7 decision may be wrong — try the other count; the lap sum
            # arbitrates, and an accepted alt read corrects the run
            if age > 6000 and not p["best"]["accepted"]:
                alt = 3 if r["lapCount"] == 7 else 7
                alt_read = self.reader.read(bgr, alt, label=f"run{r['run']}_t{ms}_alt")
                if alt_read["accepted"] or (
                        (alt_read.get("player") or {}).get("lapSumOk")
                        and not (p["best"].get("player") or {}).get("lapSumOk")):
                    r["lapCount"] = alt
                    p["best"] = alt_read
                    p["reads"] = [alt_read]
                    p["identity"] = {}
                    p["id_tries"] = {}
        # END-SCREEN STILL — kept for EVERY run, whatever happens to the video.
        # The clip is bulk that a retention budget will eventually reclaim (and
        # some setups record no video at all), but the result screen is the
        # evidence: times, both loadouts, the banner. It is one ~200 KB JPEG per
        # run, so it survives every cleanup. Prefer the frame where the player's
        # time CLOSED — settled by definition, digits no longer rolling.
        if first_card or (
                not p.get("endscreenSettled")
                and ((p["best"] or {}).get("player") or {}).get("lapSumOk")):
            p["endscreen"] = bgr.copy()
            p["endscreenSettled"] = bool(((p["best"] or {}).get("player") or {}).get("lapSumOk"))
        if self.on_card and p.get("endscreenSettled") and not p.get("qaCardSent"):
            # The first card may still show rolling digits. Pair the exact
            # analysed frame only once its seven/three lap times close on the
            # total; this is the same settled gate used by endscreen evidence.
            p["qaCardSent"] = True
            self.on_card(r, ms, p["best"]["player"])
        # keep the settled card region for the median stack (see STACK_* above)
        y1, y2, x1, x2 = STACK_BAND
        p["stack"].append(bgr[y1:y2, x1:x2].copy())
        want = [o for o in ("player", "ghost")
                if (p["best"].get(o) or {}).get("lapSumOk")
                and p["id_tries"].get(o, 0) < ID_TRIES_MAX
                and not identity_confident(p["identity"].get(o))]
        if want:
            src = bgr
            if len(p["stack"]) >= STACK_MIN:
                src = bgr.copy()
                src[y1:y2, x1:x2] = np.median(np.stack(p["stack"]), axis=0).astype(np.uint8)
            # Is the ghost a Nintendo staff ghost? Only the TIME can prove it —
            # a player may pick any name, including one edit away from a staff
            # name — so the ghost name is only canonicalised once its total
            # matches the database staff time for this course+cc exactly.
            ctx = r.get("context") or {}
            gres = p["best"].get("ghost") or {}
            # loadout is only available once a previous frame has been read, so
            # it strengthens the retries; the total+laps gate stands on its own
            gid = p["identity"].get("ghost") or {}
            gload = {k: (gid.get(f) or {}).get("id") for k, f in
                     (("characterId", "character"), ("bodyId", "kart"),
                      ("tireId", "wheel"), ("gliderId", "glider"))}
            staff = self.identity.is_staff_ghost(
                (ctx.get("trackName") or {}).get("trackId"), ctx.get("cc"),
                gres.get("totalMs"), gres.get("lapTimesMs"),
                {k: v for k, v in gload.items() if v})
            # the name strip is printed in the console language: a decided non-Latin
            # language reads it with its own reader (paired with English, so Latin
            # profile names still read); otherwise the engine's Latin reader
            self.identity._reader = self.an.language.track_reader() or self.an._reader
            # icons from the median stack, name text from this sharp frame
            self.identity.mii_pick = getattr(self.an, "mii_pick", None)
            ids = self.identity.read(src, r["lapCount"], owners=tuple(want), text_src=bgr,
                                     staff_ghost=staff)
            for o in want:
                if ids.get(o):
                    # evidence shows what the matcher actually saw (the stack)
                    self._save_evidence(src, r, o, ids[o])
                    p["identity"][o] = merge_identity(p["identity"].get(o), ids[o])
                    p["id_tries"][o] = p["id_tries"].get(o, 0) + 1
        done_ids = all(
            not (p["best"].get(o) or {}).get("lapSumOk")
            or identity_confident(p["identity"].get(o))
            or p["id_tries"].get(o, 0) >= ID_TRIES_MAX
            for o in ("player", "ghost"))
        # Ghost give-up: once the PLAYER's times have closed, keep trying the
        # ghost only briefly. Some result layouts leave the ghost unreadable by
        # the single-shift fixed grid (a WIN card puts the player on top and the
        # ghost in the flipped bottom slot the grid can't reach), so waiting the
        # full 20s budget just stalls the run — the "finished" event and the
        # dashboard appeared ~30s after the banner. Close promptly with the
        # player's (correct, lap-sum-verified) time; the ghost stays flagged and
        # the confidence chip shows amber. A normally-readable ghost closes in
        # 1-2 reads, well inside this window.
        player_ok = bool((p["best"].get("player") or {}).get("lapSumOk"))
        if player_ok and "player_ok_since" not in p:
            p["player_ok_since"] = ms
        ghost_giveup = player_ok and ms - p.get("player_ok_since", ms) > GHOST_GIVEUP_MS
        if (p["best"]["accepted"] and done_ids) or (player_ok and ghost_giveup and done_ids) \
                or age > READ_BUDGET_MS:
            self._close_pending()

    def _save_evidence(self, bgr, run: dict, owner: str, ident: dict) -> None:
        """Save the card crop the identity was read from — lets the dashboard
        show WHY a field was decided (and lets the user judge unsure ones)."""
        box = ident.get("cardBox")
        if not box:
            return
        x1, y1, x2, y2 = box
        pad = 6
        crop = bgr[max(0, y1 - pad):y2 + pad, max(0, x1 - pad):x2 + pad]
        if crop.size == 0:
            return
        self.out.mkdir(parents=True, exist_ok=True)
        fname = f"run_{run['run']:02d}_{owner}_card.png"
        try:
            cv2.imwrite(str(self.out / fname), crop)
            ident["evidenceFile"] = f"{self.out.name}/{fname}"
        except Exception:
            pass

    def _close_pending(self) -> None:
        p, self.pending = self.pending, None
        if p is None:
            return
        run = p["run"]
        # A run closed as "result screen missed" whose times DID close on the
        # lap sum is a finished run after all — the only thing that failed was
        # the on-screen gate, and the lap sum is the stronger evidence. Promote
        # it, keeping the provenance so the dashboard can flag it.
        if run.pop("resultScreenLikely", False) and \
                ((p["best"] or {}).get("player") or {}).get("lapSumOk"):
            run["finished"] = True
            run["aborted"] = False
            run["finishGateMissed"] = run.pop("abortReason", None)
        still = p.get("endscreen")
        if still is not None:
            try:
                self.out.mkdir(parents=True, exist_ok=True)
                name = f"run_{run['run']:02d}_endscreen.jpg"
                if cv2.imwrite(str(self.out / name), still,
                               [int(cv2.IMWRITE_JPEG_QUALITY), 90]):
                    run["endscreenFile"] = f"{self.out.name}/{name}"
                    run["endscreenSettled"] = bool(p.get("endscreenSettled"))
            except Exception:
                pass
        run["results"] = p["best"]
        run["identity"] = {k: v for k, v in p["identity"].items() if v}
        # the central scan result: the same result contract as the Web scanner and Android
        scan_result = central_scan_result(run["results"], run["identity"], run.get("lapCount") or 3)
        if scan_result:
            run["scanResult"] = scan_result
        _drop_events_past_the_finish(run)
        if self.on_run:
            self.on_run(run)

    def finalize(self, ms: int) -> None:
        if self.pending is not None:
            self._close_pending()
        self.an.finalize(ms)
        if self.an.runs and not self.an.runs[-1].get("results") \
                and self.an.runs[-1].get("aborted") and self.on_run:
            pass  # aborted-at-end run already reported via feed or is final
