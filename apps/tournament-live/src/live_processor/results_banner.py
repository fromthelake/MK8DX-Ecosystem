"""Diagnostic: which race-ending message the LAN score screen showed.

Before the scoreboard settles, the game rolls a black banner over row 12 with
Race.msbt 9105 "The results are in! The race is over." (or 9106/9107 for a
time-out or a player too far behind), in the console's language. This module
reads that banner around the selected race-score frame and records the message
identity and the locales that print it (`result["results_banner"]`).

It never changes the selection: a banner says the race is decided, not that
the scoreboard is complete (row 12 is under it). Any failure is recorded and
swallowed. Off by default while Tournament Live is parked (it also runs in the
recorded post-analysis); `MK8DX_TOURNAMENT_BANNER_OCR=1` switches it on.
"""

from __future__ import annotations

import os
import time
from functools import lru_cache
from typing import Any

import cv2  # type: ignore

from mk8dx_tournament_extraction import game_messages  # type: ignore

from .baseline_vision import crop_and_upscale_image
from .display_assets import clean_assets_root

WINDOW_SECONDS = 3.0      # banner frames lie before the settled scoreboard...
STEP_SECONDS = 0.5        # ...one sample per half second is enough (it stays ~2 s)
MAX_ATTEMPTS = 4          # OCR reads per race (the prefilter is cheap, OCR is not)
TIME_BUDGET_SECONDS = 8.0

# Per stream (the context dict of one console's recording): the script and
# locales of its last banner. A console keeps its language until a connection
# reset or a new recording, so its script is tried first; every race is still
# checked against all scripts when that one does not match, which is how a
# language change after a reset shows up. A new recording gets a new context.
MEMORY_KEY = "results_banner_language"
# The operator's choice per console: Auto or one of the 15 game locales. A
# chosen locale reads only that locale's texts with its own script, and the
# result names that locale (the operator set it, the banner did not tell).
GAME_LOCALE_KEY = "game_locale"


def enabled() -> bool:
    return os.environ.get("MK8DX_TOURNAMENT_BANNER_OCR", "0").strip().lower() in {"1", "true", "on"}


@lru_cache(maxsize=4)
def _messages(database: str) -> tuple[game_messages.GameMessage, ...]:
    return tuple(game_messages.load_messages(database))


def messages() -> tuple[game_messages.GameMessage, ...]:
    database = clean_assets_root() / "database.json"
    if not database.is_file():
        return ()
    return _messages(str(database))


class _LockedReader:
    """The engine's cached EasyOCR reader, run under the engine's per-reader lock."""

    def __init__(self, languages: tuple[str, ...], reader: Any) -> None:
        self.languages = languages
        self.reader = reader

    def readtext(self, image: Any) -> Any:
        from mk8dx_tournament_extraction.engine import extract_text  # type: ignore

        with extract_text._easyocr_reader_run_context(self.languages):
            return self.reader.readtext(image)


def _reader_for(languages: tuple[str, ...]) -> Any:
    from mk8dx_tournament_extraction.engine import extract_text  # type: ignore

    reader = extract_text._get_easyocr_reader(languages)
    return None if reader is None else _LockedReader(languages, reader)


def _script_order(context: dict[str, Any]) -> tuple[tuple[str, tuple[str, ...]], ...]:
    scripts = game_messages.OCR_SCRIPTS
    chosen = game_messages.normalize_game_locale(context.get(GAME_LOCALE_KEY))
    if chosen != game_messages.AUTO:
        script = game_messages.script_for_game_locale(chosen)
        return tuple(entry for entry in scripts if entry[0] == script)
    known = (context.get(MEMORY_KEY) or {}).get("script")
    if not known:
        return scripts
    first = [entry for entry in scripts if entry[0] == known]
    return tuple(first + [entry for entry in scripts if entry[0] != known])


def sample_frames(anchor_frame: int, fps: float) -> list[int]:
    """Frames from WINDOW_SECONDS before to WINDOW_SECONDS after the anchor, earliest first."""
    fps = fps if fps and fps > 0 else 60.0
    step = max(1, int(round(fps * STEP_SECONDS)))
    reach = int(round(fps * WINDOW_SECONDS))
    return [frame for frame in range(anchor_frame - reach, anchor_frame + reach + 1, step) if frame >= 0]


