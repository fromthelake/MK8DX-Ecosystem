from __future__ import annotations

import json
import re
import sys
import time
import threading
from collections import defaultdict
from pathlib import Path
from typing import Any

import cv2  # type: ignore
import numpy as np

from .baseline_export_metadata import character_index, character_roster_name, resolve_character_variant_family_name
from .paths import DIAGNOSTICS_ROOT, assert_write_allowed
from .run_context import attach_run_id, current_run_id



from mk8dx_tournament_extraction.engine.ocr_scoreboard_consensus import (  # type: ignore  # noqa: E402
    _masked_cutout_color_score,
    character_row_roi,
    load_character_templates,
)
from mk8dx_tournament_extraction.engine.score_layouts import score_layout_id_from_filename  # type: ignore  # noqa: E402


VARIANT_FAMILY_REFINEMENT_MIN_SUPPORT = 3
VARIANT_FAMILY_REFINEMENT_MIN_DOMINANT_RATIO = 0.9
VARIANT_FAMILY_REFINEMENT_MIN_AVG_MARGIN = 0.5
# A single row whose family colour analysis is individually this confident (best coeff
# + margin over the runner-up) is trusted even when the per-player dominant gate above
# doesn't fire — so two players temporarily sharing a name after a reset (two different players both read as the
# same name) keep their distinct colours (one Orange, one Yellow Yoshi).
VARIANT_FAMILY_REFINEMENT_PER_ROW_MIN_COEFF = 88.0
VARIANT_FAMILY_REFINEMENT_PER_ROW_MIN_MARGIN = 2.0
# A single race's colour analysis is reliable on its own when the winner clears this
# coeff and beats the runner-up by this margin — commit it immediately (no 3-race
# support needed) so the right colour shows from race 1 instead of the base shape-match's
# arbitrary guess. Validated over a full run: 111/111 single-colour players agree with
# their true colour at this bar (the only disagreements are base-character misreads and
# genuine per-race colour switches, which the cross-race dominant still resolves).
VARIANT_FAMILY_REFINEMENT_PER_RACE_MIN_COEFF = 86.0
VARIANT_FAMILY_REFINEMENT_PER_RACE_MIN_MARGIN = 3.0
VARIANT_FAMILY_REFINEMENT_METHOD = "variant_family_aligned_color_refine"
# Cold-start Mii: on the first race there's no character prior yet, so the OCR can't run
# its open-set Mii rejection (which kicks in from race 2) and instead returns a
# low-confidence base guess (Champion Link / Pauline). A base read this far below a real
# match (real characters score ~100) that the colour-family analysis also can't place is
# a Mii — validated over a full run (every such row was a Mii; real Yoshis read poorly are
# excluded because they DO get a family resolution). The cross-race dominant outvotes any
# stray frame, so this only helps race 1 without risking real characters.
COLD_START_MII_MAX_CONFIDENCE = 60.0
COLD_START_MII_METHOD = "cold_start_mii_likely"
CHARACTER_VARIANT_FAMILY_ROSTER_NAMES = {
    7: "Birdo",
    8: "Yoshi",
    11: "Shy Guy",
    40: "Inkling",
}
EXPLICIT_CHARACTER_VARIANT_FAMILIES = {
    "Mario": ("Mario", "Metal Mario", "Gold Mario"),
    "Peach": ("Peach", "Cat Peach", "Baby Peach", "Pink Gold Peach", "Peachette"),
}

_REFINEMENT_LOCK = threading.Lock()


