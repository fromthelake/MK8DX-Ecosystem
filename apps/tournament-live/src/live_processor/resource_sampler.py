"""Low-overhead CPU / GPU / RAM sampler for the monitoring runs.

Runs a background thread that appends a JSON line per tick (default ~2 Hz) to
``Live_Output/diagnostics/resource_samples.jsonl``, stamped with ``wall_time``
(``time.time()`` — the same clock the event bus and broadcast server use, and
since everything runs on one laptop the browser shares it too). The monitoring
report overlays these samples onto each latency-waterfall stage so a slow stage
can be attributed to *time* (e.g. the 20s gate) vs *contention* (saturated GPU /
CPU / VRAM).

System-wide CPU/RAM/GPU are reliable; per-process GPU utilisation is not on
consumer GPUs, so we report per-process RSS (RAM) but only system-wide GPU util
plus per-process VRAM where NVML exposes it.
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

from .paths import DIAGNOSTICS_ROOT, assert_write_allowed


class ResourceSampler:
    def __init__(self, output_path: Path | None = None, interval_seconds: float = 0.5) -> None:
        self.output_path = assert_write_allowed(
            output_path or (DIAGNOSTICS_ROOT / "resource_samples.jsonl")
        )
        self.interval_seconds = max(0.1, float(interval_seconds))
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._psutil = None
        self._proc = None
        self._nvml = None
        self._gpu_handle = None
        self.samples_written = 0

    # -- lifecycle -------------------------------------------------------
    def start(self) -> None:
        if self._thread is not None:
            return
        self._init_backends()
        DIAGNOSTICS_ROOT.mkdir(parents=True, exist_ok=True)
        self.output_path.write_text("", encoding="utf-8")
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="resource-sampler", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=3.0)
            self._thread = None
        if self._nvml is not None:
            try:
                self._nvml.nvmlShutdown()
            except Exception:
                pass

    def __enter__(self) -> "ResourceSampler":
        self.start()
        return self

    def __exit__(self, *exc: Any) -> None:
        self.stop()

    # -- backends --------------------------------------------------------
    def _init_backends(self) -> None:
        try:
            import psutil  # type: ignore

            self._psutil = psutil
            self._proc = psutil.Process(os.getpid())
            psutil.cpu_percent(interval=None)  # prime the system counter
            self._proc.cpu_percent(interval=None)  # prime the process counter
        except Exception:
            self._psutil = None
        try:
            import pynvml  # type: ignore

            pynvml.nvmlInit()
            self._nvml = pynvml
            self._gpu_handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        except Exception:
            self._nvml = None
            self._gpu_handle = None

    def _sample(self) -> dict[str, Any]:
        row: dict[str, Any] = {"wall_time": time.time()}
        if self._psutil is not None:
            try:
                row["cpu_pct"] = float(self._psutil.cpu_percent(interval=None))
                vm = self._psutil.virtual_memory()
                row["ram_used_mb"] = round(vm.used / (1024 * 1024), 1)
                row["ram_total_mb"] = round(vm.total / (1024 * 1024), 1)
                row["ram_pct"] = float(vm.percent)
            except Exception:
                pass
            try:
                row["proc_rss_mb"] = round(self._proc.memory_info().rss / (1024 * 1024), 1)
                row["proc_cpu_pct"] = float(self._proc.cpu_percent(interval=None))
            except Exception:
                pass
        if self._nvml is not None and self._gpu_handle is not None:
            nv = self._nvml
            try:
                util = nv.nvmlDeviceGetUtilizationRates(self._gpu_handle)
                row["gpu_util"] = int(util.gpu)
                row["gpu_mem_util"] = int(util.memory)
            except Exception:
                pass
            try:
                mem = nv.nvmlDeviceGetMemoryInfo(self._gpu_handle)
                row["gpu_mem_used_mb"] = round(mem.used / (1024 * 1024), 1)
                row["gpu_mem_total_mb"] = round(mem.total / (1024 * 1024), 1)
            except Exception:
                pass
            try:
                enc, _ = nv.nvmlDeviceGetEncoderUtilization(self._gpu_handle)
                row["enc_util"] = int(enc)
            except Exception:
                pass
            try:
                dec, _ = nv.nvmlDeviceGetDecoderUtilization(self._gpu_handle)
                row["dec_util"] = int(dec)
            except Exception:
                pass
        return row

    def _run(self) -> None:
        with self.output_path.open("a", encoding="utf-8") as handle:
            while not self._stop.is_set():
                row = self._sample()
                handle.write(json.dumps(row) + "\n")
                handle.flush()
                self.samples_written += 1
                self._stop.wait(self.interval_seconds)


def main(argv: list[str]) -> int:
    """Standalone: sample until interrupted (Ctrl-C)."""
    interval = float(argv[0]) if argv else 0.5
    sampler = ResourceSampler(interval_seconds=interval)
    sampler.start()
    print(f"resource sampler writing {sampler.output_path} every {interval}s; Ctrl-C to stop")
    try:
        while True:
            time.sleep(1.0)
    except KeyboardInterrupt:
        pass
    finally:
        sampler.stop()
        print(f"stopped; {sampler.samples_written} samples")
    return 0


if __name__ == "__main__":
    import sys

    raise SystemExit(main(sys.argv[1:]))
