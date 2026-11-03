"""Which video device is the capture card, answered before capture starts.

The recognition engine needs a DirectShow device name and fails with a flag
message when it gets none. A person should never see that: the console
lists the video devices FFmpeg sees on this PC, lets them pick one, and
takes one still picture from it so a wrong pick (a webcam, a virtual
camera, the second card of the same model) is caught before a session.

Two cards of the same model carry the same display name. FFmpeg gives every
device an "alternative name" that is unique, so a name that appears more
than once is passed to the engine by that alternative name instead.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import subprocess

LIST_TIMEOUT_SECONDS = 20
SNAPSHOT_TIMEOUT_SECONDS = 30
# A capture card needs a moment after it is opened before its picture is
# real: the first frames are black, green or the previous signal. The
# snapshot discards this many frames (two seconds at 30 fps) and keeps the
# next one.
SNAPSHOT_WARMUP_FRAMES = 60
SNAPSHOT_FILE_NAME = "capture-preview.jpg"

_DEVICE_LINE = re.compile(
    r'^\[dshow @ [^\]]+\]\s+"(?P<name>.+)"\s+\((?P<kind>video|audio|none)\)\s*$'
)
_ALTERNATIVE_LINE = re.compile(r'^\[dshow @ [^\]]+\]\s+Alternative name\s+"(?P<name>.+)"\s*$')
_LEGACY_HEADER = re.compile(r"^\[dshow @ [^\]]+\]\s+DirectShow (?P<kind>video|audio) devices")
_LEGACY_DEVICE = re.compile(r'^\[dshow @ [^\]]+\]\s+"(?P<name>.+)"\s*$')


@dataclass(frozen=True)
class CaptureDevice:
    """One video input as FFmpeg reports it."""

    name: str
    alternative_name: str | None = None


def parse_dshow_devices(listing: str) -> list[CaptureDevice]:
    """The video devices in FFmpeg's ``-list_devices`` output, in order.

    Understands the current form (``"Name" (video)`` followed by an
    ``Alternative name`` line) and the older headed form. Audio devices are
    left out: a capture card's audio input is never the picture.
    """
    devices: list[CaptureDevice] = []
    last_was_video = False
    legacy_kind: str | None = None
    for raw in listing.splitlines():
        line = raw.strip()
        matched = _DEVICE_LINE.match(line)
        if matched:
            legacy_kind = None
            last_was_video = matched.group("kind") == "video"
            if last_was_video:
                devices.append(CaptureDevice(matched.group("name")))
            continue
        alternative = _ALTERNATIVE_LINE.match(line)
        if alternative:
            if last_was_video and devices:
                devices[-1] = CaptureDevice(devices[-1].name, alternative.group("name"))
            continue
        header = _LEGACY_HEADER.match(line)
        if header:
            legacy_kind = header.group("kind")
            last_was_video = False
            continue
        legacy = _LEGACY_DEVICE.match(line)
        if legacy and legacy_kind == "video":
            devices.append(CaptureDevice(legacy.group("name")))
            last_was_video = True
    return devices


def list_video_devices(ffmpeg: str) -> list[CaptureDevice]:
    """Ask FFmpeg which DirectShow video devices this PC has right now."""
    try:
        completed = subprocess.run(
            [ffmpeg, "-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=LIST_TIMEOUT_SECONDS,
            shell=False,
            stdin=subprocess.DEVNULL,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    # FFmpeg prints the listing on stderr and then "fails" to open `dummy`;
    # the exit status says nothing about the listing.
    return parse_dshow_devices(completed.stderr or "")


def engine_device_argument(device: CaptureDevice, devices: list[CaptureDevice]) -> str:
    """What to pass as ``--dshow-name`` so exactly this device opens."""
    same_name = sum(1 for candidate in devices if candidate.name == device.name)
    if same_name > 1 and device.alternative_name:
        return device.alternative_name
    return device.name


def snapshot_command(ffmpeg: str, device_argument: str, output: str | Path) -> list[str]:
    """The FFmpeg call that writes one warmed-up still picture from a device."""
    return [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "dshow", "-i", f"video={device_argument}",
        "-vf", f"select=gte(n\\,{SNAPSHOT_WARMUP_FRAMES})",
        "-fps_mode", "vfr",
        "-frames:v", "1", "-q:v", "3", str(output),
    ]


def take_snapshot(ffmpeg: str, device_argument: str, output: str | Path) -> bool:
    """Write one still picture from the device; False when none could be taken.

    A device that is in use by another program, unplugged between the listing
    and the pick, or simply not a working input produces no frame within the
    timeout, and that is the answer the console needs.
    """
    path = Path(output)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            path.unlink()
        completed = subprocess.run(
            snapshot_command(ffmpeg, device_argument, path),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=SNAPSHOT_TIMEOUT_SECONDS,
            shell=False,
            stdin=subprocess.DEVNULL,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    try:
        return completed.returncode == 0 and path.is_file() and path.stat().st_size > 0
    except OSError:
        return False
