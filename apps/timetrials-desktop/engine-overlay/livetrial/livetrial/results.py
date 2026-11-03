"""End-screen results reading: lap times + total via the proven capture-card path.

Reuses the existing production engine READ-ONLY (no repo code modified):
src/mk8_production/workflow_ocr_engine.py running the 4-node AutoY workflows
(FixedMK8Grid + SevenSegmentOCRProbe slot-template decode, baseline 0/1344
mismatches on capture-card frames). The workflow is chosen per run lap count
(race3 / race7), which the temporal layer knows from the arm gate.

Acceptance follows the project's lap-sum principle: a read is accepted when
the lap times sum exactly to the total (per owner). Ghost absence is detected
per the APK's phantom-ghost rule: no ghost fields -> no ghost result.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# NOTE: the per-digit scale sweep (0.85-1.2) in the segment decode LOOKS
# wasteful for a clean capture card (canonical 1280x720, scale exactly 1.0), but
# a measured A/B (scale locked to 1.0) gave BYTE-IDENTICAL times. (The old
# ~580ms/read figure was the vendored workflow engine; the purpose-built ocr.py
# with the batched-matmul decode now reads in ~22ms/read even under the live
# 2-thread cap, so segment decode is no longer a lock-latency factor.)
_LAPIDX_CFG = Path(__file__).resolve().parent.parent / "config" / "lapindex"

_TIME_RE = re.compile(r"^(\d):([0-5]\d)\.(\d{3})$")


def time_to_ms(text: str):
    """'1:26.950' -> 86950; None for unknowns/misreads ('?', bad format)."""
    m = _TIME_RE.match(str(text).strip())
    if not m:
        return None
    return (int(m.group(1)) * 60 + int(m.group(2))) * 1000 + int(m.group(3))


def _central(module: str):
    """A module of the central package (packages/icon-matcher), staged with the reader."""
    from .shared_field_shadow import _field_package
    return __import__(_field_package().__name__ + "." + module, fromlist=["__name__"])


def _central_lap_sum_ok(total_text, lap_texts) -> bool:
    """The central time decision's lap-sum rule (packages/icon-matcher time_decision, the same as
    the Web scanner and Android). Without the central package nothing closes: the previous own
    check was removed (2026-10-31), as every other previous route."""
    try:
        decision = _central("time_decision")
    except Exception:
        return False
    return decision.lap_sum_complete([{"total": total_text, "laps": list(lap_texts)}])


# The identity fields of a LiveTrial card; the central scan result takes the same names.
_SCAN_FIELDS = ("character", "kart", "wheel", "glider", "flag")


def central_scan_result(results: dict | None, identity: dict | None, lap_count: int) -> dict | None:
    """The central scan result (packages/icon-matcher scan_result: the Web scanner's and Android's
    result contract) for every owner the result card was read for: which time and laps count,
    whether the laps close, which parts are accepted, what needs a check. None without times or
    without the central package."""
    try:
        scan = _central("scan_result")
    except Exception:
        return None
    out = {}
    for owner in ("player", "ghost"):
        read = (results or {}).get(owner)
        if not read or read.get("totalMs") is None:
            continue
        fields = {f"{owner}_total": ms_to_time(read["totalMs"])}
        for lap, value in enumerate(read.get("lapTimesMs") or [], 1):
            fields[f"{owner}_lap_{lap}"] = ms_to_time(value) if value is not None else "?"
        card = (identity or {}).get(owner) or {}
        slots = {}
        for field in _SCAN_FIELDS:
            entry = card.get(field)
            if not isinstance(entry, dict):
                continue
            suggestion = entry.get("suggestion") or {}
            slots[field] = {"id": entry.get("id") or entry.get("selectedId"), "ok": entry.get("id") is not None,
                           "score": entry.get("score"),
                           "alternatives": [{"id": alt.get("id"), "name": alt.get("label")}
                                            for alt in suggestion.get("alternatives") or []]}
        if card.get("name"):
            slots["card_name"] = card["name"]
        out[owner] = scan.compose_scan_result(
            {"locked": True, "layout": "endscreen", "fields": fields, "identity": {owner: slots}}, lap_count)
    return out or None


def ms_to_time(ms: int) -> str:
    s = ms / 1000.0
    return f"{int(s // 60)}:{s % 60:06.3f}"


class _LapIndexProbe:
    """Locates the player's circled lap-1 index on the result card to compute
    the exact grid y-shift directly — no candidate sweep. The '1' circle sits
    at a rock-stable x=1018 (2704-annotation dataset); its y tells us where the
    card physically is. The PLAYER circle (yellow card bg) is matched apart
    from the GHOST circle (grey bg), so owner + position both fall out.

    Y_EXPECTED = the canonical y the reader's grid expects the player lap-1
    circle at. shift = Y_EXPECTED - y_found aligns any card position (solo top,
    two-card top, two-card bottom). Calibrated on 3 verified frames:
    race3 two-card y=208 (shift 0), race7 two-card y=424 (shift -32),
    race7 solo y=88 (shift +304) -> Y_EXPECTED{3:208, 7:392}."""

    Y_EXPECTED = {3: 208, 7: 392}

    # FIXED lap-1 circle y per physical slot, from the deterministic capture-card
    # layout (benchmarks/fixed_grid_scenarios_20260702.json: circle_y = slot_y1 +
    # first lap_strip_rel_y). The clean capture card puts each card at EXACTLY
    # one of these, so we match the lap-index template at these few positions
    # instead of scanning -> which slot the player/ghost is in (i.e. win vs lose)
    # falls out from a handful of template checks. No RF-DETR needed.
    #   top-3lap 130+78=208, bottom-3lap 363+78=441, top-7lap 59+63=122,
    #   bottom-7lap 362+63=425 (measured ~424). -30 = new-ghost/record footer.
    SLOT_CIRCLE_Y = {3: {"top": 208, "bottom": 441}, 7: {"top": 122, "bottom": 424}}
    _SLOT_OFFSETS = (0, -30)

    def __init__(self):
        self._tpls = None

    def _load(self):
        if self._tpls is not None:
            return self._tpls
        from .templates import Template
        self._tpls = {}
        try:
            anchors = json.loads((_LAPIDX_CFG / "anchors.json").read_text())
            for role, fname in (("player", "lap1_player.png"), ("ghost", "lap1_ghost.png")):
                a = anchors[fname]
                self._tpls[role] = (Template, fname, a)
        except Exception:
            self._tpls = {}
        return self._tpls

    def _best_y(self, rgb, role, y_lo=70, y_hi=480):
        tpls = self._load()
        if role not in tpls:
            return (-1.0, None)
        Template, fname, a = tpls[role]
        best = (-1.0, None)
        # coarse scan (step 6), then refine +-6 (step 2) around the peak
        for y in range(y_lo, y_hi, 6):
            c = Template(fname, Path(fname), {"x": a["x"], "y": y}, _LAPIDX_CFG).corr(rgb, search=1)
            if c > best[0]:
                best = (c, y)
        if best[1] is not None:
            for y in range(best[1] - 6, best[1] + 7, 2):
                c = Template(fname, Path(fname), {"x": a["x"], "y": y}, _LAPIDX_CFG).corr(rgb, search=1)
                if c > best[0]:
                    best = (c, y)
        return best

    def _match_slot(self, rgb, role, lap_count):
        """(corr, y, slot) of the best lap-1 circle match across the FIXED slot
        positions — discrete, not a scan. A few template checks tell us which
        physical slot the owner occupies (top/bottom) and hence win vs lose."""
        tpls = self._load()
        if role not in tpls:
            return (-1.0, None, None)
        Template, fname, a = tpls[role]
        best = (-1.0, None, None)
        for slot, cy in self.SLOT_CIRCLE_Y[7 if lap_count == 7 else 3].items():
            for off in self._SLOT_OFFSETS:
                c = Template(fname, Path(fname), {"x": a["x"], "y": cy + off}, _LAPIDX_CFG).corr(rgb, search=3)
                if c > best[0]:
                    best = (c, cy + off, slot)
        return best

    def shift_for(self, bgr_frame, lap_count: int):
        """Return (shift, meta) from the player lap-1 circle, or (None, meta)
        when no confident circle is found (fall back to the sweep). The player's
        matched slot decides the shift; the ghost slot is confirmed too."""
        import cv2
        rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        key = 7 if lap_count == 7 else 3
        cp, yp, pslot = self._match_slot(rgb, "player", lap_count)
        if yp is None or cp < 0.85:
            return None, {"playerCorr": round(float(cp), 3) if cp >= 0 else None}
        cg, yg, gslot = self._match_slot(rgb, "ghost", lap_count)
        shift = self.Y_EXPECTED[key] - yp
        return shift, {"playerCorr": round(float(cp), 3), "playerY": yp, "playerSlot": pslot,
                       "ghostCorr": round(float(cg), 3) if cg >= 0 else None, "ghostSlot": gslot,
                       "solo": cg < 0.8}


_CENTRAL_PRESENCE = []


def _central_ghost_y(rgb, lap_count: int, probe):
    """Ghost lap-1 circle y from the central card presence (packages/icon-matcher
    card_presence: circles 1, 2, 3 at one fixed ghost slot). Returns None when
    the shared package or the card-anchors file is not staged (the caller keeps
    the single-circle gate), False when the ghost card is absent."""
    if not _CENTRAL_PRESENCE:
        found = None
        try:
            import os
            from .identity_matcher import assets_root
            from .shared_field_shadow import _field_package
            api = _field_package()
            module = __import__(api.__name__ + ".card_presence", fromlist=["CardAnchors"])
            override = os.environ.get("MK8DX_CARD_ANCHORS", "").strip()
            path = Path(override) if override else Path(assets_root()).parent / "card-anchors-v1.json"
            if path.is_file():
                found = (module, module.CardAnchors.load(path))
        except Exception:
            found = None
        _CENTRAL_PRESENCE.append(found)
    if _CENTRAL_PRESENCE[0] is None:
        return None
    module, anchors = _CENTRAL_PRESENCE[0]
    _cp, yp, pslot = probe._match_slot(rgb, "player", lap_count)
    ghost = module.card_presence(rgb, anchors, "ghost", lap_count, exclude_slot=pslot)
    if not ghost["present"]:
        return False
    # Presence and slot are central; the exact y stays this engine's own probe
    # (GHOST_Y_EXPECTED is calibrated on it).
    circle_y = ghost["circleY"]
    _cg, yg = probe._best_y(rgb, "ghost")
    if yg is not None and abs(yg - circle_y) <= 8:
        return yg
    start = 70 + ((circle_y - 6 - 70) // 6) * 6  # stay on the scan's 6-px grid
    return probe._best_y(rgb, "ghost", start, circle_y + 13)[1]


class ResultReader:
    """Lazy wrapper around WorkflowOcrEngine; one engine per race key."""

    def __init__(self):
        self._engines = {}
        self._probe = _LapIndexProbe()

    def _engine(self, lap_count: int):
        key = 7 if lap_count == 7 else 3
        if key not in self._engines:
            from .ocr import OcrEngine
            self._engines[key] = OcrEngine(key)
        return self._engines[key]

    # The result card has stable vertical positions: with the ghost-data
    # footer (anchorShift y:-30 in the database) and without. The race7 grid
    # anchors are baked for the footer position — measured on the reference
    # still, the no-footer card sits exactly one lap row (32px) lower; the
    # race3 anchors are baked for the no-footer position. A SOLO run has no
    # ghost card and its single card sits in the TOP slot: +304 (race7) /
    # +236 (race3) — the lap-index circle clusters (top y=115/203 vs bottom
    # y=419/439) and a shift-sweep on a real failed solo clip both give the
    # same numbers. Candidate y-shifts (negative = shift frame up, positive =
    # down) realign the frame per hypothesis; the lap sum decides which one
    # was right, so extra candidates only cost time when earlier ones fail.
    # These are the FALLBACK: read() first computes the exact shift from the
    # player lap-1 circle (_LapIndexProbe) and only sweeps when the circle
    # isn't clean enough (mid-animation / partial fade).
    Y_SHIFT_CANDIDATES = {3: (0, 30, 236), 7: (0, -32, 304)}

    # Ghost-slot lap-1 circle y (the GREY-decode slot the FixedMK8Grid reads the
    # ghost from). The grid's owner->physical-slot mapping differs by lap count
    # (7-lap: player=bottom/ghost=top; 3-lap: player=top/ghost=bottom), and the
    # player-anchored shift only aligns the PLAYER — so in a FLIPPED layout (a
    # WIN card, player on top for 7-lap) the ghost lands off its decode slot and
    # reads garbage. Anchoring the GHOST's own lap-1 circle here (owner-split
    # detection tells us where the ghost is) reads it directly. Both calibrated
    # on real flipped-layout clips: 7-lap WIN (ghost bottom yg=424 -> clean at
    # shift -308 -> grey slot y 116); 3-lap LOSS (ghost top yg=208 -> clean at
    # shift 0 -> grey slot y 208). The grid's grey slot differs per lap count
    # because its owner->slot mapping flips between 3 and 7 laps.
    GHOST_Y_EXPECTED = {3: 208, 7: 116}

    @staticmethod
    def _apply_shift(bgr_frame, s):
        import cv2
        if s == 0:
            return bgr_frame
        if s < 0:
            return cv2.copyMakeBorder(bgr_frame[-s:], 0, -s, 0, 0, cv2.BORDER_REPLICATE)
        return cv2.copyMakeBorder(bgr_frame, s, 0, 0, 0, cv2.BORDER_REPLICATE)[:bgr_frame.shape[0]]

    def read(self, bgr_frame, lap_count: int, label: str = "result") -> dict:
        """Read the result screen; returns per-owner lap/total ms + acceptance.

        The player's lap-1 circle gives the exact shift directly (owner + card
        position in one probe), so we try THAT first — one read instead of a
        blind sweep. The candidate list stays as a fallback for frames where
        the circle isn't clean yet (mid-animation, partial fade)."""
        key = 7 if lap_count == 7 else 3
        out = None
        tried = []
        probe_shift, meta = self._probe.shift_for(bgr_frame, lap_count)
        if probe_shift is not None:
            tried.append(probe_shift)
            out = self._read_once(self._apply_shift(bgr_frame, probe_shift), lap_count,
                                  f"{label}_probe{probe_shift}")
            out["shiftMeta"] = {"probe": probe_shift, **meta}
        # only sweep the fallback candidates if the primary read didn't close
        if out is None or not out["accepted"]:
            for s in self.Y_SHIFT_CANDIDATES[key]:
                if s in tried:
                    continue
                out = merge(out, self._read_once(self._apply_shift(bgr_frame, s), lap_count, f"{label}_y{s}"))
                if out["accepted"]:
                    break
        # Ghost-independent recovery (doc: "anchor EACH card independently").
        # A CONFIDENT ghost lap-1 circle means a ghost card IS present, so if its
        # lap sum hasn't closed the ghost is mis-read, NOT absent — the flipped
        # (win) layout puts it off the player-anchored decode slot, where it
        # reads as garbage/absent and the phantom-ghost rule would wrongly accept
        # a player-only result. Align the ghost's OWN circle to the grey ghost-
        # slot and read it directly. Skipped for true solo runs (no ghost circle)
        # and normal runs (ghost already closed), so those are untouched.
        if out is not None and not (out.get("ghost") or {}).get("lapSumOk"):
            import cv2
            rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
            yg = _central_ghost_y(rgb, lap_count, self._probe)
            if yg is None:
                cg, yg, gslot = self._probe._match_slot(rgb, "ghost", lap_count)
                # 0.70, not 0.80: a real ghost circle sits ~0.79-0.90 (measured 0.79
                # on a live new-record frame) while solo runs have no grey circle at
                # all (<<0.5), so the lower gate recovers a borderline ghost without
                # ever firing on a genuine solo run.
                if not (yg is not None and cg >= 0.70):
                    yg = None
            if yg is not None and yg is not False:
                gshift = self.GHOST_Y_EXPECTED[key] - int(yg)
                gout = self._read_once(self._apply_shift(bgr_frame, gshift), lap_count,
                                       f"{label}_ghost{gshift}")
                if (gout.get("ghost") or {}).get("lapSumOk"):
                    out["ghost"] = gout["ghost"]
                    out["accepted"] = bool((out.get("player") or {}).get("lapSumOk"))
        return out

    def _read_once(self, bgr_frame, lap_count: int, label: str) -> dict:
        res = self._engine(lap_count).run_frame(label, bgr_frame)
        fields = dict(res.fields)
        out = {"fieldsRaw": fields, "player": None, "ghost": None, "accepted": False}
        for owner in ("player", "ghost"):
            total = time_to_ms(fields.get(f"{owner}_total", ""))
            laps = [time_to_ms(fields.get(f"{owner}_lap_{i}", "")) for i in range(1, lap_count + 1)]
            present = total is not None or any(v is not None for v in laps)
            if not present:
                continue  # phantom-ghost rule: absent owner stays absent
            lap_sum_ok = _central_lap_sum_ok(
                fields.get(f"{owner}_total") or None,
                [fields.get(f"{owner}_lap_{i}") or "" for i in range(1, lap_count + 1)])
            out[owner] = {
                "totalMs": total,
                "lapTimesMs": laps,
                "lapSumOk": lap_sum_ok,
            }
        player_ok = bool(out["player"] and out["player"]["lapSumOk"])
        ghost_ok = out["ghost"] is None or out["ghost"]["lapSumOk"]
        out["accepted"] = player_ok and ghost_ok
        return out


