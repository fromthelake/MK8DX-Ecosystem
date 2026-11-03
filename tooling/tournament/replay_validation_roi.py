"""Profile-derived review overlays, explicitly NOT historical per-call traces.

Only known tagged 1280x720 score frames are eligible. No label or score approval
is produced. Untagged consensus neighbors require a unique same-folder tagged
anchor; mixed/unknown layouts and raw source dimensions stay missing.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def explicit_layout(path):
    name = Path(path).stem
    for tag, layout in (("lan2_split_2p", "lan2_split_2p"), ("lan1_full_1p", "lan1_full_1p"),
                        ("2p", "lan2_split_2p"), ("1p", "lan1_full_1p")):
        if re.search(r"(?:^|[+_])" + re.escape(tag) + r"(?:$|[+_])", name):
            return layout
    return None


def position_tile_rectangle(index, layout, module):
    """Mirror extract_position_tile_match_crops geometry, without processing pixels."""
    (base_x, base_y), _ = layout.base_position_strip_roi
    start, end = module.position_template_tile_windows()[index]
    x1 = max(0, min(1280, int(base_x) + int(module.POSITION_TEMPLATE_TILE_X_OFFSET)))
    x2 = max(x1, min(1280, int(base_x) + int(module.POSITION_TEMPLATE_TILE_X_OFFSET)
                     + int(module.POSITION_TEMPLATE_TILE_WIDTH)))
    y1 = max(0, min(720, int(base_y) + int(module.POSITION_TEMPLATE_TILE_Y_OFFSET) + start))
    y2 = max(y1, min(720, int(base_y) + int(module.POSITION_TEMPLATE_TILE_Y_OFFSET) + end))
    return ((x1, y1), (x2, y2))


def frame_overlay(path, layout_module, character_module, historical_source=None):
    from PIL import Image

    path = Path(path)
    with Image.open(path) as frame:
        size = list(frame.size)
    stage = "race_score" if path.parent.name == "2RaceScore" else "total_score" if path.parent.name == "3TotalScore" else "unknown"
    layout_id = explicit_layout(path)
    layout_evidence = str(path)
    if layout_id is None and stage != "unknown":
        anchors = [(anchor, explicit_layout(anchor)) for anchor in path.parent.glob("anchor_*")]
        known = {value for _, value in anchors if value}
        if len(known) == 1:
            layout_id = next(iter(known))
            layout_evidence = str(next(anchor for anchor, value in anchors if value == layout_id))
    record = {"frameSha256": sha256(path), "path": str(path), "stage": stage, "space": size,
              "layoutId": layout_id, "layoutEvidence": layout_evidence,
              "status": "missing", "roi": [], "humanApproval": "none"}
    if size != [1280, 720] or not layout_id or stage == "unknown":
        record["reason"] = "Requires known tagged score layout and normalized 1280x720 score frame"
        return record
    layout_source, character_source = Path(layout_module.__file__), Path(character_module.__file__)
    record["layoutVersion"] = {"maintainedSource": str(layout_source), "maintainedSha256": sha256(layout_source),
        "characterSource": str(character_source), "characterSha256": sha256(character_source),
        "historicalProfileSource": str(historical_source) if historical_source else None,
        "historicalProfileSha256": sha256(historical_source) if historical_source else None,
        "historicalProfileUse": "reference_hash_only_not_executed_or_parity_proven"}
    provenance = "profile-derived (not observed per-call); explicit tagged canonical720 frame; maintained shared engine"
    layout = layout_module.get_score_layout(layout_id)
    digit_layout = character_module.score_digit_layout(scale_factor=5, score_layout_id=layout_id)
    def append_rectangle(field, rectangle, role, symbol):
        (x1, y1), (x2, y2) = rectangle
        record["roi"].append({"field": field, "box": [x1, y1, x2-x1, y2-y1],
                              "space": [1280, 720], "provenance": provenance,
                              "role": role, "sourceSymbol": symbol})

    for index in range(12):
        rectangles = {"playerName": layout.player_name_coords[index],
                      "character": character_module.character_row_roi(index, score_layout_id=layout_id),
                      "totalPoints": layout.total_points_coords[index],
                      "positionTile": position_tile_rectangle(index, layout, character_module)}
        if stage == "race_score":
            rectangles["racePoints"] = layout.race_points_coords[index]
        for field, rectangle in rectangles.items():
            symbol = ("extract_position_tile_match_crops" if field == "positionTile" else
                      "character_row_roi" if field == "character" else "get_score_layout")
            append_rectangle(f"{field}[{index+1}]", rectangle,
                             "position-template" if field == "positionTile" else "field-region", symbol)
        for field, key in (("racePointsDigit", "race_points"), ("totalPointsDigit", "total_points")):
            if key == "race_points" and stage != "race_score":
                continue
            starts, row_step, (width, height), _probes, _rows, _digits = digit_layout[key]
            for digit, (x, y) in enumerate(starts):
                values = (x, y + index * row_step, width, height)
                if any(value % 5 for value in values):
                    raise ValueError("Digit layout no longer maps to integral canonical720 coordinates")
                x1, y1, width1, height1 = (value // 5 for value in values)
                append_rectangle(f"{field}[{index+1}][{digit+1}]",
                                 ((x1, y1), (x1+width1, y1+height1)),
                                 "digit-sample", "score_digit_layout(scale_factor=5); inverse scale to canonical720")
    record["scoreFieldSemantics"] = {
        "racePoints": "detected screen points; not placement-derived exported RacePoints" if stage == "race_score" else "not read by default on TotalScore",
        "totalPoints": "OldTotalScore (may already be rolling upward)" if stage == "race_score" else "NewTotalScore",
        "positionTile": "row template and visible-row evidence; not an OCR numeric result",
    }
    record["status"] = "profile_derived_not_per_call"
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frames", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--historical-layout-source", type=Path)
    parser.add_argument("--reference-root", type=Path, required=True,
                        help="Reviewed private runtime root containing data/ and reference_data/ (read-only)")
    args = parser.parse_args()
    sys.dont_write_bytecode = True
    root = Path(__file__).resolve().parents[2]
    if args.output.resolve().is_relative_to(root) or any(args.output.resolve().is_relative_to(folder.resolve()) for folder in args.frames):
        raise ValueError("Output must be outside repository and source frames")
    if args.output.exists():
        raise FileExistsError(args.output)
    reference = args.reference_root.resolve()
    if not (reference / "data/mii_allowed_chars.json").is_file() or not (reference / "reference_data/game_catalog.json").is_file():
        raise ValueError("Reference root must contain data/mii_allowed_chars.json and reference_data/game_catalog.json")
    os.environ["MK8DX_TOURNAMENT_REFERENCE_ROOT"] = str(reference)
    os.environ["MK8DX_TOURNAMENT_ENGINE_DATA_ROOT"] = str(reference)
    sys.path.insert(0, str(root / "packages/tournament-extraction/python/src"))
    from mk8dx_tournament_extraction.engine import score_layouts, ocr_scoreboard_consensus

    paths = sorted({p for folder in args.frames for p in folder.rglob("*")
                    if p.suffix.lower() in {".jpg", ".png", ".webp"}})
    output = {"schema": "mk8dx.review-profile-roi.v1", "provenance": "profile-derived (not observed per-call)",
              "sourceRoots": [str(folder.resolve()) for folder in args.frames],
              "frames": [frame_overlay(p, score_layouts, ocr_scoreboard_consensus, args.historical_layout_source) for p in paths]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as handle:
        json.dump(output, handle, ensure_ascii=False)
    print(json.dumps({"frames": len(output["frames"]), "profileDerived": sum(bool(f["roi"]) for f in output["frames"])}))


if __name__ == "__main__":
    main()
