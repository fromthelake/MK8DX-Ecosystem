"""A cold Windows sign-in must neither race Docker nor show a blank console."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from tooling import windows_startup as startup


class DockerStartTest(unittest.TestCase):
    @patch.object(startup.shutil, "which", return_value="docker.exe")
    def test_already_running_does_not_start_desktop_again(self, _which):
        with patch.object(startup, "_engine", return_value="linux"), patch.object(startup, "_command") as command:
            self.assertEqual(startup.ensure_docker(launch=True, timeout_s=600), (True, "already-running"))
            command.assert_not_called()

    @patch.object(startup.shutil, "which", return_value="docker.exe")
    def test_cold_start_launches_once_and_waits_for_engine(self, _which):
        with patch.object(startup, "_engine", side_effect=("", "", "linux")), \
                patch.object(startup, "_command", return_value=subprocess.CompletedProcess([], 0)) as command, \
                patch.object(startup.time, "sleep"):
            self.assertEqual(startup.ensure_docker(launch=True, timeout_s=600), (True, "started"))
        command.assert_called_once_with(["docker.exe", "desktop", "start", "--detach"], timeout=30)

    def test_scheduled_path_finds_docker_in_desktop_installation(self):
        with tempfile.TemporaryDirectory() as temporary:
            docker = Path(temporary) / "Programs" / "DockerDesktop" / "resources" / "bin" / "docker.exe"
            docker.parent.mkdir(parents=True)
            docker.touch()
            with patch.object(startup.shutil, "which", return_value=None), \
                    patch.dict(startup.os.environ, {"LOCALAPPDATA": temporary}, clear=True):
                self.assertEqual(startup._docker_exe(), str(docker))

    @patch.object(startup.shutil, "which", return_value="docker.exe")
    def test_start_has_a_deadline_and_windows_containers_are_refused(self, _which):
        with patch.object(startup, "_engine", return_value=""), \
                patch.object(startup, "_command", return_value=subprocess.CompletedProcess([], 1)), \
                patch.object(startup.time, "monotonic", side_effect=(0, 601)):
            self.assertEqual(startup.ensure_docker(launch=True, timeout_s=600), (False, "docker-timeout"))
        with patch.object(startup, "_engine", return_value="windows"), patch.object(startup, "_command") as command:
            self.assertEqual(startup.ensure_docker(launch=True, timeout_s=600),
                             (False, "linux-containers-required"))
            command.assert_not_called()


class ServiceStartTest(unittest.TestCase):
    def test_waits_for_all_a2_services_and_their_health(self):
        starting = {name: ("running", "up (health: starting)") for name in startup.EXPECTED["A2_OFFLINE"]}
        healthy = {name: ("running", "up (healthy)") for name in startup.EXPECTED["A2_OFFLINE"]}
        with patch.object(startup, "_services", side_effect=(starting, healthy)), patch.object(startup.time, "sleep"):
            self.assertEqual(startup.wait_for_services("A2_OFFLINE", "test", timeout_s=30), "ready")

    def test_a_manually_stopped_installation_stays_stopped(self):
        stopped = {name: ("exited", "exited (0)") for name in startup.EXPECTED["A1"]}
        with patch.object(startup, "_services", return_value=stopped), patch.object(startup.time, "sleep") as sleep:
            self.assertEqual(startup.wait_for_services("A1", "test", timeout_s=30), "stopped")
            sleep.assert_not_called()

    def test_missing_service_times_out(self):
        with patch.object(startup, "_services", return_value={}), \
                patch.object(startup.time, "monotonic", side_effect=(0, 601)):
            self.assertEqual(startup.wait_for_services("A1", "test", timeout_s=600), "services-timeout")


class ScheduledTaskTest(unittest.TestCase):
    def _state(self, root: Path):
        (root / "operator-profile.json").write_text(
            json.dumps({"route": "A2_OFFLINE", "project": "mk8dx-test"}), encoding="utf-8")

    def test_failure_is_recorded_and_opens_one_branded_alert(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            self._state(state)
            with patch.object(startup, "ensure_docker", return_value=(False, "docker-timeout")), \
                    patch.object(startup, "_alert") as alert, patch.object(startup, "wait_for_services") as services:
                self.assertEqual(startup.run("start", state), 1)
            alert.assert_called_once_with("docker-timeout", "A2_OFFLINE")
            services.assert_not_called()
            written = json.loads((state / "startup-status.json").read_text(encoding="utf-8"))
            self.assertEqual((written["result"], written["reason"]), ("failed", "docker-timeout"))
            self.assertNotIn("project", written)

    def test_ready_engine_and_services_finish_without_alert(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            self._state(state)
            with patch.object(startup, "ensure_docker", return_value=(True, "already-running")), \
                    patch.object(startup, "wait_for_services", return_value="ready"), \
                    patch.object(startup, "_alert") as alert:
                self.assertEqual(startup.run("start", state), 0)
            alert.assert_not_called()
            self.assertEqual(json.loads((state / "startup-status.json").read_text())["result"], "ready")

    def test_stopped_services_are_reported_without_overriding_the_stop(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            self._state(state)
            with patch.object(startup, "ensure_docker", return_value=(True, "already-running")), \
                    patch.object(startup, "wait_for_services", return_value="stopped"), \
                    patch.object(startup, "_alert") as alert:
                self.assertEqual(startup.run("start", state), 1)
            alert.assert_called_once_with("stopped", "A2_OFFLINE")
            self.assertEqual(json.loads((state / "startup-status.json").read_text())["reason"], "stopped")

    def test_maintenance_waits_for_engine_before_running_child(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            self._state(state)
            from contextlib import nullcontext
            with patch.object(startup, "ensure_docker", return_value=(True, "ready")) as docker, \
                    patch.object(startup, "_maintenance_lock", return_value=nullcontext()), \
                    patch.object(startup, "_command", return_value=subprocess.CompletedProcess([], 0)) as command:
                self.assertEqual(startup.run("ca", state, "python.exe"), 0)
            docker.assert_called_once_with(launch=False, timeout_s=startup.MAINTENANCE_TIMEOUT_SECONDS)
            self.assertIn("maintain-ca", command.call_args.args[0])
            self.assertEqual(json.loads((state / "scheduled-ca-status.json").read_text())["result"], "ok")

    def test_a3_backup_does_not_require_docker(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            (state / "operator-profile.json").write_text(
                json.dumps({"route": "A3", "project": "mk8dx-test"}), encoding="utf-8")
            from contextlib import nullcontext
            with patch.object(startup, "ensure_docker") as docker, \
                    patch.object(startup, "_maintenance_lock", return_value=nullcontext()), \
                    patch.object(startup, "_command", return_value=subprocess.CompletedProcess([], 0)) as command:
                self.assertEqual(startup.run("other-backup", state, "python.exe"), 0)
            docker.assert_not_called()
            self.assertIn("backup-run", command.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
