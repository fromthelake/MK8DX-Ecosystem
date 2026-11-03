"""Which reader supplies LiveTrial's visible field decisions.

Kept free of engine imports so the switch itself is testable without the
preserved engine.
"""

from __future__ import annotations

import os

# The five visible field decisions (character, body, tire, glider, flag) on result cards and Ghost
# Select panels come from the central reader (packages/icon-matcher). The previous reader ("legacy")
# and its comparison route ("shadow") were removed on 2026-10-30; asking for them is an error so a
# stale setting is noticed instead of silently ignored.
FIELD_READER_VARIABLE = "MK8DX_FIELD_READER"
FIELD_READERS = ("shared",)
DEFAULT_FIELD_READER = "shared"


def field_reader_route(environment=None) -> str:
    """The field reader: always the central one."""
    env = os.environ if environment is None else environment
    if env.get("MK8DX_SHARED_FIELD_SHADOW") == "1":
        raise ValueError("MK8DX_SHARED_FIELD_SHADOW was removed with the previous reader (2026-10-30)")
    explicit = (env.get(FIELD_READER_VARIABLE) or "").strip().lower()
    if explicit and explicit not in FIELD_READERS:
        raise ValueError(f"{FIELD_READER_VARIABLE}={explicit} is no longer available; the central reader "
                         "is the only one (the previous reader was removed 2026-10-30)")
    return DEFAULT_FIELD_READER
