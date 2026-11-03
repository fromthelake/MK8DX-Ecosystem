"""Name-strip logic: cross-frame voting, vocabulary snapping, language order.

Pure logic — no easyocr, no frames — so it runs anywhere and fast. The pixel
half (does the ROI actually read the card?) is covered by _endscreen_check.py
against real stills; this covers the decisions made ON a read, which is where
the field went wrong historically:

  - 'longest read wins' let a trackside billboard beat the real name
  - a 0.78 fuzzy match over all 14 locales let text overrule a confident icon
  - the star in 'Nin*Joost' has no stable OCR, so per-glyph regexes never end

    python livetrial/tests/test_names.py
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import livetrial.identity as I  # noqa: E402


def vote_prefers_consensus_over_length():
    """The regression that started this: 'Vin;~Sophia GOLDENW' is LONGER than
    'Nin*Sophia' because a billboard bled through the translucent ghost card,
    and longest-wins therefore picked the contaminated read every time."""
    got = I._vote_name({"Nin★Sophia": 3, "Vin;~Sophia GOLDENW": 3})
    return [] if got == "Nin★Sophia" else [f"tie elected {got!r}"]


def vote_takes_the_majority():
    got = I._vote_name({"Bowser": 5, "3owser": 2})
    return [] if got == "Bowser" else [f"majority elected {got!r}"]


def vote_medoid_breaks_a_scatter():
    """No majority: three frames, three different reads. The central one wins —
    OCR noise lands in different places per frame, so the candidate closest to
    all the others is the one the frames actually agree about."""
    got = I._vote_name({"Nin★Chris": 1, "Nin★Chns": 1, "Vin★Chris": 1})
    return [] if got == "Nin★Chris" else [f"medoid elected {got!r}"]


def vote_empty_is_none():
    return [] if I._vote_name({}) is None else ["empty vote did not return None"]


def staff_ghost_names_snap_to_the_database():
    """The star OCRs as space / k / ^ / ' on real cards. Matching the whole
    string against the 31 known staff names beats a regex per glyph."""
    rd = I.IdentityReader()
    cases = [("Nin Joost", "Nin★Joost"), ("Nin kChris", "Nin★Chris"),
             ("Nin' Sophia", "Nin★Sophia"), ("Nin ^ Mitsu", "Nin★Mitsu")]
    errs = []
    for raw, want in cases:
        got = rd._staff_name_snap(raw)
        if got != want:
            errs.append(f"{raw!r} -> {got!r}, expected {want!r}")
    return errs


def human_ghost_names_are_never_rewritten():
    """A real player must never be renamed into a staff ghost. Measured tops
    out at 0.353 for these against any Nin* name, far under the 0.78 gate."""
    rd = I.IdentityReader()
    errs = []
    for raw in ("Valerio", "BEnZor", "Ben", "3ENZor", "Sophia"):
        got = rd._staff_name_snap(raw)
        if got is not None:
            errs.append(f"human name {raw!r} was rewritten to {got!r}")
    return errs


def staff_snap_requires_time_proof():
    """A name alone must never make a ghost a staff ghost — players choose
    their own names. Three facts must agree: the total equals the database
    staff time exactly, the lap times were read and sum to it, and the loadout
    matches. Verified against the real 200cc Mario Kart Stadium run (card
    OCR'd 81984 ms; database holds 81984 ms; Gold Mario / Gold Kart / Gold
    Wheels / Gold Glider)."""
    rd = I.IdentityReader()
    T, C, MS = "track.mario_kart_stadium", "200", 81984
    LAPS = [28960, 26813, 26211]
    LOAD = {"characterId": "character.gold_mario", "bodyId": "body.gold_kart",
            "tireId": "tire.gold_wheels", "gliderId": "glider.gold_glider"}
    errs = []
    if not rd.is_staff_ghost(T, C, MS, LAPS, LOAD):
        errs.append("the genuine staff ghost was rejected")
    checks = [
        (dict(total_ms=81985), "1 ms off the staff total"),
        (dict(total_ms=82120), "the player's own time"),
        (dict(lap_times_ms=[28960, 26813, 26210]), "lap times that do not sum to the total"),
        (dict(lap_times_ms=[28960, None, 26211]), "a lap that was never read"),
        (dict(lap_times_ms=[]), "no lap times at all"),
        (dict(loadout={"characterId": "character.mario"}), "a loadout that disagrees"),
        (dict(cc="150"), "the 200cc time against the 150cc record"),
        (dict(track_id=None), "an unknown track"),
    ]
    # a COLOUR variant is the same part: the colour follows the character, so
    # the database's base id and the matcher's variant id agree
    if not rd.is_staff_ghost(T, C, MS, LAPS,
                             dict(LOAD, bodyId="body_variant.gold_kart.001_x")):
        errs.append("a colour variant of the right kart was treated as a mismatch")
    for over, why in checks:
        kw = dict(track_id=T, cc=C, total_ms=MS, lap_times_ms=LAPS, loadout=LOAD)
        kw.update(over)
        if rd.is_staff_ghost(**kw):
            errs.append(f"accepted {why}")
    return errs


def language_order_shrinks_the_vocabulary():
    """The point of the console-language setting: fewer strings, fewer of them
    colliding with a name that belongs to a DIFFERENT character."""
    rd = I.IdentityReader()
    all_v = rd._character_names(None)
    nl = rd._character_names(["nl-NL", "en-US"])
    errs = []
    if len(all_v) < 600:
        errs.append(f"full vocabulary unexpectedly small ({len(all_v)})")
    if not (0 < len(nl) < len(all_v) / 3):
        errs.append(f"nl-NL+en-US vocabulary {len(nl)} not much smaller than {len(all_v)}")
    return errs


def unknown_locale_falls_back_not_breaks():
    """A wrong or unset language must never make a name unreadable."""
    rd = I.IdentityReader()
    saved = I.PREFERRED_LOCALES
    try:
        I.set_locales(["xx-XX"])
        hit = rd._name_strip_override("Bowser")
        if not hit or hit[0] != "character.bowser":
            return [f"bogus locale broke the lookup: {hit}"]
    finally:
        I.set_locales(saved)
    return []


def ambiguous_name_resolves_to_nothing():
    """Two different characters equally plausible -> no answer, not a coin
    flip. 'aldeano'/'aldeana' (Villager male/female in Spanish) is the pair
    that motivated the margin."""
    rd = I.IdentityReader()
    saved = I.PREFERRED_LOCALES
    try:
        I.set_locales(["es-ES"])
        hit = rd._name_strip_override("aldean")
        if hit is not None:
            return [f"ambiguous 'aldean' resolved to {hit[0]} (should be None)"]
    finally:
        I.set_locales(saved)
    return []


def player_name_resolves_with_a_garbled_read():
    """The whole point of snapping: 'Drv Bowser' and 'sahelle' are what the OCR
    really returns, and both must land on the right character."""
    rd = I.IdentityReader()
    errs = []
    for raw, want in (("Drv Bowser", "character.dry_bowser"), ("sahelle", "character.isabelle")):
        hit = rd._name_strip_override(raw)
        if not hit or hit[0] != want:
            errs.append(f"{raw!r} -> {hit[0] if hit else None}, expected {want}")
    return errs


def colour_names_resolve_to_their_variant():
    """'White Shv Guv' is a real OCR read of White Shy Guy: the printed colour name resolves to
    the variant. Which of name and icon wins is the central decision's (read_result_card takes the
    name as its clue); the previous app-side override rules were removed with the previous reader
    (2026-10-30)."""
    rd = I.IdentityReader()
    hit = rd._name_strip_override("White Shv Guv")
    if not hit:
        return ["White Shy Guy OCR did not resolve"]
    return [] if hit[0] == "character_variant.shy_guy.032_white" else [f"resolved to {hit[0]}, expected white Shy Guy"]


def plain_family_name_means_the_plain_colour():
    """Owner card 2026-09-07: the Dutch strip read 'Inkline-ioneen' (Inkling-jongen), a name every
    Inkling Boy colour shares in every locale. A shared name resolves to the BASE character."""
    rd = I.IdentityReader()
    errs = []
    hit = rd._name_strip_override("Inkline-ioneen")
    if not hit:
        return ["Inkling-jongen OCR did not resolve"]
    cid, _ratio, disp = hit
    if cid != "character.inkling_boy":
        errs.append(f"shared family name resolved to {cid}, expected the base character")
    if disp != "Inkling-jongen":
        errs.append(f"display name {disp!r}")
    return errs


CASES = [vote_prefers_consensus_over_length, vote_takes_the_majority,
         vote_medoid_breaks_a_scatter, vote_empty_is_none,
         staff_ghost_names_snap_to_the_database, human_ghost_names_are_never_rewritten,
         staff_snap_requires_time_proof, language_order_shrinks_the_vocabulary, unknown_locale_falls_back_not_breaks,
         ambiguous_name_resolves_to_nothing, player_name_resolves_with_a_garbled_read,
         colour_names_resolve_to_their_variant,
         plain_family_name_means_the_plain_colour]


def run() -> int:
    failed = 0
    for fn in CASES:
        try:
            errs = fn()
        except Exception as e:  # noqa: BLE001
            import traceback
            errs = [f"exception: {e!r}", traceback.format_exc().splitlines()[-3].strip()]
        if errs:
            failed += 1
            print(f"  FAIL {fn.__name__}")
            for e in errs:
                print(f"         {e}")
        else:
            print(f"  ok   {fn.__name__}")
    print(f"\nname handling: {len(CASES) - failed}/{len(CASES)} cases pass")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(run())
