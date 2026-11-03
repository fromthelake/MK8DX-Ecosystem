from __future__ import annotations

import shutil
import subprocess
import time
from dataclasses import dataclass, asdict


@dataclass
class SystemSample:
    timestamp: float
    cpu_percent: float | None
    ram_used_mb: float | None
    ram_percent: float | None
    gpu_percent: float | None
    vram_used_mb: float | None
    disk_write_bytes: int | None


def collect_system_sample() -> SystemSample:
    cpu_percent = None
    ram_used_mb = None
    ram_percent = None
    disk_write_bytes = None
    try:
        import psutil  # type: ignore

        cpu_percent = float(psutil.cpu_percent(interval=None))
        mem = psutil.virtual_memory()
        ram_used_mb = float(mem.used / (1024 * 1024))
        ram_percent = float(mem.percent)
        disk = psutil.disk_io_counters()
        disk_write_bytes = int(disk.write_bytes) if disk else None
    except Exception:
        pass

    gpu_percent = None
    vram_used_mb = None
    if shutil.which("nvidia-smi"):
        try:
            result = subprocess.run(
                [
                    "nvidia-smi",
                    "--query-gpu=utilization.gpu,memory.used",
                    "--format=csv,noheader,nounits",
                ],
                capture_output=True,
                text=True,
                timeout=2,
                check=False,
            )
            first = result.stdout.strip().splitlines()[0]
            gpu, vram = [part.strip() for part in first.split(",", 1)]
            gpu_percent = float(gpu)
            vram_used_mb = float(vram)
        except Exception:
            pass

    return SystemSample(
        timestamp=time.time(),
        cpu_percent=cpu_percent,
        ram_used_mb=ram_used_mb,
        ram_percent=ram_percent,
        gpu_percent=gpu_percent,
        vram_used_mb=vram_used_mb,
        disk_write_bytes=disk_write_bytes,
    )


def sample_as_dict(sample: SystemSample) -> dict[str, object]:
    return asdict(sample)
