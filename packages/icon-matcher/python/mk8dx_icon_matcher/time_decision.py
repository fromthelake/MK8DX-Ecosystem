"""The central time decision across the fields of one card (CENTRAL_RECOGNITION section 8.6, phase 2c).

One specification in Python (this reference), TypeScript (``ts/sharedTimeDecision.ts``) and Java
(``TimeDecision.java``). The rules the Web scanner and Android each carried, line for line:

* a time reads ``M:SS.mmm`` with seconds 0..59;
* an owner's laps add up to its total (``lap_sum_complete``: every owner that shows times closes,
  and at least one does);
* ``lap_sum_closure``: with exactly one unreadable digit, the one value that closes the sum fills
  it; with every digit read but a sum that does not close, exactly one single-digit change that
  closes it is applied (more than one candidate: nothing changes);
* ``repair_guard``: a sum that closes only after a repair counts as closed only when every digit
  was read with at least 0.65 confidence (two photos can repeat the same compensating misreads).

Pure text logic: the matcher reads the digits, this decides the card.
"""

from __future__ import annotations

DIGIT_POSITIONS = (0, 2, 3, 5, 6, 7)
REPAIR_MIN_DIGIT_CONFIDENCE = 0.65


def _is_digit(ch: str) -> bool:
    return "0" <= ch <= "9"


def format_valid(text: str | None) -> bool:
    if not text or len(text) != 8 or text[1] != ":" or text[4] != ".":
        return False
    if not all(_is_digit(text[pos]) for pos in DIGIT_POSITIONS):
        return False
    return 0 <= int(text[2:4]) <= 59


def time_ms(text: str | None) -> int | None:
    if not format_valid(text):
        return None
    return int(text[0]) * 60000 + int(text[2:4]) * 1000 + int(text[5:8])


def lap_sum_complete(owners: list[dict]) -> bool:
    """``owners``: per owner ``{"total": text | None, "laps": [text, ...]}``."""
    closed = 0
    for owner in owners:
        total_text, laps = owner.get("total"), owner.get("laps") or []
        if total_text is None and not laps:
            continue
        total = time_ms(total_text) if total_text is not None else None
        if total is None or not laps:
            return False
        lap_sum = 0
        for lap in laps:
            ms = time_ms(lap)
            if ms is None:
                return False
            lap_sum += ms
        if lap_sum != total:
            return False
        closed += 1
    return closed > 0


def _replace(text: str, pos: int, ch: str) -> str:
    return text[:pos] + ch + text[pos + 1:]


def _delta(texts: list[str], index: int, replacement: str | None) -> int | None:
    total, lap_sum = 0, 0
    for i, text in enumerate(texts):
        ms = time_ms(replacement if i == index else text)
        if ms is None:
            return None
        if i == 0:
            total = ms
        else:
            lap_sum += ms
    return lap_sum - total


def lap_sum_closure(texts: list[str]) -> dict | None:
    """``texts``: one owner's ``[total, lap1, lap2, ...]``. Returns the single repair that closes
    the sum, ``{"field": index, "pos": position, "from": text, "to": text, "kind": "fill" | "flip"}``,
    or None."""
    if any(not t or len(t) != 8 or t[1] != ":" or t[4] != "." for t in texts):
        return None
    unknown = [(f, pos) for f, text in enumerate(texts) for pos in DIGIT_POSITIONS if not _is_digit(text[pos])]
    if len(unknown) == 1:
        field, pos = unknown[0]
        fits = [str(d) for d in range(10)
                if format_valid(_replace(texts[field], pos, str(d)))
                and _delta(texts, field, _replace(texts[field], pos, str(d))) == 0]
        if len(fits) == 1:
            return {"field": field, "pos": pos, "from": texts[field], "to": _replace(texts[field], pos, fits[0]),
                    "kind": "fill"}
        return None
    if unknown:
        return None
    delta = _delta(texts, -1, None)
    if delta is None or delta == 0:
        return None
    found = None
    count = 0
    for field, text in enumerate(texts):
        for pos in DIGIT_POSITIONS:
            for d in range(10):
                if str(d) == text[pos]:
                    continue
                candidate = _replace(text, pos, str(d))
                if format_valid(candidate) and _delta(texts, field, candidate) == 0:
                    found = {"field": field, "pos": pos, "from": text, "to": candidate, "kind": "flip"}
                    count += 1
    return found if count == 1 else None


def repair_guard(lap_sum_ok: bool, repair_count: int, min_digit_confidence: float) -> dict | None:
    """The guard record when a repaired, closed sum must count as open; None when it stands."""
    if not lap_sum_ok or repair_count == 0 or min_digit_confidence >= REPAIR_MIN_DIGIT_CONFIDENCE:
        return None
    return {"kind": "repair_confidence_guard", "min_digit_confidence": min_digit_confidence,
            "threshold": REPAIR_MIN_DIGIT_CONFIDENCE}
