"""Compare label-free family colour metrics on paired private icon crops.

The first pass selects the family. Each second-pass metric sees only the same
hashed crop and the Clean Assets for that family. Truth enters after ranking.
This probe cannot change any product decision or acceptance threshold.
"""

from __future__ import annotations

import argparse
from hashlib import sha256
import json
from pathlib import Path
import statistics
import sys
from time import perf_counter

import cv2
import numpy as np

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "packages/icon-matcher/python"))
from mk8dx_icon_matcher import IconMatcher, ReferenceBank  # noqa: E402
from mk8dx_icon_matcher.matcher import BOX  # noqa: E402


def _linear(rgb: np.ndarray) -> np.ndarray:
    return np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)


def _oklab(rgb: np.ndarray) -> np.ndarray:
    linear = _linear(rgb)
    lms = linear @ np.array([[.4122214708, .2119034982, .0883024619],
                             [.5363325363, .6806995451, .2817188376],
                             [.0514459929, .1073969566, .6299787005]], dtype=np.float32)
    return np.cbrt(np.maximum(lms, 0)) @ np.array(
        [[.2104542553, 1.9779984951, .0259040371],
         [.7936177850, -2.4285922050, .7827717662],
         [-.0040720468, .4505937099, -.8086757660]], dtype=np.float32)


def _space(rgb: np.ndarray, name: str) -> np.ndarray:
    if name == "rgb":
        return rgb
    if name == "linear_rgb":
        return _linear(rgb)
    if name.startswith("lab"):
        lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
        return lab * np.array([.01, 1 / 128, 1 / 128], dtype=np.float32)
    if name == "oklab":
        return _oklab(rgb) * np.array([1., 2.5, 2.5], dtype=np.float32)
    if name == "ycrcb":
        return cv2.cvtColor(rgb, cv2.COLOR_RGB2YCrCb) * np.array([.5, 2., 2.], dtype=np.float32)
    if name.startswith("hsv"):
        hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
        angle = np.deg2rad(hsv[:, :, 0])
        saturation = hsv[:, :, 1]
        value_weight = 1. if name == "hsv_balanced" else .5
        return np.stack((saturation * np.cos(angle), saturation * np.sin(angle),
                         hsv[:, :, 2] * value_weight), axis=2)
    raise ValueError(name)


def _calibrate(query: np.ndarray, reference: np.ndarray, anchor: np.ndarray,
               method: str) -> np.ndarray:
    # One transform for the whole family, inferred from low-variance shared
    # pixels. Never fit a different white balance to the candidate being tested.
    q = query[anchor]
    r = reference[:, anchor].mean(axis=0)
    if method == "whitebalance":
        gain = np.clip(np.median(r, axis=0) / np.maximum(np.median(q, axis=0), .03),
                       .75, 1.33)
        return np.clip(query * gain[None, None], 0, 1).astype(np.float32)
    if method == "affine":
        qlo, qhi = np.percentile(q, (10, 90), axis=0)
        rlo, rhi = np.percentile(r, (10, 90), axis=0)
        gain = np.clip((rhi - rlo) / np.maximum(qhi - qlo, .06), .75, 1.33)
        offset = np.clip(rlo - gain * qlo, -.08, .08)
        return np.clip(query * gain[None, None] + offset[None, None], 0, 1).astype(np.float32)
    raise ValueError(method)


