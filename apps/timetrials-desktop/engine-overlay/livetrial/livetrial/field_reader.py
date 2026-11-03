"""Which reader supplies LiveTrial's visible field decisions.

Kept free of engine imports so the switch itself is testable without the
preserved engine.
"""

from __future__ import annotations

# The five visible field decisions (character, body, tire, glider, flag) on result cards and Ghost
# Select panels come from the central reader (packages/icon-matcher). There is no other reader and no
# switch to choose one: the MK8DX_FIELD_READER / MK8DX_SHARED_FIELD_SHADOW settings were removed
# (2026-11-02, no legacy switches) and are not read any more.
DEFAULT_FIELD_READER = "shared"


def field_reader_route(environment=None) -> str:
    """The field reader: always the central one (the name is recorded in field-reader.json)."""
    return DEFAULT_FIELD_READER
