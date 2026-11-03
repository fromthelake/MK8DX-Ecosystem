"""A server switch restarts an idle LiveTrial without reusing its old profile."""

from __future__ import annotations

import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

import livetrial_desktop_app as desktop
from livetrial_settings import write_server_origin


class ServerRestartTests(unittest.TestCase):
    def test_returning_to_packaged_owner_server_reopens_existing_data(self) -> None:
        with TemporaryDirectory() as directory:
            environment = {"LOCALAPPDATA": directory}
            base = desktop.cli.product_base_root(environment)
            base.mkdir(parents=True)
            marker = base / "existing-owner-outbox.txt"
            marker.write_text("synthetic waiting run", encoding="utf-8")
            self.assertEqual(desktop.cli.product_data_root(environment), base)

            other = "https://another.example.org"
            write_server_origin(base, other)
            other_root = desktop.cli.product_data_root(environment)
            self.assertNotEqual(other_root, base)
            self.assertEqual(other_root.parent, base / "servers")

            write_server_origin(base, desktop.cli.DEFAULT_API_ORIGIN)
            self.assertEqual(desktop.cli.product_data_root(environment), base)
            self.assertEqual(marker.read_text(encoding="utf-8"), "synthetic waiting run")

            write_server_origin(base, other)
            self.assertEqual(desktop.cli.product_data_root(environment), other_root)

    def _app(self, root: Path, current: str = "http://127.0.0.1:18080") -> desktop.LiveTrialDesktopApp:
        app = object.__new__(desktop.LiveTrialDesktopApp)
        app._environment = {}
        app._api_origin = current
        app._lock = threading.Lock()
        app._job = None
        app.quit_requested = threading.Event()
        app.restart_requested = threading.Event()
        return app

    def test_only_a_persisted_idle_switch_requests_restart(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            app = self._app(root)
            write_server_origin(root, "http://127.0.0.1:18090")
            with patch.object(desktop.cli, "product_base_root", return_value=root), patch.object(desktop.threading, "Timer") as timer:
                self.assertEqual(app.restart_for_server_change(), {"restarting": True})
                self.assertTrue(app.restart_requested.is_set())
                self.assertFalse(app.quit_requested.is_set())
                timer.assert_called_once()
                timer.return_value.start.assert_called_once()

            app.restart_requested.clear()
            write_server_origin(root, app._api_origin)
            with patch.object(desktop.cli, "product_base_root", return_value=root):
                with self.assertRaises(desktop.LiveTrialDesktopError):
                    app.restart_for_server_change()
            self.assertFalse(app.restart_requested.is_set())

            app._job = object()
            write_server_origin(root, "http://127.0.0.1:18090")
            with patch.object(desktop.cli, "product_base_root", return_value=root):
                with self.assertRaises(desktop.LiveTrialDesktopError):
                    app.restart_for_server_change()
            self.assertFalse(app.restart_requested.is_set())

    def test_frozen_restart_is_independent_and_reuses_existing_window(self) -> None:
        calls = []
        with patch.object(desktop.sys, "frozen", True, create=True), patch.object(desktop.sys, "executable", "C:/client/LiveTrial.exe"):
            desktop._launch_restarted_app({"MARKER": "synthetic"}, lambda *args, **kwargs: calls.append((args, kwargs)))
        args, kwargs = calls[0]
        self.assertEqual(args[0], ["C:/client/LiveTrial.exe"])
        self.assertEqual(kwargs["env"]["PYINSTALLER_RESET_ENVIRONMENT"], "1")
        self.assertEqual(kwargs["env"][desktop.REUSE_WINDOW_ENV], "1")
        self.assertEqual(kwargs["env"]["MARKER"], "synthetic")
        self.assertEqual(kwargs["cwd"], "C:\\client")

    def test_new_process_is_launched_after_both_local_servers_stop(self) -> None:
        order = []
        fake_app = SimpleNamespace(
            start=lambda: SimpleNamespace(url="http://127.0.0.1:8776/", stop=lambda: order.append("dashboard stopped")),
            quit_requested=SimpleNamespace(wait=lambda _seconds: True),
            restart_requested=SimpleNamespace(is_set=lambda: True),
            shutdown=lambda: order.append("history stopped"),
        )
        environment = {desktop.REUSE_WINDOW_ENV: "1"}
        with patch.object(desktop.cli, "product_data_root", return_value=Path("synthetic")), \
                patch.object(desktop, "_quiet_streams"), \
                patch.object(desktop, "running_instance", return_value=False), \
                patch.object(desktop, "LiveTrialDesktopApp", return_value=fake_app), \
                patch.object(desktop, "open_app_window") as open_window, \
                patch.object(desktop, "_launch_restarted_app", side_effect=lambda _env: order.append("new process")):
            self.assertEqual(desktop.main(environment), 0)
        open_window.assert_not_called()
        self.assertEqual(order, ["history stopped", "dashboard stopped", "new process"])

    def test_history_readiness_requires_the_history_or_capture_server(self) -> None:
        app = object.__new__(desktop.LiveTrialDesktopApp)

        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self, _limit):
                return b'{"live":false}'

        with patch.object(desktop.urllib.request, "urlopen", side_effect=OSError("starting")):
            self.assertFalse(app._history_ready())
        with patch.object(desktop.urllib.request, "urlopen", return_value=Response()) as request:
            self.assertTrue(app._history_ready())
            request.assert_called_once_with(app.LIVE_URL, timeout=0.5)


if __name__ == "__main__":
    unittest.main()