def rank(crop: np.ndarray, kind: str, profile: str, family: str,
         matcher: IconMatcher, offset: tuple[int, int]) -> dict[str, list[tuple[str, float]]]:
    group = matcher.references.groups[(kind, profile)]
    indices = [i for i, candidate_family in enumerate(group.families)
               if candidate_family == family]
    references = group.rgb[indices]
    ids = [group.ids[i] for i in indices]
    masks = np.stack([cv2.erode((group.mask[i] > .15).astype(np.uint8),
                                np.ones((3, 3), np.uint8)) > 0 for i in indices])
    common = np.all(masks, axis=0)
    spread = (references.max(axis=0) - references.min(axis=0)).max(axis=2)
    query = cv2.cvtColor(cv2.resize(crop, BOX[kind], interpolation=cv2.INTER_AREA),
                         cv2.COLOR_BGR2RGB)
    if offset != (0, 0):
        query = cv2.warpAffine(query, np.float32([[1, 0, offset[0]], [0, 1, offset[1]]]),
                               BOX[kind], flags=cv2.INTER_LINEAR,
                               borderMode=cv2.BORDER_REPLICATE)
    query = query.astype(np.float32) / 255
    anchor = common & (spread <= np.percentile(spread[common], 30))
    if anchor.sum() < 24:
        anchor = common
    balanced = _calibrate(query, references, anchor, "whitebalance")
    affine = _calibrate(query, references, anchor, "affine")
    result = {}
    methods = (("rgb", "rgb", query, None),
               ("linear_rgb", "linear_rgb", query, None),
               ("lab_equal", "lab_equal", query, None),
               ("lab_chroma", "lab_chroma", query, (0.5, 1.5, 1.5)),
               ("oklab", "oklab", query, None),
               ("oklab_chroma", "oklab", query, (.5, 1., 1.)),
               ("oklab_lightness", "oklab", query, (1.5, 1., 1.)),
               ("ycrcb", "ycrcb", query, None),
               ("hsv_balanced", "hsv_balanced", query, None),
               ("hsv_colour", "hsv_colour", query, None),
               ("rgb_whitebalance", "rgb", balanced, None),
               ("rgb_affine", "rgb", affine, None),
               ("lab_affine", "lab_equal", affine, None),
               ("oklab_whitebalance", "oklab", balanced, None),
               ("oklab_affine", "oklab", affine, None))
    for percentile in (70, 80, 85, 90, 95):
        area = common & (spread >= np.percentile(spread[common], percentile))
        if area.sum() < 24:
            continue
        for label, colour_space, target, weights in methods:
            if percentile not in (70, 85) and label not in (
                    "rgb", "oklab", "oklab_chroma", "oklab_lightness"):
                continue
            ref_space = np.stack([_space(one, colour_space) for one in references])
            query_space = _space(target, colour_space)
            delta = np.abs(ref_space[:, area] - query_space[area][None])
            if weights is not None:
                delta *= np.asarray(weights, dtype=np.float32)[None, None]
            distances = delta.mean(axis=(1, 2))
            order = np.argsort(distances, kind="stable")
            result[f"{label}_p{percentile}"] = [(ids[i], round(float(distances[i]), 6))
                                                    for i in order]
    return result


def _capture_stress(manifest: Path, input_root: Path, matcher: IconMatcher,
                    method_names: list[str]) -> dict:
    """Bounded colour changes to real direct-capture crops, validation only."""
    raw = manifest.read_bytes()
    rows = []
    for case in json.loads(raw)["cases"]:
        if case.get("group") != "bodies":
            continue
        path = (input_root / case["cropFile"]).resolve(strict=True)
        if input_root.resolve() not in path.parents or sha256(path.read_bytes()).hexdigest() != case["cropSha256"]:
            raise ValueError(f"Unpaired capture crop: {case['caseId']}")
        original = cv2.imread(str(path), cv2.IMREAD_COLOR)
        rgb = cv2.cvtColor(original, cv2.COLOR_BGR2RGB).astype(np.float32) / 255
        for condition in ("original", "dim10", "bright10", "sat90", "sat110",
                          "warm", "cool", "blur3"):
            adjusted = rgb.copy()
            if condition in ("dim10", "bright10", "sat90", "sat110"):
                hsv = cv2.cvtColor(adjusted, cv2.COLOR_RGB2HSV)
                if condition.startswith("sat"):
                    hsv[:, :, 1] = np.clip(hsv[:, :, 1] * (.9 if condition == "sat90" else 1.1), 0, 1)
                else:
                    hsv[:, :, 2] = np.clip(hsv[:, :, 2] * (.9 if condition == "dim10" else 1.1), 0, 1)
                adjusted = cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB)
            elif condition in ("warm", "cool"):
                gains = (1.04, 1., .96) if condition == "warm" else (.96, 1., 1.04)
                adjusted = np.clip(adjusted * np.asarray(gains, dtype=np.float32), 0, 1)
            crop = (original.copy() if condition == "original" else
                    cv2.cvtColor((adjusted * 255).astype(np.uint8), cv2.COLOR_RGB2BGR))
            if condition == "blur3":
                crop = cv2.GaussianBlur(original, (3, 3), 0)
            primary = matcher.match(crop, "bodies", profile="result",
                                    search_mode="center_then_shortlist", top_k=4)
            family = primary.family_top[0].family_id
            if len(primary.family_top[0].variants) > 1:
                orders = rank(crop, "bodies", "result", family, matcher, primary.offset)
                choices = {key: order[0][0] for key, order in orders.items()}
            else:
                choices = {key: primary.top[0].id for key in method_names}
            rows.append({"caseId": case["caseId"], "condition": condition,
                         "truth": case["truth"], "familyFirst": matcher.references.family[case["truth"]] == family,
                         "primary": primary.top[0].id, "choices": choices})
    conditions = sorted({row["condition"] for row in rows})
    summary = {condition: {"cases": len(subset),
                           "sourceFrames": len({row["caseId"].rsplit("-", 1)[0] for row in subset}),
                           "familyFirst": sum(row["familyFirst"] for row in subset),
                           "primaryExact": sum(row["primary"] == row["truth"] for row in subset),
                           "methods": {key: sum(row["choices"][key] == row["truth"] for row in subset)
                                       for key in method_names}}
               for condition in conditions
               for subset in [[row for row in rows if row["condition"] == condition]]}
    return {"manifestSha256": sha256(raw).hexdigest(), "summary": summary, "rows": rows}


