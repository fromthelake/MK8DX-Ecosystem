"""The central open-set character decision (CENTRAL_RECOGNITION section 8.7): "Mii?".

A Mii is no character the references can hold - a Mii face can look like anything. So nothing
detects a Mii; the reader detects the absence of a clear winner among the known characters and
suggests a Mii (owner, 2026-10-30). One specification in Python (this reference), TypeScript
(``ts/sharedOpenSet.ts``) and Java (``OpenSet.java``):

- only a character field the closed-set decision did not accept can become "Mii?";
- the suggestion is never accepted on one read and carries no size: the id is
  ``character.mii_medium``, the catalog's bare "Mii" (owner, 2026-09-08), shown as "Mii";
- per profile the visual top score must stay below ``maxScore`` and, where set, the gap to the
  best other family below ``maxFamilyMargin``. ``mode`` says what the suggestion does:
  ``propose`` makes "Mii" the proposed value, ``alternative`` offers it beside the best match
  (where unread real characters share the no-clear-winner zone). Profiles without a measured
  threshold never suggest a Mii. The Select-a-Ghost panel shows one generic Mii icon (a real reference), so it
  is closed-set and has no open-set rule.

Measured thresholds (2026-10-30/31, private sets under private-qa/mii-session-20261030):
- ``scoreboard`` (Tournament score rows): top < 0.84 marks 237 of 254 real Mii rows and 0 of
  3000 real characters; the rest are the look-alikes below.
- ``result`` (result cards, photos and HDMI, the 172-card phone baseline): every Mii card read
  without an accepted character had top < 0.81 and a family gap <= 0.010 (12 of 17; the other 5
  were accepted as yellow Yoshi), but so did 5 unread real characters (Dry Bones, Gold Mario,
  Birdo, Pink Gold Peach twice - all already wrong suggestions). So on cards "Mii" is offered as
  an alternative, never proposed over a real character.

``MII_LOOKALIKES``: characters a default Mii face can clear the acceptance bar on (a default Mii
read as Pauline at 0.83 while a real Pauline read 0.83 too). An accepted look-alike stays
accepted here; a product with stronger evidence (Tournament's own lobby face, its decision over
races) may overrule it.
"""

from __future__ import annotations

from typing import Iterable

MII_ID = "character.mii_medium"
MII_LABEL = "Mii"
MII_EVIDENCE = "open_set_mii"
MII_LOOKALIKES = ("character.pauline", "character.champion_link")

PROFILES: dict[str, dict] = {
    "scoreboard": {"maxScore": 0.84, "maxFamilyMargin": None, "mode": "propose"},
    "result": {"maxScore": 0.81, "maxFamilyMargin": 0.012, "mode": "alternative"},
}


def family_margin(top: Iterable) -> float | None:
    """The first score minus the best score of another family; ``top`` is ordered best first and
    holds ``(id, familyId, score)`` triples or dicts with those keys."""
    items = [_triple(item) for item in top]
    if not items:
        return None
    first_family, first_score = items[0][1], items[0][2]
    other = next((score for _id, family, score in items[1:] if family != first_family), None)
    return None if other is None else first_score - other


def mii_suggestion(profile: str, top: Iterable, accepted_id: str | None) -> dict | None:
    """``{"id", "label", "evidence", "mode", "score", "familyMargin"}`` when the read suggests a
    Mii, else ``None``. ``top`` is the visual ranking (best first), ``accepted_id`` the closed-set decision."""
    rule = PROFILES.get(profile)
    items = [_triple(item) for item in top]
    if accepted_id or not rule or rule["maxScore"] is None or not items:
        return None
    score = items[0][2]
    margin = family_margin(items)
    if score >= rule["maxScore"]:
        return None
    if rule["maxFamilyMargin"] is not None and margin is not None and margin >= rule["maxFamilyMargin"]:
        return None
    return {"id": MII_ID, "label": MII_LABEL, "evidence": MII_EVIDENCE, "mode": rule["mode"],
            "score": score, "familyMargin": margin}


# A player's own Mii face (a Tournament lobby slot, LiveTrial's character select) as one extra
# reference: the face pixels are what is not the light card or cell (saturated, or darker).
FACE_MIN_SATURATION = 40
FACE_MAX_VALUE = 170
FACE_MIN_PIXELS = 150
# the face is drawn at a slightly different size than the score-row or card icon
FACE_SCALES = (0.85, 0.92, 1.0, 1.08)


def own_face_reference(crop_bgr):
    """The Mii face on a light background as a BGRA reference (alpha on the face pixels, cut to
    their bounds), or None when the slot holds no face."""
    import cv2
    import numpy as np

    hsv = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2HSV)
    mask = ((hsv[:, :, 1] > FACE_MIN_SATURATION) | (hsv[:, :, 2] < FACE_MAX_VALUE)).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    ys, xs = np.nonzero(mask)
    if len(xs) < FACE_MIN_PIXELS:
        return None
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    bgra = cv2.cvtColor(crop_bgr[y0:y1, x0:x1], cv2.COLOR_BGR2BGRA)
    bgra[:, :, 3] = mask[y0:y1, x0:x1] * 255
    return bgra


def own_face_wins(matcher, crop_bgr, face_bgra, top_score: float, profile: str) -> tuple[bool, float]:
    """The owner's rule: the player's own Mii face as ONE extra candidate next to the character
    references, scored exactly as they are; ``(won, face score)``."""
    score = matcher.score_references(crop_bgr, "characters", [face_bgra], profile=profile, scales=FACE_SCALES,
                                     search_radius=2)
    return score > top_score, score


def _triple(item) -> tuple[str, str, float]:
    if isinstance(item, dict):
        return (str(item.get("id")), str(item.get("familyId") or item.get("family_id") or item.get("id")),
                float(item.get("score")))
    if hasattr(item, "family_id"):
        return (item.id, item.family_id, float(item.score))
    rid, family, score = item
    return (rid, family, float(score))
