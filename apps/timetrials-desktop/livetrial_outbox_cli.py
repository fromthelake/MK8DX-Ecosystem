"""Local executable for one explicit LiveTrial report-to-outbox publication."""

from __future__ import annotations

import argparse
import sys
import time

from livetrial_runtime_root import domain_package_root, install_outbox_reference_path


# Resolve bundled resources through the runtime resource root so this executable
# also works from a packaged build.
install_outbox_reference_path()

from livetrial_adapter import LiveTrialAdapterError
from livetrial_asset_catalog import LiveTrialAssetCatalogError
from livetrial_context import LiveTrialContextDocumentError
from livetrial_local_host import LiveTrialLocalHostError
from livetrial_outbox import (
    LiveTrialOutboxError,
    deliver_livetrial_report_context_to_outbox,
)
from livetrial_output import LiveTrialOutputDeliveryError
from livetrial_report import LiveTrialReportError
from livetrial_report_output import LiveTrialReportCoordinationError
from mk8dx_local_outbox import LocalOutboxError, LocalTimeTrialOutbox
from mk8dx_time_trial_validator import (
    OfflineTimeTrialSubmissionV1Validator,
    OfflineTimeTrialValidatorError,
)


class LiveTrialOutboxCliError(ValueError):
    """Bounded executable usage error."""


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise LiveTrialOutboxCliError("LiveTrial outbox command is invalid.") from None


def _parser() -> argparse.ArgumentParser:
    parser = _Parser(description="Publish one LiveTrial report run to local outbox.")
    parser.add_argument("--report", required=True)
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--context", required=True)
    parser.add_argument("--run-number", required=True, type=int)
    parser.add_argument("--catalog-source-sha256", required=True)
    parser.add_argument("--canonical-outbox-root", required=True)
    parser.add_argument("--private-evidence-root", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    try:
        arguments = _parser().parse_args(argv)
        validator = OfflineTimeTrialSubmissionV1Validator(domain_package_root())
        outbox = LocalTimeTrialOutbox(
            arguments.canonical_outbox_root,
            arguments.private_evidence_root,
            validator,
        )
        deliver_livetrial_report_context_to_outbox(
            arguments.report,
            arguments.catalog,
            arguments.context,
            arguments.catalog_source_sha256,
            arguments.run_number,
            time.time_ns() // 1_000_000,
            outbox,
        )
    except (
        LiveTrialOutboxCliError,
        LiveTrialOutboxError,
        LiveTrialLocalHostError,
        LiveTrialAssetCatalogError,
        LiveTrialContextDocumentError,
        LiveTrialReportError,
        LiveTrialReportCoordinationError,
        LiveTrialAdapterError,
        LiveTrialOutputDeliveryError,
        LocalOutboxError,
        OfflineTimeTrialValidatorError,
    ):
        print("LiveTrial outbox export failed.", file=sys.stderr)
        return 1
    print("LiveTrial outbox entry written.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