def run(sets: list[tuple[str, Path, Path]], asset_root: Path, output: Path,
        stress_capture: bool = False) -> dict:
    destination = output.resolve()
    if destination.exists() or destination == REPO or REPO in destination.parents:
        raise ValueError("Choose a new private report outside Git")
    bank = ReferenceBank(asset_root)
    matcher = IconMatcher(bank)
    report = {"schema": "mk8dx.private-family-colour-space-probe.v1",
              "catalogSha256": bank.catalog_sha256,
              "sourceSha256": sha256(Path(__file__).read_bytes()).hexdigest(), "sets": {}}
    summaries = {}
    for name, manifest, input_root in sets:
        raw = manifest.read_bytes()
        rows = []
        for case in json.loads(raw)["cases"]:
            kind = case.get("kind", case.get("group"))
            if kind not in ("characters", "bodies") or name.startswith("body_") and kind != "bodies":
                continue
            profile = case.get("profile", "result")
            path = (input_root / case["cropFile"]).resolve(strict=True)
            if input_root.resolve() not in path.parents or sha256(path.read_bytes()).hexdigest() != case["cropSha256"]:
                raise ValueError(f"Unpaired crop: {name}/{case['caseId']}")
            crop = cv2.imread(str(path), cv2.IMREAD_COLOR)
            started = perf_counter()
            primary = matcher.match(crop, kind, profile=profile,
                                    search_mode="center_then_shortlist", top_k=4)
            primary_ms = (perf_counter() - started) * 1000
            family = primary.family_top[0].family_id
            if len(primary.family_top[0].variants) < 2:
                continue
            started = perf_counter()
            orders = rank(crop, kind, profile, family, matcher, primary.offset)
            probe_ms = (perf_counter() - started) * 1000
            source_group = (case.get("sourceGroup") or case.get("groupId") or
                            case.get("sourceKey") or case["caseId"].rsplit("-", 1)[0])
            rows.append({"caseId": case["caseId"],
                         "sourceGroup": source_group,
                         "cropSha256": case["cropSha256"], "truth": case["truth"],
                         "familyFirst": bank.family[case["truth"]] == family,
                         "primary": primary.top[0].id, "primaryMs": round(primary_ms, 3),
                         "probeMs": round(probe_ms, 3),
                         "top3": {key: choices[:3] for key, choices in orders.items()}})
        eligible = [row for row in rows if row["familyFirst"]]
        methods = list(eligible[0]["top3"]) if eligible else []
        summary = {"cases": len(rows), "eligible": len(eligible),
                   "sourceGroups": len({row["sourceGroup"] for row in eligible}),
                   "primaryExact": sum(row["primary"] == row["truth"] for row in eligible),
                   "primaryMedianMs": round(statistics.median(row["primaryMs"] for row in eligible), 3),
                   "probeMedianMsAllMethods": round(statistics.median(row["probeMs"] for row in eligible), 3),
                   "methods": {key: {"exact": sum(row["top3"][key][0][0] == row["truth"]
                                                    for row in eligible),
                                     "regressions": [row["caseId"] for row in eligible
                                                     if row["primary"] == row["truth"]
                                                     and row["top3"][key][0][0] != row["truth"]],
                                     "fixes": [row["caseId"] for row in eligible
                                               if row["primary"] != row["truth"]
                                               and row["top3"][key][0][0] == row["truth"]]}
                               for key in methods}}
        report["sets"][name] = {"manifestSha256": sha256(raw).hexdigest(),
                                "summary": summary, "rows": rows}
        summaries[name] = summary
    if stress_capture:
        direct = next(((manifest, root) for name, manifest, root in sets
                       if name == "body_direct"), None)
        if direct is None:
            raise ValueError("Capture stress requires a body_direct set")
        report["captureStress"] = _capture_stress(direct[0], direct[1], matcher,
                                                  list(summaries["body_direct"]["methods"]))
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return summaries


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--set", nargs=3, action="append", metavar=("NAME", "MANIFEST", "INPUT_ROOT"), required=True)
    parser.add_argument("--asset-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--capture-stress", action="store_true")
    args = parser.parse_args()
    summary = run([(name, Path(manifest), Path(root)) for name, manifest, root in args.set],
                  args.asset_root, args.output, args.capture_stress)
    print(json.dumps({name: {"eligible": item["eligible"], "primaryExact": item["primaryExact"],
                             "methods": {key: value["exact"] for key, value in item["methods"].items()}}
                      for name, item in summary.items()}))


if __name__ == "__main__":
    main()
