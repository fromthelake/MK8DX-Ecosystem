"""Console language: which of the Switch's 12 languages this session shows.

Mario Kart 8 Deluxe prints its banners, menus and track names in the
console's system language, and Clean Assets v5.5 carries the language-
dependent HUD templates for all 12 (`consoleLanguages` in database.json). The
engine needs the language for two things:

* which template variants to consult — scoring all 12 on every check costs
  12x and lets another language's artwork match;
* how to read the track name — the OCR reader (script) and the locales of
  `collections.tracks[].names` to match against.

The player chooses the language in the desktop app, or leaves it on automatic.
Automatic detection runs at the start of a session and the result holds until
the session ends: it is never re-decided mid-session.

Evidence (measured 2026-10-27 on one recording per language, all 12):

* The track-confirm screen's option rows (Clean Assets 086-090: Solo, race
  against ghost, view ghost, more ghosts, upload ghost; the text of each row in
  its unselected state). Four of the five are unselected on every
  track-confirm screen, before every run, and each puts the console's own
  language on top: 0.99-1.0 for its own text, 0.29-0.83 ahead of the next
  language, simplified and traditional Chinese included; across every confirm
  frame of the 12 recordings no row named a wrong language and no other
  screen gave any evidence. This is the main evidence.
* Templates. The finish banners (won, lost, new record, solo finish), the
  new-ghost footer and the ghost-replay menu rows put the console's own
  language on top in every recording, 0.15–0.73 ahead of the best other
  language. Languages that share the artwork tie exactly (ja/ko/zh-cn/zh-tw
  show the English banners; de and nl share GEWONNEN!/VERLOREN; nl and en
  share FINISH!), so a template narrows the candidates to a group. GO!,
  "Start Replay?" OK and View Ghost are left out: their margins are 0.03–0.06
  and they matched a wrong language at 0.81–0.89.
* Nameplates (Clean Assets v5.7, nameplates.py). The name banner of the cup,
  character and vehicle screens and the cup screen's track labels are
  matched against the printed-name masks of every language's game locales; a
  decided match names the languages that print exactly that text (measured on
  the 2026-10-28 walks of all 15 game locales scaled to 720p: 4511 crops gave
  evidence, none without the console's language; 295 stayed undecided). Only
  the crops the nameplates leave undecided go on to the OCR below.
* Menu text OCR. Each script's reader (Latin, Cyrillic, Japanese, Korean,
  simplified and traditional Chinese) reads the names the menus print - the
  four track names and the name banner of the cup screen, the character (and
  part) name in the same banner on the select screens, the track name on the
  track-confirm and ghost menus - and is matched against that language's
  names in Clean Assets; a reader that matches clearly excludes the scripts
  that do not. This runs in a background thread so the capture loop never
  waits for it.

All evidence is gathered in the menus only (owner 2026-10-27): while the
countdown and the race run - and the race is being recorded - the engine
scores no other languages, it only consults the candidates still open. A
session started before the track is chosen is therefore usually decided
before its first race.

The language is decided only when one candidate is left AND evidence from at
least two different frames supports it. Until then the engine consults the
English and Dutch variants it always used (so an undecided session behaves
exactly as before) plus whatever group the evidence has narrowed to.

One exception to "kept until the session ends": changing the Switch's
language restarts the game, so a capture left running across that change
would keep a language the screen no longer shows (a recording of 2026-10-27
began on the French menus and continued in Spanish). A *detected* language is
therefore re-opened when template evidence from three different frames,
spanning at least 0.3 s, excludes it with no supporting evidence in between;
a chosen language never is. After the decision the templates are still
observed for exactly this check: four times a second, and on every check while
a contradiction is pending (a banner is on screen for about a second only).
"""

from __future__ import annotations

import difflib
import re
import threading
import time
import unicodedata

