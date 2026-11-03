"""Match a certified icon crop to schema-9 Clean Assets references.

Geometry, card presence, OCR and temporal consensus are upstream/downstream
evidence. This module never reads a human label or a product prediction.
"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
from pathlib import Path
from typing import Literal

import cv2
import numpy as np


Kind = Literal["characters", "bodies", "tires", "gliders", "flags"]
Profile = Literal["result", "scoreboard", "ghost_select"]
Method = Literal["rgb", "ncc", "chroma", "lab", "template_ncc"]
SearchMode = Literal["full", "center_then_full", "center_shortlist", "center_then_shortlist"]
BOX = {"characters": (48, 48), "bodies": (80, 50), "tires": (80, 50), "gliders": (80, 50), "flags": (55, 38)}


@dataclass(frozen=True)
class Candidate:
    id: str
    family_id: str
    score: float


@dataclass(frozen=True)
class FamilyCandidate:
    family_id: str
    score: float
    variants: tuple[Candidate, ...]


@dataclass(frozen=True)
class MatchResult:
    id: str | None
    family_id: str | None
    status: str
    score: float
    margin: float
    top: tuple[Candidate, ...]
    method: Method
    profile: Profile
    offset: tuple[int, int]
    family_top: tuple[FamilyCandidate, ...] = ()


@dataclass(frozen=True)
class WindowMatchResult:
    match: MatchResult
    crop_xywh: tuple[int, int, int, int]
    basis: Literal["fixed_slot", "window_search"]


@dataclass(frozen=True)
class FlagWindowResult:
    """All-country optical ranking on one source frame and its own fixed slot."""

    proposed_id: str
    accepted_id: str | None
    status: Literal["accepted", "review"]
    score: float
    margin: float
    top: tuple[Candidate, ...]
    scale: float
    offset_px: tuple[int, int]


FLAG_SCALES = (0.90, 0.95, 1.0, 1.05, 1.10)
FLAG_PADDING = 6


@dataclass(frozen=True)
class _Group:
    ids: tuple[str, ...]
    families: tuple[str, ...]
    rgb: np.ndarray
    mask: np.ndarray
    count: np.ndarray


def fit_reference(image_bgra: np.ndarray, size: tuple[int, int], scale: float = 1.0
                  ) -> tuple[np.ndarray, np.ndarray]:
    """A BGRA reference placed in the match box as every catalog reference is: centred at
    ``scale`` of the box; returns RGB in 0..1 and the alpha mask (alpha > 0.15)."""
    if scale != 1.0:
        sw, sh = max(2, round(size[0] * scale)), max(2, round(size[1] * scale))
        small = cv2.resize(image_bgra, (sw, sh), interpolation=cv2.INTER_AREA)
        fitted = np.zeros((size[1], size[0], 4), dtype=np.uint8)
        x, y = (size[0] - sw) // 2, (size[1] - sh) // 2
        # larger than the box (an extra reference drawn bigger): its centre is kept
        sx, sy = max(0, -x), max(0, -y)
        x, y = max(0, x), max(0, y)
        w, h = min(sw - sx, size[0]), min(sh - sy, size[1])
        fitted[y:y + h, x:x + w] = small[sy:sy + h, sx:sx + w]
    else:
        fitted = cv2.resize(image_bgra, size, interpolation=cv2.INTER_AREA)
    rgb = cv2.cvtColor(fitted[:, :, :3], cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    mask = (fitted[:, :, 3].astype(np.float32) / 255.0 > 0.15).astype(np.float32)
    return rgb, mask


class ReferenceBank:
    """Build references in memory from a protected Clean Assets authoring root."""

    def __init__(self, asset_root: Path):
        root = Path(asset_root).resolve(strict=True)
        raw = (root / "database.json").read_bytes()
        db = json.loads(raw)
        if db.get("schemaVersion") != 9:
            raise ValueError("Expected schema-9 Clean Assets")
        self.catalog_sha256 = sha256(raw).hexdigest()
        self.asset_root = root
        self.groups: dict[tuple[Kind, Profile], _Group] = {}
        self.canonical: dict[str, str] = {}
        self.family: dict[str, str] = {}
        self.country_names: dict[str, dict[str, str]] = {}
        self.display_names: dict[str, dict[str, str]] = {}
        self.variant_slugs: dict[str, str] = {}
        self.part_for_character: dict[tuple[str, str, str], str] = {}
        self.tire_by_index: dict[int, str] = {}
        specs: dict[str, list[tuple[str, str, str]]] = {kind: [] for kind in BOX}

        for item in db["collections"]["characters"]:
            rid = item["id"]
            self.family[rid] = rid
            self.display_names[rid] = item.get("names", {})
            for role in ("score", "menu"):
                asset = item["assets"].get(role)
                if asset:
                    specs.setdefault("characters_" + role, []).append((rid, rid, asset["path"]))
        for item in db["relationships"]["characterVariants"]:
            rid, base = item["id"], item["characterId"]
            self.family[rid] = base
            self.variant_slugs[rid] = item.get("variantSlug", "")
            for role in ("score", "menu"):
                asset = item["assets"].get(role)
                if asset:
                    specs.setdefault("characters_" + role, []).append((rid, base, asset["path"]))

        for kind, collection, relation, base_key in (
            ("bodies", "vehicleBodies", "bodyVariants", "bodyId"),
            ("gliders", "vehicleGliders", "gliderVariants", "gliderId"),
        ):
            for item in db["collections"][collection]:
                rid = item["id"]
                asset = item["assets"].get("default") or next(iter(item["assets"].values()))
                specs[kind].append((rid, rid, asset["path"]))
                self.family[rid] = rid
                self.display_names[rid] = item.get("names", {})
            for item in db["relationships"][relation]:
                rid, base = item["id"], item[base_key]
                self.family[rid] = base
                self.variant_slugs[rid] = item.get("variantSlug", "")
                for character in item.get("relatedCharacterIds", []) + item.get("relatedCharacterVariantIds", []):
                    key = (kind, base, character)
                    mapped = base if item.get("variantSlug") == "default" else rid
                    if key in self.part_for_character and self.part_for_character[key] != mapped:
                        raise ValueError(f"Conflicting part relation: {key}")
                    self.part_for_character[key] = mapped
                if item.get("variantSlug") == "default":
                    self.canonical[rid] = base
                    continue
                specs[kind].append((rid, base, item["asset"]["path"]))

        for item in db["collections"]["vehicleTires"]:
            rid = item["id"]
            asset = item["assets"].get("default") or next(iter(item["assets"].values()))
            specs["tires"].append((rid, rid, asset["path"]))
            self.family[rid] = rid
            self.display_names[rid] = item.get("names", {})
            if isinstance(item.get("index"), int):
                self.tire_by_index[item["index"]] = rid

        for item in db["collections"]["countries"]:
            asset = item.get("assets", {}).get("mk8Flag")
            if asset:
                rid = item["id"]
                specs["flags"].append((rid, rid, asset["path"]))
                self.family[rid] = rid
                self.country_names[rid] = item.get("names", {})
                self.display_names[rid] = item.get("names", {})

        for kind in BOX:
            key = "characters_score" if kind == "characters" else kind
            self.groups[(kind, "result")] = self._load(specs[key], BOX[kind], allow_opaque=kind == "flags")
        self.groups[("characters", "ghost_select")] = self._load(specs["characters_menu"], BOX["characters"])
        scale = float(db["detection"]["scoreboard"]["character"]["refScale"])
        self.groups[("characters", "scoreboard")] = self._load(specs["characters_score"], BOX["characters"], scale)
        self.ref_scale = {("characters", "scoreboard"): scale}

    def _load(self, specs: list[tuple[str, str, str]], size: tuple[int, int],
              scale: float = 1.0, *, allow_opaque: bool = False) -> _Group:
        ids, families, colors, masks = [], [], [], []
        for rid, family, relative in specs:
            path = (self.asset_root / relative).resolve(strict=True)
            if self.asset_root not in path.parents:
                raise ValueError(f"Asset outside source root: {relative}")
            image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
            if image is None or image.ndim != 3 or image.shape[2] not in ((3, 4) if allow_opaque else (4,)):
                raise ValueError(f"Expected {'RGB/RGBA' if allow_opaque else 'RGBA'} reference: {relative}")
            if image.shape[2] == 3:
                image = cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)
            rgb, mask = fit_reference(image, size, scale)
            if mask.sum() < 8:
                raise ValueError(f"Empty reference: {rid}")
            ids.append(rid)
            families.append(family)
            colors.append(rgb)
            masks.append(mask)
        rgb = np.stack(colors)
        mask = np.stack(masks)
        return _Group(tuple(ids), tuple(families), rgb, mask, mask.sum((1, 2)))


class IconMatcher:
    """Common ranking contract with explicit profile and abstention semantics."""

    def __init__(self, references: ReferenceBank):
        self.references = references
        self._flag_window_templates = None

    def match_flag_window(self, frame_bgr: np.ndarray,
                          slot_xywh: tuple[int, int, int, int]) -> FlagWindowResult:
        """Opt-in optical search over every flag, with no label or partner frame.

        `slot_xywh` is the detected game's flag slot on this same aligned BGR
        frame. Its 6-pixel surround allows modest optical shift and scale.
        The strongest candidate is retained even when acceptance needs review.
        Ordinary fixed-crop `match` and HDMI callers are unchanged.
        """
        if (not isinstance(frame_bgr, np.ndarray) or frame_bgr.ndim != 3
                or frame_bgr.shape[2] != 3 or frame_bgr.dtype != np.uint8
                or not isinstance(slot_xywh, tuple) or len(slot_xywh) != 4
                or any(not isinstance(value, int) or isinstance(value, bool)
                       for value in slot_xywh)):
            raise ValueError("Expected uint8 BGR frame and integer flag slot")
        x, y, width, height = slot_xywh
        if (width not in (BOX["flags"][0], BOX["flags"][0] + 1) or height != BOX["flags"][1]
                or x < FLAG_PADDING or y < FLAG_PADDING
                or x + width + FLAG_PADDING > frame_bgr.shape[1]
                or y + height + FLAG_PADDING > frame_bgr.shape[0]):
            raise ValueError("Flag slot needs its complete fixed surround")
        window = frame_bgr[y-FLAG_PADDING:y+height+FLAG_PADDING,
                           x-FLAG_PADDING:x+width+FLAG_PADDING]
        if self._flag_window_templates is None:
            group = self.references.groups[("flags", "result")]
            templates = []
            for rid, rgb in zip(group.ids, group.rgb):
                base = np.clip(rgb[:, :, ::-1] * 255, 0, 255).astype(np.uint8)
                sizes = tuple((scale, cv2.resize(base, (round(base.shape[1] * scale),
                                                       round(base.shape[0] * scale)),
                                                  interpolation=cv2.INTER_AREA))
                              for scale in FLAG_SCALES)
                templates.append((rid, sizes))
            self._flag_window_templates = templates
        ranked = []
        for rid, sizes in self._flag_window_templates:
            best = (-1.0, 1.0, (0, 0))
            for scale, template in sizes:
                _, value, _, location = cv2.minMaxLoc(
                    cv2.matchTemplate(window, template, cv2.TM_CCOEFF_NORMED))
                if value > best[0]:
                    best = (float(value), scale, location)
            ranked.append((rid, *best))
        ranked.sort(key=lambda item: (-item[1], item[0]))
        if not ranked:
            raise ValueError("Flag reference bank is empty")
        first = ranked[0]
        score = first[1]
        margin = score - ranked[1][1] if len(ranked) > 1 else score
        accepted = score >= 0.65 and margin >= 0.02
        return FlagWindowResult(
            first[0], first[0] if accepted else None,
            "accepted" if accepted else "review", score, margin,
            tuple(Candidate(rid, rid, value) for rid, value, _, _ in ranked[:3]),
            first[2], (first[3][0] - FLAG_PADDING, first[3][1] - FLAG_PADDING),
        )

    def match_tire_window(
        self,
        window_bgr: np.ndarray,
        slot_xywh: tuple[int, int, int, int],
        *,
        step: int = 2,
    ) -> WindowMatchResult:
        """Rank one tire slot, searching its bounded source window only if unclear.

        The upstream adapter supplies a geometric slot and its padded BGR window.
        Neither an old product decision nor a label selects the search location.
        The top three scores compare references at the single winning location.
        """
        if (not isinstance(window_bgr, np.ndarray) or window_bgr.ndim != 3
                or window_bgr.shape[2] != 3
                or not isinstance(step, int) or isinstance(step, bool) or step not in (1, 2, 4)
                or not isinstance(slot_xywh, tuple) or len(slot_xywh) != 4
                or any(not isinstance(v, int) or isinstance(v, bool)
                                                for v in slot_xywh)):
            raise ValueError("Expected BGR tire window, integer slot and bounded step")
        x, y, width, height = slot_xywh
        window_height, window_width = window_bgr.shape[:2]
        if (width < 4 or height < 4 or x < 0 or y < 0
                or x + width > window_width or y + height > window_height
                or window_width - width > 20 or window_height - height > 20):
            raise ValueError("Tire slot must fit its bounded padded window")
        centered = self.match(window_bgr[y:y + height, x:x + width], "tires", search_radius=0)
        if centered.status == "accepted":
            return WindowMatchResult(centered, (x, y, width, height), "fixed_slot")
        best: WindowMatchResult | None = None
        for top in range(0, window_height - height + 1, step):
            for left in range(0, window_width - width + 1, step):
                match = self.match(window_bgr[top:top + height, left:left + width],
                                   "tires", search_radius=0)
                if best is None or match.score > best.match.score:
                    best = WindowMatchResult(match, (left, top, width, height), "window_search")
        assert best is not None
        return best

    def match(
        self,
        crop_bgr: np.ndarray,
        kind: Kind,
        *,
        profile: Profile = "result",
        method: Method = "rgb",
        present: bool = True,
        top_k: int = 3,
        min_score: float | None = None,
        min_margin: float = 0.02,
        white_balance: tuple[float, float, float] | None = None,
        search_radius: int | None = None,
        search_mode: SearchMode = "full",
        shortlist_size: int = 8,
    ) -> MatchResult:
        if top_k < 1:
            raise ValueError("top_k must be positive")
        if method not in ("rgb", "ncc", "chroma", "lab"):
            raise ValueError("Fixed-crop match expects rgb, ncc, chroma or lab")
        if (kind, profile) not in self.references.groups:
            raise ValueError(f"Unsupported kind/profile: {kind}/{profile}")
        if search_mode not in ("full", "center_then_full", "center_shortlist", "center_then_shortlist"):
            raise ValueError("Unsupported search mode")
        if not isinstance(shortlist_size, int) or isinstance(shortlist_size, bool) or shortlist_size < 1:
            raise ValueError("Shortlist size must be positive")
        if search_mode in ("center_then_full", "center_then_shortlist"):
            if search_radius is not None:
                raise ValueError("Adaptive search selects its own radius")
            common = dict(profile=profile, method=method, present=present, top_k=top_k,
                          min_score=min_score, min_margin=min_margin, white_balance=white_balance,
                          shortlist_size=shortlist_size)
            centered = self.match(crop_bgr, kind, **common, search_radius=0)
            if centered.status in ("accepted", "absent"):
                return centered
            if search_mode == "center_then_full":
                return self.match(crop_bgr, kind, **common, search_radius=2)
            return self.match(crop_bgr, kind, **common, search_mode="center_shortlist")
        if not present:
            return MatchResult(None, None, "absent", 0.0, 0.0, (), method, profile, (0, 0))
        if crop_bgr is None or crop_bgr.size == 0 or crop_bgr.ndim != 3 or crop_bgr.shape[2] != 3:
            raise ValueError("Expected nonempty BGR crop")
        group = self.references.groups[(kind, profile)]
        q = cv2.cvtColor(cv2.resize(crop_bgr, BOX[kind], interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        if white_balance is not None:
            gain = np.asarray(white_balance, dtype=np.float32)
            if gain.shape != (3,) or not np.all(np.isfinite(gain)) or np.any(gain < 0.7) or np.any(gain > 1.4):
                raise ValueError("White balance must contain bounded RGB gains")
            q = np.clip(q * gain, 0, 1)
        radius = (2 if profile == "scoreboard" or search_mode == "center_shortlist" else 0) if search_radius is None else search_radius
        if not isinstance(radius, int) or isinstance(radius, bool) or not 0 <= radius <= 2:
            raise ValueError("Search radius must be an integer from 0 to 2")
        offsets = tuple((dx, dy) for dy in range(-radius, radius + 1) for dx in range(-radius, radius + 1))
        scores = np.full(len(group.ids), -1.0, dtype=np.float32)
        best_offsets = np.zeros((len(group.ids), 2), dtype=np.int8)
        selected = None
        if search_mode == "center_shortlist":
            scores[:] = self._score(q, group, method)
            ranking = np.argsort(-scores, kind="stable")[:shortlist_size]
            families = {group.families[int(i)] for i in ranking}
            selected = np.asarray([i for i, family in enumerate(group.families) if family in families], dtype=np.intp)
            group_for_offsets = _Group(
                tuple(group.ids[int(i)] for i in selected),
                tuple(group.families[int(i)] for i in selected),
                group.rgb[selected], group.mask[selected], group.count[selected],
            )
        for dx, dy in offsets:
            if selected is not None and not (dx or dy):
                continue
            shifted = cv2.warpAffine(q, np.float32([[1, 0, dx], [0, 1, dy]]), BOX[kind],
                                     flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE) if (dx or dy) else q
            if selected is None:
                values = self._score(shifted, group, method)
                better = values > scores
                scores[better] = values[better]
                best_offsets[better] = (dx, dy)
            else:
                values = self._score(shifted, group_for_offsets, method)
                better = values > scores[selected]
                scores[selected[better]] = values[better]
                best_offsets[selected[better]] = (dx, dy)
        order = np.argsort(-scores, kind="stable")
        first, second = int(order[0]), int(order[1])
        score, margin = float(scores[first]), float(scores[first] - scores[second])
        threshold = (0.35 if method == "ncc" else 0.80) if min_score is None else min_score
        status = "accepted" if score >= threshold and margin >= min_margin else "unknown"
        top = tuple(Candidate(group.ids[int(i)], group.families[int(i)], float(scores[int(i)])) for i in order[:top_k])
        family_members: dict[str, list[Candidate]] = {}
        for index in order:
            i = int(index)
            family = group.families[i]
            members = family_members.setdefault(family, [])
            members.append(Candidate(group.ids[i], family, float(scores[i])))
        family_top = tuple(FamilyCandidate(family, members[0].score, tuple(members))
                           for family, members in list(family_members.items())[:3])
        return MatchResult(group.ids[first] if status == "accepted" else None,
                           group.families[first] if status == "accepted" else None,
                           status, score, margin, top, method, profile,
                           tuple(map(int, best_offsets[first])), family_top)

    def score_references(self, crop_bgr: np.ndarray, kind: Kind, references: list[np.ndarray], *,
                         profile: Profile = "result", scales: tuple[float, ...] = (1.0,),
                         search_radius: int | None = None) -> float:
        """The best score of extra BGRA references on a crop, compared exactly as the catalog
        references of ``kind``/``profile`` are (same box, ``rgb`` score, the profile's search
        radius); ``scales`` multiply the profile's own reference scale. For a reference that only
        the product holds, such as a Tournament player's own lobby Mii face."""
        if crop_bgr is None or crop_bgr.size == 0 or crop_bgr.ndim != 3 or crop_bgr.shape[2] != 3:
            raise ValueError("Expected nonempty BGR crop")
        base = getattr(self.references, "ref_scale", {}).get((kind, profile), 1.0)
        fitted = [fit_reference(image, BOX[kind], base * scale) for image in references for scale in scales]
        fitted = [(rgb, mask) for rgb, mask in fitted if mask.sum() >= 8]
        if not fitted:
            return -1.0
        mask = np.stack([m for _rgb, m in fitted])
        group = _Group(tuple(f"extra.{i}" for i in range(len(fitted))), tuple("extra" for _ in fitted),
                       np.stack([rgb for rgb, _m in fitted]), mask, mask.sum((1, 2)))
        q = cv2.cvtColor(cv2.resize(crop_bgr, BOX[kind], interpolation=cv2.INTER_AREA),
                         cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        radius = (2 if profile == "scoreboard" else 0) if search_radius is None else search_radius
        best = -1.0
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                shifted = cv2.warpAffine(q, np.float32([[1, 0, dx], [0, 1, dy]]), BOX[kind],
                                         flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE) if (dx or dy) else q
                best = max(best, float(self._score(shifted, group, "rgb").max()))
        return best

    @staticmethod
    def _score(q: np.ndarray, group: _Group, method: Method) -> np.ndarray:
        mask = group.mask[:, :, :, None]
        query = q[None]
        if method == "rgb":
            return 1.0 - (np.abs(group.rgb - query) * mask).sum((1, 2, 3)) / (group.count * 3 + 1e-6)
        if method == "chroma":
            # Brightness-invariant diagnostic. Keep shape alignment identical.
            a = group.rgb / np.maximum(group.rgb.sum(axis=3, keepdims=True), 0.03)
            b = query / np.maximum(query.sum(axis=3, keepdims=True), 0.03)
            return 1.0 - (np.abs(a - b) * mask).sum((1, 2, 3)) / (group.count * 2 + 1e-6)
        if method == "lab":
            a = cv2.cvtColor((q * 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32) / 255.0
            refs = np.stack([cv2.cvtColor((r * 255).astype(np.uint8), cv2.COLOR_RGB2LAB) for r in group.rgb]).astype(np.float32) / 255.0
            return 1.0 - (np.abs(refs - a[None]) * mask).sum((1, 2, 3)) / (group.count * 3 + 1e-6)
        if method == "ncc":
            total = group.count * 3 + 1e-6
            a_mean = (group.rgb * mask).sum((1, 2, 3)) / total
            b_mean = (query * mask).sum((1, 2, 3)) / total
            a = (group.rgb - a_mean[:, None, None, None]) * mask
            b = (query - b_mean[:, None, None, None]) * mask
            num = (a * b).sum((1, 2, 3))
            den = np.sqrt((a * a).sum((1, 2, 3)) * (b * b).sum((1, 2, 3)))
            return np.where(den > 1e-6, num / np.maximum(den, 1e-6), 0)
        raise ValueError(f"Unknown method: {method}")
