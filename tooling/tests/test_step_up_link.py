"""install.py step-up-link: the break-glass for the fresh e-mail confirmation runs the operator tool on this
server only (Docker: inside the api container with the private operator settings; A3/B2: with node), names the
account on standard input and never on the command line, and is refused on an offline LAN installation."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tooling import install

sys.path.insert(0, str(Path(install.__file__).resolve().parent))
import native_install  # noqa: E402


class StepUpAddressTest(unittest.TestCase):
    def test_defaults_to_the_installation_administrator_and_accepts_another_account(self):
        profile = {"route": "B1", "adminEmail": "admin@example.test"}
        self.assertEqual(install.step_up_address(profile), "admin@example.test")
        self.assertEqual(install.step_up_address(profile, " other@example.test "), "other@example.test")

    def test_refuses_offline_lan_and_unusable_addresses(self):
        with self.assertRaises(ValueError):
            install.step_up_address({"route": "A2_OFFLINE", "adminEmail": None}, "admin@example.test")
        for address in ("", "no-at-sign", "two words@example.test"):
            with self.assertRaises(ValueError):
                install.step_up_address({"route": "A1", "adminEmail": None}, address)


class StepUpLinkCommandTest(unittest.TestCase):
    def test_docker_routes_run_the_tool_in_the_api_container_with_the_address_on_stdin(self):
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder)
            (state / install.PROFILE).write_text(json.dumps({"route": "B1", "adminEmail": "admin@example.test"}),
                                                 encoding="utf-8")
            with mock.patch.object(install, "compose_command", return_value=["docker", "compose"]), \
                    mock.patch.object(install, "route_services", return_value=("mysql", "api", "web")), \
                    mock.patch.object(install, "images_behind_package", return_value=[]), \
                    mock.patch.object(install.subprocess, "run",
                                      return_value=subprocess.CompletedProcess([], 0)) as run:
                install.operate(state, "step-up-link", email="director@example.test")
        command = run.call_args.args[0]
        self.assertEqual(command[:2], ["docker", "compose"])
        self.assertIn("dist/security/step-up-operator-main.js", command)
        self.assertEqual(command[-1], "--email-stdin")
        self.assertNotIn("director@example.test", " ".join(command))
        self.assertEqual(run.call_args.kwargs["input"], "director@example.test\n")

    def test_non_docker_routes_run_the_tool_with_node(self):
        profile = {"route": "B2", "adminEmail": "admin@example.test"}
        with mock.patch.object(native_install, "package_paths"), \
                mock.patch.object(native_install, "loaded", return_value=(Path("state"), profile, {})), \
                mock.patch.object(native_install, "node_command") as node:
            native_install.operate(Path("state"), "step-up-link")
        node.assert_called_once_with(Path("state"), "security/step-up-operator-main.js", "--email-stdin",
                                     input_text="admin@example.test\n")


if __name__ == "__main__":
    unittest.main()
