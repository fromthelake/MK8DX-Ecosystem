"""Mount LiveTrial source processes into production-local canonical storage."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import signal
import subprocess
import time
from typing import Callable, Mapping, Protocol, Sequence

from livetrial_product import (
    deliver_product_report_run_to_outbox,
    product_report_run_numbers,
)


class LiveTrialProductRuntimeError(RuntimeError):
    """Bounded runtime-composition failure without source or path detail."""


class LiveTrialRuntimeOutbox(Protocol):
    def create(
        self,
        canonical_submission: dict,
        created_at_ms: int,
        private_evidence: dict | None = None,
    ) -> dict: ...

    def read(self, entry_key: str) -> dict: ...

    def read_private_evidence(self, entry_key: str) -> dict: ...


@dataclass(frozen=True)
class LiveTrialReportScan:
    created: int
    already_saved: int
    unavailable: int


@dataclass(frozen=True)
class LiveTrialProcessResult:
    return_code: int
    created: int
    already_saved: int
    interrupted: bool


class ProductProcess(Protocol):
    def poll(self) -> int | None: ...

    def wait(self, timeout: float | None = None) -> int: ...

    def send_signal(self, value: int) -> None: ...

    def terminate(self) -> None: ...


ProcessFactory = Callable[[Sequence[str], Path], ProductProcess]
Clock = Callable[[], int]
# Observes every saved record so the caller can bind it to the account that
# produced it. Ingestion never fails because an observer failed.
EntryObserver = Callable[[dict], None] | None


def _observe(observer: EntryObserver, record: dict) -> None:
    if observer is None:
        return
    try:
        observer(record)
    except Exception:
        return


def _fail() -> None:
    raise LiveTrialProductRuntimeError("LiveTrial product runtime failed.") from None


def scan_livetrial_reports_once(
    runs_root: str | Path,
    catalog_path: str | Path,
    profile: object,
    source_kind: str,
    outbox: LiveTrialRuntimeOutbox,
    clock: Clock,
    player_id: str | None = None,
    entry_observer: EntryObserver = None,
    created_entry_observer: EntryObserver = None,
) -> LiveTrialReportScan:
    """Idempotently ingest every currently readable eligible run under one root."""
    try:
        root = Path(runs_root)
        if root.is_symlink() or not root.is_dir():
            _fail()
        reports = sorted(
            (path for path in root.rglob("report.json") if path.is_file()),
            key=lambda path: path.as_posix(),
        )
    except LiveTrialProductRuntimeError:
        raise
    except (OSError, TypeError, ValueError):
        _fail()

    created = 0
    already_saved = 0
    unavailable = 0
    for report in reports:
        try:
            run_numbers = product_report_run_numbers(report)
            for run_number in run_numbers:
                record, was_created = deliver_product_report_run_to_outbox(
                    report,
                    catalog_path,
                    profile,
                    source_kind,
                    run_number,
                    clock(),
                    outbox,
                    player_id,
                )
                if not isinstance(record, dict):
                    _fail()
                _observe(entry_observer, record)
                if was_created:
                    created += 1
                    _observe(created_entry_observer, record)
                else:
                    already_saved += 1
        except Exception:
            unavailable += 1
    return LiveTrialReportScan(created, already_saved, unavailable)


def _report_signatures(runs_root: str | Path) -> tuple[tuple[str, int, int], ...]:
    try:
        root = Path(runs_root)
        signatures = []
        for path in root.rglob("report.json"):
            try:
                if path.is_file():
                    status = path.stat()
                    signatures.append(
                        (
                            path.relative_to(root).as_posix(),
                            status.st_mtime_ns,
                            status.st_size,
                        )
                    )
            except OSError:
                continue
        return tuple(sorted(signatures))
    except (OSError, TypeError, ValueError):
        _fail()


def run_livetrial_source_process(
    arguments: Sequence[str],
    working_directory: str | Path,
    runs_root: str | Path,
    catalog_path: str | Path,
    profile: object,
    source_kind: str,
    outbox: LiveTrialRuntimeOutbox,
    clock: Clock,
    process_factory: ProcessFactory,
    poll_interval_seconds: float = 0.25,
    player_id: str | None = None,
    entry_observer: EntryObserver = None,
    created_entry_observer: EntryObserver = None,
) -> LiveTrialProcessResult:
    """Run one source shell and ingest canonical results throughout its lifetime."""
    if (
        not arguments
        or any(not isinstance(value, str) or not value for value in arguments)
        or not callable(clock)
        or not callable(process_factory)
        or not isinstance(poll_interval_seconds, (int, float))
        or not 0.01 <= poll_interval_seconds <= 5.0
    ):
        _fail()
    try:
        working = Path(working_directory)
        if working.is_symlink() or not working.is_dir():
            _fail()
        process = process_factory(tuple(arguments), working)
    except LiveTrialProductRuntimeError:
        raise
    except Exception:
        _fail()

    created = 0
    already_saved = 0
    unavailable = 0
    interrupted = False
    prior_signatures: tuple[tuple[str, int, int], ...] | None = None
    try:
        while process.poll() is None:
            signatures = _report_signatures(runs_root)
            if signatures != prior_signatures:
                scan = scan_livetrial_reports_once(
                    runs_root,
                    catalog_path,
                    profile,
                    source_kind,
                    outbox,
                    clock,
                    player_id,
                    entry_observer,
                    created_entry_observer,
                )
                created += scan.created
                already_saved += scan.already_saved
                unavailable = scan.unavailable
                prior_signatures = signatures
            time.sleep(poll_interval_seconds)
        return_code = process.wait()
    except KeyboardInterrupt:
        interrupted = True
        try:
            process.send_signal(signal.SIGINT)
            return_code = process.wait(timeout=10)
        except Exception:
            try:
                process.terminate()
                return_code = process.wait(timeout=5)
            except Exception:
                _fail()
    except Exception:
        _fail()

    final_scan = scan_livetrial_reports_once(
        runs_root,
        catalog_path,
        profile,
        source_kind,
        outbox,
        clock,
        player_id,
        entry_observer,
        created_entry_observer,
    )
    created += final_scan.created
    already_saved += final_scan.already_saved
    unavailable = final_scan.unavailable
    if return_code != 0 or unavailable:
        _fail()
    return LiveTrialProcessResult(
        return_code=return_code,
        created=created,
        already_saved=already_saved,
        interrupted=interrupted,
    )


def default_process_factory(
    arguments: Sequence[str],
    cwd: Path,
    environment: Mapping[str, str] | None = None,
) -> ProductProcess:
    return subprocess.Popen(
        list(arguments),
        cwd=cwd,
        shell=False,
        env=None if environment is None else dict(environment),
    )