T = "hud_template."
# Records whose per-language scores count as evidence (see the module note).
CONFIRM_ROWS = tuple(T + s for s in (
    "menu_confirm_solo_not_selected", "menu_confirm_ghost_race_not_selected",
    "menu_confirm_view_ghost_not_selected", "menu_confirm_more_ghosts_not_selected",
    "menu_confirm_upload_ghost_not_selected",
))
EVIDENCE_TEMPLATES = frozenset(CONFIRM_ROWS) | frozenset(T + s for s in (
    "finish_banner_won", "finish_banner_lost", "finish_banner_new_record", "finish_banner_finish",
    "sidebar_ghost_footer",
    "ghost_replay_continue_replay_selected", "ghost_replay_continue_replay_not_selected",
    "ghost_replay_replay_from_start_selected", "ghost_replay_replay_from_start_not_selected",
    "ghost_replay_race_against_ghost_selected", "ghost_replay_race_against_ghost_not_selected",
    "ghost_replay_quit_replay_selected", "ghost_replay_quit_replay_not_selected",
))
EVIDENCE_MIN = 0.80        # the best language must reach this...
EVIDENCE_MARGIN = 0.15     # ...and lead every language outside its tie by this
TIE = 0.01                 # identical artwork scores identically

REOPEN_FRAMES = 3          # contradicting frames that re-open a detected language...
REOPEN_SPAN_MS = 300       # ...spread over at least this long (not one glitch)
OBSERVE_EVERY_MS = 250     # observation rate once the language is detected

OCR_MIN = 0.75             # a read must match a name this well to count...
OCR_EXCLUDE = 0.30         # ...and excludes languages scoring this much lower;
OCR_CLEAR = 0.95           # a clear read (Latin names differ by a letter or two)
OCR_CLEAR_EXCLUDE = 0.08   # excludes everything this much lower
OCR_EVERY_MS = 1500
OCR_VERIFY_EVERY_MS = 10000  # a detected language is re-read this often in the menus
NAMEPLATE_EVERY_MS = 250   # menu names matched against the nameplates at most this often
MIN_CONTAINED = 4          # a name this long inside a read counts (a colour variant's base name)
NAME_COLLECTIONS = ("characters", "vehicleBodies", "vehicleTires", "vehicleGliders", "cups")

LEGACY_LANGUAGES = ("en", "nl")
LEGACY_TRACK_LOCALES = ("en-US", "en-GB", "nl-NL")
LATIN = frozenset({"en", "nl", "de", "fr", "es", "it", "pt"})
# EasyOCR language lists per reader. The Latin reader serves the seven Latin
# languages; every other script pairs with English, as EasyOCR requires.
OCR_READERS = {
    "latin": ["en", "nl", "de", "fr", "es", "it", "pt"],
    "ru": ["ru", "en"],
    "ja": ["ja", "en"],
    "ko": ["ko", "en"],
    "zh-cn": ["ch_sim", "en"],
    "zh-tw": ["ch_tra", "en"],
}
DEFAULT_LANGUAGE = "en"
AUTO = "auto"


def reader_key(code: str) -> str:
    return "latin" if code in LATIN else code


def normalize_name(text: str) -> str:
    """Compare names the way OCR can see them: case-, width-, space- and
    punctuation-blind, and blind to the Japanese voicing marks (ジ vs シ),
    which the reader drops on the small banner font."""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c) and c not in "゙゚")
    return re.sub(r"[\W_]+", "", text.casefold())


def catalog_languages(db: dict) -> list[dict]:
    """`consoleLanguages.languages` from database.json (the console's order)."""
    return list((db.get("consoleLanguages") or {}).get("languages") or [])


