"""Write the remaining public cross-runtime parity vectors from the Python reference (issue #99, phase 1).

    python packages/icon-matcher/tools/generate_rule_vectors.py [--pack DIR] [--only NAME] [--check]

A sibling of ``generate_vectors.py`` (context-v1, icon-score-v1), sharing its JSON form and pack loading.
Outputs in packages/icon-matcher/vectors/:

* ``refinement-v1.json``: the opt-in refinement evidence on synthetic box-sized queries made from the
  pack's own references: shape rank (shape_rank.py), distinctive flag rank, NL/LU band ratio and NL/LU/PY
  tricolour (flag_rank.py), flag exposure (flag_exposure.py), character family colour (family_colour.py)
  and neutral chroma (neutral_chroma.py). Each case carries the upstream inputs Python computed (the
  visual read, the shape rank, the shortlisted IDs), so a runtime replays one refinement at a time.
* ``frame-geometry-v1.json``: frame_geometry.py over the pack's frame definitions for every race key,
  owner, static and anchored panel and registered/unregistered card.
* ``lap-grid-v1.json``: lap_grid.build_dynamic_grid on synthetic lap-index and owner-box detections
  placed on the pack's time grids (resolved, refined, nominal and every blocked status).
* ``segment-digits-v1.json``: segment_digits.py on rendered synthetic slots (every digit, shifts,
  noise, scale, required digit) with synthetic colour-coded templates (the product templates are
  not in the repository).
* ``name-match-v1.json``: name_match.py on a synthetic multi-locale vocabulary (invented part and track
  names in Latin, Cyrillic and CJK scripts) and synthetic OCR damage.

frame-geometry and lap-grid need ``frame-definitions-v1.json`` and refinement needs the tensor pack:
``node tooling/assets/materialize_collection.mjs recognition-pack <dir>`` then ``--pack <dir>`` (or
MK8DX_RECOGNITION_PACK). segment-digits and name-match are self-contained. Deterministic (no RNG, sorted
keys, LF); ``--check`` fails when a committed file differs. Cases within 1e-5 of a threshold carry
``"boundary": true``; runtimes report rather than fail on those until the arithmetic is unified.
"""

from __future__ import annotations

import argparse
import base64
from hashlib import sha256
import importlib.util
import json
import os
from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parent
PACKAGE = HERE.parent
sys.path.insert(0, str(PACKAGE / "python"))

_spec = importlib.util.spec_from_file_location("generate_vectors", HERE / "generate_vectors.py")
gv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gv)

from mk8dx_icon_matcher import frame_geometry as fg  # noqa: E402
from mk8dx_icon_matcher import lap_grid as lg  # noqa: E402
from mk8dx_icon_matcher import name_match as nm  # noqa: E402
from mk8dx_icon_matcher import segment_digits as sd  # noqa: E402
from mk8dx_icon_matcher.family_colour import rank_character_family_colour  # noqa: E402
from mk8dx_icon_matcher.flag_exposure import flag_exposure_proposal  # noqa: E402
from mk8dx_icon_matcher.flag_rank import (  # noqa: E402
    distinctive_flag_rank, flag_band_ratio, flag_tricolor_evidence)
from mk8dx_icon_matcher.matcher import Candidate, IconMatcher, MatchResult  # noqa: E402
from mk8dx_icon_matcher.neutral_chroma import _hsv, rank_neutral_reference  # noqa: E402
from mk8dx_icon_matcher.shape_rank import rank_icon_shape  # noqa: E402

VECTORS = PACKAGE / "vectors"
BOUNDARY = 1e-5
dump = gv.dump
# name -> (builder, pack input: "tensors", "frame-definitions" or None); each section registers
BUILDERS: dict = {}
NL, LU, PY = "country.nl", "country.lu", "country.py"


def _b64(array: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(array).tobytes()).decode("ascii")


def _jsonable(value):
    """Plain JSON (floats, not numpy scalars) so every runtime reads the same numbers."""
    return json.loads(json.dumps(value, default=float))


def pack_root(pack: str | None) -> Path | None:
    if pack:
        root = Path(pack)
        return root.parent if root.name == "tensor-pack" else root
    if os.environ.get("MK8DX_RECOGNITION_PACK"):
        return Path(os.environ["MK8DX_RECOGNITION_PACK"])
    return None


def frame_definitions_path(pack: str | None) -> Path | None:
    if os.environ.get("MK8DX_FRAME_DEFINITIONS") and not pack:
        return Path(os.environ["MK8DX_FRAME_DEFINITIONS"])
    root = pack_root(pack)
    return None if root is None else root / "frame-definitions-v1.json"


# ----------------------------------------------------------------------------------------- refinement-v1

REFINEMENT_GROUPS = ("flags__result", "tires__result", "characters__result")


def visual_from_json(read: dict, profile: str = "result") -> MatchResult:
    """A recorded visual read (generate_vectors.match_json) as the MatchResult the refinements take."""
    top = tuple(Candidate(c["id"], c["familyId"], c["score"]) for c in read["top"])
    accepted = read["acceptedId"]
    return MatchResult(accepted, top[0].family_id if accepted else None, read["status"], read["score"],
                       read["margin"], top, "rgb", profile, tuple(read["offset"]), ())


def run_refinement_case(case: dict, bank) -> dict:
    """Every refinement a case asks for, from its query and recorded inputs (Python reference)."""
    kind, profile = case["group"].split("__")
    group = bank.groups[(kind, profile)]
    query_u8 = gv.decode_query(case)
    crop_bgr = np.ascontiguousarray(query_u8[:, :, ::-1])
    query = query_u8.astype(np.float32) / np.float32(255.0)
    inputs = case["inputs"]
    out = {}
    for name in case["refinements"]:
        if name == "shape":
            out[name] = rank_icon_shape(crop_bgr, group, inputs["shapeMode"])
        elif name == "distinctive":
            out[name] = distinctive_flag_rank(query, group, inputs["distinctiveIds"])
        elif name == "bandRatio":
            out[name] = flag_band_ratio(query)
        elif name == "tricolor":
            out[name] = flag_tricolor_evidence(query, group, inputs["rawTopIds"], inputs["distinctiveTopId"],
                                               inputs["shape"])
        elif name == "exposure":
            out[name] = flag_exposure_proposal(crop_bgr, group, inputs["shape"])
        elif name == "familyColour":
            out[name] = rank_character_family_colour(query, group, visual_from_json(inputs["visual"], profile))
        elif name == "neutralChroma":
            matcher = IconMatcher(bank)
            out[name] = rank_neutral_reference(crop_bgr, matcher, visual_from_json(inputs["visual"], profile))
        else:
            raise ValueError(f"unknown refinement {name}")
    return _jsonable(out)


