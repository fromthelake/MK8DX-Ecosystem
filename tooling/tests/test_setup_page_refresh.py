"""A package update writes the A2 /setup page again, so an older installation gets the 15-language page."""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
import sys
import types
from unittest.mock import patch

from tooling import install, offline_lan_ca


def provisioned(folder: Path) -> Path:
    state = folder / "state"
    state.mkdir()
    offline_lan_ca.provision(state, "192.168.12.34", protect=lambda value: b"synthetic-test-protector")
    return state


class SetupPageRefreshTest(unittest.TestCase):
    def test_an_old_page_is_replaced_and_the_certificate_files_stay(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = provisioned(Path(temporary))
            setup = state / "offline-ca" / "setup"
            downloads = {name: (setup / name).read_bytes() for name in ("root.crt", "root.mobileconfig")}
            fresh = (setup / "index.html").read_bytes()
            self.assertFalse(offline_lan_ca.refresh_setup_page(state))  # already current: untouched
            (setup / "index.html").write_bytes(b"<html lang=\"en\">old English/Dutch page</html>")
            self.assertTrue(offline_lan_ca.refresh_setup_page(state))
            page = (setup / "index.html").read_bytes()
            self.assertEqual(page, fresh)
            for code in ("de", "ja", "zh-TW", "es-419"):
                self.assertIn(f'data-lang="{code}"'.encode(), page)
            self.assertIn("https://192.168.12.34".encode(), page)
            self.assertEqual({name: (setup / name).read_bytes() for name in downloads}, downloads)
            self.assertEqual(sorted(path.name for path in setup.iterdir()),
                             ["index.html", "root.crt", "root.mobileconfig"])

    def test_update_package_writes_the_page_after_the_new_version_runs(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = provisioned(Path(temporary))
            (state / install.PROFILE).write_text(json.dumps({"route": "A2_OFFLINE"}), encoding="utf-8")
            backup = Path(temporary) / "backup"
            backup.mkdir()
            (state / "offline-ca" / "setup" / "index.html").write_bytes(b"old page")
            order = []
            lifecycle = types.SimpleNamespace(verify_backup=lambda path: None)  # install.py imports it by name
            with patch.dict(sys.modules, {"lifecycle": lifecycle}), \
                    patch.object(install, "update_offer", return_value={"available": True, "to": "r30"}), \
                    patch.object(install, "use_package_images", return_value=b""), \
                    patch.object(install, "run_compose"), \
                    patch.object(install, "status", side_effect=lambda *a, **k: order.append("status")), \
                    patch.object(install, "record_package", side_effect=lambda *a: order.append("record")), \
                    contextlib.redirect_stdout(io.StringIO()) as shown:
                install.operate(state, "update-package", backup, qa_offline_candidate=True)
            self.assertEqual(order, ["status", "record"])
            self.assertNotEqual((state / "offline-ca" / "setup" / "index.html").read_bytes(), b"old page")
            self.assertIn("The page phones and other PCs open first is updated to this package.", shown.getvalue())


if __name__ == "__main__":
    unittest.main()