class ConsoleLanguage:
    """The session's console language: chosen, or detected once at the start."""

    def __init__(self, tdb, choice: str = AUTO, ocr_probe=None, on_change=None):
        self.tdb = tdb
        self.catalog = {entry["code"]: entry for entry in catalog_languages(getattr(tdb, "db", None) or {})}
        known = list(getattr(tdb, "languages", None) or ())
        self.all = [code for code in self.catalog if code in known] or known or [DEFAULT_LANGUAGE]
        # Clean Assets v5.7 adds the American variants of the English, French and
        # Spanish templates (en-us, fr-ca, es-419: system region The Americas).
        # They belong to their console language: evidence from them counts for
        # it, and a decided language consults them too.
        self.regional = {code: [lang for lang in known if lang not in self.catalog
                                and lang.split("-")[0] == code] for code in self.all}
        self._console_of = {lang: code for code, langs in self.regional.items() for lang in langs}
        self.choice = choice if choice == AUTO or choice in self.all else AUTO
        self.on_change = on_change
        self.ocr_probe = ocr_probe
        self._lock = threading.Lock()
        self.ms = 0
        self.in_menu = True
        self.evidence: list[dict] = []   # newest last, capped
        self._support: set[int] = set()  # frames (ms) whose evidence the candidates rest on
        self._ocr_ms = -10 ** 9
        self._plate_ms = -10 ** 9
        self._observe_ms: dict[str, int] = {}   # per record: one busy record must not starve another
        self._conflict_frames: dict[int, set] = {}
        self.conflicts = 0
        self.reopened = 0
        self._allow: dict = {}
        if self.choice == AUTO:
            self.code = None
            self.status = "detecting"
            self.candidates = list(self.all)
            tdb.observed = EVIDENCE_TEMPLATES
            tdb.observer = self._observe_template
            tdb.observe_gate = self._observe_now
            self._apply()
        else:
            self._decide(self.choice, "manual")

    # -- what the engine asks ------------------------------------------------

    def tick(self, ms: int, in_menu: bool = True) -> None:
        self.ms = ms
        self.in_menu = in_menu

    @property
    def decided(self) -> bool:
        return self.code is not None

    @property
    def observing(self) -> bool:
        """True while language evidence matters: undecided, or detected (re-open check)."""
        return self.code is None or self.status == "detected"

    def assumed(self) -> str:
        """The language to act on now: decided, else the single candidate, else English."""
        if self.code:
            return self.code
        return self.candidates[0] if len(self.candidates) == 1 else DEFAULT_LANGUAGE

    def track_locales(self) -> tuple[str, ...]:
        """Locales of the track names to match an OCR read against. English and
        Dutch keep exactly the set the engine always used."""
        code = self.code
        if code is None or code in LEGACY_LANGUAGES:
            return LEGACY_TRACK_LOCALES
        own = tuple(self.catalog.get(code, {}).get("textLocales") or ())
        return own + tuple(loc for loc in ("en-US", "en-GB") if loc not in own)

    def name_locales(self) -> list[str] | None:
        """Preferred locales for printed character names (identity.set_locales),
        None to keep the engine's default. English and Dutch keep the default."""
        code = self.code
        if code is None or code in LEGACY_LANGUAGES:
            return None
        own = list(self.catalog.get(code, {}).get("textLocales") or ())
        return own + [loc for loc in ("en-US", "en-GB") if loc not in own]

    def track_allowlist(self) -> str:
        """Characters of the decided language's own track names (they carry the
        console prefixes and digits) — what its reader may output. Adding the
        English names let Latin letters in again (马nI赛a for 马力欧赛道)."""
        if self.code not in self._allow:
            names = (getattr(self.tdb, "db", None) or {}).get("collections", {}).get("tracks") or []
            locales = list(self.catalog.get(self.code or "", {}).get("textLocales") or ())
            self._allow[self.code] = "".join(sorted({c for t in names for loc in locales
                                                     for c in (t.get("names") or {}).get(loc, "")}))
        return self._allow[self.code]

    def track_reader(self):
        """A reader for the track name when the decided language needs its own
        script, else None (the engine's Latin reader stays in charge)."""
        if self.code is None or reader_key(self.code) == "latin" or self.ocr_probe is None:
            return None
        return self.ocr_probe.reader_for(self.code)

    def wants_ocr(self) -> bool:
        """Menu text to read now? Every 1.5 s while open; every 10 s once
        detected (the re-open check); never for a chosen language."""
        if self.ocr_probe is None or not self.in_menu or not self.observing:
            return False
        every = OCR_EVERY_MS if self.code is None else OCR_VERIFY_EVERY_MS
        return self.ms - self._ocr_ms >= every

    def wants_nameplates(self) -> bool:
        """Menu names to match against the nameplates now? At most four times a
        second while the language is open or detected; never for a chosen one."""
        if not self.in_menu or not self.observing:
            return False
        return self.ms - self._plate_ms >= NAMEPLATE_EVERY_MS

    def submit_nameplate(self, hit: dict) -> None:
        """A menu name the nameplates decided (nameplates.crop_languages): the
        languages that print exactly that name, from one frame."""
        self._plate_ms = self.ms
        self._narrow(set(hit["languages"]), {"source": "nameplate", "ms": self.ms,
                                             "languages": list(hit["languages"]), "score": hit["score"],
                                             "read": hit["text"][:80], "ids": list(hit["ids"])[:4],
                                             "locale": hit["locale"]})

    def nameplates_checked(self) -> None:
        self._plate_ms = self.ms

    def submit_ocr(self, crop) -> None:
        """Hand a track-name strip to the background probe (never blocks)."""
        self.submit_menu_text([(crop, "tracks")])

    def submit_menu_text(self, crops) -> None:
        """Hand menu text crops [(image, "tracks" | "names")] to the background
        probe (never blocks); one batch per OCR_EVERY_MS."""
        if not self.wants_ocr() or not crops:
            return
        self._ocr_ms = self.ms
        with self._lock:
            # a verification read scores every language, else only the open ones
            candidates = list(self.candidates) if self.code is None else list(self.all)
        self.ocr_probe.submit(crops, candidates, self.ms, self._observe_ocr)

    def state(self) -> dict:
        with self._lock:
            code = self.code
            shown = code or (self.candidates[0] if len(self.candidates) == 1 else None)
            entry = self.catalog.get(shown or "", {})
            return {
                "choice": self.choice,
                "code": code,
                "status": self.status,
                "candidates": list(self.candidates),
                "label": entry.get("label"),
                "flag": entry.get("flag"),
                "evidence": [dict(e) for e in self.evidence[-8:]],
                "conflicts": self.conflicts,
                "reopened": self.reopened,
            }

    # -- evidence -------------------------------------------------------------

    def _observe_now(self, rec_id: str = "") -> bool:
        """Only in the menus. There: every check while undecided or while a
        contradiction is pending; otherwise each record at most every 250 ms."""
        if not self.in_menu:
            return False
        if self.code is None or self._conflict_frames:
            return True
        if self.ms - self._observe_ms.get(rec_id, -10 ** 9) < OBSERVE_EVERY_MS:
            return False
        self._observe_ms[rec_id] = self.ms
        return True

    def _observe_template(self, rec_id: str, scores: dict) -> None:
        folded: dict = {}
        for lang, value in scores.items():
            code = self._console_of.get(lang, lang)
            folded[code] = max(value, folded.get(code, value))
        scores = folded
        group = _evidence_group(scores, EVIDENCE_MIN, EVIDENCE_MARGIN)
        if group is None:
            return
        self._narrow(set(group), {"source": rec_id.split(".")[-1], "ms": self.ms,
                                  "languages": sorted(group), "score": round(max(scores.values()), 3)})

    def _observe_ocr(self, scores: dict, ms: int, raw: dict) -> None:
        if not scores:
            return
        best = max(scores.values())
        if best < OCR_MIN:
            return
        clear = best >= OCR_CLEAR
        keep = {code for code, value in scores.items()
                if value > best - (OCR_CLEAR_EXCLUDE if clear else OCR_EXCLUDE)}
        # languages the probe did not score (already excluded) stay as they are
        keep |= {code for code in self.all if code not in scores}
        top = max(scores, key=scores.get)
        self._narrow(keep, {"source": "menu_text_ocr", "ms": ms, "languages": sorted(keep & set(scores)),
                            "score": round(best, 3), "clear": clear, "read": raw.get(top, "")[:80],
                            "reader": reader_key(top)})

    def _narrow(self, group: set, event: dict) -> None:
        decide, reopened = None, False
        with self._lock:
            if self.code is None:
                decide = self._narrow_open(group, event)
            elif self.status == "detected" and (event.get("source") != "menu_text_ocr" or event.get("clear")):
                reopened = self._contradict(group, event)
                if reopened and len(self.candidates) == 1:
                    decide = self.candidates[0]
        if decide:
            self._decide(decide, "detected")
            return
        self._apply()
        if reopened and self.on_change is not None:
            try:
                self.on_change(self.state())
            except Exception:
                pass

    def _narrow_open(self, group: set, event: dict):
        """Narrow the open candidates (lock held); the code to decide, or None."""
        self.evidence.append(event)
        del self.evidence[:-40]
        narrowed = [code for code in self.candidates if code in group]
        if not narrowed:
            # contradiction before a decision: the newer evidence restarts it
            narrowed = [code for code in self.all if code in group]
            self._support = set()
        self._support.add(event["ms"])
        self.candidates = narrowed
        if len(narrowed) == 1 and len(self._support) >= 2:
            return narrowed[0]
        return None

    def _contradict(self, group: set, event: dict) -> bool:
        """Evidence about a detected language (lock held); True when it re-opens."""
        if self.code in group:
            self._conflict_frames = {}   # supported again
            return False
        self.conflicts += 1
        self.evidence.append(event)
        del self.evidence[:-40]
        self._conflict_frames[event["ms"]] = set(group)
        frames = sorted(self._conflict_frames)
        if len(frames) < REOPEN_FRAMES or frames[-1] - frames[0] < REOPEN_SPAN_MS:
            return False
        # the screen no longer shows the detected language: decide again
        common = set.intersection(*self._conflict_frames.values())
        self.code = None
        self.status = "detecting"
        self.candidates = [code for code in self.all if code in common] or list(self.all)
        self._support = set(self._conflict_frames)
        self._conflict_frames = {}
        self.reopened += 1
        return True

    def _decide(self, code: str, status: str) -> None:
        with self._lock:
            self.code = code
            self.status = status
            self.candidates = [code]
            self._conflict_frames = {}
        if status != "detected":
            # a chosen language is trusted: nothing to observe
            self.tdb.observer = None
            self.tdb.observed = frozenset()
        self._apply()
        if self.ocr_probe is not None and status != "detected":
            self.ocr_probe.keep_only(code)
        if self.on_change is not None:
            try:
                self.on_change(self.state())
            except Exception:
                pass

    def _apply(self) -> None:
        """Point the template database at the variants to consult now."""
        if not hasattr(self.tdb, "set_languages"):
            return   # a template source without language variants
        if self.code is not None:
            self.tdb.set_languages(self._with_regional([self.code]))
        elif len(self.candidates) == len(self.all):
            self.tdb.set_languages(list(LEGACY_LANGUAGES))
        else:
            self.tdb.set_languages(self._with_regional(self.candidates))

    def _with_regional(self, codes):
        return list(codes) + [lang for code in codes for lang in self.regional.get(code, ())]


