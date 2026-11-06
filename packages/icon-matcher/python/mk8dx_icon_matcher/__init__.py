"""Shared MK8DX visual field reader: one versioned meaning of a field decision."""

# One version names the field semantics every product adapter implements
# (ranking, families/variants, proposedId/acceptedId, absent/unknown/?).
# Python, TypeScript (ts/sharedFieldVersion.ts) and pyproject must agree.
__version__ = "0.4.2"
FIELD_SEMANTICS_VERSION = __version__

from .matcher import FlagWindowResult, IconMatcher, MatchResult, ReferenceBank, WindowMatchResult
from .context import Decision, TextClue, combine_character, combine_part
from .field_result import visual_field_result
from .field_reader import FieldContext, read_field
from .flag_exposure import flag_exposure_proposal
from .part_subset import rank_part_subset
from .optical_ghost import (FlagColourCalibration, digit_neutral_clahe_crop,
                            flag_colour_calibration, rank_family_then_variant)

__all__ = ["__version__", "FIELD_SEMANTICS_VERSION", "FlagWindowResult", "IconMatcher", "MatchResult", "ReferenceBank", "WindowMatchResult", "Decision", "TextClue", "combine_character", "combine_part", "visual_field_result", "FieldContext", "read_field", "flag_exposure_proposal", "FlagColourCalibration", "digit_neutral_clahe_crop", "flag_colour_calibration", "rank_family_then_variant", "rank_part_subset"]
