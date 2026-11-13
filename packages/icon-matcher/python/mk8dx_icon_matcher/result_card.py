"""One result card, read and decided with the central profile.

Every product hands in the five field crops it located (``None`` when a field
is absent) and the printed text it read; this module produces the shared
evidence, the text context decisions and the result-card decision
(``compose_result_proposal``), identical to the web scanner's for the same
pixels and text. Products only map the decision into their own form.
"""

from __future__ import annotations

import numpy as np

from hashlib import sha256

from .context import Decision, TextClue, combine_character, combine_part
from .field_result import visual_field_result
from .matcher import IconMatcher
from .result_evidence import field_evidence_with_match
from .result_proposal import compose_result_proposal

KIND = {"character": "characters", "kart": "bodies", "wheel": "tires", "glider": "gliders", "flag": "flags"}


def _decision_record(decision: Decision) -> dict:
    return {"id": decision.id, "familyId": decision.family_id, "status": decision.status,
            "evidence": list(decision.evidence), "visualTop1": decision.visual_top1,
            "suggestedId": decision.suggested_id}


def read_result_card(crops: dict, matcher: IconMatcher, *, name_clue: TextClue | None = None,
                     part_clues: dict | None = None, wheel_window=None, flag_window=None,
                     photometric: dict | None = None) -> dict:
    """Return ``{"evidence": owner record, "proposal": {"fields": ...}}`` for one card owner.

    ``wheel_window`` is ``(padded_window_bgr, slot_xywh)`` around the wheel
    slot (at most 10 px each side): the wheel is then read like the web
    scanner, at the fixed slot first and in the window when that is unclear.
    ``flag_window`` is ``(padded_window_bgr, slot_xywh)`` around the flag slot
    (``flag_window.WINDOW_PAD`` each side): the flag is read at the position
    the central flag-window search chooses, in place of ``crops["flag"]``.
    """
    part_clues = part_clues or {}
    owner, matches = {}, {}
    window_match = None
    flag_found = None
    if flag_window is not None:
        from .flag_window import find_flag_crop
        window_bgr, slot = flag_window
        window_bgr = np.ascontiguousarray(window_bgr)
        flag_found = find_flag_crop(window_bgr, tuple(int(v) for v in slot), matcher)
        x, y, w, h = flag_found["cropXywh"]
        crops = {**crops, "flag": window_bgr[y:y + h, x:x + w]}
    for field, kind in KIND.items():
        crop = crops.get(field)
        if crop is None or not getattr(crop, "size", 0):
            continue
        read, match = field_evidence_with_match(np.ascontiguousarray(crop), kind, matcher)
        owner[field] = {"shared_icon_qa": read}
        matches[field] = match
    if flag_found is not None and "flag" in owner:
        owner["flag"]["flag_window_qa"] = flag_found
    if photometric is not None and "flag" in owner:
        # the card's photometric correction (photometric.correct_card) as flag evidence
        owner["flag"]["shared_icon_qa"]["photometric_qa"] = photometric
    if wheel_window is not None and "wheel" in owner:
        window_bgr, slot = wheel_window
        found = matcher.match_tire_window(np.ascontiguousarray(window_bgr), tuple(int(v) for v in slot))
        x, y, w, h = found.crop_xywh
        crop = np.ascontiguousarray(window_bgr[y:y + h, x:x + w])
        read = visual_field_result(found.match, kind="tires", crop_pixel_sha256=sha256(crop.tobytes()).hexdigest(),
                                   catalog_sha256=matcher.references.catalog_sha256)
        owner["wheel"]["tire_window_qa"] = {**read, "windowBasis": found.basis}
        window_match = found.match
    refs = matcher.references
    character = Decision(None, None, "unknown", ("character_unavailable",), None)
    if "character" in matches:
        character = combine_character(matches["character"], name_clue, refs)
        owner["character"]["character_text_qa"] = {
            "schema": "mk8dx.character-text-shadow.v1", "clue": None if name_clue is None
            else {"id": name_clue.id, "fuzzy": name_clue.fuzzy, "margin": name_clue.margin},
            "chosenBasis": "selected", "chosen": _decision_record(character)}
    for field in ("kart", "glider", "wheel"):
        if field not in matches:
            continue
        clue = part_clues.get(field)
        windowed = field == "wheel" and window_match is not None
        chosen = combine_part(KIND[field], window_match if windowed else matches[field], character, clue, refs,
                              tire_text_top3_guard=field == "wheel")
        basis_read = owner[field]["tire_window_qa"] if windowed else owner[field]["shared_icon_qa"]
        owner[field]["part_text_qa"] = {
            "schema": "mk8dx.part-text-shadow.v1", "basis": "tire_window" if windowed else "selected",
            "cropPixelSha256": basis_read["cropPixelSha256"],
            "clue": None if clue is None else {"id": clue.id, "fuzzy": clue.fuzzy, "margin": clue.margin},
            "chosen": _decision_record(chosen)}
    return {"evidence": owner, "proposal": compose_result_proposal(owner)}