def _evidence_group(scores: dict, minimum: float, margin: float):
    """The languages tied at the top, when the top is high and clear; else None."""
    if not scores:
        return None
    best = max(scores.values())
    if best < minimum:
        return None
    group = [code for code, value in scores.items() if value >= best - TIE]
    rest = [value for code, value in scores.items() if code not in group]
    if rest and best - max(rest) < margin:
        return None
    return group


class OcrProbe:
    """Reads track-name strips with each script's reader in a background thread.

    One job at a time: a new strip replaces one still waiting. Readers load on
    first use (2–20 s each, from the EasyOCR model folder) and are dropped once
    the language is decided, except the decided language's own reader."""

    def __init__(self, db: dict, reader_factory=None):
        self.db = db
        self._factory = reader_factory or _easyocr_reader
        self._readers: dict[str, object] = {}
        self._reader_lock = threading.Lock()
        self._job = None
        self._wake = threading.Condition()
        self._stopped = False
        # per language: normalised name -> id, for track names and for the
        # other printed names (characters, parts, cups)
        self._names: dict[str, dict[str, dict[str, str]]] = {}
        collections = db.get("collections") or {}
        for entry in catalog_languages(db):
            vocab = {"tracks": {}, "names": {}}
            for kind, sources in (("tracks", ("tracks",)), ("names", NAME_COLLECTIONS)):
                for source in sources:
                    for item in collections.get(source) or []:
                        for loc in entry.get("textLocales") or ():
                            name = (item.get("names") or {}).get(loc)
                            if name and normalize_name(name):
                                vocab[kind][normalize_name(name)] = item["id"]
            self._names[entry["code"]] = vocab
        self._thread = threading.Thread(target=self._run, name="console-language-ocr", daemon=True)
        self._thread.start()

    def submit(self, crops, candidates, ms, deliver) -> None:
        with self._wake:
            self._job = (list(crops), list(candidates), ms, deliver)
            self._wake.notify()

    def stop(self) -> None:
        with self._wake:
            self._stopped = True
            self._wake.notify()

    def keep_only(self, code: str) -> None:
        with self._reader_lock:
            keep = reader_key(code)
            for key in [k for k in self._readers if k != keep]:
                del self._readers[key]

    def reader_for(self, code: str):
        key = reader_key(code)
        with self._reader_lock:
            if key not in self._readers:
                self._readers[key] = self._factory(OCR_READERS[key])
            return _Locked(self._readers[key], self._reader_lock)

    def score(self, crops, candidates) -> tuple[dict, dict]:
        """{language: mean name-match ratio over the crops that read as text},
        {language: the reads, joined}. `crops` is [(image, "tracks" | "names")]."""
        totals: dict = {}
        raws: dict = {}
        for crop, kind in crops:
            texts, ratios = {}, {}
            for code in candidates:
                key = reader_key(code)
                if key not in OCR_READERS or code not in self._names:
                    continue
                if key not in texts:
                    with self._reader_lock:
                        reader = self._readers.get(key)
                        if reader is None:
                            reader = self._readers[key] = self._factory(OCR_READERS[key])
                        texts[key] = " ".join(r[1] for r in reader.readtext(crop))
                raw = texts[key]
                if len(normalize_name(raw)) < 2:
                    continue
                ratios[code] = match_ratio(raw, self._names[code].get(kind, {}))
                raws[code] = (raws.get(code, "") + " | " + raw).strip(" |")
            # a crop no language reads as one of its names (a cup name outside
            # en/nl, a transition frame) says nothing about the language
            if ratios and max(ratios.values()) >= OCR_MIN:
                for code, value in ratios.items():
                    totals.setdefault(code, []).append(value)
        scores = {code: round(sum(values) / len(values), 3) for code, values in totals.items()}
        return scores, raws

    def _run(self) -> None:
        while True:
            with self._wake:
                while self._job is None and not self._stopped:
                    self._wake.wait()
                if self._stopped:
                    return
                crop, candidates, ms, deliver = self._job
                self._job = None
            try:
                scores, raws = self.score(crop, candidates)
                deliver(scores, ms, raws)
            except Exception as error:  # a reader that cannot load is no evidence
                print(f"[livetrial] console-language OCR unavailable ({type(error).__name__})", flush=True)
                time.sleep(5)


