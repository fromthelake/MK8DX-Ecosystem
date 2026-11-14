"""Write vectors/crop-search-v1.json from the Python reference of the Web/Android icon crop search
(python/mk8dx_icon_matcher/crop_search.py; issue #99, phase 3).

The file holds the searcher's ``constants`` (each runtime checks its shared module against them),
``helperCases`` (one call per branch of every step function the Web scanner and Android call, issue #99
phase 4) and two kinds of whole-search case, all replayed by Python, TypeScript and Java through the
decision functions (``decide_field``, ``ts/sharedCropSearch.ts``, ``CropSearch.java``):

- ``synthetic``: hand-built measurements on every branch and rounding edge of the decision;
- ``public-test-set``: real crops. The browser scanner reads the public test set
  (``packages/assets/test-set``) and ``tools/capture_crop_search_web.mjs`` records the canonical card it
  handed to ``matchCard`` and every crop-search result. The Python reference then searches the same
  canonical card itself. A case stores only numbers: the slot, the measurements of each look (nominal
  score, the five best references of the position pass, the shifted score), the decision, and what the
  Web scanner decided (``web``). No pixels are stored; the capture stays outside the repository.

  PYTHONPATH=packages/icon-matcher/python python packages/icon-matcher/tools/generate_crop_search_vectors.py \\
      --capture <capture.json.gz> --clean-assets apps/timetrials-scanner-web/public/assets/clean_assets
  python packages/icon-matcher/tools/generate_crop_search_vectors.py --check      # synthetic part current,
                                                                                  # real cases kept as committed
"""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
import sys
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE / "python"))

import numpy as np  # noqa: E402

from mk8dx_icon_matcher import crop_search as cs  # noqa: E402

OUT = PACKAGE / "vectors" / "crop-search-v1.json"
TEST_SET = PACKAGE.parents[1] / "packages" / "assets" / "test-set"
SCHEMA = "mk8dx.crop-search-vectors.v1"
KEEP_CANDIDATES = 5
FIELDS = (("character", "characters"), ("kart", "bodies"), ("glider", "gliders"))


def look(scale=1.0, box=(40, 30, 48, 48), search=10, subset=None, center=0.8, candidates=(), shifted=None):
    return {"scale": scale, "box": list(box), "search": search, "subset": subset, "centerScore": center,
            "candidates": [list(c) for c in candidates], "shiftedScore": shifted}