def identify_results_banner(context: dict[str, Any], anchor_frame: int, capture: Any | None = None) -> dict[str, Any]:
    """Read the race-ending banner near `anchor_frame`; a JSON-safe summary."""
    summary: dict[str, Any] = {"attempted": False, "message": None, "matchedFrame": None}
    if not enabled():
        summary["reason"] = "disabled"
        return summary
    known = list(messages())
    chosen = game_messages.normalize_game_locale(context.get(GAME_LOCALE_KEY))
    summary["gameLocale"] = chosen
    if chosen != game_messages.AUTO:
        known = [message for message in known if message.locale == chosen]
    if not known:
        summary["reason"] = "no_game_messages"
        return summary
    if anchor_frame <= 0:
        summary["reason"] = "no_anchor_frame"
        return summary
    owned = capture is None
    cap = capture if capture is not None else cv2.VideoCapture(str(context["processing_video_path"]))
    if cap is None or not cap.isOpened():
        summary["reason"] = "video_open_failed"
        return summary
    state = game_messages.BannerState(max_attempts=MAX_ATTEMPTS)
    started = time.monotonic()

    def budgeted_reader(languages: tuple[str, ...]) -> Any:
        # Past the budget no further script is tried (loading a reader is the slow part).
        if time.monotonic() - started > TIME_BUDGET_SECONDS:
            summary["reason"] = "time_budget"
            return None
        return _reader_for(languages)

    summary["attempted"] = True
    candidates = 0
    try:
        for frame_index in sample_frames(anchor_frame, float(context.get("fps") or 0)):
            if state.message is not None or state.attempts >= MAX_ATTEMPTS:
                break
            if time.monotonic() - started > TIME_BUDGET_SECONDS:
                summary["reason"] = "time_budget"
                break
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            ok, frame = cap.read()
            if not ok:
                continue
            image = crop_and_upscale_image(
                frame,
                int(context["median_left"]),
                int(context["median_top"]),
                int(context["median_crop_width"]),
                int(context["median_crop_height"]),
            )
            if game_messages.banner_candidate(image):
                candidates += 1
                outcome = game_messages.recognise_banner(image, known, budgeted_reader, scripts=_script_order(context))
                state.attempts += 1
                state.reads.extend(outcome["reads"])
                if outcome["message"] is not None:
                    state.message = outcome["message"]
                    state.first_frame = frame_index
    finally:
        if owned:
            cap.release()
    if state.message is not None and chosen != game_messages.AUTO:
        state.message.update({"localeBasis": "operator_choice", "regionalIdentification": "established"})
    if state.message is not None:
        previous = context.get(MEMORY_KEY) or {}
        locales = list(state.message.get("locales") or [])
        # Only a different text counts as a change: EUen and USen share theirs.
        summary["languageChanged"] = (chosen == game_messages.AUTO and bool(previous.get("locales"))
                                      and previous.get("locales") != locales)
        context[MEMORY_KEY] = {"script": state.message.get("script"), "locales": locales}
    summary.update(
        {
            "message": state.message,
            "matchedFrame": state.first_frame,
            "candidates": candidates,
            "ocrAttempts": state.attempts,
            "reads": [read["text"][:120] for read in state.reads][:8],
            "seconds": round(time.monotonic() - started, 2),
        }
    )
    summary.setdefault("reason", "matched" if state.message is not None else "no_clear_match")
    return summary


def attach_results_banner(result: dict[str, Any], context: dict[str, Any], anchor_frame: int,
                          capture: Any | None = None) -> None:
    """Store the diagnostic on a selection result; never raises, never touches the selection."""
    try:
        result["results_banner"] = identify_results_banner(context, anchor_frame, capture)
    except Exception as error:  # noqa: BLE001 - a diagnostic must not break selection
        result["results_banner"] = {"attempted": True, "message": None, "reason": f"error: {type(error).__name__}: {error}"[:200]}