class _Locked:
    """A reader whose readtext holds the probe's lock (the probe thread shares it)."""

    def __init__(self, reader, lock):
        self._reader, self._lock = reader, lock

    def readtext(self, *args, **kwargs):
        with self._lock:
            return self._reader.readtext(*args, **kwargs)


GLYPH_WHITE = 200   # banner names are white glyphs with a dark outline on a blue gradient


def glyph_image(crop, upscale: int = 2):
    """The banner's white glyphs as black text on white, enlarged: what the
    non-Latin readers read best. Measured on the language recordings with each
    language's own character set: zh-cn 0.67-0.89 -> 1.0 on every frame
    (马D欧赛圈 -> 马力欧赛道), zh-tw 0.88 -> 1.0, ja 0.86 -> 1.0, ko 0.95 -> 1.0,
    ru 0.94 -> 1.0, none worse."""
    import cv2
    import numpy as np
    grey = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY) if crop.ndim == 3 else crop
    text = np.where(grey > GLYPH_WHITE, 0, 255).astype(np.uint8)
    text = cv2.copyMakeBorder(text, 10, 10, 10, 10, cv2.BORDER_CONSTANT, value=255)
    return cv2.resize(text, None, fx=upscale, fy=upscale, interpolation=cv2.INTER_NEAREST)


def match_ratio(raw: str, names: dict[str, str]) -> float:
    text = normalize_name(raw)
    if len(text) < 2 or not names:
        return 0.0
    if text in names:
        return 1.0
    best = max(difflib.SequenceMatcher(None, text, name).ratio() for name in names)
    # a printed colour variant carries its base name (Gelber Yoshi, kiiro Yoshi)
    if any(len(name) >= MIN_CONTAINED and name in text for name in names):
        best = max(best, 0.9)
    return round(best, 3)


def _easyocr_reader(languages):
    import easyocr
    return easyocr.Reader(languages, gpu=False, verbose=False)
