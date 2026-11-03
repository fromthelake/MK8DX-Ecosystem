"""Hardware-aware PyTorch package selection for setup scripts.

This module intentionally uses only the Python standard library so it can run
from a fresh virtual environment before the project dependencies are installed.
"""

from __future__ import annotations

import argparse
import json
import platform
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from typing import Iterable


TORCH_VERSION = "2.10.0"
TORCHVISION_VERSION = "0.25.0"
CPU_SUFFIX = "cpu"
CUDA_SUFFIX = "cu128"

CUDA_INDEX_URL = "https://download.pytorch.org/whl/cu128"
CPU_INDEX_URL = "https://download.pytorch.org/whl/cpu"
ROCM_FIND_LINKS_URL = "https://repo.radeon.com/rocm/manylinux/rocm-rel-7.2.3/"


@dataclass(frozen=True)
class HardwareProfile:
    system: str
    machine: str
    gpu_names: tuple[str, ...]
    nvidia_smi_available: bool = False

    @property
    def normalized_system(self) -> str:
        return self.system.strip().lower()

    @property
    def has_nvidia(self) -> bool:
        return self.nvidia_smi_available or any("nvidia" in name.lower() for name in self.gpu_names)

    @property
    def has_amd(self) -> bool:
        markers = ("amd", "advanced micro devices", "radeon")
        return any(any(marker in name.lower() for marker in markers) for name in self.gpu_names)

    @property
    def has_intel(self) -> bool:
        return any("intel" in name.lower() for name in self.gpu_names)


@dataclass(frozen=True)
class TorchPackageDecision:
    requested_mode: str
    selected_mode: str
    system: str
    machine: str
    gpu_names: tuple[str, ...]
    nvidia_smi_available: bool
    expected_gpu_ocr: bool
    experimental: bool
    requires_manual_setup: bool
    index_url: str
    pip_args: tuple[str, ...]
    reason: str
    warnings: tuple[str, ...] = ()
    post_install_note: str = ""

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2)


def _run_command(args: list[str], timeout_seconds: int = 8) -> tuple[int, str]:
    try:
        result = subprocess.run(
            args,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
    except (OSError, subprocess.SubprocessError):
        return 1, ""
    return result.returncode, (result.stdout or "").strip()


def _dedupe_names(names: Iterable[str]) -> tuple[str, ...]:
    seen = set()
    clean_names: list[str] = []
    for raw_name in names:
        name = " ".join(str(raw_name).strip().split())
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        clean_names.append(name)
    return tuple(clean_names)


def _nvidia_smi_names() -> tuple[bool, tuple[str, ...]]:
    if shutil.which("nvidia-smi") is None:
        return False, ()
    code, output = _run_command(
        ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
        timeout_seconds=8,
    )
    if code != 0:
        return True, ()
    return True, _dedupe_names(output.splitlines())


def _windows_gpu_names() -> tuple[str, ...]:
    shell = shutil.which("pwsh") or shutil.which("powershell")
    if shell is None:
        return ()
    code, output = _run_command(
        [
            shell,
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }",
        ],
        timeout_seconds=10,
    )
    if code != 0:
        return ()
    return _dedupe_names(output.splitlines())


def _linux_gpu_names() -> tuple[str, ...]:
    if shutil.which("lspci") is None:
        return ()
    code, output = _run_command(["lspci"], timeout_seconds=8)
    if code != 0:
        return ()
    gpu_lines = []
    for line in output.splitlines():
        lower_line = line.lower()
        if "vga compatible controller" in lower_line or "3d controller" in lower_line or "display controller" in lower_line:
            gpu_lines.append(line.split(":", 2)[-1].strip())
    return _dedupe_names(gpu_lines)


def _macos_gpu_names() -> tuple[str, ...]:
    if shutil.which("system_profiler") is None:
        return ()
    code, output = _run_command(["system_profiler", "SPDisplaysDataType"], timeout_seconds=15)
    if code != 0:
        return ()
    names = []
    for line in output.splitlines():
        text = line.strip()
        if text.startswith("Chipset Model:"):
            names.append(text.split(":", 1)[1].strip())
    return _dedupe_names(names)


def detect_hardware_profile() -> HardwareProfile:
    system = platform.system() or "Unknown"
    machine = platform.machine() or "Unknown"
    nvidia_smi_available, nvidia_names = _nvidia_smi_names()

    detected_names: tuple[str, ...]
    normalized_system = system.lower()
    if normalized_system == "windows":
        detected_names = _windows_gpu_names()
    elif normalized_system == "linux":
        detected_names = _linux_gpu_names()
    elif normalized_system == "darwin":
        detected_names = _macos_gpu_names()
    else:
        detected_names = ()

    gpu_names = _dedupe_names((*nvidia_names, *detected_names))
    return HardwareProfile(
        system=system,
        machine=machine,
        gpu_names=gpu_names,
        nvidia_smi_available=nvidia_smi_available,
    )


