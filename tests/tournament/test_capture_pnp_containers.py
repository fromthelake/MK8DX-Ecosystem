"""Capture cards get their PnP container from one batched PowerShell call."""
import json
import subprocess
import sys
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps" / "tournament-live" / "src"))

from live_processor import capture  # noqa: E402


def run_with(stdout: str, returncode: int = 0):
    calls = []

    def fake(args, **kwargs):
        calls.append((args, kwargs))
        return subprocess.CompletedProcess(args, returncode, stdout=stdout, stderr="")

    return calls, fake


def setup_function():
    capture._PNP_CONTAINER_CACHE = (0.0, {})


def test_one_property_call_for_all_devices_with_room_for_a_busy_machine():
    rows = [{"instanceId": "USB\\VID_1\\A", "containerId": "{4652F5CE-0000}"},
            {"instanceId": "SWD\\MMDEVAPI\\B", "containerId": "{4652F5CE-0000}"}]
    calls, fake = run_with(json.dumps(rows))
    with mock.patch.object(capture.subprocess, "run", side_effect=fake):
        containers = capture._present_pnp_container_ids()
    assert containers == {"usb\\vid_1\\a": "{4652f5ce-0000}", "swd\\mmdevapi\\b": "{4652f5ce-0000}"}
    command = calls[0][0][-1]
    # Batched: the instance ids go in as one array, not one call per device.
    assert "-InstanceId $d.InstanceId" in command and "ForEach-Object {$p=" not in command
    assert "SilentlyContinue" in command
    assert calls[0][1]["timeout"] >= 30


def test_a_single_device_and_a_failure_still_return_a_mapping():
    calls, fake = run_with(json.dumps({"instanceId": "X", "containerId": "{C}"}))
    with mock.patch.object(capture.subprocess, "run", side_effect=fake):
        assert capture._present_pnp_container_ids() == {"x": "{c}"}
    capture._PNP_CONTAINER_CACHE = (0.0, {})
    with mock.patch.object(capture.subprocess, "run", side_effect=subprocess.TimeoutExpired("powershell", 30)):
        assert capture._present_pnp_container_ids() == {}
