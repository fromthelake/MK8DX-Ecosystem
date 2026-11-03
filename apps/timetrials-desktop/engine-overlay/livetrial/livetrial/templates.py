"""Clean Assets template database: masked-correlation HUD templates.

Ported from tools/timetrial_analyzer.py (validated reference implementation,
see docs/example_analysis/). Driven entirely by database.json — anchors, refs
and rules come from the database; no hardcoded coordinates.
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

MAX_SAMPLE = 1200  # masked pixels sampled per template: plenty for a corr estimate


def _imread_rgba(path):
    from PIL import Image
    return Image.open(path).convert("RGBA")


class Template:
    def __init__(self, rec_id, path, anchor, root, lang=None):
        img = np.asarray(_imread_rgba(root / path))
        self.id = rec_id
        self.lang = lang     # console-language bucket of a language variant, else None
        self.anchor = anchor
        self.h, self.w = img.shape[:2]
        ys, xs = np.where(img[:, :, 3] > 128)
        if len(ys) > MAX_SAMPLE:
            idx = np.random.RandomState(1).choice(len(ys), MAX_SAMPLE, replace=False)
            ys, xs = ys[idx], xs[idx]
        self.ys, self.xs = ys, xs
        px = img[ys, xs, :3].astype(np.float32).flatten()
        px -= px.mean()
        self.pixels = px / max(np.linalg.norm(px), 1e-6)

    def corr(self, frame, search=0):
        """Best masked normalized correlation at the anchor, small local search."""
        ax, ay = self.anchor["x"], self.anchor["y"]
        best = -1.0
        for dy in range(-search, search + 1):
            for dx in range(-search, search + 1):
                x, y = ax + dx, ay + dy
                if x < 0 or y < 0 or x + self.w > frame.shape[1] or y + self.h > frame.shape[0]:
                    continue
                crop = frame[self.ys + y, self.xs + x, :].astype(np.float32).flatten()
                crop -= crop.mean()
                n = np.linalg.norm(crop)
                if n < 1e-6:
                    continue
                c = float(np.dot(self.pixels, crop) / n)
                if c > best:
                    best = c
        return best


class TemplateDb:
    """Loads hudTemplates from database.json; language variants become separate entries."""

    def __init__(self, root: Path):
        self.root = root
        db = json.loads((root / "database.json").read_text(encoding="utf-8"))
        self.db = db
        self.flow = db["detection"]["timeTrialFlow"]
        self.templates: dict[str, list[Template]] = {}
        for rec in db["collections"]["hudTemplates"]:
            if rec.get("kind") == "zone_reference":
                continue
            tpl = rec["assets"]["template"]
            variants = []
            if "byLanguage" in tpl:
                for lang, v in tpl["byLanguage"].items():
                    if v:
                        variants.append(Template(f"{rec['id']}:{lang}", v["path"], v["anchor"], root, lang))
            else:
                variants.append(Template(rec["id"], tpl["path"], rec["anchor"], root))
            self.templates[rec["id"]] = variants
        self.ocr_zones = {rec["slug"]: rec["ocrZones"]
                          for rec in db["collections"]["hudTemplates"] if rec.get("ocrZones")}
        # Console language (consolelang.py). Clean Assets v5.5 carries the
        # language-dependent templates for all 12 console languages; scoring
        # every variant on every check costs 12x and lets a stranger's banner
        # match. `set_languages` narrows the variants consulted to the session's
        # language(s); `observer(rec_id, {lang: score})` sees the per-language
        # scores of the records it asks for while the language is not yet known.
        self.languages = sorted({t.lang for vs in self.templates.values() for t in vs if t.lang})
        self._active: dict[str, list[Template]] = {}
        self.active_languages: list[str] | None = None
        self.observer = None
        self.observed: frozenset = frozenset()
        self.observe_gate = None    # optional (rec_id) -> bool: observe this check?
        self._discriminate()
        self._build_coin_last_digit()
        self._build_lap_denominator()
        self._build_lap_advance()

    # Coin counter shows "00".."10" (icon + two 7-segment digits). Matching the
    # whole counter fails: the shared icon + leading "0" dominate, and "7" is a
    # segment-subset of "3" so coins_07 ties coins_03 on a "3" frame (coin 3
    # missed for a whole lap). User insight: read only the LAST digit (enough
    # for 0-9) on its DIFF-region (subset-safe: penalises the segments a digit
    # lacks), and detect 10 by colour — the "10" digits are ORANGE (hue~20
    # sat~218) while 0-9 are white (sat~10). The small last-digit region gives a
    # ~0.2 margin vs ~0.09 for the whole counter, so no tie-breaker is needed.
    LAST_DIGIT_COLS = (78, 101)   # x-range within the coins template

    def _build_coin_last_digit(self):
        from PIL import Image
        recs = {i: next(r for r in self.db["collections"]["hudTemplates"]
                        if r["id"] == f"hud_template.hud_coins_{i:02d}") for i in range(11)}
        imgs = {i: np.asarray(Image.open(self.root / recs[i]["assets"]["template"]["path"]).convert("RGBA"))
                for i in range(11)}
        lx0, lx1 = self.LAST_DIGIT_COLS
        anchor = self.templates["hud_template.hud_coins_03"][0].anchor
        # diff-region within the last-digit block, across ALL 11 (0..10). The
        # "10" last digit is an ORANGE "0" vs the white "0" of value 0: same
        # shape, different colour -> the diff-region captures that colour delta
        # and the RGB match separates them, so 10 needs no colour heuristic.
        stack = np.stack([imgs[i][:, lx0:lx1, :3].astype(np.int16) for i in range(11)])
        diff = (stack.max(0) - stack.min(0)).mean(2) > 28
        ys, xs = np.where(diff)
        self._coin_last = {"ax": anchor["x"] + lx0, "ay": anchor["y"], "ys": ys, "xs": xs, "pix": {}}
        for i in range(11):
            sub = imgs[i][:, lx0:lx1, :3].astype(np.float32)
            px = sub[ys, xs].flatten(); px -= px.mean()
            self._coin_last["pix"][i] = px / max(np.linalg.norm(px), 1e-6)

    def read_coins(self, frame, thr=0.72, margin=0.06, search=1):
        """Coins 0-10 from the last digit's diff-region (subset-safe; 10 = the
        orange '0'). None when no digit clears thr with a clear margin.

        The coin counter sits at a FIXED position for a whole session, so the
        winning search offset is stable. We lock it: once found, later frames
        read all 11 digits at that ONE offset (11 dot products) instead of
        sweeping 11*(2s+1)^2. Self-healing — a failed locked read (occlusion,
        blur) falls back to the full sweep and re-locks. This was the single
        biggest per-frame ROI cost (measured ~420k shift-evals across clips)."""
        c = self._coin_last
        ax, ay, ys, xs = c["ax"], c["ay"], c["ys"], c["xs"]
        H, W = frame.shape[:2]
        xm, ym = int(xs.max()), int(ys.max())

        def read_at(dx, dy):
            """All 11 digit scores at one offset -> (best_i, best_v, second)."""
            x, y = ax + dx, ay + dy
            if x < 0 or y < 0 or x + xm >= W or y + ym >= H:
                return None
            crop = frame[ys + y, xs + x, :].astype(np.float32).flatten()
            crop -= crop.mean()
            n = np.linalg.norm(crop)
            if n <= 1e-6:
                return None
            bi, bv, sec = None, -1.0, -1.0
            for i in range(11):
                v = float(np.dot(c["pix"][i], crop) / n)
                if v > bv:
                    bi, bv, sec = i, v, bv
                elif v > sec:
                    sec = v
            return bi, bv, sec

        # fast path: the locked offset from a previous frame
        lock = c.get("lock")
        if lock is not None:
            r = read_at(*lock)
            if r and r[1] >= thr and r[1] - r[2] >= margin:
                return r[0], r[1]

        # slow path: full sweep -> best offset (highest single-digit score), lock it
        best = None  # (v, i, sec, dx, dy)
        for dy in range(-search, search + 1):
            for dx in range(-search, search + 1):
                r = read_at(dx, dy)
                if r and (best is None or r[1] > best[0]):
                    best = (r[1], r[0], r[2], dx, dy)
        if best is None:
            return None, -1.0
        v, i, sec, dx, dy = best
        if v >= thr and v - sec >= margin:
            c["lock"] = (dx, dy)
            return i, v
        return None, v

    # 3-vs-7 laps decided by the counter's DENOMINATOR, as an ON/OFF segment
    # test instead of a template correlation — because correlating hud_lap3_1
    # against hud_lap7_1 cannot work:
    #   * they are the same 134x53 image apart from one digit, so the shared
    #     chrome dominates a full-mask match (measured margin 0.001-0.002 —
    #     right answer, but far inside the noise);
    #   * _discriminate's diff-region fix does not rescue it, because the diff
    #     is mostly pixels where "3" has ink and "7" is TRANSPARENT. Those are
    #     dropped by lap7_1's alpha mask, leaving it only 28 usable pixels —
    #     under the 60-pixel floor, so lap7_1 silently kept a DIFFERENT (larger,
    #     chrome-heavy) mask while lap3_1 was resampled onto 146 discriminative
    #     pixels. The two were then scored on non-comparable pixel sets and
    #     lap7_1 won every time: measured 0/40 correct on clear "1/3" footage,
    #     i.e. a constant "7" predictor. (This is what the 3/7 misreads on
    #     context-less clips were; the coin counter's subset trap, one family
    #     over, is the same story.)
    # So: take the pixels that are lit in "3" but NOT in "7", and ask whether
    # the FRAME is lit there, normalised against the always-lit shared strokes
    # (ON reference) and the counter background (OFF reference). That is
    # illumination-invariant and needs no comparison between two templates.
    # Calibrated on 800 samples from 10 runs across 5 capture-card clips:
    #     3 laps -> 0.835 .. 0.887      7 laps -> 0.29 .. 0.56
    # Dead band 0.65-0.75 sits in the gap; outside it the read is confident,
    # inside it we return None and the caller keeps whatever it had.
    LAP_DENOM_LIT = 150.0      # template luma above which a pixel counts as ink
    LAP_DENOM_MIN_CONTRAST = 40.0
    LAP_DENOM_LO, LAP_DENOM_HI = 0.65, 0.75

    def _build_lap_denominator(self):
        from PIL import Image
        recs = {r["id"]: r for r in self.db["collections"]["hudTemplates"]}
        try:
            a = np.asarray(Image.open(
                self.root / recs["hud_template.hud_lap3_1"]["assets"]["template"]["path"]).convert("RGBA"))
            b = np.asarray(Image.open(
                self.root / recs["hud_template.hud_lap7_1"]["assets"]["template"]["path"]).convert("RGBA"))
            anchor = recs["hud_template.hud_lap3_1"]["anchor"]
        except Exception:
            self._lap_denom = None
            return
        if a.shape != b.shape:
            self._lap_denom = None
            return
        lum = lambda im: im[:, :, :3].astype(np.float32).mean(2)  # noqa: E731
        on3 = (a[:, :, 3] > 128) & (lum(a) > self.LAP_DENOM_LIT)
        on7 = (b[:, :, 3] > 128) & (lum(b) > self.LAP_DENOM_LIT)
        only3 = on3 & ~on7          # strokes the "3" has and the "7" lacks
        shared = on3 & on7          # the "1/" etc — always lit, the ON reference
        off = (a[:, :, 3] > 128) & (b[:, :, 3] > 128) & ~on3 & ~on7  # OFF reference
        if only3.sum() < 30 or shared.sum() < 60 or off.sum() < 60:
            self._lap_denom = None
            return
        self._lap_denom = {
            "anchor": anchor, "h": a.shape[0], "w": a.shape[1],
            "only": np.where(only3), "on": np.where(shared), "off": np.where(off),
        }

    def read_lap_count(self, frame, search=2):
        """3 or 7 from the in-race lap counter, or None when not confident
        (counter absent/animating, or the ratio lands in the dead band)."""
        d = self._lap_denom
        if not d:
            return None
        g = frame[:, :, :3].astype(np.float32).mean(2)
        H, W = g.shape
        ax, ay = d["anchor"]["x"], d["anchor"]["y"]
        ys_on, xs_on = d["on"]
        ys_off, xs_off = d["off"]
        ys_o3, xs_o3 = d["only"]
        best = None
        for dy in range(-search, search + 1):
            for dx in range(-search, search + 1):
                x, y = ax + dx, ay + dy
                if x < 0 or y < 0 or y + d["h"] > H or x + d["w"] > W:
                    continue
                on = g[ys_on + y, xs_on + x].mean()
                off = g[ys_off + y, xs_off + x].mean()
                # align on the strongest ON/OFF contrast: that is where the
                # counter really sits, independent of which digit is shown
                if best is None or on - off > best[0]:
                    best = (on - off, g[ys_o3 + y, xs_o3 + x].mean(), on, off)
        if best is None or best[0] < self.LAP_DENOM_MIN_CONTRAST:
            return None
        _, lit, on, off = best
        ratio = (lit - off) / (on - off)
        if ratio >= self.LAP_DENOM_HI:
            return 3
        if ratio <= self.LAP_DENOM_LO:
            return 7
        return None

    # "Has the counter advanced from N to N+1?" asked as the one question that
    # separates them: are the strokes only N+1 lights actually lit?
    #
    # Whole-template correlation cannot answer it, because a digit whose
    # segments are a SUBSET of the next one matches the next one perfectly.
    # Measured across the lap templates, exactly one pair is a subset — and it
    # is the pair that failed in the corpus:
    #     5 vs 6:  lit only in 5:   3 px    lit only in 6:  61 px
    #     every other pair:        58..310            58..310
    # A 7-segment "6" is a "5" plus the bottom-left stroke. So on a 6 frame the
    # "5" template finds all of ITS pixels lit and scores 0.914, HIGHER than
    # the true "6" at 0.850 — which is why requiring next > current would break
    # the real crossing — while on a 5 frame the "6" template is short only
    # those 61 dark pixels and still reaches 0.661 against a 0.66 threshold.
    # That fired lap 6 1.3 s into lap 5 on Baby Park and swallowed the real
    # crossing 8.5 s later. Same failure the coin counter documents ("7 is a
    # segment-subset of 3"), and the same shape of fix.
    #
    # Scored like the 3-vs-7 denominator: brightness of the "only next" strokes
    # against ON (lit in both — the flag and "/N") and OFF (opaque in both, lit
    # in neither) references, so it is immune to the HUD's transparency and to
    # whatever scenery is behind it.
    # Measured on the Baby Park 5->6 pair: 0.47..0.52 while the counter still
    # shows 5, 0.87..0.91 once it shows 6. 0.70 is the middle of that gap.
    LAP_ADV_MIN = 0.70

    def _build_lap_advance(self):
        from PIL import Image
        self._lap_adv: dict = {}
        for laps in (3, 7):
            try:
                ims = [np.asarray(Image.open(
                    self.root / next(r for r in self.db["collections"]["hudTemplates"]
                                     if r["id"] == f"hud_template.hud_lap{laps}_{n}"
                                     )["assets"]["template"]["path"]).convert("RGBA"))
                       for n in range(1, laps + 1)]
                anchor = next(r for r in self.db["collections"]["hudTemplates"]
                              if r["id"] == f"hud_template.hud_lap{laps}_1")["anchor"]
            except Exception:
                continue
            lum = [im[:, :, :3].astype(np.float32).mean(2) for im in ims]
            solid = [im[:, :, 3] > 128 for im in ims]
            on = [s & (l > self.LAP_DENOM_LIT) for s, l in zip(solid, lum)]
            for i in range(laps - 1):
                only = on[i + 1] & ~on[i]
                both = on[i] & on[i + 1]
                dark = solid[i] & solid[i + 1] & ~on[i] & ~on[i + 1]
                if only.sum() < 30 or both.sum() < 60 or dark.sum() < 60:
                    continue
                self._lap_adv[(laps, i + 1)] = {
                    "anchor": anchor, "h": ims[0].shape[0], "w": ims[0].shape[1],
                    "only": np.where(only), "on": np.where(both), "off": np.where(dark)}

    def lap_advanced(self, frame, laps, cur, search=2):
        """Ratio in ~[0,1] that the counter now shows cur+1 rather than cur,
        or None when the counter is not legible on this frame. The caller
        thresholds it — see LAP_ADV_MIN."""
        d = self._lap_adv.get((laps, cur))
        if not d:
            return None
        g = frame[:, :, :3].astype(np.float32).mean(2)
        H, W = g.shape
        ax, ay = d["anchor"]["x"], d["anchor"]["y"]
        ys_on, xs_on = d["on"]
        ys_off, xs_off = d["off"]
        ys_o, xs_o = d["only"]
        best = None
        for dy in range(-search, search + 1):
            for dx in range(-search, search + 1):
                x, y = ax + dx, ay + dy
                if x < 0 or y < 0 or y + d["h"] > H or x + d["w"] > W:
                    continue
                on = g[ys_on + y, xs_on + x].mean()
                off = g[ys_off + y, xs_off + x].mean()
                # align on the strongest ON/OFF contrast — where the counter
                # really sits, independent of which digit it shows
                if best is None or on - off > best[0]:
                    best = (on - off, g[ys_o + y, xs_o + x].mean(), on, off)
        if best is None or best[0] < self.LAP_DENOM_MIN_CONTRAST:
            return None
        _, lit, on, off = best
        return float((lit - off) / (on - off))

    def _discriminate(self):
        """For state families (coins, laps, mushrooms) re-sample each template on the
        pixels where the family members DIFFER: the shared chrome (coin icon, flag
        icon) otherwise dominates the mask and makes all candidates correlate.

        (The coin family is read separately via the last-digit reader, see
        _build_coin_last_digit — it still appears here so the counter templates
        also get a whole-counter discriminated sample for the HUD-alive fallback,
        but the actual value comes from read_coins.)"""
        FAMILIES = [
            [f"hud_template.hud_coins_{i:02d}" for i in range(11)],
            [f"hud_template.hud_lap3_{i}" for i in (1, 2, 3)],
            [f"hud_template.hud_lap7_{i}" for i in range(1, 8)],
            [f"hud_template.hud_items_mushrooms_{i}" for i in (3, 2, 1)],
            # cross-family LAST: lap3_1 vs lap7_1 differ only in the
            # denominator digit — without this the arm-time 3/7-lap decision
            # can flip on slightly blurrier live captures
            ["hud_template.hud_lap3_1", "hud_template.hud_lap7_1"],
        ]
        from PIL import Image
        for fam in FAMILIES:
            recs = [r for r in self.db["collections"]["hudTemplates"] if r["id"] in fam]
            imgs = []
            for r in recs:
                img = np.asarray(Image.open(self.root / r["assets"]["template"]["path"]).convert("RGBA"))
                imgs.append((r, img))
            hw = {(i.shape[0], i.shape[1]) for _, i in imgs}
            if len(hw) != 1:
                continue  # sizes differ; keep full-mask sampling
            stack = np.stack([i[:, :, :3].astype(np.int16) for _, i in imgs])
            diff = (stack.max(axis=0) - stack.min(axis=0)).mean(axis=2) > 28
            masks = [(r, img, np.where((img[:, :, 3] > 128) & diff)) for (r, img) in imgs]
            # ALL-OR-NOTHING. Skipping just the members with too few diff pixels
            # left them on a different (larger, chrome-heavy) mask than their
            # resampled siblings, so their scores were no longer comparable —
            # and best_state compares exactly those scores. That is what made
            # lap7_1 beat lap3_1 on every frame of a clear "1/3" (28 usable
            # pixels vs 146). If any member can't be discriminated, the whole
            # family keeps its full masks and stays internally consistent.
            if any(len(ys) < 60 for _, _, (ys, _xs) in masks):
                continue
            for (r, img, (ys, xs)) in masks:
                if len(ys) > MAX_SAMPLE:
                    idx = np.random.RandomState(1).choice(len(ys), MAX_SAMPLE, replace=False)
                    ys, xs = ys[idx], xs[idx]
                for t in self.templates[r["id"]]:
                    t.ys, t.xs = ys, xs
                    px = img[ys, xs, :3].astype(np.float32).flatten()
                    px -= px.mean()
                    t.pixels = px / max(np.linalg.norm(px), 1e-6)

    def set_languages(self, languages=None):
        """Consult only these languages' variants; None consults all of them.

        A record with no variant in any of the given languages (the LAN banner
        exists in two languages only) falls back to its English variant, and
        to all its variants when it has no English one either — a record never
        becomes unmatchable because of the language choice."""
        # Built aside and swapped in whole: the decision can come from the
        # background OCR thread while the capture loop is matching.
        active: dict[str, list[Template]] = {}
        wanted = set(languages or ())
        for rec_id, variants in self.templates.items() if wanted else ():
            if not any(t.lang for t in variants):
                continue
            chosen = [t for t in variants if t.lang in wanted]
            if not chosen:
                chosen = [t for t in variants if t.lang == "en"] or list(variants)
            active[rec_id] = chosen
        self._active = active
        self.active_languages = list(languages) if languages else None

    def variants(self, rec_id):
        """The variants of a record that the current language choice consults."""
        return self._active.get(rec_id) or self.templates[rec_id]

    def variant(self, rec_id):
        """The one variant to use where a single image is needed (a sub-crop):
        the first consulted variant — English first while the language is open."""
        return self.variants(rec_id)[0]

    def language_scores(self, frame, rec_id, search=1):
        """{language: correlation} over ALL language variants of a record."""
        return {t.lang: t.corr(frame, search) for t in self.templates[rec_id] if t.lang}

    def corr(self, frame, rec_id, search=1):
        """Best correlation over the consulted language variants of a template id."""
        if (self.observer is not None and rec_id in self.observed
                and (self.observe_gate is None or self.observe_gate(rec_id))):
            scores = self.language_scores(frame, rec_id, search)
            if scores:
                try:
                    self.observer(rec_id, scores)
                except Exception:
                    pass  # language evidence must never break recognition
                consulted = {t.lang for t in self.variants(rec_id)}
                return max((v for k, v in scores.items() if k in consulted), default=-1.0)
        return max((t.corr(frame, search) for t in self.variants(rec_id)), default=-1.0)

    def match(self, frame, rec_id, thr=0.8, search=1):
        return self.corr(frame, rec_id, search) >= thr

    def best_state(self, frame, rec_ids, thr=0.75, search=0, margin=0.0):
        """Best candidate above thr that also clearly beats the runner-up.

        The margin requirement suppresses near-tie misreads between similar
        digits (3 vs 7, 8 vs 9) when background noise bleeds through the
        translucent HUD: with no clear winner the caller keeps its last value."""
        best_id, best_c, second = None, -1.0, -1.0
        for rid in rec_ids:
            c = self.corr(frame, rid, search)
            if c > best_c:
                best_id, best_c, second = rid, c, best_c
            elif c > second:
                second = c
        if best_c >= thr and best_c - second >= margin:
            return best_id, best_c
        return None, best_c

