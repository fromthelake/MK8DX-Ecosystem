"""Write vectors/canonical-warp-v1.json from the Python reference of the canonical card geometry before
the crop (python/mk8dx_icon_matcher/canonical_warp.py; issue #99, phase 5).

The file holds the ``constants`` (each runtime checks its shared module against them), ``helperCases``
(one call per branch of every step function) and whole-geometry ``cases``, replayed by Python,
TypeScript (``ts/sharedCanonicalWarp.ts``) and Java (``CanonicalWarp.java``):

- ``synthetic``: hand-built cards on every branch (seeds, target boxes, clipping, the anti-alias
  reduction, a registered panel);
- ``public-test-set``: real cards. The browser scanner reads the public test set
  (``packages/assets/test-set``) and ``tools/capture_canonical_warp_web.mjs`` records the numbers of its
  stage 17 and 18 OpenCV calls. A case keeps the card quad, the frame size, the homography OpenCV solved
  and the target the scanner chose; the reference must give the same destination corners, alignment,
  composed and final matrix and warp source size, double for double (``web``). Numbers only.

  PYTHONPATH=packages/icon-matcher/python python packages/icon-matcher/tools/generate_canonical_warp_vectors.py \\
      --capture <capture.json> --grid apps/timetrials-scanner-web/public/assets/grid
  python packages/icon-matcher/tools/generate_canonical_warp_vectors.py --check   # synthetic part current,
                                                                                # real cases kept as committed
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE / "python"))

from mk8dx_icon_matcher import canonical_warp as cw  # noqa: E402

OUT = PACKAGE / "vectors" / "canonical-warp-v1.json"
SCHEMA = "mk8dx.canonical-warp-vectors.v1"
IDENTITY = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
H_TILT = [1.0123, -0.0187, -14.25, 0.0091, 0.9874, 6.5, 1.2e-5, -3.4e-6, 1.0]


def constants() -> dict:
    return {"canonicalSize": list(cw.CANONICAL_SIZE), "playerBoxRace7": list(cw.PLAYER_BOX_RACE7),
            "ghostBoxRace7": list(cw.GHOST_BOX_RACE7), "ghostDetailBoxRace3": list(cw.GHOST_DETAIL_BOX_RACE3),
            "ghostDetailBoxRace7": list(cw.GHOST_DETAIL_BOX_RACE7),
            "antialiasBelowScale": cw.ANTIALIAS_BELOW_SCALE, "antialiasTargetScale": cw.ANTIALIAS_TARGET_SCALE,
            "contentKeys": list(cw.CONTENT_KEYS)}


GRID_FLAT = {"anchor": {"x": 10.5, "y": 20.25}, "lap_index_boxes_rel": [1.0, 2.0, 30.0, 12.0],
             "total_strip_rel": [40.0, -3.0, 210.0, 15.5]}
GRID_NESTED = {"anchor": {"x": 100.0, "y": 50.0},
               "lap_index_boxes_rel": [[0.0, 0.0, 20.0, 20.0], [0.0, 30.0, 20.0, 50.0], [[0.0, 60.0, 20.0, 80.0]]],
               "lap_strips_rel": [[30.0, 0.0, 300.0, 20.0], [30.0, 30.0, 300.0, 50.0]],
               "total_strip_rel": [30.0, 90.0, 320.0, 112.0]}
GRID_NO_ANCHOR = {"total_strip_rel": [5.0, 6.0, 7.0, None]}
GRID_REVERSED = {"anchor": {"x": 50.0, "y": 50.0}, "lap_strips_rel": [[30.0, 20.0, -10.0, -5.0], [0.0, 0.0, 4.0, 4.0]]}
GRID_EMPTY = {"anchor": {"x": 1.0, "y": 1.0}, "lap_strips_rel": []}
RACE3 = [596.0, 98.0, 1180.0, 290.0]
RACE7 = [592.0, 70.0, 1185.0, 326.0]


def helper_cases() -> list[dict]:
    calls = [
        ("boundingRect", [[[830.5554809570312, 203.7795], [1844.55, 203.7795], [1844.55, 533.78], [830.55, 533.78]], 1920, 1080]),
        ("boundingRect", [[[-12.5, -3.2], [700.0, -1.0], [701.0, 400.0], [-11.0, 401.5]], 640, 360]),
        ("boundingRect", [[[2000.0, 1200.0], [2100.0, 1200.0], [2100.0, 1300.0], [2000.0, 1300.0]], 1920, 1080]),
        ("boundingRect", [[[10.0, 10.0], [10.0, 10.0], [10.0, 10.0], [10.0, 10.0]], 100, 100]),
        ("quadFromRect", [[830, 203, 1015, 331]]),
        ("quadFromRect", [[0, 0, 1, 1]]),
        ("shiftedQuad", [[[0, 0], [639, 0], [639, 359], [0, 359]], 12.75, 3.5]),
        ("quadBox", [[[3.0, 9.5], [1.0, 2.0], [7.25, 4.0], [5.0, 11.0]]]),
        ("contentExtent", [GRID_FLAT]),
        ("contentExtent", [GRID_NESTED]),
        ("contentExtent", [GRID_NO_ANCHOR]),
        ("contentExtent", [GRID_REVERSED]),
        ("contentExtent", [GRID_EMPTY]),
        ("contentExtent", [None]),
        ("targetBox", ["player", "race7", False, None, None]),
        ("targetBox", ["ghost", "race7", False, None, None]),
        ("targetBox", ["player", "race3", False, RACE3, RACE7]),
        ("targetBox", ["ghost", "race3", False, RACE3, RACE7]),
        ("targetBox", ["player", "race3", False, None, RACE7]),
        ("targetBox", ["ghost", "race3", False, RACE3, None]),
        ("targetBox", ["ghost", "race3", True, None, None]),
        ("targetBox", ["ghost", "race7", True, None, None]),
        ("targetBox", ["player", "unknown", False, None, None]),
        ("canonicalAlign", [[830.0, 203.0, 1844.0, 533.0], [548.0, 42.0, 1231.0, 349.0]]),
        ("canonicalAlign", [[5.0, 5.0, 5.5, 5.0], [548.0, 362.0, 1231.0, 661.0]]),
        ("canonicalAlign", [[100.0, 100.0, 300.0, 200.0], [10.0, 10.0, 10.5, 10.25]]),
        ("alignMatrix", [[0.6728136094674556, 0.6545454545454547, -9.668295857988142, -16.87272727272733]]),
        ("compose", [[0.5, 0.0, 3.0, 0.0, 0.25, -7.0, 0.0, 0.0, 1.0], H_TILT]),
        ("compose", [H_TILT, [2.0, 0.0, 0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 1.0]]),
        ("antialiasPlan", [[0.2, 0.3, 1.0, 1.0], 4032, 3024]),
        ("antialiasPlan", [[0.5, 0.3, 1.0, 1.0], 4000, 3000]),
        ("antialiasPlan", [[0.6, 0.5, 1.0, 1.0], 4000, 3000]),
        ("antialiasPlan", [[0.0, 0.3, 1.0, 1.0], 4000, 3000]),
        ("antialiasPlan", [[-0.2, 0.3, 1.0, 1.0], 4000, 3000]),
        ("antialiasPlan", [[0.001, 0.001, 0.0, 0.0], 100, 100]),
    ]
    fns = {"boundingRect": cw.bounding_rect, "quadFromRect": cw.quad_from_rect, "shiftedQuad": cw.shifted_quad,
           "quadBox": cw.quad_box, "contentExtent": cw.content_extent, "targetBox": cw.target_box,
           "canonicalAlign": cw.canonical_align, "alignMatrix": cw.align_matrix, "compose": cw.compose,
           "antialiasPlan": cw.antialias_plan}
    return [{"fn": fn, "args": args, "expected": fns[fn](*args)} for fn, args in calls]


def card(name, quad, frame=(1920, 1080), seed="geometric_quad", owner="player", race_key="race7", ghost_detail=False,
         race3=None, race7=None, homography=IDENTITY, registration=None, deskew_roi=None) -> dict:
    case = {"name": name, "source": "synthetic", "frame": list(frame), "quad": [list(p) for p in quad], "seed": seed,
            "deskewRoi": deskew_roi, "owner": owner, "raceKey": race_key, "ghostDetail": ghost_detail,
            "race3Content": race3, "race7Content": race7, "homography": list(homography),
            "registration": registration}
    case["expected"] = cw.canonical_transform(case)
    return case


def synthetic_cases() -> list[dict]:
    hdmi = [[547.6, 361.4], [1231.3, 361.9], [1230.8, 661.2], [548.1, 660.7]]
    phone = [[1210.4, 980.25], [3102.9, 1010.5], [3080.0, 1905.75], [1190.5, 1880.0]]
    return [
        card("hdmi_player_race7", hdmi, frame=(1280, 720)),
        card("hdmi_ghost_race7_tilted", hdmi, frame=(1280, 720), owner="ghost", homography=H_TILT),
        card("phone_player_race3_derived", phone, frame=(4032, 3024), race_key="race3", race3=RACE3, race7=RACE7,
             homography=H_TILT),
        card("phone_ghost_race3_derived", phone, frame=(4032, 3024), owner="ghost", race_key="race3", race3=RACE3,
             race7=RACE7),
        card("race3_without_grid_falls_back", phone, frame=(4032, 3024), race_key="race3", race7=RACE7),
        card("antialias_large_photo", [[400.0, 900.0], [3800.0, 900.0], [3800.0, 2400.0], [400.0, 2400.0]],
             frame=(4032, 3024)),
        card("antialias_boundary_half_scale", [[100.0, 100.0], [1466.0, 100.0], [1466.0, 698.0], [100.0, 698.0]],
             frame=(1920, 1080)),
        card("quad_clipped_at_the_frame", [[-20.4, -8.6], [1300.2, -2.0], [1295.0, 731.9], [-15.0, 728.0]],
             frame=(1280, 720)),
        card("ghost_detail_race3_registered", [[540.2, 170.4], [782.6, 170.0], [782.0, 331.5], [540.0, 331.0]],
             frame=(1280, 720), owner="ghost", race_key="race3", ghost_detail=True,
             registration=[1.002, 0.001, -0.8, -0.0007, 0.999, 1.25, 1e-6, 0.0, 1.0]),
        card("ghost_detail_race7", [[530.0, 110.0], [770.0, 112.0], [771.0, 380.0], [531.0, 383.0]], frame=(1280, 720),
             owner="ghost", ghost_detail=True, homography=H_TILT),
        card("ghost_detail_deskew_seed", [[530.0, 110.0], [770.0, 112.0], [771.0, 380.0], [531.0, 383.0]],
             frame=(1280, 720), seed=cw.GHOST_DETAIL_DESKEW_SEED, deskew_roi=[512.75, 96.5, 281, 301], owner="ghost",
             race_key="race3", ghost_detail=True),
    ]


# ---------------------------------------------------------------- the real cards of the Web capture

def f32(value: float) -> float:
    return struct.unpack("f", struct.pack("f", value))[0]


def _grid(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _extent(grid: dict, race_key: str, owner: str):
    race = grid.get(race_key) or {}
    return cw.content_extent((race.get("owners") or {}).get(owner))


def _attempts(calls: list[dict]):
    """Stage 17 and 18 of every seed attempt: the perspective solve and warp, the alignment gemm, an
    optional anti-alias gemm, the canonical warp, and an optional registration gemm with its warp."""
    i = 0
    while i < len(calls):
        c = calls[i]
        nxt = calls[i + 1] if i + 1 < len(calls) else None
        if not (c["fn"] == "getPerspectiveTransform" and nxt and nxt["fn"] == "warpPerspective"
                and nxt["size"] == nxt["srcSize"]):
            i += 1
            continue
        attempt = {"solve": c, "frame": nxt["srcSize"], "gemms": [], "warps": []}
        j = i + 2
        while j < len(calls) and not (calls[j]["fn"] == "getPerspectiveTransform" and j + 1 < len(calls)
                                      and calls[j + 1]["fn"] == "warpPerspective"
                                      and calls[j + 1]["size"] == calls[j + 1]["srcSize"]):
            if calls[j]["fn"] == "gemm":
                attempt["gemms"].append(calls[j])
            elif calls[j]["fn"] == "warpPerspective" and calls[j]["size"] == list(cw.CANONICAL_SIZE):
                attempt["warps"].append(calls[j])
            j += 1
        yield attempt
        i = j


def real_cases(capture: dict, grid_dir: Path) -> tuple[list[dict], dict]:
    grids = {"endscreen": _grid(grid_dir / "new_relative_grid_combined.json"),
             "ghost_detail": _grid(grid_dir / "ghost_detail_relative_grid.json")}
    cases, skipped = [], {"deskewSeed": 0, "noCanonicalWarp": 0, "noTarget": 0}
    for frame in capture["frames"]:
        diag = frame["diagnostics"] or {}
        diag_quad = diag.get("quad")
        ghost_detail = frame["layout"] == "ghost_detail"
        grid = grids[frame["layout"]]
        for n, attempt in enumerate(_attempts(frame["calls"])):
            src = attempt["solve"]["src"]
            quad = [[src[2 * k], src[2 * k + 1]] for k in range(4)]
            if diag_quad and all(f32(diag_quad[k][a]) == quad[k][a] for k in range(4) for a in range(2)):
                quad = [[float(v) for v in p] for p in diag_quad]   # the scanner's own (double) quad
            cols, rows = attempt["frame"]
            dst = attempt["solve"]["dst"]
            destination = [[dst[2 * k], dst[2 * k + 1]] for k in range(4)]
            if destination != cw.quad_from_rect(cw.bounding_rect(quad, cols, rows)):
                skipped["deskewSeed"] += 1   # the upright-ROI destination: the ROI's fractional origin is not recorded
                continue
            if not attempt["gemms"] or not attempt["warps"]:
                skipped["noCanonicalWarp"] += 1
                continue
            homography = attempt["solve"]["out"]
            affine = attempt["gemms"][0]["a"]
            chosen = None
            for owner in ("ghost",) if ghost_detail else ("player", "ghost"):
                for race_key in ("race7", "race3"):
                    case = {"name": f"{frame['file']}#{n}", "source": "public-test-set", "frame": [cols, rows],
                            "quad": quad, "seed": "recorded_quad", "deskewRoi": None, "owner": owner, "raceKey": race_key,
                            "ghostDetail": ghost_detail,
                            "race3Content": None if ghost_detail else _extent(grid, "race3", owner),
                            "race7Content": None if ghost_detail else _extent(grid, "race7", owner),
                            "homography": homography, "registration": None}
                    if cw.align_matrix(cw.canonical_align(cw.quad_box(destination),
                                                          cw.target_box(owner, race_key, ghost_detail,
                                                                        case["race3Content"],
                                                                        case["race7Content"])["box"])) == affine:
                        chosen = chosen or case
            if chosen is None:
                skipped["noTarget"] += 1
                continue
            gemms = attempt["gemms"]
            registration = None
            if len(attempt["warps"]) > 1:
                registration = gemms[-1]["a"]
            chosen["registration"] = registration
            chosen["expected"] = cw.canonical_transform(chosen)
            chosen["web"] = {"destination": destination, "affine": affine,
                             "composed": attempt["warps"][0]["m"], "final": attempt["warps"][-1]["m"],
                             "warpSource": attempt["warps"][-1]["srcSize"]}
            cases.append(chosen)
    return cases, skipped


def build(capture_path: Path | None, grid_dir: Path | None) -> dict:
    doc = {"schema": SCHEMA, "generator": "packages/icon-matcher/tools/generate_canonical_warp_vectors.py",
           "constants": constants(), "helperCases": helper_cases(), "cases": synthetic_cases()}
    if capture_path is not None:
        capture = json.loads(capture_path.read_text(encoding="utf-8"))
        real, skipped = real_cases(capture, grid_dir)
        doc["cases"] += real
        doc["realSource"] = {"testSet": "packages/assets/test-set", "frames": len(capture["frames"]),
                             "skipped": skipped}
    else:
        committed = json.loads(OUT.read_text(encoding="utf-8"))
        doc["cases"] += [case for case in committed["cases"] if case["source"] != "synthetic"]
        if "realSource" in committed:
            doc["realSource"] = committed["realSource"]
    return doc


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--capture", type=Path)
    parser.add_argument("--grid", type=Path, help="the scanner's materialized assets/grid folder")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.capture is not None and args.grid is None:
        parser.error("--capture needs --grid")
    text = json.dumps(build(args.capture, args.grid), indent=1) + "\n"
    if args.check:
        if OUT.read_text(encoding="utf-8") != text:
            print(f"{OUT.name} is not current; run the generator")
            return 1
        print(f"{OUT.name} is current")
        return 0
    OUT.write_bytes(text.encode("utf-8"))
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