def _normalize_mode(mode: str | None) -> str:
    normalized = str(mode or "auto").strip().lower().replace("_", "-")
    aliases = {
        "": "auto",
        "automatic": "auto",
        "nvidia": "cuda",
        "nvidia-cuda": "cuda",
        "gpu": "cuda",
        "rocm": "rocm-experimental",
        "amd": "rocm-experimental",
        "amd-rocm": "rocm-experimental",
        "rocmexperimental": "rocm-experimental",
        "mps": "mps-experimental",
        "apple-mps": "mps-experimental",
        "mpsexperimental": "mps-experimental",
    }
    normalized = aliases.get(normalized, normalized)
    if normalized not in {"auto", "cuda", "cpu", "rocm-experimental", "mps-experimental"}:
        raise ValueError(
            "Torch mode must be one of: auto, cuda, cpu, rocm-experimental, mps-experimental"
        )
    return normalized


def _index_pip_args(index_url: str, packages: Iterable[str]) -> tuple[str, ...]:
    return ("--index-url", index_url, *tuple(packages))


def _cpu_packages(profile: HardwareProfile) -> tuple[str, ...]:
    if profile.normalized_system == "darwin":
        return (f"torch=={TORCH_VERSION}", f"torchvision=={TORCHVISION_VERSION}")
    return _index_pip_args(
        CPU_INDEX_URL,
        (f"torch=={TORCH_VERSION}+{CPU_SUFFIX}", f"torchvision=={TORCHVISION_VERSION}+{CPU_SUFFIX}"),
    )