def _refinement_boundary(expected: dict) -> bool:
    """Within 1e-5 of a refinement threshold, where float order alone could flip a branch."""
    def near(value, gate):
        return value is not None and abs(value - gate) < BOUNDARY
    band = expected.get("bandRatio") or {}
    tri = expected.get("tricolor") or {}
    exp = expected.get("exposure") or {}
    neu = expected.get("neutralChroma") or {}
    hits = [near(band.get("ratio"), 0.62), near(band.get("ratio"), 0.68),
            near(exp.get("gain"), 1.25), near(neu.get("referenceSaturation"), 0.06),
            near(neu.get("querySaturation"), 0.12)]
    if tri.get("stripeContrast") is not None:
        hits.append(near(tri["stripeContrast"], tri["stripeBoundary"]))
        hits += [near(p["advantage"], 0.2 * p["referenceSeparation"]) for p in tri["pairAdvantages"]]
    hits += [near(c["scoreGap"], 0.02) for c in neu.get("considered", [])]
    top = (expected.get("exposure") or {}).get("top") or []
    hits += [abs(a["score"] - b["score"]) < 1e-6 for a, b in zip(top, top[1:])]
    shape_top = (expected.get("shape") or {}).get("top") or []
    hits += [abs(a["score"] - b["score"]) < 1e-9 for a, b in zip(shape_top, shape_top[1:])]
    distinct = expected.get("distinctive") or []
    hits += [abs(a["distance"] - b["distance"]) < 1e-9 for a, b in zip(distinct, distinct[1:])]
    family = (expected.get("familyColour") or {}).get("top") or []
    hits += [abs(a["distance"] - b["distance"]) < 1e-9 for a, b in zip(family, family[1:])]
    return any(hits)


class RefinementFactory:
    def __init__(self, bank):
        self.bank = bank
        self.matcher = IconMatcher(bank)
        self.cases: list[dict] = []
        self.seen: set = set()

    def group(self, key):
        kind, profile = key.split("__")
        return self.bank.groups[(kind, profile)]

    def ref(self, key: str, rid: str) -> np.ndarray:
        group = self.group(key)
        return group.rgb[group.ids.index(rid)] * 255.0

    def visual(self, key: str, query: np.ndarray) -> dict:
        return gv.python_match(self.matcher, key, query, "center_shortlist")

    def add(self, name: str, key: str, query: np.ndarray, refinements: list[str], **forced) -> None:
        """One case: Python computes the upstream inputs the product would (visual read, shape rank,
        shortlist) unless ``forced`` names them, then every listed refinement."""
        query = gv._u8(query) if query.dtype != np.uint8 else query
        signature = (key, query.tobytes(), tuple(refinements), json.dumps(forced, sort_keys=True))
        if signature in self.seen:
            return
        self.seen.add(signature)
        visual = self.visual(key, query)
        kind = key.split("__")[0]
        inputs: dict = {}
        if kind in ("flags", "tires"):
            inputs["shapeMode"] = "full_rgb_ncc" if kind == "flags" else "masked_gray_ncc"
        if kind == "flags":
            crop = np.ascontiguousarray(query[:, :, ::-1])
            shape = rank_icon_shape(crop, self.group(key), "full_rgb_ncc")
            ids = [c["id"] for c in visual["top"]]
            inputs["shape"] = _jsonable(shape)
            inputs["distinctiveIds"] = ids
            inputs["rawTopIds"] = ids
            normalized = query.astype(np.float32) / np.float32(255.0)
            inputs["distinctiveTopId"] = distinctive_flag_rank(normalized, self.group(key), ids)[0]["id"]
        if kind == "characters":
            inputs["visual"] = visual
        inputs.update(forced)
        case = {"id": f"{key}/{name}", "group": key, "size": [int(query.shape[1]), int(query.shape[0])],
                "query": _b64(query), "inputs": _jsonable(inputs), "refinements": refinements}
        case["expected"] = run_refinement_case(case, self.bank)
        case["boundary"] = _refinement_boundary(case["expected"])
        self.cases.append(case)


