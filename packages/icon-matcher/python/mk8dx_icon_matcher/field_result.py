"""Stable source-candidate output for a visual read of one certified ROI.

The caller owns acquisition and crop geometry. Context (name/part relation)
may later change the final decision; this record preserves the visual trace.
"""

from __future__ import annotations

from math import isfinite

from .matcher import MatchResult


def visual_field_result(result: MatchResult, *, kind: str, crop_pixel_sha256: str,
                        catalog_sha256: str) -> dict:
    if kind not in ("characters", "bodies", "tires", "gliders", "flags"):
        raise ValueError("Unsupported recognition field")
    if result.status not in ("accepted", "unknown", "absent"):
        raise ValueError("Unsupported visual status")
    if not isfinite(result.score) or not isfinite(result.margin):
        raise ValueError("Nonfinite visual score")
    if (result.status == "accepted") != (result.id is not None):
        raise ValueError("Accepted status and ID disagree")
    if result.status == "absent" and result.top:
        raise ValueError("Absent field cannot have ranked candidates")
    if result.status != "absent" and not result.top:
        raise ValueError("Visible field needs ranked candidates")
    if result.id is not None and result.id != result.top[0].id:
        raise ValueError("Accepted ID must be the visual first choice")
    for value in (crop_pixel_sha256, catalog_sha256):
        if len(value) != 64 or any(char not in "0123456789abcdef" for char in value):
            raise ValueError("Expected lowercase SHA-256")
    return {"schema": "mk8dx.visual-field-read.v1", "kind": kind,
            "profile": result.profile, "method": result.method,
            "catalogSha256": catalog_sha256, "cropPixelSha256": crop_pixel_sha256,
            "status": result.status, "top1Id": result.top[0].id if result.top else None,
            "acceptedId": result.id, "score": result.score, "margin": result.margin,
            "offset": list(result.offset),
            "top": [{"id": item.id, "familyId": item.family_id, "score": item.score}
                    for item in result.top]}
