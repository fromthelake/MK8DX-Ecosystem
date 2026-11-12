"""A full-range capture card's recording is not refused for its colour-range tag (2026-11-10)."""
from live_processor import recording


def test_full_range_tag_is_the_same_layout():
    assert recording._same_pixel_layout("yuvj420p", "yuv420p")
    assert recording._same_pixel_layout("yuv420p", "yuv420p")
    assert not recording._same_pixel_layout("yuv422p", "yuv420p")
    assert not recording._same_pixel_layout("nv12", "yuv420p")