def _flag_cases(f: RefinementFactory) -> None:
    key = "flags__result"
    group = f.group(key)
    flags_all = ["shape", "distinctive", "bandRatio", "tricolor", "exposure"]
    nl, lu, py = f.ref(key, NL), f.ref(key, LU), f.ref(key, PY)
    for rid, ref in ((NL, nl), (LU, lu), (PY, py)):
        short = rid.split(".")[1]
        f.add(f"{short}/exact", key, ref, flags_all)
        f.add(f"{short}/shift_gain_noise", key, gv._shift(ref, 1, 0) * 0.94 + gv._lcg_noise(ref.shape, 11, 5),
              flags_all)
        for gain in (0.72, 0.55):  # an under-exposed crop: the exposure proposal measures
            f.add(f"{short}/dark_{gain}", key, ref * gain, flags_all)
        f.add(f"{short}/bright_1.12", key, np.minimum(255, ref * 1.12 + 8), flags_all)
    # NL toward LU: the band ratio passes NL max, the between band and LU min; the stripe contrast its boundary
    for t in (0.2, 0.35, 0.5, 0.6, 0.7, 0.85):
        blend = (1 - t) * nl + t * lu
        f.add(f"nl_lu_blend_{t}", key, blend, flags_all)
        f.add(f"nl_lu_blend_{t}/forced_nl_first", key, blend, ["tricolor", "distinctive"],
              rawTopIds=[NL, LU, PY], distinctiveIds=[NL, LU, PY], distinctiveTopId=NL)
    for t in (0.3, 0.6):
        f.add(f"nl_py_blend_{t}/forced_nl_first", key, (1 - t) * nl + t * py, ["tricolor", "distinctive"],
              rawTopIds=[NL, PY, LU], distinctiveIds=[NL, PY, LU], distinctiveTopId=NL)
    # forced branches of the tricolour rule
    f.add("nl/forced_distinctive_disagreement", key, nl, ["tricolor"], rawTopIds=[NL, LU, PY],
          distinctiveTopId=LU)
    f.add("lu/forced_different_first", key, lu, ["tricolor"], rawTopIds=[LU, NL, PY], distinctiveTopId=NL)
    lu_dark = gv._u8(lu * 0.8)
    f.add("lu_dark_0.8/forced_nl_first_lu_pattern", key, lu_dark, ["tricolor"], rawTopIds=[NL, LU, PY],
          distinctiveTopId=NL)
    f.add("nl/forced_no_pattern_rank", key, gv._u8(nl * 0.6), ["exposure"],
          shape={"mode": "masked_gray_ncc", "margin": 0.0, "top": []})
    f.add("nl/forced_unknown_pattern", key, gv._u8(nl * 0.6), ["exposure"],
          shape={"mode": "full_rgb_ncc", "margin": 0.1, "top": [{"id": "country.not_a_flag", "score": 0.9}]})
    f.add("black/forced_insufficient_brightness", key, np.zeros_like(nl), ["exposure", "bandRatio", "shape"],
          shape={"mode": "full_rgb_ncc", "margin": 0.1, "top": [{"id": NL, "score": 0.9}]})
    # a few other flags spread over the catalog
    n = len(group.ids)
    for fraction in (0.0, 0.31, 0.62, 0.93):
        rid = group.ids[min(n - 1, int(fraction * n))]
        ref = f.ref(key, rid)
        short = rid.split(".")[1]
        f.add(f"{short}/exact", key, ref, flags_all)
        f.add(f"{short}/dark_0.6", key, ref * 0.6, flags_all)


def _tire_cases(f: RefinementFactory) -> None:
    key = "tires__result"
    group = f.group(key)
    n = len(group.ids)
    for number, fraction in enumerate((0.0, 0.4, 0.8)):
        rid = group.ids[min(n - 1, int(fraction * n))]
        ref = f.ref(key, rid)
        f.add(f"{rid}/exact", key, ref, ["shape"])
        f.add(f"{rid}/shift_gain_noise", key, gv._shift(ref, -1, 1) * 0.9 + gv._lcg_noise(ref.shape, 23 + number, 6),
              ["shape"])
        f.add(f"{rid}/inverted", key, 255 - ref, ["shape"])
    f.add("flat_grey", key, np.full_like(f.ref(key, group.ids[0]), 128), ["shape"])


def _saturation(group, index: int) -> float:
    rgb, mask = group.rgb[index], group.mask[index]
    values = [_hsv(rgb[y, x])[1] for y, x in zip(*np.nonzero(mask))]
    return sum(values) / len(values) / 255 if values else 0.0


def _character_cases(f: RefinementFactory) -> None:
    key = "characters__result"
    group = f.group(key)
    families: dict[str, list[int]] = {}
    for index, family in enumerate(group.families):
        families.setdefault(family, []).append(index)
    multi = [members for _, members in sorted(families.items()) if len(members) >= 2]
    both = ["familyColour", "neutralChroma"]
    for number, fraction in enumerate((0.0, 0.25, 0.5, 0.75)):
        members = multi[min(len(multi) - 1, int(fraction * len(multi)))]
        a, b = members[0], members[1]
        ra, rb = group.rgb[a] * 255.0, group.rgb[b] * 255.0
        rid = group.ids[a]
        f.add(f"{rid}/exact", key, ra, both)
        f.add(f"{rid}/shift_1_1", key, gv._shift(ra, 1, 1), both)
        f.add(f"{rid}/sibling_blend_0.4", key, 0.6 * ra + 0.4 * rb + gv._lcg_noise(ra.shape, 31 + number, 3), both)
    single = next(members for _, members in sorted(families.items()) if len(members) == 1)
    f.add(f"{group.ids[single[0]]}/single_member_family", key, group.rgb[single[0]] * 255.0, both)
    # neutral (pale) references: the chroma review applies
    neutral = [i for i in range(len(group.ids)) if _saturation(group, i) <= 0.06]
    saturated = [i for i in range(len(group.ids)) if _saturation(group, i) > 0.2]
    for number, index in enumerate(neutral[:3]):
        ref = group.rgb[index] * 255.0
        rid = group.ids[index]
        f.add(f"{rid}/neutral_exact", key, ref, both)
        tint = ref * np.array([0.55, 0.75, 1.0]) + np.array([0.0, 10.0, 60.0])  # a blue cast: saturated query
        f.add(f"{rid}/neutral_blue_cast", key, tint, both)
        rival = group.ids[saturated[number]]
        visual = f.visual(key, gv._u8(tint))
        top = [visual["top"][0], {"id": rival, "familyId": group.families[saturated[number]],
                                  "score": visual["top"][0]["score"] - 0.015}]
        if len(visual["top"]) > 2:
            top.append(visual["top"][2])
        forced = {**visual, "top": [visual["top"][0] | {"id": rid, "familyId": group.families[index]}] + top[1:],
                  "top1Id": rid}
        f.add(f"{rid}/neutral_blue_cast/forced_saturated_rival_gap_0.015", key, tint, ["neutralChroma"],
              visual=forced)
        wide = {**forced, "top": [forced["top"][0], forced["top"][1] | {"score": forced["top"][0]["score"] - 0.03}]
                + forced["top"][2:]}
        f.add(f"{rid}/neutral_blue_cast/forced_saturated_rival_gap_0.03", key, tint, ["neutralChroma"],
              visual=wide)
        f.add(f"{rid}/neutral_orange_only", key, np.broadcast_to(np.array([230.0, 150.0, 30.0]), ref.shape),
              ["neutralChroma"], visual=forced)
        offset = {**forced, "offset": [2, -1]}
        f.add(f"{rid}/neutral_blue_cast/forced_offset_2_-1", key, tint, ["neutralChroma"], visual=offset)


