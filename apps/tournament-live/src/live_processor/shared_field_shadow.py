"""Opt-in shared reads after Tournament Live's own row selection and JPEG crop.

Only metadata is written. No value from this module changes provisional rows,
whole-event character finalization, Excel/CSV or Director acceptance.
"""

from __future__ import annotations

import json
import sys
from hashlib import sha256
from pathlib import Path
from time import perf_counter

import cv2
import numpy as np
from mk8dx_tournament_extraction.engine.score_layouts import LAN1_SCORE_LAYOUT_ID

from .paths import assert_write_allowed


def _field_package():
    try:
        import mk8dx_icon_matcher
        return mk8dx_icon_matcher
    except ModuleNotFoundError as error:
        if error.name != "mk8dx_icon_matcher":
            raise
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "packages" / "icon-matcher" / "python"
        if (candidate / "mk8dx_icon_matcher" / "field_reader.py").is_file():
            sys.path.insert(0, str(candidate))
            import mk8dx_icon_matcher
            return mk8dx_icon_matcher
    raise ModuleNotFoundError("Shared field package is not staged")


class TournamentFieldShadow:
    def __init__(self, asset_root: Path, output: Path):
        self.api = _field_package()
        self.matcher = self.api.IconMatcher(self.api.ReferenceBank(Path(asset_root)))
        self.output = assert_write_allowed(output)
        db = json.loads((Path(asset_root) / "database.json").read_bytes())
        grid = db["detection"]["scoreboard"]
        if grid["frame"] != {"width": 1280, "height": 720} or grid["character"]["rows"] != 12:
            raise ValueError("Unsupported Tournament score grid")
        if len(self.matcher.references.groups[("flags", "result")].ids) != 110:
            raise ValueError("Expected 110 MK8 flags")
        self.grid = grid
        self.old_ids = {}
        for item in [*db["collections"]["characters"],
                     *db["relationships"]["characterVariants"]]:
            index = item.get("externalIds", {}).get("videoResultExtractor", {}).get("characterIndex")
            if index is not None:
                if int(index) in self.old_ids:
                    raise ValueError("Duplicate legacy character index")
                self.old_ids[int(index)] = item["id"]

    def record_row(self, *, working, frame_hash: str, layout, row: int,
                   character_crop_path: Path, character_box, position_present: bool,
                   old_character):
        """Read the exact JPEG old used; flag uses the catalog's fixed game cell."""
        if working.shape[:2] != (720, 1280) or not 1 <= row <= 12:
            raise ValueError("Expected normalized score frame and row")
        char_crop = cv2.imread(str(character_crop_path), cv2.IMREAD_COLOR)
        if char_crop is None or char_crop.shape[:2] != (character_box[3], character_box[2]):
            raise ValueError("Product character JPEG is missing or has another geometry")
        char_context = self.api.FieldContext(
            "direct_game", "scoreboard", "row", "present" if position_present else "unknown")
        started = perf_counter()
        character = self.api.read_field(
            char_crop, "characters", "scoreboard", char_context, self.matcher)
        character_ms = round((perf_counter() - started) * 1000, 3)
        profile = "1p" if layout.layout_id == LAN1_SCORE_LAYOUT_ID else "2p"
        flag = self.grid["flag"]
        x = self.grid["layouts"][profile]["flagLeft"]
        y = flag["cropY0"] + flag["rowStep"] * (row - 1)
        flag_box = (x, y, flag["cropWidth"], flag["cropHeight"])
        flag_crop = working[y:y + flag_box[3], x:x + flag_box[2]]
        if flag_crop.shape[:2] != (flag_box[3], flag_box[2]):
            raise ValueError("Tournament flag cell outside normalized frame")
        gray = cv2.cvtColor(flag_crop, cv2.COLOR_BGR2GRAY)
        contrast = float(gray.std())
        horizontal_edge = float(np.max(np.abs(np.diff(gray.mean(axis=1)))))
        gate = flag["presence"]
        if not position_present:
            presence = "unknown"
        elif contrast < gate["minContrast"] and horizontal_edge < gate["minHorizontalEdge"]:
            presence = "absent"
        elif contrast < gate["minContrast"] or horizontal_edge < gate["minHorizontalEdge"]:
            presence = "unknown"
        else:
            presence = "present"
        flag_context = self.api.FieldContext("direct_game", "scoreboard", "row", presence)
        started = perf_counter()
        flag_read = self.api.read_field(flag_crop, "flags", "result", flag_context,
                                        self.matcher)
        flag_ms = round((perf_counter() - started) * 1000, 3)
        old_index = (int(Path(old_character.candidates[0]["template"]).stem)
                     if old_character.candidates else None)
        old_top1 = self.old_ids.get(old_index)
        old_id = old_top1 if old_character.status == "CHARACTER_EXTRACTED" else None
        record = {"schema": "mk8dx.tournament-row-field-shadow.v1",
                  "catalogSha256": self.matcher.references.catalog_sha256,
                  "framePixelSha256": frame_hash, "layoutId": layout.layout_id,
                  "row": row, "positionPresent": position_present,
                  "characterBox": list(character_box),
                  "characterJpegSha256": sha256(character_crop_path.read_bytes()).hexdigest(),
                  "oldCharacter": {"top1Id": old_top1, "acceptedId": old_id,
                                   "score": old_character.confidence,
                                   "status": old_character.status},
                  "character": character, "characterMs": character_ms,
                  "flagBox": list(flag_box),
                  "flagPresence": {"contrast": round(contrast, 3),
                                   "horizontalEdge": round(horizontal_edge, 3)},
                  "flag": flag_read, "flagMs": flag_ms}
        self.output.parent.mkdir(parents=True, exist_ok=True)
        with self.output.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, separators=(",", ":")) + "\n")
