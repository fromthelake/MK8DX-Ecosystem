"""The Python ReferenceBank equals the committed recognition pack's tensor-pack (issue #99, divergence 4).

Python rebuilds its reference tensors from the Clean Assets PNGs at run time (cv2.imread, INTER_AREA, alpha
mask); the browser and Android load the pack's sha-pinned tensors. This test proves both are the same bytes.

It needs a materialized recognition pack and skips without one:

    node tooling/assets/materialize_collection.mjs recognition-pack <absolute-dir>
    MK8DX_RECOGNITION_PACK=<absolute-dir>

or point MK8DX_SHARED_ICON_PACK at its tensor-pack/ and MK8_CLEAN_ASSETS_ROOT at its clean-assets/.
"""

from __future__ import annotations

from hashlib import sha256
import json
import os
from pathlib import Path
import sys

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mk8dx_icon_matcher.matcher import ReferenceBank


def _pack_dirs() -> tuple[Path | None, Path | None]:
    root = os.environ.get("MK8DX_RECOGNITION_PACK")
    tensors = os.environ.get("MK8DX_SHARED_ICON_PACK") or (str(Path(root) / "tensor-pack") if root else None)
    assets = os.environ.get("MK8_CLEAN_ASSETS_ROOT") or (str(Path(root) / "clean-assets") if root else None)
    return (Path(tensors) if tensors else None), (Path(assets) if assets else None)


TENSORS, ASSETS = _pack_dirs()
pytestmark = pytest.mark.skipif(
    not (TENSORS and (TENSORS / "references.json").is_file() and ASSETS and (ASSETS / "database.json").is_file()),
    reason="recognition pack not materialized (set MK8DX_RECOGNITION_PACK)")


def _tensor(spec: dict) -> bytes:
    data = (TENSORS / spec["file"]).read_bytes()
    assert len(data) == spec["bytes"] and sha256(data).hexdigest() == spec["sha256"], spec["file"]
    return data


@pytest.fixture(scope="module")
def pack():
    manifest = json.loads((TENSORS / "references.json").read_text(encoding="utf-8"))
    return manifest, ReferenceBank(ASSETS)


def test_catalog_and_group_set_are_the_same(pack):
    manifest, bank = pack
    assert manifest["schema"] == "mk8dx.shared-icon-references.v1"
    assert bank.catalog_sha256 == manifest["catalogSha256"]
    assert {f"{kind}__{profile}" for kind, profile in bank.groups} == set(manifest["groups"])


def test_reference_tensors_masks_and_counts_are_bit_identical(pack):
    manifest, bank = pack
    report = {}
    for key, spec in sorted(manifest["groups"].items()):
        kind, profile = key.split("__")
        group = bank.groups[(kind, profile)]
        width, height = spec["size"]
        n = len(spec["ids"])
        assert list(group.ids) == spec["ids"], key
        assert list(group.families) == spec["families"], key
        rgb = np.frombuffer(_tensor(spec["tensors"]["rgb"]), dtype="<f4").reshape(n, height, width, 3)
        mask = np.frombuffer(_tensor(spec["tensors"]["mask"]), dtype=np.uint8).reshape(n, height, width)
        count = np.frombuffer(_tensor(spec["tensors"]["count"]), dtype="<f4")
        assert group.rgb.shape == rgb.shape and group.rgb.dtype == np.float32, key
        delta = np.abs(group.rgb - rgb).reshape(n, -1).max(1)
        mask_delta = (group.mask.astype(np.uint8) != mask).reshape(n, -1).sum(1)
        differing = [spec["ids"][i] for i in np.flatnonzero((delta > 0) | (mask_delta > 0))]
        report[key] = {"maxAbs": float(delta.max()), "maskPixels": int(mask_delta.sum()), "entries": differing[:10]}
        assert np.array_equal(group.count.astype(np.float32), count), key
    assert all(not item["entries"] for item in report.values()), report


def test_part_context_relations_are_the_same(pack):
    manifest, bank = pack
    context = manifest["context"]
    assert context["schema"] == "mk8dx.part-context.v1"
    assert {(kind, family, character): part for kind, family, character, part in context["partForCharacter"]} \
        == bank.part_for_character
    assert dict(context["tireByIndex"]) == bank.tire_by_index