def synthetic_cases() -> list[dict]:
    """One case per branch of the decision and per rounding edge."""
    W, H = 1280, 720
    slot = [40, 30, 48, 48]
    cases = []

    def add(name, looks, slot_=slot, width=W, height=H):
        cases.append({"name": name, "source": "synthetic", "width": width, "height": height,
                      "slot": list(slot_), "roiOffset": [0, 0], "looks": looks})

    add("no_shift_center_position", [look(candidates=[["a", 2000.0, 100.0, 10, 10]])])
    add("shift_accepted_higher", [look(candidates=[["a", 2000.0, 100.0, 13, 7]], shifted=0.85)])
    add("shift_accepted_equal_score", [look(candidates=[["a", 2000.0, 100.0, 13, 7]], shifted=0.8)])
    add("shift_rejected_lower", [look(candidates=[["a", 2000.0, 100.0, 13, 7]], shifted=0.7999)])
    add("first_strict_maximum_wins", [look(candidates=[["a", 2000.0, 100.0, 3, 4], ["b", 4000.0, 200.0, 17, 15],
                                                       ["c", 2000.0, 99.0, 0, 20]], shifted=0.9)])
    add("tie_keeps_first_reference", [look(candidates=[["a", 2000.0, 100.0, 3, 4], ["b", 4000.0, 200.0, 17, 15]],
                                           shifted=0.9)])
    add("small_template_does_not_vote", [look(candidates=[["a", 23.0, 0.0, 0, 0], ["b", 2000.0, 300.0, 12, 9]],
                                              shifted=0.81)])
    add("template_sum_24_votes", [look(candidates=[["a", 24.0, 0.0, 1, 2], ["b", 2000.0, 300.0, 12, 9]],
                                       shifted=0.81)])
    add("subset_filters_votes", [look(subset=["b"], candidates=[["a", 2000.0, 0.0, 0, 0], ["b", 2000.0, 300.0, 12, 9]],
                                      shifted=0.81)])
    add("empty_subset_no_vote", [look(subset=[], candidates=[["a", 2000.0, 0.0, 0, 0]], shifted=0.99)])
    add("no_candidates", [look(candidates=[])])
    add("window_clipped_left_top", [look(box=(3, 2, 48, 48), candidates=[["a", 2000.0, 1.0, 0, 0]], shifted=0.9)],
        slot_=[3, 2, 48, 48])
    add("window_clipped_right_bottom", [look(box=(1228, 668, 48, 48), candidates=[["a", 2000.0, 1.0, 14, 12]],
                                             shifted=0.9)], slot_=[1228, 668, 48, 48])
    add("template_under_8px", [look(box=(40, 30, 7.49, 48), candidates=[["a", 2000.0, 1.0, 0, 0]], shifted=0.99)])
    add("template_rounds_to_8px", [look(box=(40, 30, 7.5, 48), candidates=[["a", 2000.0, 1.0, 0, 0]], shifted=0.99)])
    add("window_smaller_than_template", [look(box=(0, 0, 48, 48), candidates=[["a", 2000.0, 1.0, 0, 0]],
                                              shifted=0.99)], width=40, height=60, slot_=[0, 0, 48, 48])
    add("nominal_clipped_to_one_pixel", [look(box=(1300, 30, 48, 48), candidates=[["a", 2000.0, 1.0, 0, 0]],
                                              shifted=0.99)], slot_=[1300, 30, 48, 48])
    add("box_half_rounds_up", [look(box=(39.5, 29.5, 47.5, 47.5), candidates=[["a", 2000.0, 1.0, 0, 0]],
                                    shifted=0.9)])
    add("box_negative_half_rounds_up", [look(box=(-0.5, -2.5, 48, 48), candidates=[["a", 2000.0, 1.0, 5, 3]],
                                             shifted=0.9)], slot_=[0, 0, 48, 48])
    scales = list(cs.CHARACTER_SCALES)

    def sweep(scores, shifts=None):
        out = []
        for i, (scale, score) in enumerate(zip(scales, scores)):
            w = 48 * scale
            box = (40 + (48 - w) / 2.0, 30 + (48 - w) / 2.0, w, w)
            cand, shifted = [], None
            if shifts and shifts[i]:
                cand, shifted = [["a", 2000.0, 1.0, 10 + shifts[i][0], 10 + shifts[i][1]]], shifts[i][2]
            out.append(look(scale, box, 10, None, score, cand, shifted))
        return out

    add("sweep_best_scale", sweep([0.80, 0.81, 0.83, 0.82, 0.79, 0.78, 0.70]))
    add("sweep_tie_keeps_first_scale", sweep([0.80, 0.83, 0.83, 0.82, 0.83, 0.78, 0.70]))
    add("sweep_shift_wins", sweep([0.80, 0.81, 0.80, 0.82, 0.79, 0.78, 0.70],
                                  [None, None, (2, -3, 0.86), None, None, None, None]))
    add("sweep_largest_scale", sweep([0.70, 0.71, 0.72, 0.73, 0.74, 0.75, 0.76]))
    add("sweep_crop_box_half_up", sweep([0.70, 0.71, 0.72, 0.73, 0.74, 0.75, 0.76]), slot_=[40, 30, 45, 45])
    cases.append({"name": "boosted_region_offsets", "source": "synthetic", "width": 84, "height": 84,
                  "slot": [600, 400, 48, 48], "roiOffset": [582, 382],
                  "looks": [look(1.0, (18, 18, 48, 48), 10, None, 0.8, [["a", 2000.0, 1.0, 4, 13]], 0.82)]})
    add("part_glider_6px", [look(1.0, (300, 500, 80, 50), 6, ["glider.a", "glider.b"],
                                 0.77, [["glider.a", 9000.0, 900.0, 6, 6], ["glider.b", 9000.0, 800.0, 11, 1]], 0.79)],
        slot_=[300, 500, 80, 50])
    for case in cases:
        case["expected"] = cs.decide_field(case)
    return cases


def constants() -> dict:
    """The searcher's constants: each runtime's shared module must hold exactly these."""
    return {"characterScales": list(cs.CHARACTER_SCALES), "searchPx": dict(cs.SEARCH_PX),
            "boostMargin": cs.BOOST_MARGIN, "boostSatMin": cs.BOOST_SAT_MIN, "boostSatMax": cs.BOOST_SAT_MAX,
            "boostSatTarget": cs.BOOST_SAT_TARGET, "boostMaxFactor": cs.BOOST_MAX_FACTOR,
            "windowGainMin": cs.WINDOW_GAIN_MIN, "windowGainMax": cs.WINDOW_GAIN_MAX,
            "minWindowMean": cs.MIN_WINDOW_MEAN, "minTemplatePx": cs.MIN_TEMPLATE_PX, "minCropPx": cs.MIN_CROP_PX,
            "minTemplateSum": cs.MIN_TEMPLATE_SUM}