def build_refinement(directory: Path) -> dict:
    manifest, bank, hashes = gv.load_tensor_pack(directory, REFINEMENT_GROUPS)
    factory = RefinementFactory(bank)
    _flag_cases(factory)
    _tire_cases(factory)
    _character_cases(factory)
    ids = [case["id"] for case in factory.cases]
    if len(set(ids)) != len(ids):
        raise ValueError("duplicate refinement case id")
    return {"schema": "mk8dx.refinement-vectors.v1",
            "source": ["packages/icon-matcher/python/mk8dx_icon_matcher/shape_rank.py",
                       "packages/icon-matcher/python/mk8dx_icon_matcher/flag_rank.py",
                       "packages/icon-matcher/python/mk8dx_icon_matcher/flag_exposure.py",
                       "packages/icon-matcher/python/mk8dx_icon_matcher/family_colour.py",
                       "packages/icon-matcher/python/mk8dx_icon_matcher/neutral_chroma.py"],
            "generator": "packages/icon-matcher/tools/generate_rule_vectors.py",
            "catalogSha256": manifest["catalogSha256"], "tensors": hashes,
            "query": "box-sized uint8 RGB, row-major, base64; the runtime query tensor is bytes / 255 (float32)",
            "inputs": "the upstream values Python computed (center_shortlist visual read, full_rgb_ncc shape "
                      "rank, shortlisted IDs) or forced ones; runtimes take them as given",
            "tolerance": 1e-6, "cases": factory.cases}


BUILDERS["refinement"] = (build_refinement, "tensors")


# ------------------------------------------------------------------------------------- frame-geometry-v1

KINDS = ("character_icon", "kart_icon", "wheel_icon", "glider_icon", "flag_icon")
RACE_KEYS = ("race3", "race7", "ghost_detail", "ghost_detail7")


def frame_geometry_case(defs: dict, race_key: str, owner: str, anchor, registration, image) -> dict:
    panel = fg.panel_box(defs, race_key, owner, anchor)
    case = {"raceKey": race_key, "owner": owner, "anchor": anchor, "registration": registration,
            "image": image, "panel": panel}
    if panel is None:
        return case
    _race, laps, ghost_detail = fg.race_and_laps(race_key)
    right = fg.text_right(defs, panel, ghost_detail)
    case.update(registerWindow=fg.register_window(defs, panel, image[0], image[1]), textRight=right,
                ghostNameRight=fg.ghost_name_right(defs, panel), fields={})
    for kind in KINDS:
        slot = fg.slot_box(defs, owner, kind, laps, panel, registration)
        entry = {"deployBox": fg.deploy_box(defs, kind, laps, panel["w"], panel["h"]), "slot": slot}
        if slot is not None:
            entry["searchWindow"] = fg.search_window(defs, kind, slot, image[0], image[1])
            entry["textStrip"] = fg.text_strip(defs, slot, right)
        case["fields"][kind] = entry
    return case


def build_frame_geometry(defs_path: Path) -> dict:
    raw = defs_path.read_bytes()
    defs = json.loads(raw)
    cases = []
    anchors = (None, [1033.5, 231.5], [1034.25, 500.0], [580.4, 250.37], [1040.0, 540.0], [3.0, 2.0],
               [1279.0, 719.0])
    registrations = (None, [0.0, 0.0, 1.0, 1.0], [2.5, -1.5, 0.98, 1.02], [-7.0, 4.0, 1.03, 0.94])
    images = ([1280, 720], [900, 500])
    for race_key in RACE_KEYS:
        for owner in ("ghost", "player"):
            for a, anchor in enumerate(anchors):
                for r, registration in enumerate(registrations):
                    if a > 1 and r not in (0, 2):
                        continue
                    for image in images if (a, r) in ((0, 0), (0, 2), (6, 2)) else images[:1]:
                        cases.append(frame_geometry_case(defs, race_key, owner, anchor, registration, image))
    cases.append(frame_geometry_case(defs, "race_unknown", "player", None, None, [1280, 720]))
    cases.append(frame_geometry_case(defs, "race3", "spectator", None, None, [1280, 720]))
    return {"schema": "mk8dx.frame-geometry-vectors.v1",
            "source": "packages/icon-matcher/python/mk8dx_icon_matcher/frame_geometry.py",
            "generator": "packages/icon-matcher/tools/generate_rule_vectors.py",
            "frameDefinitionsSha256": sha256(raw).hexdigest(), "cases": _jsonable(cases)}


BUILDERS["frame-geometry"] = (build_frame_geometry, "frame-definitions")


# ------------------------------------------------------------------------------------------- lap-grid-v1

def _det(label: str, score: float, box, width: int, height: int) -> dict:
    left, top, right, bottom = box
    return {"label": label, "score": score, "left": left / width, "top": top / height,
            "right": right / width, "bottom": bottom / height}


def _lap_rows(owner_grid: dict, count: int, width: int, height: int, dx: float, dy: float, stretch: float,
              wobble: int, base_score: float) -> list[dict]:
    rows = lg.canonical_lap_index_boxes(owner_grid)[:count]
    if not rows:
        return []
    first = rows[0].center_y()
    out = []
    for i, row in enumerate(rows):
        jitter = ((i * 7 + wobble) % 5 - 2) * 0.6 if wobble else 0.0
        cy_shift = (row.center_y() - first) * (stretch - 1.0)
        box = (row.left + dx + jitter, row.top + dy + cy_shift, row.right + dx + jitter, row.bottom + dy + cy_shift)
        out.append(_det("lap_index", round(base_score - 0.01 * i, 4), box, width, height))
    return out


def _owner_box(owner: str, upper: bool, width: int, height: int) -> dict:
    box = (560, 70, 1220, 350) if upper else (560, 370, 1220, 650)
    return _det(f"{owner}_timetrail_box", 0.9, box, width, height)


