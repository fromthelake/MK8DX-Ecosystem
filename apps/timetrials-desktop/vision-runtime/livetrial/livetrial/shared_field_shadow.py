"""Opt-in paired icon reads on LiveTrial's actual selected field ROIs.

This module writes decision metadata only to the caller's local evidence root.
It never changes a product identity or score.
"""

from __future__ import annotations

import json
import sys
from hashlib import sha256
from pathlib import Path
from time import perf_counter


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


class SharedFieldShadow:
    def __init__(self, asset_root: Path, output: Path):
        self.api = _field_package()
        self.matcher = self.api.IconMatcher(self.api.ReferenceBank(Path(asset_root)))
        self.output = Path(output)
        self.asset_root = Path(asset_root)
        self._anchors = False

    def card_anchors(self):
        """The shared card-anchors file (MK8DX_CARD_ANCHORS, else next to the
        Clean Assets folder), or None when it is not staged."""
        if self._anchors is False:
            import os
            override = os.environ.get("MK8DX_CARD_ANCHORS", "").strip()
            path = Path(override) if override else self.asset_root.parent / "card-anchors-v1.json"
            module = __import__(self.api.__name__ + ".card_presence", fromlist=["CardAnchors"])
            self._anchors = module.CardAnchors.load(path) if path.is_file() else None
        return self._anchors

    def read(self, *, source, box, kind, profile, presence, owner, screen,
             character=None, text=None):
        """Read one field without evidence I/O for the QA-only candidate route."""
        x, y, w, h = (int(round(value)) for value in box)
        crop = source[max(0, y):y + h, max(0, x):x + w]
        clue = self.api.TextClue(*text) if text else None
        screen_kind = "ghost_select" if screen in ("collapsed", "expanded") else "result_card"
        context = self.api.FieldContext("direct_game", screen_kind, owner,
                                        presence, clue, character)
        return self.api.read_field(crop, kind, profile, context, self.matcher,
                                   shape_review=kind in ("tires", "flags"),
                                   flag_exposure_review=(kind == "flags"
                                                         and profile == "result"),
                                   neutral_chroma_review=(kind == "characters"
                                                          and profile == "result"))

    def record(self, frame, *, source, box, kind, profile, presence,
               old_id, old_score, owner, screen, character=None, text=None,
               frame_hash=None, product_box=None):
        x, y, w, h = (int(round(value)) for value in box)
        crop = source[max(0, y):y + h, max(0, x):x + w]
        px, py, pw, ph = (int(round(value)) for value in
                          (product_box if product_box is not None else box))
        product_crop = source[max(0, py):py + ph, max(0, px):px + pw]
        start = perf_counter()
        field = self.read(source=source, box=box, kind=kind, profile=profile,
                          presence=presence, owner=owner, screen=screen,
                          character=character, text=text)
        elapsed = round((perf_counter() - start) * 1000, 3)
        record = {"screen": screen, "owner": owner, "kind": kind,
                  "framePixelSha256": frame_hash or sha256(frame.tobytes()).hexdigest(),
                  "box": [x, y, w, h], "productBox": [px, py, pw, ph],
                  "productCropPixelSha256": sha256(product_crop.tobytes()).hexdigest(),
                  "oldId": old_id,
                  "oldScore": old_score, "candidate": field,
                  "candidateMs": elapsed}
        self.output.parent.mkdir(parents=True, exist_ok=True)
        with self.output.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, separators=(",", ":")) + "\n")
        return field