def select_torch_package(
    requested_mode: str | None = "auto",
    profile: HardwareProfile | None = None,
) -> TorchPackageDecision:
    profile = profile or detect_hardware_profile()
    mode = _normalize_mode(requested_mode)
    system = profile.normalized_system
    warnings: list[str] = []

    if mode == "auto":
        if system == "darwin":
            selected = "cpu"
            reason = "macOS defaults to CPU because CUDA is unavailable and MPS is experimental in this project."
        elif profile.has_nvidia:
            selected = "cuda"
            reason = "NVIDIA hardware was detected; CUDA PyTorch is the recommended fast EasyOCR path."
        else:
            selected = "cpu"
            if profile.has_amd:
                reason = "AMD GPU detected; defaulting to CPU because ROCm is experimental for this project."
                warnings.append("Use the ROCm experimental mode only after checking AMD/PyTorch ROCm compatibility for this machine.")
            elif profile.has_intel:
                reason = "Intel GPU detected; defaulting to CPU because EasyOCR has no verified Intel GPU path here."
            else:
                reason = "No NVIDIA CUDA-capable GPU was detected; defaulting to CPU PyTorch."
    else:
        selected = mode
        reason = f"Manual TorchMode override selected: {mode}."

    if selected == "cuda":
        if not profile.has_nvidia:
            warnings.append("CUDA mode was forced, but NVIDIA hardware was not detected by setup.")
        return TorchPackageDecision(
            requested_mode=mode,
            selected_mode="cuda",
            system=profile.system,
            machine=profile.machine,
            gpu_names=profile.gpu_names,
            nvidia_smi_available=profile.nvidia_smi_available,
            expected_gpu_ocr=True,
            experimental=False,
            requires_manual_setup=False,
            index_url=CUDA_INDEX_URL,
            pip_args=_index_pip_args(
                CUDA_INDEX_URL,
                (f"torch=={TORCH_VERSION}+{CUDA_SUFFIX}", f"torchvision=={TORCHVISION_VERSION}+{CUDA_SUFFIX}"),
            ),
            reason=reason,
            warnings=tuple(warnings),
        )

    if selected == "rocm-experimental":
        if system != "linux":
            return TorchPackageDecision(
                requested_mode=mode,
                selected_mode="rocm-experimental",
                system=profile.system,
                machine=profile.machine,
                gpu_names=profile.gpu_names,
                nvidia_smi_available=profile.nvidia_smi_available,
                expected_gpu_ocr=False,
                experimental=True,
                requires_manual_setup=True,
                index_url="",
                pip_args=(),
                reason="ROCm experimental setup is only scripted for Linux. Use CPU mode on Windows/macOS unless you are following current AMD/PyTorch instructions manually.",
                warnings=tuple(warnings),
            )
        if not profile.has_amd:
            warnings.append("ROCm experimental mode was selected, but AMD hardware was not detected by setup.")
        return TorchPackageDecision(
            requested_mode=mode,
            selected_mode="rocm-experimental",
            system=profile.system,
            machine=profile.machine,
            gpu_names=profile.gpu_names,
            nvidia_smi_available=profile.nvidia_smi_available,
            expected_gpu_ocr=True,
            experimental=True,
            requires_manual_setup=False,
            index_url=ROCM_FIND_LINKS_URL,
            pip_args=("-f", ROCM_FIND_LINKS_URL, f"torch=={TORCH_VERSION}", f"torchvision=={TORCHVISION_VERSION}"),
            reason="Linux ROCm experimental mode selected. EasyOCR has no native AMD backend; this relies on PyTorch ROCm exposing the AMD GPU through torch.cuda.",
            warnings=tuple(warnings),
            post_install_note="After setup, confirm PyTorch HIP/ROCm and validate recorded output before relying on this experimental backend.",
        )

    if selected == "mps-experimental":
        if system != "darwin":
            return TorchPackageDecision(
                requested_mode=mode,
                selected_mode="mps-experimental",
                system=profile.system,
                machine=profile.machine,
                gpu_names=profile.gpu_names,
                nvidia_smi_available=profile.nvidia_smi_available,
                expected_gpu_ocr=False,
                experimental=True,
                requires_manual_setup=True,
                index_url="",
                pip_args=(),
                reason="MPS experimental mode only applies to macOS. Use CPU or CUDA mode on this platform.",
                warnings=tuple(warnings),
            )
        warnings.append("MPS is experimental for this project and may be slower or less stable than CPU.")
        return TorchPackageDecision(
            requested_mode=mode,
            selected_mode="mps-experimental",
            system=profile.system,
            machine=profile.machine,
            gpu_names=profile.gpu_names,
            nvidia_smi_available=profile.nvidia_smi_available,
            expected_gpu_ocr=True,
            experimental=True,
            requires_manual_setup=False,
            index_url="",
            pip_args=_cpu_packages(profile),
            reason="macOS MPS experimental mode selected. The standard macOS PyTorch wheel is installed; runtime GPU use requires MK8_EASYOCR_GPU_MODE=gpu.",
            warnings=tuple(warnings),
            post_install_note="Use MK8_EASYOCR_GPU_MODE=gpu to test MPS and validate recorded output. Return to CPU mode if sample output is unreliable.",
        )

    return TorchPackageDecision(
        requested_mode=mode,
        selected_mode="cpu",
        system=profile.system,
        machine=profile.machine,
        gpu_names=profile.gpu_names,
        nvidia_smi_available=profile.nvidia_smi_available,
        expected_gpu_ocr=False,
        experimental=False,
        requires_manual_setup=False,
        index_url="" if system == "darwin" else CPU_INDEX_URL,
        pip_args=_cpu_packages(profile),
        reason=reason,
        warnings=tuple(warnings),
    )


def _format_text(decision: TorchPackageDecision) -> str:
    lines = [
        f"Detected OS: {decision.system} ({decision.machine})",
        f"Detected GPUs: {', '.join(decision.gpu_names) if decision.gpu_names else 'none reported'}",
        f"nvidia-smi available: {decision.nvidia_smi_available}",
        f"Requested torch mode: {decision.requested_mode}",
        f"Selected torch mode: {decision.selected_mode}",
        f"Expected GPU OCR: {'yes' if decision.expected_gpu_ocr else 'no'}",
        f"Experimental: {'yes' if decision.experimental else 'no'}",
        f"Reason: {decision.reason}",
    ]
    for warning in decision.warnings:
        lines.append(f"Warning: {warning}")
    if decision.post_install_note:
        lines.append(f"Note: {decision.post_install_note}")
    if decision.pip_args:
        lines.append(f"pip args: {' '.join(decision.pip_args)}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Choose the PyTorch package mode for this hardware.")
    parser.add_argument("--mode", default="auto", help="auto, cuda, cpu, rocm-experimental, or mps-experimental")
    parser.add_argument("--format", choices=("json", "text"), default="text")
    parser.add_argument("--install", action="store_true", help="Install the selected wheels into this Python environment")
    args = parser.parse_args(argv)

    try:
        decision = select_torch_package(args.mode)
    except ValueError as exc:
        parser.error(str(exc))
        return 2

    if args.format == "json":
        print(decision.to_json())
    else:
        print(_format_text(decision))
    if args.install:
        if decision.requires_manual_setup:
            return 2
        return subprocess.call([sys.executable, "-m", "pip", "install", "--only-binary=:all:", *decision.pip_args])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
