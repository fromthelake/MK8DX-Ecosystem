from __future__ import annotations

import copy
import os
from typing import Any


RUN_ID_ENV_VARS = ("MK8DX_LIVE_RUN_ID", "MK8DX_CLEAN_REPLAY_RUN_ID")


def current_run_id() -> str:
    for name in RUN_ID_ENV_VARS:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def attach_run_id(payload: Any, run_id: str | None = None) -> Any:
    active_run_id = run_id if run_id is not None else current_run_id()
    if not active_run_id:
        return payload
    if isinstance(payload, list):
        return [attach_run_id(item, active_run_id) for item in payload]
    if isinstance(payload, dict):
        cloned = copy.deepcopy(payload)
        cloned.setdefault("run_id", active_run_id)
        return cloned
    return payload
