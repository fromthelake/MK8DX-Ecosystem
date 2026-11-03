"""Open family/colour ranking from same-frame character candidates."""

from __future__ import annotations

import cv2
import numpy as np

from .matcher import Kind, ReferenceBank


def rank_part_subset(crop_bgr: np.ndarray, kind: Kind,
                     characters: tuple[str, ...], references: ReferenceBank) -> dict:
    """Rank catalog-related variants; do not turn the result into acceptance."""
    if kind not in ("bodies", "gliders") or crop_bgr is None or crop_bgr.ndim != 3 \
            or crop_bgr.shape[2] != 3 or crop_bgr.size == 0:
        raise ValueError("Expected a BGR body or glider crop")
    candidates = tuple(dict.fromkeys(characters))[:3]
    if not candidates or any(character not in references.family for character in candidates):
        raise ValueError("Expected same-frame catalog character candidates")
    group = references.groups[(kind, "result")]
    bases = [rid for rid, family in zip(group.ids, group.families) if rid == family]
    allowed = {references.part_for_character.get((kind, base, character), base)
               for character in candidates for base in bases}
    indices = np.asarray([i for i, rid in enumerate(group.ids) if rid in allowed], dtype=np.intp)
    if len(indices) != len(allowed) or len(indices) < 2:
        raise ValueError("Part relation outside pinned catalog")
    width, height = {"bodies": (80, 50), "gliders": (80, 50)}[kind]
    query = cv2.cvtColor(cv2.resize(crop_bgr, (width, height),
                                    interpolation=cv2.INTER_AREA),
                             cv2.COLOR_BGR2RGB).astype(np.float32) / 255
    rgb, mask, count = (getattr(group, name)[indices] for name in ("rgb", "mask", "count"))
    ref_mean = float(np.sum(rgb * mask[:, :, :, None], dtype=np.float64)
                     / max(float(np.sum(count, dtype=np.float64)) * 3, 1e-6))
    query_mean = float(np.mean(query, dtype=np.float64))
    gain = max(.6, min(2.6, ref_mean / max(query_mean, 1e-4)))
    adjusted = np.clip(query * np.float32(gain), 0, 1)
    scores = 1 - (np.abs(rgb - adjusted) * mask[:, :, :, None]).sum((1, 2, 3)) \
        / (count * 3 + 1e-6)
    order = np.argsort(-scores, kind="stable")

    def item(position: int) -> dict:
        index = int(indices[position])
        return {"id": group.ids[index], "familyId": group.families[index],
                "score": float(scores[position])}

    distinct = set()
    families = []
    for position in order:
        family = group.families[int(indices[position])]
        if family in distinct:
            continue
        distinct.add(family)
        families.append({"familyId": family, "score": float(scores[position])})
        if len(families) == 3:
            break
    first = int(order[0])
    selected_family = group.families[int(indices[first])]
    variants = [item(int(position)) for position in order
                if group.families[int(indices[position])] == selected_family][:3]
    return {"schema": "mk8dx.part-subset-rank.v1", "kind": kind,
            "characters": list(candidates), "subsetSize": len(indices),
            "luminanceGain": gain, "top1Id": group.ids[int(indices[first])],
            "score": float(scores[first]),
            "margin": float(scores[first] - scores[int(order[1])]),
            "familyMargin": (families[0]["score"] - families[1]["score"]
                             if len(families) > 1 else None),
            "top3": [item(int(position)) for position in order[:3]],
            "familyTop3": families, "variantTop3": variants, "acceptedId": None}
