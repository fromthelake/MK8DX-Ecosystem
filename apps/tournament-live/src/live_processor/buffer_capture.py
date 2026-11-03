"""A ``cv2.VideoCapture``-compatible adapter over buffered frames.

This is the live-faithful seam for V2: the validated frame selector
(``extractor.extract_score_screen_selection.analyze_score_window_task`` and the
helpers it calls) only touch a capture object through this surface:

* ``isOpened()``
* ``get(cv2.CAP_PROP_POS_FRAMES)`` (== ``get(1)``) -> index of the *next* frame to read
* ``get(cv2.CAP_PROP_FRAME_COUNT)`` / ``get(cv2.CAP_PROP_FPS)`` / width/height
* ``set(cv2.CAP_PROP_POS_FRAMES, N)`` -> position the next read at frame ``N``
* ``read()`` -> ``(ok, frame)`` and advance the position by one
* ``grab()`` -> advance one frame without decoding (cheap short forward jumps)
* ``release()``

By serving those calls from a bounded set of *already received* frames (the
rolling buffer fed by the virtual/real capture device), the selector never
reaches back into the original video file. Frames that were never buffered --
i.e. that have not "arrived" yet, or have aged out -- read as ``(False, None)``,
exactly like seeking past the end of a live stream. That is the whole point:
the live path can only ever see what the capture device has delivered.
"""

from __future__ import annotations

from typing import Any, Callable, Mapping

# OpenCV property ids. We hard-code them so this module does not import cv2 at
# import time (the adapter itself is pure-Python); they are stable constants.
CAP_PROP_POS_FRAMES = 1
CAP_PROP_FRAME_WIDTH = 3
CAP_PROP_FRAME_HEIGHT = 4
CAP_PROP_FPS = 5
CAP_PROP_FRAME_COUNT = 7

FrameProvider = Callable[[], Any]


class BufferCapture:
    """Serve buffered frames through the subset of the cv2.VideoCapture API the
    validated selector uses.

    Parameters
    ----------
    frames:
        Mapping of absolute ``frame_index`` -> either a decoded frame
        (``numpy.ndarray``) or a zero-arg provider returning one. Providers let
        callers decode lazily (e.g. from compressed buffer bytes) so only the
        frames the selector actually reads are materialised.
    fps, frame_count, width, height:
        Reported via ``get(...)``. ``frame_count`` defaults to one past the
        highest buffered index so the selector's tail logic behaves; it does not
        imply every index below it is present.
    """

    def __init__(
        self,
        frames: Mapping[int, Any | FrameProvider],
        *,
        fps: float = 30.0,
        frame_count: int | None = None,
        width: int = 0,
        height: int = 0,
    ) -> None:
        # Copy into a plain dict so external mutation can't shift us mid-read.
        self._frames: dict[int, Any | FrameProvider] = dict(frames)
        self._sorted_indices = sorted(self._frames)
        self._fps = float(fps)
        self._width = int(width)
        self._height = int(height)
        highest = (self._sorted_indices[-1] + 1) if self._sorted_indices else 0
        self._frame_count = int(frame_count) if frame_count is not None else highest
        # Position == index of the NEXT frame to be returned by read()/grab().
        self._position = 0
        self._opened = True
        self.reads_served = 0
        self.reads_missed = 0
        self.grabs = 0

    # -- lifecycle -------------------------------------------------------
    def isOpened(self) -> bool:  # noqa: N802 - cv2 API name
        return self._opened

    def release(self) -> None:
        self._opened = False
        self._frames.clear()
        self._sorted_indices = []

    # -- properties ------------------------------------------------------
    def get(self, prop_id: int) -> float:  # noqa: A003 - cv2 API name
        if prop_id == CAP_PROP_POS_FRAMES:
            return float(self._position)
        if prop_id == CAP_PROP_FRAME_COUNT:
            return float(self._frame_count)
        if prop_id == CAP_PROP_FPS:
            return float(self._fps)
        if prop_id == CAP_PROP_FRAME_WIDTH:
            return float(self._width)
        if prop_id == CAP_PROP_FRAME_HEIGHT:
            return float(self._height)
        return 0.0

    def set(self, prop_id: int, value: float) -> bool:  # noqa: A003 - cv2 API name
        if prop_id == CAP_PROP_POS_FRAMES:
            self._position = max(0, int(value))
            return True
        return False

    # -- frame access ----------------------------------------------------
    def _materialise(self, frame_index: int) -> Any | None:
        entry = self._frames.get(frame_index)
        if entry is None:
            return None
        if callable(entry):
            frame = entry()
            # Cache the materialised frame so repeated reads are cheap and stable.
            if frame is not None:
                self._frames[frame_index] = frame
            return frame
        return entry

    def grab(self) -> bool:
        """Advance one frame without decoding, mirroring cv2.VideoCapture.grab()."""
        present = self._position in self._frames
        self.grabs += 1
        self._position += 1
        return bool(present)

    def read(self) -> tuple[bool, Any]:
        frame = self._materialise(self._position)
        self._position += 1
        if frame is None:
            self.reads_missed += 1
            return False, None
        self.reads_served += 1
        return True, frame

    def retrieve(self) -> tuple[bool, Any]:
        # The frame "grabbed" was the one at position-1 after grab() advanced us.
        frame = self._materialise(self._position - 1)
        if frame is None:
            return False, None
        return True, frame

    # -- introspection ---------------------------------------------------
    def buffered_indices(self) -> list[int]:
        return list(self._sorted_indices)

    def stats(self) -> dict[str, int]:
        return {
            "reads_served": self.reads_served,
            "reads_missed": self.reads_missed,
            "grabs": self.grabs,
            "buffered_frames": len(self._sorted_indices),
        }


def build_capture_from_buffer(
    buffer: Any,
    *,
    fps: float,
    decode: Callable[[Any], Any] | None = None,
) -> BufferCapture:
    """Build a :class:`BufferCapture` from a :class:`~live_processor.frame_buffer.RollingFrameBuffer`.

    Each buffered entry contributes a lazy provider that yields its
    full-resolution frame: the preserved raw frame if present, otherwise the
    decoded compressed bytes. ``decode`` defaults to
    ``frame_buffer.decode_compressed_frame``.
    """
    if decode is None:
        from .frame_buffer import decode_compressed_frame as decode  # type: ignore

    frames: dict[int, FrameProvider] = {}
    width = height = 0
    for entry in list(buffer.entries):
        width = width or int(getattr(entry, "frame_width", 0) or 0)
        height = height or int(getattr(entry, "frame_height", 0) or 0)

        def _provider(entry: Any = entry) -> Any:
            if getattr(entry, "full_resolution_frame", None) is not None:
                return entry.full_resolution_frame
            return decode(getattr(entry, "compressed_full_resolution_bytes", None))

        frames[int(entry.frame_index)] = _provider

    return BufferCapture(frames, fps=fps, width=width, height=height)
