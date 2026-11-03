"""Detect what live capture needs before the recognition engine is started.

Live capture reads the capture card through FFmpeg, which the LiveTrial
package deliberately does not bundle (ADR-0131: the validated binary is a
GPL build, so a user-installed FFmpeg is preferred). Analysing a recording
does not need it. A missing FFmpeg therefore has to be explained in plain
language before capture starts, instead of surfacing as an engine failure.

FFmpeg is accepted from two places, in this order:

1. the product-local tools folder
   ``%LOCALAPPDATA%\\MK8DX\\LiveTrial\\tools\\ffmpeg\\bin\\ffmpeg.exe``,
   which lets a person who cannot change PATH drop the binary next to the
   product's own data; the engine is launched with that folder prepended to
   its PATH so the engine's plain ``ffmpeg`` invocations find it;
2. ``ffmpeg`` on the PATH of the environment the product was started with.
"""

from __future__ import annotations

import os
from pathlib import Path
import shutil
from typing import Mapping

FFMPEG_EXECUTABLE = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
_TOOLS_RELATIVE = ("tools", "ffmpeg", "bin")


def ffmpeg_tools_directory(data_root: str | Path) -> Path:
    """The product-local folder a person may place ``ffmpeg.exe`` in."""
    return Path(data_root).joinpath(*_TOOLS_RELATIVE)


def _path_value(environment: Mapping[str, str]) -> str | None:
    try:
        value = environment.get("PATH")
    except Exception:
        return None
    return value if isinstance(value, str) else None


def find_ffmpeg(
    environment: Mapping[str, str],
    data_root: str | Path,
) -> str | None:
    """Return the FFmpeg executable live capture will use, or ``None``."""
    local = ffmpeg_tools_directory(data_root) / FFMPEG_EXECUTABLE
    try:
        if local.is_file() and not local.is_symlink():
            return str(local)
    except OSError:
        pass
    path_value = _path_value(environment)
    try:
        found = shutil.which("ffmpeg", path=path_value) if path_value is not None else None
    except Exception:
        found = None
    return found


def engine_environment(
    environment: Mapping[str, str],
    data_root: str | Path,
    runtime_root: str | Path | None = None,
) -> dict[str, str] | None:
    """The environment the recognition engine is launched with.

    The product-local tools folder is put first on PATH when it exists, so the
    engine (which calls plain ``ffmpeg``) sees the same binary the check found;
    everything else is passed through untouched. ``None`` means nothing needs
    changing and the engine simply inherits the process environment.
    """
    tools = ffmpeg_tools_directory(data_root)
    try:
        present = tools.is_dir()
    except OSError:
        present = False
    models = Path(runtime_root) / "ocr-models" if runtime_root else None
    if not present and not (models and (models / "model/latin_g2.pth").is_file()):
        return None
    result = {str(key): str(value) for key, value in dict(environment).items()}
    if present:
        existing = result.get("PATH", "")
        result["PATH"] = str(tools) + (os.pathsep + existing if existing else "")
    if models and (models / "model/latin_g2.pth").is_file() and (
        models / "model/craft_mlt_25k.pth").is_file():
        result["EASYOCR_MODULE_PATH"] = str(models)
    return result


def capture_requirements(
    environment: Mapping[str, str],
    data_root: str | Path,
) -> dict:
    """One bounded status document describing what live capture needs."""
    ffmpeg = find_ffmpeg(environment, data_root)
    return {
        "ffmpeg": ffmpeg,
        "ffmpegAvailable": ffmpeg is not None,
        "ffmpegToolsDirectory": str(ffmpeg_tools_directory(data_root)),
    }


def missing_ffmpeg_lines(data_root: str | Path) -> list[str]:
    """Plain-language help shown when FFmpeg cannot be found."""
    tools = ffmpeg_tools_directory(data_root)
    return [
        "Live capture needs FFmpeg, and it was not found on this PC.",
        "Analysing a recording works without it; only capture from the capture card needs it.",
        "",
        "To install FFmpeg, do one of these, then choose capture again:",
        "  - in a PowerShell or Command Prompt window run:  winget install Gyan.FFmpeg",
        "    (close and reopen LiveTrial afterwards so it sees the new PATH), or",
        "  - download a Windows build from https://ffmpeg.org/download.html (for example",
        "    the gyan.dev release zip), unzip it, and either add its bin folder to your",
        "    PATH or copy ffmpeg.exe into this folder:",
        f"    {tools}",
        "",
        "FFmpeg is not included with LiveTrial because of its licence; it is a free download.",
    ]


def ffmpeg_found_lines(ffmpeg: str) -> list[str]:
    """Plain-language confirmation for the requirements check."""
    return [
        "FFmpeg was found, so live capture can start.",
        f"  Using: {ffmpeg}",
    ]