def helper_cases() -> list[dict]:
    """The step functions the products call, one case per branch and edge: ``fn``, ``args``, ``expected``."""
    calls = [
        ("searchPx", ["characters"]), ("searchPx", ["bodies"]), ("searchPx", ["gliders"]),
        ("searchWindow", [40, 30, 48, 48, 1280, 720, 10]), ("searchWindow", [3, 2, 48, 48, 1280, 720, 10]),
        ("searchWindow", [1228, 668, 48, 48, 1280, 720, 6]), ("searchWindow", [40, 30, 7, 48, 1280, 720, 10]),
        ("searchWindow", [40, 30, 8, 8, 1280, 720, 10]), ("searchWindow", [0, 0, 48, 48, 40, 60, 10]),
        ("windowGain", [0.5, 0.0001]), ("windowGain", [0.5, 0.00010001]), ("windowGain", [0.5, 0.25]),
        ("windowGain", [0.5, 1.0]), ("windowGain", [0.5, 0.9]), ("windowGain", [0.5, 0.2]),
        ("windowGain", [0.45, 0.3]), ("windowGain", [0.3, 0.6]), ("windowGain", [0.4, 0.0]),
        ("votes", ["a", 24.0, None]), ("votes", ["a", 23.999, None]), ("votes", ["a", 2000.0, ["a", "b"]]),
        ("votes", ["c", 2000.0, ["a", "b"]]), ("votes", ["a", 2000.0, []]),
        ("pickedShift", [[30, 20, 98, 88], [10, 10], 40, 30]), ("pickedShift", [[30, 20, 98, 88], [13, 7], 40, 30]),
        ("pickedShift", [[0, 0, 61, 60], [0, 0], 3, 2]),
        ("acceptShift", [0.8, 0.8]), ("acceptShift", [0.8001, 0.8]), ("acceptShift", [0.7999, 0.8]),
        ("boostRegion", [[600, 400, 48, 48], 1280, 720]), ("boostRegion", [[5, 7, 48, 48], 1280, 720]),
        ("boostRegion", [[1250, 700, 48, 48], 1280, 720]), ("boostRegion", [[570, 120, 83, 77], 1280, 720]),
        ("boostFactor", [1.0]), ("boostFactor", [1.0001]), ("boostFactor", [30.0]), ("boostFactor", [45.0]),
        ("boostFactor", [61.37]), ("boostFactor", [79.999]), ("boostFactor", [80.0]), ("boostFactor", [0.0]),
        ("betterLook", [0.8, None]), ("betterLook", [0.8, 0.8]), ("betterLook", [0.8001, 0.8]),
        ("betterLook", [0.0, None]),
        ("cropBox", [[40, 30, 48, 48], 1.0, 0, 0]), ("cropBox", [[40, 30, 45, 45], 0.94, -3, 2]),
        ("cropBox", [[570, 120, 48, 48], 0.96, -4, 0]), ("cropBox", [[0, 0, 7, 7], 0.94, 0, 0]),
        ("cropBox", [[443, 83, 83, 77], 1.06, 5, -1]),
    ]
    for scale in cs.CHARACTER_SCALES:
        calls.append(("lookBox", [[570, 120, 48, 48], scale, 0, 0]))
        calls.append(("lookBox", [[600, 400, 45, 47], scale, 582, 382]))
    fns = {"searchPx": cs.search_px, "searchWindow": cs.search_window, "windowGain": cs.window_gain,
           "votes": lambda rid, total, subset: cs.votes(rid, total, None if subset is None else set(subset)),
           "pickedShift": cs.picked_shift, "acceptShift": cs.accept_shift, "boostRegion": cs.boost_region,
           "boostFactor": cs.boost_factor, "lookBox": cs.look_box, "betterLook": cs.better_look,
           "cropBox": cs.crop_box}
    return [{"fn": fn, "args": args, "expected": fns[fn](*args)} for fn, args in calls]


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _truncate(candidates: list) -> list:
    """The five best references of the position pass (all ties at the top), in reference order: the
    decision over them equals the decision over all."""
    if not candidates:
        return []
    scores = [1.0 - c[2] / c[1] for c in candidates]
    top = max(scores)
    ranked = sorted(range(len(candidates)), key=lambda i: -scores[i])[:KEEP_CANDIDATES]
    keep = set(ranked) | {i for i, s in enumerate(scores) if s == top}
    return [candidates[i] for i in sorted(keep)]


