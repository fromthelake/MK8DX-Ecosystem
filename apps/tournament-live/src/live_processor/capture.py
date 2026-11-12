from __future__ import annotations

import re
import shutil
import subprocess
import json
import time
from dataclasses import dataclass, replace

from .paths import DIAGNOSTICS_ROOT, assert_write_allowed
from .performance import PerformanceTracker


@dataclass(frozen=True)
class CaptureDevice:
    name: str
    kind: str = "dshow"
    # DirectShow "alternative name" (@device_pnp_...): unique per physical
    # device, unlike the friendly name — multiple identical cards (e.g. three
    # "UGREEN 35287") can only be told apart / opened individually through it.
    alternative_name: str = ""
    media_type: str = "video"
    # Windows can rotate an audio endpoint's DirectShow wave GUID after a
    # reboot. The PnP container remains shared by the video and audio
    # interfaces of the same physical card and is safe for recovery only when
    # it resolves uniquely.
    container_id: str = ""

    @property
    def ffmpeg_input(self) -> str:
        """The -i value for ffmpeg dshow: prefer the unique alternative name."""
        media = "audio" if self.media_type == "audio" else "video"
        return f"{media}={self.alternative_name or self.name}"


# ffmpeg's -list_devices output changed across versions:
#   old:  section headers ("DirectShow video devices"), then "Name" lines
#   new:  no headers; per line:  "Name" (video|audio|none)
# Both list each device's unique  Alternative name "@device_..."  on the next line.
_TYPED_DEVICE_RE = re.compile(r'"([^"]+)"\s*\((video|audio|none)\)')
_ALTERNATIVE_RE = re.compile(r'Alternative name\s+"([^"]+)"')
_QUOTED_NAME_RE = re.compile(r'"([^"]+)"')


def parse_ffmpeg_dshow_inputs(output: str) -> list[CaptureDevice]:
    devices: list[CaptureDevice] = []
    section_media_type = ""
    expecting_alternative = False
    for line in output.splitlines():
        if "DirectShow video devices" in line:
            section_media_type = "video"
            continue
        if "DirectShow audio devices" in line:
            section_media_type = "audio"
            continue
        alt = _ALTERNATIVE_RE.search(line)
        if alt:
            if expecting_alternative and devices:
                devices[-1] = replace(devices[-1], alternative_name=alt.group(1))
            expecting_alternative = False
            continue
        typed = _TYPED_DEVICE_RE.search(line)
        if typed:
            # "none" covers virtual devices ffmpeg cannot type (e.g. OBS Virtual
            # Camera); retain it as video for backwards compatibility.
            media_type = "video" if typed.group(2) == "none" else typed.group(2)
            devices.append(CaptureDevice(typed.group(1), media_type=media_type))
            expecting_alternative = True
            continue
        if section_media_type:
            match = _QUOTED_NAME_RE.search(line)
            if match and not match.group(1).startswith("@device_"):
                devices.append(CaptureDevice(match.group(1), media_type=section_media_type))
                expecting_alternative = True
    return devices


def parse_ffmpeg_dshow_devices(output: str) -> list[CaptureDevice]:
    return [device for device in parse_ffmpeg_dshow_inputs(output) if device.media_type == "video"]


def parse_ffmpeg_dshow_audio_devices(output: str) -> list[CaptureDevice]:
    return [device for device in parse_ffmpeg_dshow_inputs(output) if device.media_type == "audio"]


_PNP_CONTAINER_CACHE: tuple[float, dict[str, str]] = (0.0, {})


