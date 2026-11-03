"""The central slot-presence decision (CENTRAL_RECOGNITION section 8.6): whether an icon or flag
slot holds a picture or only flat card background (a profile without a nationality, an empty slot).

One specification in Python (this reference), TypeScript (``ts/sharedSlotPresence.ts``) and Java
(``SlotPresence.java``). The product measures the slot (pixel work) and hands the statistic in; the
decision - which statistic a source uses and the threshold per field - is this module's:

- ``photo`` (Web scanner and Android: phone photos and webcam frames on the canonical card): the
  standard deviation of the slot's grey values (OpenCV BGR2GRAY, then meanStdDev); an icon needs
  21.5, a flag 20.0 (the scanners' contrast gates);
- ``hdmi`` (LiveTrial on the capture card): the mean over the B, G, R channels of each channel's
  spatial standard deviation (a saturated flat colour has a large spread between channels but none
  inside each); a flag needs 40 (empty slots measure 2-9, a small translucent Portugal flag 44).
"""

from __future__ import annotations

PROFILES = {
    "photo": {"statistic": "gray_std", "icon": 21.5, "flag": 20.0},
    "hdmi": {"statistic": "channel_std", "flag": 40.0},
}


def slot_present(source: str, kind: str, value: float) -> dict:
    """``{"present", "statistic", "threshold", "value"}``; ``kind`` is ``icon`` or ``flag``,
    ``value`` the source's statistic. A source without a threshold for the kind accepts the slot."""
    profile = PROFILES[source]
    threshold = profile.get(kind)
    present = threshold is None or value >= threshold
    return {"present": present, "statistic": profile["statistic"], "threshold": threshold, "value": value}