def _central_field_vote():
    """The central multi-frame field vote (packages/icon-matcher sequence_decision.field_vote, the
    same vote Tournament Live uses); None when the package is not staged."""
    try:
        from .shared_field_shadow import _field_package
        module = __import__(_field_package().__name__ + ".sequence_decision", fromlist=["field_vote"])
        return getattr(module, "field_vote", None)
    except Exception:
        return None


# A read whose own lap sum closed is the strongest witness of its digits.
CLOSED_READ_WEIGHT = 2.0


def vote_reads(reads: list, lap_count: int, best: dict | None = None) -> dict | None:
    """Decide the result screen from ALL reads so far, the Tournament way (CENTRAL_RECOGNITION
    section 8.6, phase 6): per owner and per field (total, each lap) every read votes with the
    central ``field_vote``, a read whose lap sum closed weighing double; the voted times are accepted
    when THEY close the lap sum (central time decision). One noisy or badly compressed frame no
    longer blocks a result the other frames agree on. An owner already closed stays final, and an
    owner no read showed stays absent (phantom-ghost rule). Without the central package this is the
    previous pairwise ``merge``."""
    field_vote = _central_field_vote()
    if field_vote is None:
        out = best
        for read in reads[-1:]:
            out = merge(out, read)
        return out
    out = {"fieldsRaw": reads[-1].get("fieldsRaw") if reads else None, "player": None, "ghost": None}
    for owner in ("player", "ghost"):
        previous = (best or {}).get(owner)
        if previous and previous.get("lapSumOk"):
            out[owner] = previous
            continue
        seen = [r.get(owner) for r in reads if r and r.get(owner)]
        if not seen:
            continue
        def voted(get):
            won = field_vote([(get(o), CLOSED_READ_WEIGHT if o.get("lapSumOk") else 1.0) for o in seen])
            return None if won is None else won["value"]
        total = voted(lambda o: o.get("totalMs"))
        laps = [voted(lambda o, i=i: (o.get("lapTimesMs") or [None] * lap_count)[i]
                      if i < len(o.get("lapTimesMs") or []) else None) for i in range(lap_count)]
        complete = total is not None and all(v is not None for v in laps)
        lap_sum_ok = complete and _central_lap_sum_ok(ms_to_time(total), [ms_to_time(v) for v in laps])
        out[owner] = {"totalMs": total, "lapTimesMs": laps, "lapSumOk": bool(lap_sum_ok),
                      "votedReads": len(seen)}
    player_ok = bool(out["player"] and out["player"]["lapSumOk"])
    ghost_ok = out["ghost"] is None or out["ghost"]["lapSumOk"]
    out["accepted"] = player_ok and ghost_ok
    return out


def merge(best: dict | None, new: dict | None) -> dict | None:
    """Merge reads PER OWNER: player and ghost settle (and fade) at different
    moments of the result animation, so the best frame for one owner is often
    not the best frame for the other. A lap-sum-closed owner is final."""
    if best is None or new is None:
        return best or new
    out = {"fieldsRaw": new.get("fieldsRaw"), "player": None, "ghost": None}
    for owner in ("player", "ghost"):
        a, b = best.get(owner), new.get(owner)
        if a and a.get("lapSumOk"):
            out[owner] = a
        elif b and b.get("lapSumOk"):
            out[owner] = b
        else:
            out[owner] = a or b
    player_ok = bool(out["player"] and out["player"]["lapSumOk"])
    ghost_ok = out["ghost"] is None or out["ghost"]["lapSumOk"]
    out["accepted"] = player_ok and ghost_ok
    return out