def _present_pnp_container_ids() -> dict[str, str]:
    """Read present Windows media-device containers without failing discovery."""
    global _PNP_CONTAINER_CACHE
    checked_at, cached = _PNP_CONTAINER_CACHE
    if time.monotonic() - checked_at < 5:
        return cached
    # One property call for all devices: one call per device took 15-17 s on a busy
    # laptop with three capture cards (28 devices) and ran into the timeout, which
    # silently left every card without its container (LAN QA groep3, 2026-11-11).
    # Batched it takes about 1.3 s; a device without the property is skipped.
    command = (
        "$d=@(Get-PnpDevice -PresentOnly | Where-Object {"
        "$_.Class -in @('Camera','MEDIA','AudioEndpoint')"
        "});"
        "if ($d.Count) {"
        "@(Get-PnpDeviceProperty -InstanceId $d.InstanceId "
        "-KeyName 'DEVPKEY_Device_ContainerId' -ErrorAction SilentlyContinue | ForEach-Object {"
        "[pscustomobject]@{instanceId=$_.InstanceId;containerId=[string]$_.Data}"
        "}) | ConvertTo-Json -Compress }"
    )
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
            capture_output=True, text=True, timeout=30, check=False,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return {}
        rows = json.loads(result.stdout)
        if isinstance(rows, dict):
            rows = [rows]
        containers = {
            str(row.get("instanceId", "")).strip().casefold():
            str(row.get("containerId", "")).strip().casefold()
            for row in rows if row.get("instanceId") and row.get("containerId")
        }
        _PNP_CONTAINER_CACHE = (time.monotonic(), containers)
        return containers
    except (OSError, subprocess.SubprocessError, ValueError, TypeError):
        return {}


def _with_pnp_container_ids(devices: list[CaptureDevice]) -> list[CaptureDevice]:
    containers = _present_pnp_container_ids()
    enriched: list[CaptureDevice] = []
    for device in devices:
        alternative = device.alternative_name
        container_id = ""
        if device.media_type == "audio":
            match = re.search(r"wave_\{([^}]+)\}", alternative, re.IGNORECASE)
            if match:
                guid = match.group(1).casefold()
                matches = {value for key, value in containers.items() if guid in key}
                if len(matches) == 1:
                    container_id = matches.pop()
        elif alternative.casefold().startswith("@device_pnp_"):
            instance_id = alternative[len("@device_pnp_"):]
            if instance_id.startswith("\\\\?\\"):
                instance_id = instance_id[4:]
            instance_id = instance_id.split("#{", 1)[0].replace("#", "\\").casefold()
            container_id = containers.get(instance_id, "")
        enriched.append(replace(device, container_id=container_id))
    return enriched


def discover_capture_devices(tracker: PerformanceTracker) -> list[CaptureDevice]:
    with tracker.track("capture.discover_capture_devices"):
        if not shutil.which("ffmpeg"):
            _write_capture_note("FFmpeg not found; capture discovery not executed.")
            tracker.record_error("capture", "MissingDependency", "ffmpeg was not found on PATH")
            return []
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        devices = _with_pnp_container_ids(parse_ffmpeg_dshow_devices(result.stderr + "\n" + result.stdout))
        _write_capture_note(
            "Capture devices:\n"
            + "\n".join(f"{device.name} | {device.alternative_name}" for device in devices)
            if devices
            else "No DirectShow capture devices found."
        )
        return devices


def discover_capture_audio_devices(tracker: PerformanceTracker) -> list[CaptureDevice]:
    with tracker.track("capture.discover_capture_audio_devices"):
        if not shutil.which("ffmpeg"):
            tracker.record_error("capture", "MissingDependency", "ffmpeg was not found on PATH")
            return []
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        devices = _with_pnp_container_ids(parse_ffmpeg_dshow_audio_devices(result.stderr + "\n" + result.stdout))
        _write_capture_note(
            "Capture audio devices:\n"
            + "\n".join(f"{device.name} | {device.alternative_name}" for device in devices)
            if devices
            else "No DirectShow capture audio devices found."
        )
        return devices


def _write_capture_note(text: str) -> None:
    DIAGNOSTICS_ROOT.mkdir(parents=True, exist_ok=True)
    path = assert_write_allowed(DIAGNOSTICS_ROOT / "capture_discovery.txt")
    path.write_text(text + "\n", encoding="utf-8")
