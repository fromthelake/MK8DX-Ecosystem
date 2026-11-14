"""LiveTrial's own icon crop search takes its decision steps from the shared rule (issue #99, phase 5)."""

import importlib
import sys
from pathlib import Path

import numpy as np
import pytest

DESKTOP = Path(__file__).resolve().parents[1]
ENGINE = DESKTOP / "vision-runtime" / "livetrial"
OVERLAY = DESKTOP / "engine-overlay" / "livetrial" / "livetrial" / "identity_matcher.py"


@pytest.fixture()
def matcher(monkeypatch):
    pytest.importorskip("cv2")
    monkeypatch.syspath_prepend(str(ENGINE))
    module = importlib.import_module("livetrial.identity_matcher")
    state = dict(module._STATE)
    yield module
    module._STATE.clear()
    module._STATE.update(state)
    sys.modules.pop("livetrial.identity_matcher", None)


def test_overlay_and_engine_copies_are_the_same_file() -> None:
    assert OVERLAY.read_bytes() == (ENGINE / "livetrial" / "identity_matcher.py").read_bytes()


def test_the_rules_are_the_shared_crop_search(matcher) -> None:
    rules = matcher._crop_search_rules()
    assert rules.__name__.endswith("mk8dx_icon_matcher.crop_search")
    assert (rules.WINDOW_GAIN_MIN, rules.WINDOW_GAIN_MAX, rules.MIN_TEMPLATE_SUM, rules.MIN_TEMPLATE_PX) == (0.6, 1.8, 24.0, 8)


def _synthetic_group(rng):
    refs = rng.uniform(0.05, 0.95, size=(3, 12, 14, 3)).astype(np.float32)
    mask = np.ones((3, 12, 14), dtype=np.float32)
    mask[:, :2, :] = 0.0
    return {"ids": ["character.a", "character.b", "character.c"], "rgb": refs, "mask": mask,
            "masksum": mask.sum((1, 2))}


def test_the_search_finds_a_displaced_icon(matcher, monkeypatch) -> None:
    rng = np.random.default_rng(99)
    group = _synthetic_group(rng)
    matcher._STATE.clear()
    matcher._STATE.update({"loaded": True, "groups": {"characters": group}})

    def identify_crop(crop_bgr, name, *, subset_ids=None, offsets=None, gain_correct=True, topk=0):
        # A plain masked score against the three references, enough to rank them.
        q = crop_bgr[:, :, ::-1].astype(np.float32) / 255.0
        if q.shape[:2] != group["rgb"].shape[1:3]:
            return {"id": None, "score": 0.0, "margin": 0.0, "top3": []}
        d = (np.abs(group["rgb"] - q[None]).sum(3) * group["mask"]).sum((1, 2))
        scores = 1.0 - d / (group["masksum"] * 3.0)
        order = np.argsort(-scores, kind="stable")
        return {"id": group["ids"][order[0]], "score": round(float(scores[order[0]]), 4),
                "margin": round(float(scores[order[0]] - scores[order[1]]), 4),
                "top3": [[group["ids"][k], round(float(scores[k]), 4)] for k in order[:3]]}

    monkeypatch.setattr(matcher, "identify_crop", identify_crop)
    image = (rng.uniform(0, 1, size=(60, 80, 3)) * 255).astype(np.uint8)
    icon = (group["rgb"][1][:, :, ::-1] * 255.0 + 0.5).astype(np.uint8)
    image[23:35, 33:47] = icon            # the icon sits 3 px right of and 2 px above the nominal box
    out = matcher.identify_crop_search(image, (30.0, 25.0, 14.0, 12.0), "characters", search=6,
                                       gain_correct=False)
    assert (out["id"], out["dx"], out["dy"]) == ("character.b", 3, -2)
    assert out["score"] > 0.99

    # An image that cannot hold the whole crop runs no position pass (the shared search_window).
    out = matcher.identify_crop_search(image[:11, :20], (0.0, 0.0, 14.0, 12.0), "characters", search=6,
                                       gain_correct=False)
    assert (out["dx"], out["dy"], out["score"]) == (0, 0, 0.0)
