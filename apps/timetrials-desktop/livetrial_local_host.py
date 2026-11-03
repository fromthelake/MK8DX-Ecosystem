"""Read-only local file composition for one explicit LiveTrial report run."""

from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path

from livetrial_adapter import LiveTrialSubmissionContext
from livetrial_asset_catalog import Schema9LiveTrialAssetCatalog
from livetrial_context import (
    bind_livetrial_context_source,
    parse_livetrial_context_document,
)
from livetrial_output import LiveTrialOutputPort
from livetrial_report_output import deliver_livetrial_report_run


class LiveTrialLocalHostError(ValueError):
    """Bounded local read/JSON error without path or document detail."""


def _read_json(path: str | Path) -> object:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError):
        raise LiveTrialLocalHostError(
            "LiveTrial local input could not be read."
        ) from None


def deliver_livetrial_report_file(
    report_path: str | Path,
    catalog_path: str | Path,
    expected_catalog_source_sha256: str,
    run_number: int,
    context: LiveTrialSubmissionContext,
    output_port: LiveTrialOutputPort,
) -> dict:
    """Read two explicit JSON inputs and deliver one selected report run."""
    report_document = _read_json(report_path)
    catalog_document = _read_json(catalog_path)
    catalog = Schema9LiveTrialAssetCatalog(
        catalog_document,
        expected_catalog_source_sha256,
    )
    return deliver_livetrial_report_run(
        report_document,
        run_number,
        lambda _: deepcopy(context),
        catalog,
        output_port,
    )


def deliver_livetrial_report_context_file(
    report_path: str | Path,
    catalog_path: str | Path,
    context_path: str | Path,
    expected_catalog_source_sha256: str,
    run_number: int,
    output_port: LiveTrialOutputPort,
) -> dict:
    """Read three explicit JSON inputs and bind context from the selected report."""
    report_document = _read_json(report_path)
    catalog_document = _read_json(catalog_path)
    context_document = _read_json(context_path)
    catalog = Schema9LiveTrialAssetCatalog(
        catalog_document,
        expected_catalog_source_sha256,
    )
    context = parse_livetrial_context_document(context_document)
    return deliver_livetrial_report_run(
        report_document,
        run_number,
        lambda candidate: bind_livetrial_context_source(
            context,
            candidate.source_input,
        ),
        catalog,
        output_port,
    )