def apply_stream_character_variant_refinement(
    *,
    stream_id: str,
    video_context: str,
    race_sequence: int,
    scoreboard_rows: list[dict[str, str]],
    race_score_anchor_path: str | Path | None,
) -> tuple[list[dict[str, str]], dict[str, Any]]:
    """Apply baseline-style family color-variant refinement over accumulated stream rows.

    This mirrors the baseline finalization order: single-race OCR remains raw/stateless,
    deterministic character-prior replay runs first, and this pass then reopens the
    RaceScore anchor crops to resolve color variants such as Yoshi/Shy Guy variants
    only when the same player has repeated support across races.
    """
    if not scoreboard_rows:
        return scoreboard_rows, {
            "enabled": True,
            "stream_id": stream_id,
            "video_context": video_context,
            "race_sequence": race_sequence,
            "rows_processed": 0,
            "changes": [],
        }
    with _REFINEMENT_LOCK:
        started = time.perf_counter()
        state = _load_state(stream_id)
        races = state.setdefault("races", {})
        race_key = str(int(race_sequence))
        races[race_key] = [
            _raw_refinement_row(row, stream_id, video_context, race_sequence, race_score_anchor_path)
            for row in scoreboard_rows
        ]
        raw_rows = _sorted_rows([row for race_rows in races.values() for row in race_rows])
        refined_rows, replay_report = refine_character_variant_rows(raw_rows)
        refined_rows = _apply_mii_fallback_to_rows(refined_rows)
        refined_by_race: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in refined_rows:
            refined_by_race[str(int(row.get("race_sequence") or 0))].append(row)

        races_out = {
            key: [_public_refined_row(row) for row in _sorted_rows(value)]
            for key, value in refined_by_race.items()
        }
        state["run_id"] = current_run_id()
        state["stream_id"] = stream_id
        state["video_context"] = video_context
        state["updated_at"] = time.time()
        state["refined_races"] = races_out
        state["last_refinement"] = replay_report
        _write_state(stream_id, state)

        current_rows = [
            _scoreboard_row_from_refined(row)
            for row in _sorted_rows(refined_by_race.get(race_key, []))
        ]
        report = {
            **replay_report,
            "duration_seconds": round(time.perf_counter() - started, 4),
            "current_race_rows": len(current_rows),
            "current_race_changes": [
                change for change in replay_report["changes"]
                if int(change.get("race_sequence") or 0) == int(race_sequence)
            ],
        }
        _write_report(stream_id, report)
        return current_rows, report