def real_cases(capture_path: Path, clean_assets: Path) -> tuple[list[dict], dict]:
    capture = json.loads(gzip.decompress(capture_path.read_bytes()))
    if capture.get("schema") != "mk8dx.crop-search-web-capture.v1":
        raise SystemExit("not a crop-search capture")
    groups = cs.load_clean_assets(clean_assets)
    cases, frames = [], {}
    for frame in capture["frames"]:
        frames[frame["file"]] = _sha256(TEST_SET / frame["file"])
        for card in frame["cards"]:
            pixels = base64.b64decode(card["pixels"])
            canonical = np.frombuffer(pixels, np.uint8).reshape(card["rows"], card["cols"], card["channels"])
            canonical = np.ascontiguousarray(canonical[..., :3])
            for field, group in FIELDS:
                web = card["fields"].get(field)
                if not web or not web.get("slot_xywh") or web.get("reason") in ("low_contrast", "slot_outside_canonical"):
                    continue
                calls = [c for c in card["calls"] if c["group"] == group]
                if not calls:
                    continue
                slot = [int(v) for v in web["slot_xywh"]]
                subset = None if calls[0]["subset"] is None else set(calls[0]["subset"])
                trace: dict = {}
                if field == "character":
                    got = cs.search_character(canonical, slot, groups[group], card["yellowCard"], subset, trace=trace)
                else:
                    got = cs.search_part(canonical, slot, groups[group], subset, trace=trace)
                for one in trace["looks"]:
                    one["candidates"] = _truncate(one["candidates"])
                name = f"{frame['file']}|{card['owner']}|{card['raceKey']}|{field}"
                case = {"name": name, "source": "public-test-set", "frame": frame["file"], "owner": card["owner"],
                        "field": field, "group": group, "yellowCard": card["yellowCard"], **trace, "slot": slot}
                case["expected"] = cs.decide_field(case)
                pixel = {"scale": got["scale"], "dx": got["dx"], "dy": got["dy"], "score": got["score"],
                         "id": got["id"]}
                case["python"] = pixel
                # The field record's score is the shared reader's by now; the search's own result is the
                # call at the field's scale.
                scale = web["scale"] if web["scale"] is not None else 1.0
                kept = calls[cs.CHARACTER_SCALES.index(scale)] if field == "character" else calls[0]
                case["web"] = {"scale": scale, "dx": web["dx"] or 0, "dy": web["dy"] or 0,
                               "score": kept["result"]["score"], "id": kept["result"]["top3"][0][0],
                               "cropBox": web.get("shared_crop_xywh")}
                case["webLooks"] = [{"dx": c["result"]["dx"], "dy": c["result"]["dy"], "score": c["result"]["score"]}
                                    for c in calls]
                cases.append(case)
    return cases, frames


def build(capture: Path | None, clean_assets: Path | None) -> dict:
    previous = json.loads(OUT.read_text(encoding="utf-8")) if OUT.is_file() else {}
    if capture is not None:
        if clean_assets is None:
            raise SystemExit("--capture needs --clean-assets")
        real, frames = real_cases(capture, clean_assets)
        source = {"cleanAssetsPackSha256": _sha256(clean_assets / "pack.json"), "testSetFiles": frames}
    else:
        real = [c for c in previous.get("cases", []) if c["source"] != "synthetic"]
        source = previous.get("realSource", {})
    return {"schema": SCHEMA, "generator": "packages/icon-matcher/tools/generate_crop_search_vectors.py",
            "realSource": source, "constants": constants(), "helperCases": helper_cases(),
            "cases": synthetic_cases() + real}


def dump(doc: dict) -> str:
    return json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--capture", type=Path)
    parser.add_argument("--clean-assets", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    text = dump(build(args.capture, args.clean_assets))
    if args.check:
        if OUT.read_bytes().decode("utf-8") != text:
            print(f"{OUT.name} is not current", file=sys.stderr)
            return 1
        print(f"{OUT.name} current")
        return 0
    OUT.write_bytes(text.encode("utf-8"))
    doc = json.loads(text)
    real = [c for c in doc["cases"] if c["source"] != "synthetic"]
    agree = sum(1 for c in real if all(c["python"][k] == c["web"][k] for k in ("scale", "dx", "dy", "score")))
    print(f"wrote {OUT.name}: {len(doc['cases']) - len(real)} synthetic, {len(real)} real cases "
          f"({agree} identical to the Web scanner)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