def build_lap_grid(defs_path: Path) -> dict:
    raw = defs_path.read_bytes()
    grids = json.loads(raw)["timeGrids"]
    width, height = 1280, 720
    cases = []

    def add(name, time_grid, race_key, ghost_detail, detections, lap_rows, nominal=False, w=width, h=height):
        case = {"id": name, "timeGrid": time_grid, "raceKey": race_key, "ghostDetail": ghost_detail, "width": w,
                "height": h, "detections": detections, "lapRows": lap_rows, "nominal": nominal}
        case["result"] = _jsonable(lg.build_dynamic_grid(grids[time_grid], race_key, ghost_detail, w, h,
                                                        detections, lap_rows, nominal))
        cases.append(case)

    for race_key, laps in (("race3", 3), ("race7", 7)):
        owners = grids["endScreen"][race_key]["owners"]
        ghost = lambda **k: _lap_rows(owners["ghost"], laps, width, height, **k)  # noqa: E731
        player = lambda **k: _lap_rows(owners["player"], laps, width, height, **k)  # noqa: E731
        boxes = [_owner_box("ghost", True, width, height), _owner_box("player", False, width, height)]
        exact = dict(dx=0.0, dy=0.0, stretch=1.0, wobble=0, base_score=0.95)
        moved = dict(dx=3.5, dy=-2.25, stretch=1.04, wobble=3, base_score=0.9)
        add(f"{race_key}/both_exact", "endScreen", race_key, False, boxes, ghost(**exact) + player(**exact))
        add(f"{race_key}/both_moved", "endScreen", race_key, False, boxes, ghost(**moved) + player(**moved))
        add(f"{race_key}/both_moved_nominal", "endScreen", race_key, False, boxes,
            ghost(**moved) + player(**moved), nominal=True)
        add(f"{race_key}/player_only_box", "endScreen", race_key, False, boxes[1:], player(**moved))
        add(f"{race_key}/no_owner_boxes", "endScreen", race_key, False, [], ghost(**exact) + player(**exact))
        add(f"{race_key}/no_boxes_player_rows", "endScreen", race_key, False, [], player(**moved))
        partial = player(**moved)
        add(f"{race_key}/player_missing_rows", "endScreen", race_key, False, boxes[1:],
            [row for i, row in enumerate(partial) if i % 2 == 0] if laps == 7 else partial[:2])
        duplicated = player(**moved)
        twin = dict(duplicated[0])
        twin["score"] = 0.5
        twin["left"] += 1.0 / width
        twin["right"] += 1.0 / width
        add(f"{race_key}/duplicate_badge", "endScreen", race_key, False, boxes[1:], duplicated + [twin])
        add(f"{race_key}/far_rows", "endScreen", race_key, False, boxes[1:],
            player(dx=60.0, dy=0.0, stretch=1.0, wobble=0, base_score=0.9))
        cw, ch = 1100, 640  # a smaller frame: the digit slots right of x=1100 are clipped
        add(f"{race_key}/edge_clip", "endScreen", race_key, False,
            [_owner_box("ghost", True, cw, ch), _owner_box("player", False, cw, ch)],
            _lap_rows(owners["ghost"], laps, cw, ch, **moved) + _lap_rows(owners["player"], laps, cw, ch, **moved),
            w=cw, h=ch)
    # the owners disagree on the lap count
    owners3, owners7 = grids["endScreen"]["race3"]["owners"], grids["endScreen"]["race7"]["owners"]
    boxes = [_owner_box("ghost", True, width, height), _owner_box("player", False, width, height)]
    # two ghost rows infer 3 laps, five player rows infer 7
    mixed = (_lap_rows(owners7["ghost"], 2, width, height, dx=0.0, dy=0.0, stretch=1.0, wobble=0, base_score=0.95)
             + _lap_rows(owners7["player"], 5, width, height, dx=0.0, dy=0.0, stretch=1.0, wobble=0,
                         base_score=0.95))
    add("race7/ambiguous_lap_count", "endScreen", "race7", False, boxes, mixed)
    add("race3/one_lap_row", "endScreen", "race3", False, boxes,
        _lap_rows(owners3["player"], 1, width, height, dx=0.0, dy=0.0, stretch=1.0, wobble=0, base_score=0.9))
    add("race9/missing_relative_grid", "endScreen", "race9", False, boxes,
        _lap_rows(owners3["player"], 3, width, height, dx=0.0, dy=0.0, stretch=1.0, wobble=0, base_score=0.9))
    for race_key, laps in (("race3", 3), ("race7", 7)):
        owner = grids["ghostDetail"][race_key]["owners"]["ghost"]
        rows = _lap_rows(owner, laps, width, height, dx=-2.0, dy=1.5, stretch=0.97, wobble=2, base_score=0.92)
        add(f"ghost_detail/{race_key}", "ghostDetail", race_key, True, [], rows)
        add(f"ghost_detail/{race_key}/nominal", "ghostDetail", race_key, True, [], rows, nominal=True)
    return {"schema": "mk8dx.lap-grid-vectors.v1",
            "source": "packages/icon-matcher/python/mk8dx_icon_matcher/lap_grid.py",
            "generator": "packages/icon-matcher/tools/generate_rule_vectors.py",
            "frameDefinitionsSha256": sha256(raw).hexdigest(), "cases": cases}


BUILDERS["lap-grid"] = (build_lap_grid, "frame-definitions")


# -------------------------------------------------------------------------------------- segment-digits-v1

_COLOURS = {"a": (255, 0, 0), "b": (0, 255, 0), "c": (0, 0, 255), "d": (255, 255, 0),
            "e": (255, 0, 255), "f": (0, 255, 255), "g": (255, 128, 0)}
DIGIT_PATTERN = {digit: pattern for pattern, digit in sd.PATTERNS.items()}


