"""Shared helpers for the optional monitoring instrumentation.

All monitoring writes are gated behind the ``MK8DX_MONITOR`` environment
variable so normal runs carry zero overhead and no log clutter. Set
``MK8DX_MONITOR=1`` (or launch the GUI with ``run_gui.ps1 -Monitor``) to capture
the latency-waterfall tail hops (publish + browser render) and resources.

Everything runs on one machine, so ``time.time()`` is a single shared clock
across the event bus, the broadcast server, and the browser (``Date.now()``).
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

from .paths import DIAGNOSTICS_ROOT, assert_write_allowed

PUBLISH_LOG = DIAGNOSTICS_ROOT / "broadcast_publish_log.jsonl"
RENDER_LOG = DIAGNOSTICS_ROOT / "broadcast_render_log.jsonl"
STARTUP_LOG = DIAGNOSTICS_ROOT / "startup_log.jsonl"

_write_lock = threading.Lock()


def _launch_t0() -> float:
    """Epoch seconds of the launch command, set by run_gui.ps1 (-Monitor)."""
    ms = os.environ.get("MK8DX_GUI_LAUNCH_T0_MS")
    try:
        return float(ms) / 1000.0 if ms else 0.0
    except ValueError:
        return 0.0


def reset_startup_log() -> None:
    if not monitoring_enabled():
        return
    try:
        DIAGNOSTICS_ROOT.mkdir(parents=True, exist_ok=True)
        assert_write_allowed(STARTUP_LOG).write_text("", encoding="utf-8")
    except Exception:
        pass


def log_startup(milestone: str) -> None:
    """Record a GUI startup milestone with elapsed time since the launch command."""
    if not monitoring_enabled():
        return
    now = time.time()
    t0 = _launch_t0()
    append_jsonl(
        STARTUP_LOG,
        {"wall_time": now, "milestone": milestone,
         "elapsed_since_command_s": round(now - t0, 3) if t0 else None},
    )


def monitoring_enabled() -> bool:
    return bool(os.environ.get("MK8DX_MONITOR"))


def append_jsonl(path: Path, record: dict[str, Any]) -> None:
    """Append one JSON line; best-effort, never raises into the caller."""
    try:
        target = assert_write_allowed(path)
        DIAGNOSTICS_ROOT.mkdir(parents=True, exist_ok=True)
        record.setdefault("wall_time", time.time())
        with _write_lock:
            with target.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record, sort_keys=True) + "\n")
    except Exception:
        pass


def log_publish(payload: dict[str, Any], event_id: int, server_time: float) -> None:
    """Record a broadcast publish (server side, where the SSE event_id is known)."""
    if not monitoring_enabled():
        return
    append_jsonl(
        PUBLISH_LOG,
        {
            "wall_time": server_time,
            "event_id": int(event_id),
            "feed": payload.get("feed"),
            "phase": payload.get("phase"),
            "view_label": payload.get("view_label"),
            "race_sequence": payload.get("race_sequence") or payload.get("display_race"),
            "race_rows": len(payload.get("race_rows") or []),
            "total_rows": len(payload.get("total_rows") or []),
            "status": payload.get("status"),
        },
    )


def log_render(record: dict[str, Any]) -> None:
    """Record a browser render-ack beacon (POSTed to /timing)."""
    if not monitoring_enabled():
        return
    record["server_received_time"] = time.time()
    append_jsonl(RENDER_LOG, record)
