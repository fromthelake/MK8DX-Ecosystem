import json
from pathlib import Path

from mk8dx_icon_matcher import detections as dt

VECTORS = Path(__file__).resolve().parents[2] / "vectors" / "detections-v1.json"


def test_reference_reproduces_committed_vectors():
    doc = json.loads(VECTORS.read_text(encoding="utf-8"))
    for c in doc["raw"]:
        assert dt.parse_detections(c["boxes"], c["logits"], c["count"], c["numClasses"], c["width"],
                                   c["height"]) == c["result"]
    for c in doc["layouts"]:
        kept = dt.clean_lap_index(c["detections"])
        assert [c["detections"].index(d) for d in kept] == c["result"]


def test_threshold_and_cap():
    import math
    logit = math.log(0.2 / 0.8)
    out = dt.parse_detections([0.5, 0.5, 0.2, 0.2] * 50, [logit + 1, -9, -9, -9] * 50, 50, 4, 704, 704)
    assert len(out) == dt.MAX_DETECTIONS and all(d["label"] == "ghost_timetrail_box" for d in out)