def synthetic_template_rgb(width: int, height: int, stroke: int) -> np.ndarray:
    """A colour-coded seven-segment template (segments a..g in the product colours) on black."""
    rgb = np.zeros((height, width, 3), np.uint8)
    x0, x1 = 2, width - 3
    y0, ym, y1 = 1, height // 2, height - 2
    bars = {"a": (x0 + 1, y0, x1 - 1, y0 + stroke - 1), "d": (x0 + 1, y1 - stroke + 1, x1 - 1, y1),
            "g": (x0 + 1, ym - stroke // 2, x1 - 1, ym - stroke // 2 + stroke - 1),
            "f": (x0, y0 + 1, x0 + stroke - 1, ym - 1), "b": (x1 - stroke + 1, y0 + 1, x1, ym - 1),
            "e": (x0, ym + 1, x0 + stroke - 1, y1 - 1), "c": (x1 - stroke + 1, ym + 1, x1, y1 - 1)}
    for key, (bx0, by0, bx1, by1) in bars.items():
        rgb[by0:by1 + 1, bx0:bx1 + 1] = _COLOURS[key]
    return rgb


def render_digit(template: sd.SegmentTemplate, digit: str | None, width: int, height: int, ox: int, oy: int,
                 noise_seed: int = 0, drop: int = 0) -> bytes:
    patch = np.zeros(width * height, np.uint8)
    pattern = DIGIT_PATTERN.get(digit, "0000000") if digit else "0000000"
    for key, on in zip(sd.SEGMENT_KEYS, pattern):
        if on != "1":
            continue
        for n, (x, y) in enumerate(template.points[key]):
            if drop and n % drop == 0:
                continue
            if 0 <= ox + x < width and 0 <= oy + y < height:
                patch[(oy + y) * width + ox + x] = 255
    if noise_seed:
        flips = gv._lcg_noise((width * height,), noise_seed, 40)
        patch[flips >= 39] ^= 255
    return patch.tobytes()


def _candidate_json(candidate) -> dict | None:
    if candidate is None:
        return None
    return {"pattern": candidate.pattern, "decoded": candidate.decoded, "valid": candidate.valid,
            "onCount": candidate.on_count, "confidence": candidate.confidence, "margin": candidate.margin,
            "x": candidate.x, "y": candidate.y, "w": candidate.w, "h": candidate.h, "scaleX": candidate.scale_x,
            "scaleY": candidate.scale_y, "values": [candidate.values[k] for k in sd.SEGMENT_KEYS]}


def build_segment_digits() -> dict:
    rgb = {"lap": synthetic_template_rgb(17, 25, 2), "total": synthetic_template_rgb(18, 29, 3)}
    templates = {kind: sd.template_from_rgb(image.reshape(-1), image.shape[1], image.shape[0])
                 for kind, image in rgb.items()}
    cases = []

    def add(kind, slot, binary, width, height, required=None):
        template = templates[kind]
        best = sd.best_segment_candidate(binary, width, height, template, kind, slot)
        best_required = (sd.best_segment_candidate(binary, width, height, template, kind, slot, required)
                         if required else None)
        scores = sd.segment_scores(binary, width, height)
        case = {"id": len(cases), "kind": kind, "slot": slot, "width": width, "height": height,
                "binary": base64.b64encode(binary).decode("ascii"), "required": required,
                "best": _candidate_json(best), "bestRequired": _candidate_json(best_required),
                "segmentScores": [scores[k] for k in sd.SEGMENT_KEYS]}
        margins = [c["margin"] for c in (case["best"], case["bestRequired"]) if c]
        case["boundary"] = any(abs(v - sd.SEGMENT_ON) < BOUNDARY for c in (case["best"], case["bestRequired"])
                               if c for v in c["values"]) or any(abs(m) < BOUNDARY for m in margins)
        cases.append(case)

    for kind, slot, size in (("lap", 1, (19, 27)), ("lap", 4, (19, 27)), ("total", 3, (22, 33))):
        template = templates[kind]
        width, height = size
        for digit in sorted(DIGIT_PATTERN):
            add(kind, slot, render_digit(template, digit, width, height, 1, 1), width, height)
        for n, digit in enumerate("0123456789"):
            ox, oy = n % 3, (n // 3) % 3
            add(kind, slot, render_digit(template, digit, width, height, ox, oy, noise_seed=101 + n), width, height,
                required=None if n % 2 else str((int(digit) + 1) % 10))
        for digit in "1478":
            add(kind, slot, render_digit(template, digit, width, height, 1, 2, drop=3), width, height, required="8")
    lap = templates["lap"]
    # scale clamps: narrow, tall, too small and empty patches; punctuation slots and blank slots
    add("lap", 1, render_digit(lap.scaled(0.9, 0.9), "5", 17, 25, 0, 0), 17, 25)
    add("lap", 1, render_digit(lap.scaled(1.0, 1.15), "2", 19, 32, 1, 1), 19, 32)
    add("lap", 1, render_digit(lap, "9", 14, 20, 0, 0), 14, 20)
    add("lap", 1, bytes(19 * 27), 19, 27)
    add("lap", 2, render_digit(lap, "1", 19, 27, 1, 1), 19, 27)
    add("total", 5, render_digit(templates["total"], "7", 22, 33, 2, 1), 22, 33, required="1")
    return {"schema": "mk8dx.segment-digit-vectors.v1",
            "source": "packages/icon-matcher/python/mk8dx_icon_matcher/segment_digits.py",
            "generator": "packages/icon-matcher/tools/generate_rule_vectors.py",
            "note": "synthetic colour-coded templates and rendered slots; the product templates are not in Git",
            "templates": {kind: {"width": int(image.shape[1]), "height": int(image.shape[0]),
                                 "rgb": _b64(image)} for kind, image in rgb.items()},
            "cases": _jsonable(cases)}


BUILDERS["segment-digits"] = (build_segment_digits, None)


# ------------------------------------------------------------------------------------------ name-match-v1

# Invented names only (no game text, no people). Locales and scripts follow the products' key grammar.
NAME_LOCALES = ("de-DE", "en-GB", "en-US", "ja-JP", "nl-NL", "ru-RU", "zh-CN")
PART_NAMES = {
    "bodies": {
        "body.comet": {"en-GB": "Comet Racer", "en-US": "Comet Racer", "nl-NL": "Komeetracer", "de-DE": "Kometflitzer",
                       "ja-JP": "コメットレーサー", "ru-RU": "Кометный гонщик", "zh-CN": "彗星赛车"},
        "body.zx": {"en-GB": "ZX", "en-US": "ZX", "nl-NL": "ZX", "de-DE": "ZX", "ja-JP": "ZX", "ru-RU": "ZX",
                    "zh-CN": "ZX"},
        "body.pebble": {"en-GB": "Pebble Kart", "en-US": "Pebble Cart", "nl-NL": "Kiezelkart", "de-DE": "Kieselkart",
                        "ja-JP": "ペブルカート", "ru-RU": "Галечный карт", "zh-CN": "卵石车"},
        "body.pebble_pro": {"en-GB": "Pebble Kart Pro", "en-US": "Pebble Cart Pro", "nl-NL": "Kiezelkart Pro",
                            "de-DE": "Kieselkart Pro", "ja-JP": "ペブルカートプロ", "ru-RU": "Галечный карт Про",
                            "zh-CN": "卵石车专业版"},
        "body.lantern": {"en-GB": "Lantern", "en-US": "Lantern", "nl-NL": "Lantaarn", "de-DE": "Laterne",
                         "ja-JP": "ランタン", "ru-RU": "Фонарь", "zh-CN": "灯笼"},
    },
    "tires": {
        "tire.drum": {"en-GB": "Drum Wheels", "en-US": "Drum Tires", "nl-NL": "Trommelbanden", "de-DE": "Trommelreifen",
                      "ja-JP": "ドラムタイヤ", "ru-RU": "Барабанные шины", "zh-CN": "鼓轮胎"},
        "tire.thin": {"en-GB": "Thin", "en-US": "Thin", "nl-NL": "Dun", "de-DE": "Dünn", "ja-JP": "スリム",
                      "ru-RU": "Тонкие", "zh-CN": "细轮"},
        "tire.thin_glow": {"en-GB": "Thin Glow", "en-US": "Thin Glow", "nl-NL": "Dun Gloei", "de-DE": "Dünn Glüh",
                           "ja-JP": "スリムグロー", "ru-RU": "Тонкие светящиеся", "zh-CN": "细光轮"},
    },
    "gliders": {
        "glider.kite": {"en-GB": "Paper Kite", "en-US": "Paper Kite", "nl-NL": "Papieren vlieger",
                        "de-DE": "Papierdrachen", "ja-JP": "ペーパーカイト", "ru-RU": "Бумажный змей",
                        "zh-CN": "纸风筝"},
        "glider.leaf": {"en-GB": "Leaf Sail", "en-US": "Leaf Sail", "nl-NL": "Bladzeil", "de-DE": "Blattsegel",
                        "ja-JP": "リーフセイル", "ru-RU": "Лиственный парус", "zh-CN": "叶帆"},
    },
}
TRACK_NAMES = {
    "track.sunny_dunes": {"en-GB": "Sunny Dunes", "en-US": "Sunny Dunes", "nl-NL": "Zonnige Duinen",
                          "de-DE": "Sonnige Dünen", "ja-JP": "サニーデューン", "ru-RU": "Солнечные дюны",
                          "zh-CN": "阳光沙丘"},
    "track.gx_sunny_dunes": {"en-GB": "GX Sunny Dunes", "en-US": "GX Sunny Dunes", "nl-NL": "GX Zonnige Duinen",
                             "de-DE": "GX Sonnige Dünen", "ja-JP": "GX サニーデューン", "ru-RU": "GX Солнечные дюны",
                             "zh-CN": "GX 阳光沙丘"},
    "track.crystal_cave": {"en-GB": "Crystal Cave", "en-US": "Crystal Cavern", "nl-NL": "Kristalgrot",
                           "de-DE": "Kristallhöhle", "ja-JP": "クリスタルケイブ", "ru-RU": "Хрустальная пещера",
                           "zh-CN": "水晶洞"},
    "track.crystal_castle": {"en-GB": "Crystal Castle", "en-US": "Crystal Castle", "nl-NL": "Kristalkasteel",
                             "de-DE": "Kristallburg", "ja-JP": "クリスタルキャッスル", "ru-RU": "Хрустальный замок",
                             "zh-CN": "水晶城堡"},
    "track.harbour_loop": {"en-GB": "Harbour Loop", "en-US": "Harbor Loop", "nl-NL": "Havenlus",
                           "de-DE": "Hafenschleife", "ja-JP": "ハーバーループ", "ru-RU": "Портовая петля",
                           "zh-CN": "港湾环道"},
    "track.harbour_loop_night": {"en-GB": "Harbour Loop Night", "en-US": "Harbor Loop Night",
                                 "nl-NL": "Havenlus Nacht", "de-DE": "Hafenschleife Nacht",
                                 "ja-JP": "ハーバーループナイト", "ru-RU": "Портовая петля ночью",
                                 "zh-CN": "港湾环道夜"},
    # the same words as Harbour Loop in English: an exact word match is ambiguous there
    "track.loop_harbour": {"en-GB": "Loop Harbour", "nl-NL": "Lus van de haven", "ja-JP": "ループハーバー"},
}


def _vocab(names: dict) -> list[list[str]]:
    return [[f"{item}#{locale}", locales[locale]] for item, locales in names.items() for locale in NAME_LOCALES
            if locale in locales]


def _damage(text: str, rule: int) -> str:
    """Deterministic OCR-like damage: dropped, swapped, doubled and confused characters, case and spacing."""
    confusions = {"o": "0", "l": "1", "i": "l", "e": "c", "a": "o", "n": "m", "s": "5", "т": "г", "ー": "一"}
    if rule == 0:
        return text
    if rule == 1:
        return text.upper()
    if rule == 2:
        return text[:-1]
    if rule == 3:
        return "".join(confusions.get(ch, ch) for ch in text)
    if rule == 4:
        return text[1:] + "."
    if rule == 5:
        return " ".join(text) if len(text) < 8 else text.replace(" ", "")
    if rule == 6:
        middle = len(text) // 2
        return text[:middle] + text[middle] + text[middle:]
    if rule == 7:
        return f"| {text} ~"
    raise ValueError(rule)


def build_name_match() -> dict:
    vocabs = {kind: _vocab(names) for kind, names in PART_NAMES.items()}
    vocabs["tracks"] = _vocab(TRACK_NAMES)
    pairs = {kind: [tuple(p) for p in rows] for kind, rows in vocabs.items()}
    cases = []
    for kind in ("bodies", "tires", "gliders"):
        for item, locales in PART_NAMES[kind].items():
            for n, locale in enumerate(NAME_LOCALES):
                for rule in sorted({0, (n + len(item)) % 8, (n * 3 + 1) % 8}):
                    query = _damage(locales[locale], rule)
                    found = nm.match_name(query, pairs[kind])
                    cases.append({"kind": kind, "query": query, "key": found.key, "name": found.name,
                                  "fuzzy": found.fuzzy, "margin": found.margin, "strong": found.strong()})
    for query in ("", "ab", "  ", "12345", "Zx", "Pebble", "Pebble Kart P", "Thin G", "コメット", "ZXZX", "Lant3rn",
                  "Кометный", "Komeet racer", "0" * 12):
        for kind in ("bodies", "tires"):
            found = nm.match_name(query, pairs[kind])
            cases.append({"kind": kind, "query": query, "key": found.key, "name": found.name, "fuzzy": found.fuzzy,
                          "margin": found.margin, "strong": found.strong()})
    for case in cases:
        case["boundary"] = any(abs(case["fuzzy"] - gate) < BOUNDARY for gate in (0.85, 0.78)) or any(
            abs(case["margin"] - gate) < BOUNDARY for gate in (0.08, 0.25))
    votes = []
    vote_rows = [
        [["bodies", "Komeetracer"], ["tires", "Trommelbanden"], ["gliders", "Bladzeil"]],
        [["bodies", "ZX"], ["tires", "Thin"], ["gliders", "Leaf Sail"]],
        [["bodies", "ZX"], ["tires", "Thin"]],
        [["bodies", "ZX"]],
        [["bodies", "Pebble Cart"], ["tires", "Drum Tires"], ["gliders", "Paper Kite"]],
        [["bodies", "ペブルカート"], ["tires", "ドラムタイヤ"], ["gliders", ""]],
        [["bodies", "Галечный карт"], ["tires", "Тонкие"], ["gliders", "Бумажный змей"]],
        [["bodies", "Kieselkart Pr0"], ["tires", "Dünn Glüh"], ["gliders", "Papierdrachen"]],
        [["bodies", ""], ["tires", ""]],
    ]
    for rows in vote_rows:
        for preferred in ([], ["nl-NL"], ["ja-JP", "en-GB"], ["xx-XX"]):
            got = nm.locale_vote([tuple(r) for r in rows], pairs, list(NAME_LOCALES), preferred)
            votes.append({"rows": rows, "preferred": preferred, "locale": got["locale"], "score": got["score"],
                          "tied": got["tied"], "firstKey": got["firstMatch"].key if got["firstMatch"] else None})
    same_names = []
    for key in ("body.zx#en-GB", "body.zx#ja-JP", "body.comet#en-GB", "body.pebble#en-US", "body.lantern#en-US",
                "body.unknown#en-GB", "body.comet"):
        locales = nm.same_name_locales(pairs["bodies"], key)
        same_names.append({"key": key, "locales": locales,
                           "scripts": sorted({nm.script_for_locale(loc) for loc in locales})})
    subsets = {"all": pairs["tracks"],
               "en-nl": [p for p in pairs["tracks"] if p[0].endswith(("#en-GB", "#en-US", "#nl-NL"))]}
    titles = []
    title_queries = ["Sunny Dunes", "Dunes Sunny", "GX Sunny", "Sunny", "GX Sunny Dunes", "Dunes Sunny GX",
                     "Crystal", "Crystal Ca", "Crystal Cave", "Crysta1 Cavem", "Crystal Castie", "Harbour Loop",
                     "Harbor Loop Nite", "Harbour Lo0p Night", "Havenlus", "Havenlus Nacht", "Kristalgrot",
                     "Kristal kasteel", "Zonnige Duinen", "150cc", "Time Trials", "OK", "", "xx", "サニーデューン",
                     "サニーデュー", "水晶洞", "水晶城", "港湾环道夜", "Портовая петля", "Хрустальный замок",
                     "GX 阳光沙丘", "Loop Harbour", "Night Loop Harbour", "Harbour Loop!", "ハバールーフナイ",
                     "クリスタキャッス", "ハーパールーフナイ卜", "水昌城", "港弯环道", "サニーデュ一ン",
                     "ハバルーフナイ", "パーバールプナ", "クリスキャッ", "港湾道夜x", "サニーデ"]
    for query in title_queries:
        for subset, vocab in subsets.items():
            found = nm.match_title(query, vocab)
            titles.append({"query": query, "subset": subset, "key": found.key, "name": found.name, "rule": found.rule,
                           "fuzzy": found.fuzzy, "margin": found.margin})
    return {"schema": "mk8dx.name-match-vectors.v1",
            "source": "packages/icon-matcher/python/mk8dx_icon_matcher/name_match.py",
            "generator": "packages/icon-matcher/tools/generate_rule_vectors.py",
            "note": "invented names in the product key grammar (<item>#<locale>); no game text, no people",
            "locales": list(NAME_LOCALES), "vocabs": vocabs, "cases": _jsonable(cases), "votes": _jsonable(votes),
            "sameNames": same_names, "titles": _jsonable(titles)}


BUILDERS["name-match"] = (build_name_match, None)


# --------------------------------------------------------------------------------------------------- CLI

NAMES = tuple(BUILDERS)


def build(name: str, pack: str | None) -> bytes | None:
    """The vector's bytes, or None when its pack input is missing."""
    builder, needs = BUILDERS[name]
    if needs is None:
        return dump(builder())
    if needs == "tensors":
        source = gv.tensor_dir(pack)
        present = source is not None and (source / "references.json").is_file()
    else:
        source = frame_definitions_path(pack)
        present = source is not None and source.is_file()
    return dump(builder(source)) if present else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--pack", help="materialized recognition-pack directory")
    parser.add_argument("--only", choices=NAMES)
    parser.add_argument("--out", default=str(VECTORS))
    parser.add_argument("--check", action="store_true", help="fail when a committed vector differs")
    args = parser.parse_args(argv)
    status = 0
    for name in [args.only] if args.only else NAMES:
        data = build(name, args.pack)
        file = f"{name}-v1.json"
        if data is None:
            if args.only:
                parser.error(f"{name} needs --pack (a materialized recognition pack)")
            print(f"skip {file}: no recognition pack", file=sys.stderr)
            continue
        target = Path(args.out) / file
        if args.check:
            same = target.is_file() and target.read_bytes() == data
            print(f"{'ok' if same else 'DIFFERS'} {file}")
            status |= 0 if same else 1
        else:
            target.write_bytes(data)
            print(f"wrote {file} ({len(data)} bytes, {len(json.loads(data)['cases'])} cases)")
    return status


if __name__ == "__main__":
    raise SystemExit(main())