def _apply_mii_fallback_to_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Run the original's Mii fallback over the accumulated stream rows so an unstable
    open-set player (read as Pauline/Link/Champion Link across races) settles on "Mii",
    matching the export. Best-effort: returns rows unchanged on any failure."""
    if not rows:
        return rows
    try:
        import pandas as pd  # noqa: WPS433
        from mk8dx_tournament_extraction.engine.extract_text import apply_mii_character_fallback  # noqa: WPS433
    except Exception:
        return rows
    meta_cols = (
        "Character", "CharacterIndex", "CharacterMatchMethod", "CharacterMatchConfidence",
        "CharacterMatchRawBest", "CharacterMatchRawMargin", "CharacterMatchRawTop5Spread",
        "CharacterMatchRawTop5FamilyCount", "CharacterFamilyName", "CharacterFamilyBest",
        "CharacterFamilyBestCoeff", "CharacterFamilyMargin",
    )
    records = []
    for index, row in enumerate(rows):
        record = {
            "_row_idx": index,
            "RaceClass": str(row.get("video_context") or ""),
            "RaceIDNumber": int(row.get("race_sequence") or 0),
            "RacePosition": _optional_int(row.get("Position") or row.get("RacePosition")) or 0,
            "FixPlayerName": str(row.get("Player") or ""),
        }
        for col in meta_cols:
            record[col] = row.get(col, "")
        records.append(record)
    try:
        result_df = apply_mii_character_fallback(pd.DataFrame(records))
    except Exception:
        return rows
    out = [dict(row) for row in rows]
    for _index, result_row in result_df.iterrows():
        row_index = int(result_row["_row_idx"])
        character = str(result_row.get("Character") or "")
        if character and character != str(out[row_index].get("Character") or ""):
            out[row_index]["Character"] = character
            char_index = result_row.get("CharacterIndex")
            out[row_index]["CharacterIndex"] = "" if char_index in (None, "") else str(int(char_index))
            out[row_index]["Character Roster"] = character_roster_name(character)
    _apply_cold_start_mii_heuristic(out)
    return out


def _apply_cold_start_mii_heuristic(rows: list[dict[str, Any]]) -> None:
    """Label a first-race low-confidence open-set read as Mii before the OCR's own open-set
    rejection has a character prior to work with (see COLD_START_MII_MAX_CONFIDENCE)."""
    for row in rows:
        method = str(row.get("CharacterMatchMethod") or "")
        if "aligned_alpha_cutout" not in method:
            continue  # only the unresolved base shape-match
        if str(row.get("Character") or "") == "Mii":
            continue
        if VARIANT_FAMILY_REFINEMENT_METHOD in method or str(row.get("CharacterFamilyBest") or "").strip():
            continue  # the colour family placed it -> a real Yoshi/Shy Guy/... not a Mii
        try:
            conf = float(row.get("CharacterMatchConfidence") or 0.0)
        except (TypeError, ValueError):
            conf = 0.0
        if 0.0 < conf < COLD_START_MII_MAX_CONFIDENCE:
            row["Character"] = "Mii"
            row["CharacterIndex"] = ""
            row["Character Roster"] = character_roster_name("Mii")
            row["CharacterMatchMethod"] = f"{method}+{COLD_START_MII_METHOD}" if method else COLD_START_MII_METHOD


def refine_character_variant_rows(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    templates = load_character_templates()
    template_by_name = {str(template["character_name"]): template for template in templates}
    template_by_index = {int(template["character_index"]): template for template in templates}
    family_template_cache: dict[str, tuple[list[dict[str, object]], np.ndarray]] = {}
    frame_cache: dict[str, tuple[np.ndarray | None, str]] = {}
    row_refinements: dict[int, dict[str, Any]] = {}
    rows_out = [dict(row) for row in rows]

    for index, row in enumerate(rows_out):
        _ensure_family_columns(row)
        current_character = str(row.get("Character") or "").strip()
        family_name = resolve_character_variant_family_name(current_character)
        if not family_name:
            continue
        family_templates, diagnostic_mask = family_template_cache.get(family_name, (None, None))  # type: ignore[assignment]
        if family_templates is None:
            family_templates = character_variant_family_templates(templates, current_character)
            diagnostic_mask = build_character_variant_family_diagnostic_mask(family_templates, family_name=family_name)
            family_template_cache[family_name] = (family_templates, diagnostic_mask)
        if not family_templates or diagnostic_mask.size == 0 or int(np.count_nonzero(diagnostic_mask)) <= 0:
            continue

        position = _optional_int(row.get("Position") or row.get("RacePosition"))
        anchor_path = str(row.get("RaceScoreAnchorPath") or "").strip()
        if not anchor_path or position is None or position <= 0:
            continue
        if anchor_path not in frame_cache:
            path = Path(anchor_path)
            frame = cv2.imread(str(path), cv2.IMREAD_COLOR) if path.exists() else None
            frame_cache[anchor_path] = (frame, score_layout_id_from_filename(path) if path.exists() else "")
        frame_image, score_layout_id = frame_cache[anchor_path]
        if frame_image is None:
            continue

        (x1, y1), (x2, y2) = character_row_roi(position - 1, score_layout_id=score_layout_id)
        row_roi = frame_image[y1:y2, x1:x2]
        if row_roi.size == 0:
            continue
        ranked = []
        for family_template in family_templates:
            score = aligned_family_color_variant_score(row_roi, family_template)
            if score <= 0.0:
                score = diagnostic_character_variant_score(row_roi, family_template["template_image"], diagnostic_mask)
            ranked.append(
                {
                    "name": str(family_template["character_name"]),
                    "index": int(family_template["character_index"]),
                    "score": round(float(score) * 100.0, 1),
                }
            )
        ranked.sort(key=lambda item: item["score"], reverse=True)
        if not ranked:
            continue
        best = ranked[0]
        second = ranked[1] if len(ranked) > 1 else {"name": "", "score": 0.0}
        row_refinements[index] = {
            "family_name": family_name,
            "winner_name": best["name"],
            "winner_index": best["index"],
            "winner_score": float(best["score"]),
            "runner_up_name": second["name"],
            "runner_up_score": float(second["score"]),
            "winner_margin": round(float(best["score"]) - float(second["score"]), 1),
        }

    for index, refinement in row_refinements.items():
        row = rows_out[index]
        row["CharacterFamilyName"] = str(refinement["family_name"])
        row["CharacterFamilyBest"] = str(refinement["winner_name"])
        row["CharacterFamilyBestIndex"] = str(int(refinement["winner_index"]))
        row["CharacterFamilyBestCoeff"] = str(round(float(refinement["winner_score"]), 1))
        row["CharacterFamilySecond"] = str(refinement["runner_up_name"])
        row["CharacterFamilySecondCoeff"] = str(round(float(refinement["runner_up_score"]), 1))
        row["CharacterFamilyMargin"] = str(round(float(refinement["winner_margin"]), 1))

    changes: list[dict[str, Any]] = []
    for (_video_context, player_name), player_indices in _group_indices_by_player(rows_out).items():
        if not player_name or str(player_name).startswith("PlayerNameMissing_"):
            continue
        player_refined_indices = [index for index in player_indices if index in row_refinements]
        if len(player_refined_indices) < VARIANT_FAMILY_REFINEMENT_MIN_SUPPORT:
            continue
        family_names = {str(row_refinements[index]["family_name"]) for index in player_refined_indices}
        for family_name in family_names:
            family_indices = [
                index for index in player_refined_indices
                if str(row_refinements[index]["family_name"]) == family_name
            ]
            if len(family_indices) < VARIANT_FAMILY_REFINEMENT_MIN_SUPPORT:
                continue
            winner_counts: dict[str, int] = defaultdict(int)
            margins_by_winner: dict[str, list[float]] = defaultdict(list)
            for index in family_indices:
                refinement = row_refinements[index]
                winner = str(refinement["winner_name"])
                winner_counts[winner] += 1
                margins_by_winner[winner].append(float(refinement["winner_margin"]))
            dominant_name, dominant_count = max(winner_counts.items(), key=lambda item: (item[1], item[0]))
            dominant_ratio = dominant_count / max(1, len(family_indices))
            dominant_avg_margin = sum(margins_by_winner[dominant_name]) / max(1, len(margins_by_winner[dominant_name]))
            if dominant_ratio < VARIANT_FAMILY_REFINEMENT_MIN_DOMINANT_RATIO:
                continue
            if dominant_avg_margin < VARIANT_FAMILY_REFINEMENT_MIN_AVG_MARGIN:
                continue
            dominant_template = template_by_name.get(dominant_name)
            if dominant_template is None:
                continue
            for index in family_indices:
                row = rows_out[index]
                before_character = str(row.get("Character") or "")
                before_method = str(row.get("CharacterMatchMethod") or "").strip()
                refinement = row_refinements[index]
                row["Character"] = dominant_name
                row["CharacterIndex"] = str(int(dominant_template["character_index"]))
                row["CharacterMatchConfidence"] = str(round(float(refinement["winner_score"]), 1))
                row["CharacterMatchMethod"] = (
                    f"{before_method}+{VARIANT_FAMILY_REFINEMENT_METHOD}" if before_method else VARIANT_FAMILY_REFINEMENT_METHOD
                )
                row["Character Roster"] = character_roster_name(row.get("Character"))
                if before_character != dominant_name:
                    changes.append(
                        {
                            "stream_id": row.get("stream_id", ""),
                            "video_context": row.get("video_context", ""),
                            "race_sequence": int(row.get("race_sequence") or 0),
                            "position": row.get("Position", ""),
                            "player": row.get("Player", ""),
                            "family_name": family_name,
                            "before_character": before_character,
                            "after_character": dominant_name,
                            "dominant_ratio": round(dominant_ratio, 3),
                            "dominant_avg_margin": round(dominant_avg_margin, 3),
                        }
                    )

    # Per-row confident commit: trust an individually-confident family colour for a
    # single row even when the per-player dominant gate above did not apply (the gate
    # fails when two distinct players share an OCR name and their colours are mixed).
    # Gated by the same baseline-support requirement as the dominant pass, so a
    # low-support player isn't flipped by one frame.
    index_to_player: dict[int, tuple] = {}
    player_refined_count: dict[tuple, int] = {}
    for player_key, player_indices in _group_indices_by_player(rows_out).items():
        refined = [index for index in player_indices if index in row_refinements]
        player_refined_count[player_key] = len(refined)
        for index in player_indices:
            index_to_player[index] = player_key
    for index, refinement in row_refinements.items():
        player_key = index_to_player.get(index)
        if player_key is None:
            continue
        winner = str(refinement["winner_name"])
        if not winner:
            continue
        row = rows_out[index]
        before_character = str(row.get("Character") or "")
        coeff = float(refinement["winner_score"])
        margin = float(refinement["winner_margin"])
        # Commit when either: (a) this single race's colour analysis is confident on its own
        # (so colours are right from race 1), or (b) the player has baseline support across
        # races at the looser per-row bar.
        confident = (
            coeff >= VARIANT_FAMILY_REFINEMENT_PER_RACE_MIN_COEFF
            and margin >= VARIANT_FAMILY_REFINEMENT_PER_RACE_MIN_MARGIN
        )
        supported = (
            player_refined_count.get(player_key, 0) >= VARIANT_FAMILY_REFINEMENT_MIN_SUPPORT
            and coeff >= VARIANT_FAMILY_REFINEMENT_PER_ROW_MIN_COEFF
            and margin >= VARIANT_FAMILY_REFINEMENT_PER_ROW_MIN_MARGIN
        )
        if not (confident or supported):
            continue
        template = template_by_name.get(winner)
        if template is None:
            continue
        # Mark the colour as committed even when the analysis only *confirms* the base read
        # (winner == before): otherwise a correctly-read colour stays flagged unrefined and
        # the overlay would fall back to the neutral default for it.
        existing_method = str(row.get("CharacterMatchMethod") or "").strip()
        if VARIANT_FAMILY_REFINEMENT_METHOD not in existing_method:
            row["CharacterMatchMethod"] = (
                f"{existing_method}+{VARIANT_FAMILY_REFINEMENT_METHOD}" if existing_method else VARIANT_FAMILY_REFINEMENT_METHOD
            )
        if winner == before_character:
            continue
        row["Character"] = winner
        row["CharacterIndex"] = str(int(template["character_index"]))
        row["Character Roster"] = character_roster_name(winner)
        changes.append(
            {
                "stream_id": row.get("stream_id", ""),
                "video_context": row.get("video_context", ""),
                "race_sequence": int(row.get("race_sequence") or 0),
                "position": row.get("Position", ""),
                "player": row.get("Player", ""),
                "family_name": str(refinement["family_name"]),
                "before_character": before_character,
                "after_character": winner,
                "per_row_commit": True,
            }
        )

    for row in rows_out:
        if not str(row.get("CharacterIndex") or "").strip():
            idx = character_index(row.get("Character"))
            row["CharacterIndex"] = "" if idx is None else str(idx)
        idx = _optional_int(row.get("CharacterIndex"))
        if idx is not None and idx in template_by_index:
            row.setdefault("Character", str(template_by_index[idx]["character_name"]))
        row["Character Roster"] = character_roster_name(row.get("Character"))

    return rows_out, {
        "run_id": current_run_id(),
        "enabled": True,
        "rows_processed": len(rows_out),
        "rows_with_family_scores": len(row_refinements),
        "races_processed": len({(row.get("stream_id"), int(row.get("race_sequence") or 0)) for row in rows_out}),
        "changes": changes,
        "thresholds": {
            "min_support": VARIANT_FAMILY_REFINEMENT_MIN_SUPPORT,
            "min_dominant_ratio": VARIANT_FAMILY_REFINEMENT_MIN_DOMINANT_RATIO,
            "min_avg_margin": VARIANT_FAMILY_REFINEMENT_MIN_AVG_MARGIN,
        },
    }


def character_variant_family_templates(
    templates: list[dict[str, object]],
    character_name: str | None,
) -> list[dict[str, object]]:
    normalized = str(character_name or "").strip()
    if not normalized:
        return []
    family_name = resolve_character_variant_family_name(normalized)
    if not family_name:
        return []
    if family_name in EXPLICIT_CHARACTER_VARIANT_FAMILIES:
        explicit = {str(name).strip() for name in EXPLICIT_CHARACTER_VARIANT_FAMILIES[family_name]}
        return [template for template in templates if str(template.get("character_name", "")).strip() in explicit]
    family_roster = {
        family: roster
        for roster, family in CHARACTER_VARIANT_FAMILY_ROSTER_NAMES.items()
    }.get(family_name)
    if family_roster is None:
        return []
    return [
        template for template in templates
        if int(template.get("roster_index", -1)) == int(family_roster)
    ]


def build_character_variant_family_diagnostic_mask(
    family_templates: list[dict[str, object]],
    family_name: str | None = None,
) -> np.ndarray:
    if not family_templates:
        return np.zeros((0, 0), dtype=bool)
    template_images = [np.asarray(template["template_image"], dtype=np.uint8) for template in family_templates]
    alpha_masks = [np.asarray(template["template_alpha"], dtype=np.uint8) for template in family_templates]
    hsv_stack = np.stack([cv2.cvtColor(image, cv2.COLOR_BGR2HSV).astype(np.float32) for image in template_images], axis=0)
    alpha_stack = np.stack(alpha_masks, axis=0)
    alpha_presence = alpha_stack > 16
    alpha_mean = np.mean(alpha_presence, axis=0)
    alpha_mask = alpha_mean > 0.9
    alpha_var = np.var(alpha_presence.astype(np.float32), axis=0)
    hue_var = np.var(hsv_stack[:, :, :, 0], axis=0)
    sat_var = np.var(hsv_stack[:, :, :, 1], axis=0)
    sat_mean = np.mean(hsv_stack[:, :, :, 1], axis=0)
    val_mean = np.mean(hsv_stack[:, :, :, 2], axis=0)
    diagnostic_mask = alpha_mask & ((sat_var > 2000.0) | ((hue_var > 300.0) & (sat_mean > 40.0))) & (val_mean > 40.0)
    if str(family_name or "").strip() == "Peach":
        diagnostic_mask |= (
            (alpha_mean > 0.15)
            & (alpha_mean < 0.85)
            & (alpha_var > 0.12)
            & (val_mean > 25.0)
        )
    return diagnostic_mask


def diagnostic_character_variant_score(
    source_image: np.ndarray,
    template_image: np.ndarray,
    diagnostic_mask: np.ndarray,
) -> float:
    if source_image.size == 0 or template_image.size == 0 or diagnostic_mask.size == 0:
        return 0.0
    template_height, template_width = template_image.shape[:2]
    if source_image.shape[0] != template_height or source_image.shape[1] != template_width:
        source_image = cv2.resize(source_image, (template_width, template_height), interpolation=cv2.INTER_LINEAR)
    source_hsv = cv2.cvtColor(source_image, cv2.COLOR_BGR2HSV).astype(np.float32)
    template_hsv = cv2.cvtColor(template_image, cv2.COLOR_BGR2HSV).astype(np.float32)
    source_h = source_hsv[:, :, 0][diagnostic_mask]
    template_h = template_hsv[:, :, 0][diagnostic_mask]
    source_s = source_hsv[:, :, 1][diagnostic_mask]
    template_s = template_hsv[:, :, 1][diagnostic_mask]
    source_v = source_hsv[:, :, 2][diagnostic_mask]
    template_v = template_hsv[:, :, 2][diagnostic_mask]
    if source_h.size == 0:
        return 0.0
    hue_delta = np.abs(source_h - template_h)
    hue_delta = np.minimum(hue_delta, 180.0 - hue_delta)
    sat_diff = np.abs(source_s - template_s)
    val_diff = np.abs(source_v - template_v)
    score = 1.0
    score -= 0.55 * float(np.mean(hue_delta) / 90.0)
    score -= 0.30 * float(np.mean(sat_diff) / 255.0)
    score -= 0.15 * float(np.mean(val_diff) / 255.0)
    return max(0.0, min(1.0, score))


def aligned_family_color_variant_score(source_image: np.ndarray, family_template: dict[str, object]) -> float:
    if source_image.size == 0:
        return 0.0
    template_image = family_template["template_image"]
    template_height, template_width = template_image.shape[:2]
    if source_image.shape[0] != template_height or source_image.shape[1] != template_width:
        source_image = cv2.resize(source_image, (template_width, template_height), interpolation=cv2.INTER_LINEAR)
    source_rgb = source_image.astype(np.float32)
    best_score = 0.0
    for variant in family_template.get("aligned_variants") or ():
        score = _masked_cutout_color_score(
            source_image,
            variant["image"],
            variant["alpha"],
            source_rgb=source_rgb,
            target_rgb=variant.get("image_float"),
            target_mask=variant.get("core_mask"),
        )
        best_score = max(best_score, float(score))
    return max(0.0, min(1.0, best_score))


def _raw_refinement_row(
    row: dict[str, str],
    stream_id: str,
    video_context: str,
    race_sequence: int,
    race_score_anchor_path: str | Path | None,
) -> dict[str, Any]:
    raw = dict(row)
    raw["stream_id"] = stream_id
    raw["video_context"] = video_context
    raw["race_sequence"] = int(race_sequence)
    raw["RaceScoreAnchorPath"] = str(race_score_anchor_path or raw.get("RaceScoreAnchorPath") or "")
    raw.setdefault("CharacterMatchConfidence", raw.get("CharacterConfidence", 0.0))
    raw.setdefault("CharacterMatchMethod", "")
    raw.setdefault("NameConfidence", 100.0)
    raw.setdefault("CharacterIndex", "" if character_index(raw.get("Character")) is None else str(character_index(raw.get("Character"))))
    _ensure_family_columns(raw)
    return raw


def _ensure_family_columns(row: dict[str, Any]) -> None:
    for key in (
        "CharacterFamilyName",
        "CharacterFamilyBest",
        "CharacterFamilyBestIndex",
        "CharacterFamilyBestCoeff",
        "CharacterFamilySecond",
        "CharacterFamilySecondCoeff",
        "CharacterFamilyMargin",
    ):
        row.setdefault(key, "")


def _group_indices_by_player(rows: list[dict[str, Any]]) -> dict[tuple[str, str], list[int]]:
    grouped: dict[tuple[str, str], list[int]] = defaultdict(list)
    for index, row in enumerate(rows):
        video_context = str(row.get("video_context") or row.get("stream_id") or "")
        player = str(row.get("FixPlayerName") or row.get("Player") or "").strip()
        grouped[(video_context, player)].append(index)
    return grouped


def _scoreboard_row_from_refined(row: dict[str, Any]) -> dict[str, str]:
    result = {key: "" if value is None else str(value) for key, value in row.items() if not str(key).startswith("_")}
    result["Character Roster"] = character_roster_name(result.get("Character"))
    return result


def _public_refined_row(row: dict[str, Any]) -> dict[str, Any]:
    public = dict(row)
    public["Character Roster"] = character_roster_name(public.get("Character"))
    return public


def _sorted_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        rows,
        key=lambda row: (
            str(row.get("video_context") or row.get("stream_id") or ""),
            int(row.get("race_sequence") or 0),
            int(row.get("Position") or row.get("RacePosition") or 0),
        ),
    )


def _state_path(stream_id: str) -> Path:
    run_id = _safe_path_part(current_run_id() or "unknown_run")
    stream = _safe_path_part(stream_id or "unknown_stream")
    return assert_write_allowed(DIAGNOSTICS_ROOT / "pipeline_state" / "character_variant_refinement_state" / run_id / f"{stream}.json")


def _load_state(stream_id: str) -> dict[str, Any]:
    path = _state_path(stream_id)
    if not path.exists():
        return {"run_id": current_run_id(), "stream_id": stream_id, "races": {}}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"run_id": current_run_id(), "stream_id": stream_id, "races": {}}


def _write_state(stream_id: str, state: dict[str, Any]) -> None:
    path = _state_path(stream_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(attach_run_id(state), indent=2, sort_keys=True), encoding="utf-8")


def _write_report(stream_id: str, report: dict[str, Any]) -> None:
    path = assert_write_allowed(DIAGNOSTICS_ROOT / "character_variant_refinement_report.json")
    existing: dict[str, Any] = {"run_id": current_run_id(), "streams": {}}
    if path.exists():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            existing = {"run_id": current_run_id(), "streams": {}}
    existing.setdefault("streams", {})[stream_id] = report
    existing["updated_at"] = time.time()
    path.write_text(json.dumps(attach_run_id(existing), indent=2, sort_keys=True), encoding="utf-8")
    lines = ["# Character Variant Refinement Report", ""]
    for stream, item in sorted(existing.get("streams", {}).items()):
        lines.append(f"## {stream}")
        lines.append(f"- rows processed: {item.get('rows_processed', 0)}")
        lines.append(f"- rows with family scores: {item.get('rows_with_family_scores', 0)}")
        lines.append(f"- races processed: {item.get('races_processed', 0)}")
        lines.append(f"- current race rows: {item.get('current_race_rows', 0)}")
        lines.append(f"- current race changes: {len(item.get('current_race_changes', []))}")
        lines.append("")
    assert_write_allowed(DIAGNOSTICS_ROOT / "character_variant_refinement_report.md").write_text("\n".join(lines), encoding="utf-8")


def _safe_path_part(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value or "")).strip("_") or "unknown"


def _optional_int(value: Any) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(float(str(value)))
    except Exception:
        return None
