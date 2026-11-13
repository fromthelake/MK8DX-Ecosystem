"""Write the remaining public cross-runtime parity vectors from the Python reference (issue #99, phase 1).

    python packages/icon-matcher/tools/generate_rule_vectors.py [--pack DIR] [--only NAME] [--check]

A sibling of ``generate_vectors.py`` (context-v1, icon-score-v1), sharing its JSON form and pack loading.
Outputs in packages/icon-matcher/vectors/:

* ``refinement-v1.json``: the opt-in refinement evidence on synthetic box-sized queries made from the
  pack's own references: shape rank (shape_rank.py), distinctive flag rank, NL/LU band ratio and NL/LU/PY
  tricolour (flag_rank.py), flag exposure (flag_exposure.py), character family colour (family_colour.py)
  and neutral chroma (neutral_chroma.py). Each case carries the upstream inputs Python computed (the
  visual read, the shape rank, the shortlisted IDs), so a runtime replays one refinement at a time.

refinement needs the tensor pack:
``node tooling/assets/materialize_collection.mjs recognition-pack <dir>`` then ``--pack <dir>`` (or
MK8DX_RECOGNITION_PACK). Deterministic (no RNG, sorted
keys, LF); ``--check`` fails when a committed file differs. Cases within 1e-5 of a threshold carry
``"boundary": true``; runtimes report rather than fail on those until the arithmetic is unified.
"""

from __future__ import annotations

import argparse
import base64
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
