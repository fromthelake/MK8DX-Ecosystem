"""Local executable for one explicit LiveTrial report-to-envelope export."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

from livetrial_adapter import LiveTrialAdapterError
from livetrial_asset_catalog import LiveTrialAssetCatalogError
from livetrial_context import LiveTrialContextDocumentError
from livetrial_local_host import (
    LiveTrialLocalHostError,
    deliver_livetrial_report_context_file,
)
from livetrial_output import LiveTrialOutputDeliveryError
from livetrial_report import LiveTrialReportError
from livetrial_report_output import LiveTrialReportCoordinationError


class LiveTrialCliError(ValueError):
    """Bounded executable usage/output error."""


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise LiveTrialCliError("LiveTrial command is invalid.") from None


def _parser() -> argparse.ArgumentParser:
    parser = _Parser(description="Export one LiveTrial report run locally.")
    parser.add_argument("--report", required=True)
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--context", required=True)
    parser.add_argument("--run-number", required=True, type=int)
    parser.add_argument("--catalog-source-sha256", required=True)
    parser.add_argument("--output", required=True)
    return parser


def _write_exclusive_json(path_value: str, value: dict) -> None:
    path = Path(path_value)
    created = False
    try:
        payload = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
        with path.open("x", encoding="utf-8", newline="\n") as stream:
            created = True
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
    except (OSError, TypeError, ValueError):
        if created:
            try:
                path.unlink()
            except OSError:
                pass
        raise LiveTrialCliError("LiveTrial output could not be written.") from None


def main(argv: list[str] | None = None) -> int:
    try:
        arguments = _parser().parse_args(argv)
        delivered = []
        envelope = deliver_livetrial_report_context_file(
            arguments.report,
            arguments.catalog,
            arguments.context,
            arguments.catalog_source_sha256,
            arguments.run_number,
            delivered.append,
        )
        if delivered != [envelope]:
            raise LiveTrialCliError("LiveTrial output delivery was inconsistent.")
        _write_exclusive_json(arguments.output, envelope)
    except (
        LiveTrialCliError,
        LiveTrialLocalHostError,
        LiveTrialAssetCatalogError,
        LiveTrialContextDocumentError,
        LiveTrialReportError,
        LiveTrialReportCoordinationError,
        LiveTrialAdapterError,
        LiveTrialOutputDeliveryError,
    ):
        print("LiveTrial export failed.", file=sys.stderr)
        return 1
    print("LiveTrial envelope written.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
