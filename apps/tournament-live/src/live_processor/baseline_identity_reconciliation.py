from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pandas as pd

from tournament_live.scoring_segments import live_session_indices

from .baseline_export_metadata import character_index, character_roster_name
from .paths import DIAGNOSTICS_ROOT, assert_write_allowed
from .run_context import attach_run_id, current_run_id


from mk8dx_tournament_extraction.engine.ocr_name_matching import (  # type: ignore  # noqa: E402
    compact_identity_labels,
    merge_fragmented_identity_aliases,
    reconcile_connection_reset_identities,
    reconcile_single_race_identity_outliers,
    resolve_duplicate_name_identity_chains,
    standardize_player_names,
)


def reconcile_tournament_identities(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    if not rows:
        return rows
    df = live_rows_to_baseline_df(rows)
    before = df[["_live_row_index", "RaceClass", "RaceIDNumber", "RacePosition", "PlayerName", "Character"]].copy()
    debug_root = assert_write_allowed(DIAGNOSTICS_ROOT / "pipeline_state" / "identity_reconciliation")
    debug_root.mkdir(parents=True, exist_ok=True)
    stages: list[dict[str, Any]] = []

    for stage_name, func in [
        ("standardize_player_names", lambda frame: standardize_player_names(frame, str(debug_root), False)),
        ("merge_fragmented_identity_aliases", merge_fragmented_identity_aliases),
        ("resolve_duplicate_name_identity_chains", resolve_duplicate_name_identity_chains),
        ("reconcile_single_race_identity_outliers", reconcile_single_race_identity_outliers),
        ("reconcile_connection_reset_identities", reconcile_connection_reset_identities),
        ("compact_identity_labels", compact_identity_labels),
    ]:
        old_names = df["FixPlayerName"].astype(str).tolist() if "FixPlayerName" in df.columns else []
        df = func(df)
        new_names = df["FixPlayerName"].astype(str).tolist() if "FixPlayerName" in df.columns else []
        changes = sum(1 for old, new in zip(old_names, new_names) if old != new)
        stages.append({"stage": stage_name, "changed_rows": changes})

    reconciled = baseline_df_to_live_rows(df, rows)
    reconciled = reconcile_dominant_character_identity(reconciled)
    write_identity_reconciliation_report(before, df, stages)
    return reconciled


def reconcile_dominant_character_identity(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    """Repair isolated character outliers within a continuous lobby session.

    Players can change character after reconnecting. Earlier session majorities
    must not overwrite correct character evidence from the new lobby.
    """
    result = [dict(row) for row in rows]
    groups: dict[tuple[str, str, int], list[int]] = {}
    for index, (row, segment) in enumerate(zip(result, live_session_indices(result), strict=True)):
        key = (row.get("Video", ""), row.get("Player", ""), segment)
        if not key[0] or not key[1]:
            continue
        groups.setdefault(key, []).append(index)
    changes: list[dict[str, Any]] = []
    for (video, player, segment), indices in groups.items():
        counts: dict[str, int] = {}
        for index in indices:
            character = result[index].get("Character", "").strip()
            if character:
                counts[character] = counts.get(character, 0) + 1
        if not counts:
            continue
        dominant_character, dominant_count = sorted(counts.items(), key=lambda item: (-item[1], item[0]))[0]
        if dominant_count < 3:
            continue
        dominant_ratio = dominant_count / max(1, len(indices))
        if dominant_count <= len(indices) / 2:
            continue
        for index in indices:
            old_character = result[index].get("Character", "")
            if old_character == dominant_character:
                continue
            result[index]["Character"] = dominant_character
            result[index]["Character Roster"] = character_roster_name(dominant_character)
            changes.append(
                {
                    "row_index": index,
                    "video": video,
                    "player": player,
                    "scoring_segment": segment,
                    "old_character": old_character,
                    "new_character": dominant_character,
                    "dominant_count": dominant_count,
                    "row_count": len(indices),
                    "dominant_ratio": dominant_ratio,
                    "baseline_basis": "stable closed-set character continuity; mirrors baseline dominant-ratio character repair thresholds",
                }
            )
    write_character_reconciliation_report(changes)
    return result


def live_rows_to_baseline_df(rows: list[dict[str, str]]) -> pd.DataFrame:
    baseline_rows = []
    for index, row in enumerate(rows):
        character = str(row.get("Character", ""))
        player = str(row.get("Player", ""))
        baseline_rows.append(
            {
                "_live_row_index": index,
                "RaceClass": row.get("Video", ""),
                "RaceIDNumber": _parse_int(row.get("Race", "0")),
                "RacePosition": _parse_int(row.get("Position", "0")),
                "PlayerName": player,
                "FixPlayerName": player,
                "IdentityLabel": player,
                "Character": character,
                "CharacterRosterName": row.get("Character Roster") or character_roster_name(character),
                "CharacterIndex": character_index(character),
                "DetectedTotalScore": _parse_int(row.get("Total After Race", "0")),
                "NewTotalScore": _parse_int(row.get("Total After Race", "0")),
                "OldTotalScore": _parse_int(row.get("Total Before Race", "0")),
                "RacePoints": _parse_int(row.get("Race Points", "0")),
                "NameConfidence": 100.0,
                "NameAllowedCharRatio": 100.0,
                "NameValidationFlags": "",
                "ScoreLayoutId": "",
                # Set by live_connection_reset on a detected reset race; enables
                # the original reconcile_connection_reset_identities relink.
                "SessionResetDetected": str(
                    row.get("Session Reset Detected", "")
                ).strip().lower() == "true",
                "ReviewNeeded": False,
                "ReviewReason": "",
                "CountsTowardTotals": True,
                "ExcludedFromTotalsReason": "",
            }
        )
    return pd.DataFrame(baseline_rows)


def baseline_df_to_live_rows(df: pd.DataFrame, original_rows: list[dict[str, str]]) -> list[dict[str, str]]:
    result = [dict(row) for row in original_rows]
    if df.empty:
        return result
    for _, row in df.iterrows():
        index = int(row["_live_row_index"])
        if index < 0 or index >= len(result):
            continue
        name = str(row.get("FixPlayerName") or row.get("PlayerName") or result[index].get("Player", ""))
        character = str(row.get("Character") or result[index].get("Character", ""))
        result[index]["Player"] = name
        result[index]["Character Roster"] = str(row.get("CharacterRosterName") or character_roster_name(character))
        if bool(row.get("IdentityRelinkDetected", False)):
            result[index]["Needs Review"] = "True"
            note = str(row.get("IdentityRelinkNote") or row.get("IdentityRelinkSummary") or "identity relink")
            # Append as a "|"-separated part (the export formatter dedupes and
            # truncates); replacing here dropped the reset annotation stamped
            # by apply_connection_reset_continuity.
            existing = str(result[index].get("Review Reason") or "").strip()
            if note not in existing:
                result[index]["Review Reason"] = f"{existing} | {note}" if existing else note
    return result


def write_identity_reconciliation_report(
    before: pd.DataFrame,
    after: pd.DataFrame,
    stages: list[dict[str, Any]],
) -> None:
    rows: list[dict[str, Any]] = []
    before_names = before.set_index("_live_row_index")["PlayerName"].to_dict()
    for _, row in after.iterrows():
        index = int(row["_live_row_index"])
        before_name = str(before_names.get(index, ""))
        after_name = str(row.get("FixPlayerName") or row.get("PlayerName") or "")
        if before_name == after_name:
            continue
        rows.append(
            {
                "run_id": current_run_id(),
                "row_index": index,
                "race_class": row.get("RaceClass"),
                "race_number": int(row.get("RaceIDNumber", 0)),
                "race_position": int(row.get("RacePosition", 0)),
                "before_player": before_name,
                "after_player": after_name,
                "identity_method": row.get("IdentityResolutionMethod", ""),
                "identity_relink_detected": bool(row.get("IdentityRelinkDetected", False)),
                "identity_relink_note": row.get("IdentityRelinkNote", ""),
            }
        )
    payload = {"run_id": current_run_id(), "stages": stages, "name_changes": rows}
    DIAGNOSTICS_ROOT.mkdir(parents=True, exist_ok=True)
    assert_write_allowed(DIAGNOSTICS_ROOT / "post_ocr_identity_trace_report.json").write_text(
        json.dumps(attach_run_id(payload), indent=2, sort_keys=True),
        encoding="utf-8",
    )
    lines = ["# Post-OCR Identity Trace Report", ""]
    for stage in stages:
        lines.append(f"- {stage['stage']}: changed rows={stage['changed_rows']}")
    lines.append("")
    for row in rows:
        lines.append(
            f"- {row['race_class']} race {row['race_number']} pos {row['race_position']}: "
            f"{row['before_player']} -> {row['after_player']} ({row['identity_method']})"
        )
    assert_write_allowed(DIAGNOSTICS_ROOT / "post_ocr_identity_trace_report.md").write_text("\n".join(lines), encoding="utf-8")


def write_character_reconciliation_report(changes: list[dict[str, Any]]) -> None:
    payload = {"run_id": current_run_id(), "changes": changes}
    assert_write_allowed(DIAGNOSTICS_ROOT / "character_identity_reconciliation_report.json").write_text(
        json.dumps(attach_run_id(payload), indent=2, sort_keys=True),
        encoding="utf-8",
    )
    lines = ["# Character Identity Reconciliation Report", ""]
    if not changes:
        lines.append("- No character outlier changes applied.")
    for change in changes:
        lines.append(
            f"- {change['video']} / {change['player']}: {change['old_character']} -> {change['new_character']} "
            f"({change['dominant_count']}/{change['row_count']}, ratio={change['dominant_ratio']:.2f})"
        )
    assert_write_allowed(DIAGNOSTICS_ROOT / "character_identity_reconciliation_report.md").write_text("\n".join(lines), encoding="utf-8")


def _parse_int(value: object) -> int:
    try:
        return int(str(value).strip())
    except Exception:
        return 0
