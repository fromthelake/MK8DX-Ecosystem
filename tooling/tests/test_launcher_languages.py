"""The launcher windows in the 15 game languages: language choice (Python, PowerShell, sh), catalogs, output."""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tooling import launcher_text

ROOT = Path(__file__).resolve().parents[2]
CATALOGS = ROOT / "tooling" / "launcher_i18n"
SOURCE = ROOT / "tooling" / "i18n" / "launcher" / "messages.source.json"
# OS language tag -> product language, the cases of the A2 pages' language.js plus locale spellings.
CASES = {
    "de-DE": "de", "de_AT.UTF-8": "de", "en-GB": "en", "en-US": "en-US", "en-AU": "en", "nl-BE": "nl",
    "es-ES": "es", "es-MX": "es-419", "es_AR.UTF-8": "es-419", "fr-FR": "fr", "fr-CA": "fr-CA", "fr-BE": "fr",
    "pt-BR": "pt", "it_IT@euro": "it", "ja-JP": "ja", "ko-KR": "ko", "ru-RU": "ru", "zh-CN": "zh-CN",
    "zh-Hans-SG": "zh-CN", "zh-TW": "zh-TW", "zh-HK": "zh-TW", "zh-Hant": "zh-TW", "zh_TW.UTF-8": "zh-TW",
}
UNKNOWN = ("sv-SE", "C", "POSIX", "C.UTF-8", "")
CATALOG_LANGUAGES = [code for code in launcher_text.LANGUAGES if code != "en"]


def numbered(text):
    return set(re.findall(r"\{\d+\}", text))


def english_env(**extra):
    environment = {key: value for key, value in os.environ.items() if key != "MK8DX_LANGUAGE"}
    environment.update(extra)
    return environment


class LanguageChoiceTest(unittest.TestCase):
    def test_python_matches_exact_then_region_then_base(self):
        for tag, code in CASES.items():
            with self.subTest(tag):
                self.assertEqual(launcher_text.match(tag), code)
        for tag in UNKNOWN:
            self.assertIsNone(launcher_text.match(tag))

    def test_explicit_language_wins_then_the_system_languages_then_english(self):
        self.assertEqual(launcher_text.choose({"MK8DX_LANGUAGE": "ja"}, ["de-DE"]), "ja")
        self.assertEqual(launcher_text.choose({"MK8DX_LANGUAGE": "xx"}, ["sv-SE", "es-MX"]), "es-419")
        self.assertEqual(launcher_text.choose({}, ["sv-SE"]), "en")
        # POSIX order LC_ALL, LC_MESSAGES, LANG (Windows puts its display language before them).
        tags = launcher_text.system_tags({"LC_ALL": "", "LC_MESSAGES": "ko_KR.UTF-8", "LANG": "C"})
        self.assertLess(tags.index("ko_KR.UTF-8"), tags.index("C"))
        self.assertEqual(launcher_text.choose({}, ["C", "ko_KR.UTF-8"]), "ko")

    def test_powershell_uses_the_same_rules(self):
        shells = [shell for shell in (shutil.which("pwsh"), shutil.which("powershell")) if shell]
        if not shells:
            self.skipTest("no PowerShell on this host")
        tags = list(CASES) + [tag for tag in UNKNOWN if tag]
        script = (f". '{ROOT / 'tooling' / 'mk8dx-ui.ps1'}' -Plain; foreach ($t in @("
                  + ",".join("'" + tag + "'" for tag in tags) + ")) { [string](Get-MK8DXLanguageMatch $t) }")
        for shell in dict.fromkeys(shells):
            with self.subTest(shell):
                result = subprocess.run([shell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
                                        capture_output=True, text=True, timeout=120, env=english_env())
                self.assertEqual(result.returncode, 0, result.stderr)
                expected = [CASES.get(tag, "") for tag in tags]
                self.assertEqual(result.stdout.splitlines()[-len(tags):], expected)


class CatalogTest(unittest.TestCase):
    def test_extractor_is_up_to_date_and_every_text_has_dutch(self):
        result = subprocess.run([sys.executable, str(ROOT / "tooling/i18n/extract_launcher_messages.py"), "--check"],
                                capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_every_catalog_has_every_text_with_its_placeholders(self):
        source = [entry["key"] for entry in json.loads(SOURCE.read_text(encoding="utf-8"))["messages"]]
        self.assertGreater(len(source), 100)
        # Windows PowerShell 5.1's ConvertFrom-Json refuses keys that differ only in case.
        self.assertEqual(len({key.lower() for key in source}), len(source))
        for code in CATALOG_LANGUAGES:
            messages = json.loads((CATALOGS / f"{code}.json").read_text(encoding="utf-8"))["messages"]
            with self.subTest(code):
                if code == "en-US":
                    self.assertEqual(messages, {})
                    continue
                self.assertEqual(sorted(messages), sorted(source))
                for english, text in messages.items():
                    self.assertEqual(numbered(text), numbered(english), (code, english, text))
                    self.assertNotIn("\t", text)
                    self.assertEqual(text.endswith(" "), english.endswith(" "), (code, english, text))

    def test_python_lookup_fills_values_after_translating(self):
        german = launcher_text.messages("de")["Website: {0}"]
        self.assertEqual(launcher_text.t("Website: {0}", "https://x", language="de"),
                         german.replace("{0}", "https://x"))
        self.assertEqual(launcher_text.t("Website: {0}", "https://x", language="en"), "Website: https://x")
        self.assertEqual(launcher_text.t("Not a catalog text", language="ja"), "Not a catalog text")


class LauncherOutputTest(unittest.TestCase):
    def test_install_wizard_asks_in_german(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = subprocess.run([sys.executable, str(ROOT / "tooling/install.py"), "wizard", "--state-dir",
                                     str(Path(temporary) / "new")], input="", capture_output=True,
                                    env=english_env(MK8DX_LANGUAGE="de", PYTHONIOENCODING="utf-8"), cwd=ROOT)
        stdout, stderr = result.stdout.decode("utf-8"), result.stderr.decode("utf-8")
        german = launcher_text.messages("de")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(german["Where will MK8DX run?"], stdout)
        self.assertIn(german["Try MK8DX on this computer only (Docker; sign-in mail stays on this computer)"], stdout)
        self.assertIn(german["Setup cancelled before a choice was made; nothing was created."], stderr)
        self.assertNotIn("Where will MK8DX run?", stdout)

    def test_lifecycle_and_package_errors_reach_the_window_translated(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = subprocess.run([sys.executable, str(ROOT / "tooling/lifecycle.py"), "backup", "--state-dir",
                                     str(Path(temporary) / "missing"), "--output", str(Path(temporary) / "out")],
                                    capture_output=True, env=english_env(MK8DX_LANGUAGE="ja", PYTHONIOENCODING="utf-8"),
                                    cwd=ROOT)
        stderr = result.stderr.decode("utf-8")
        japanese = launcher_text.messages("ja")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(japanese["Lifecycle operation refused or failed: {0}"].split("{0}")[0], stderr)
        self.assertNotIn("Lifecycle operation refused", stderr)
        # A message raised deep inside is a catalog text too, not only the frame around it.
        self.assertEqual(launcher_text.t("Backup checksum mismatch", language="ru"),
                         launcher_text.messages("ru")["Backup checksum mismatch"])

    def test_powershell_demo_in_japanese_is_utf8_when_redirected(self):
        japanese = launcher_text.messages("ja")
        for shell in dict.fromkeys(filter(None, (shutil.which("pwsh"), shutil.which("powershell")))):
            with self.subTest(shell):
                result = subprocess.run([shell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                                         str(ROOT / "tooling" / "mk8dx-ui.ps1"), "-Demo", "-Plain"],
                                        capture_output=True, timeout=120, env=english_env(MK8DX_LANGUAGE="ja"))
                self.assertEqual(result.returncode, 0, result.stderr)
                text = result.stdout.decode("utf-8")
                self.assertIn("[LAP 1/4] " + japanese["Checking Python"], text)
                self.assertIn("OK  " + japanese["Done."], text)

    def test_cmd_lines_are_translated_with_their_values(self):
        shell = shutil.which("powershell") or shutil.which("pwsh")
        if shell is None:
            self.skipTest("no PowerShell on this host")
        result = subprocess.run([shell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                                 str(ROOT / "tooling" / "mk8dx-ui.ps1"), "-Show", "Info", "-ShowText",
                                 "Website: {0}|Sign-in mail - a test inbox: {1}", "-ShowValues",
                                 "http://127.0.0.1:18090|http://127.0.0.1:18227"],
                                capture_output=True, timeout=120, env=english_env(MK8DX_LANGUAGE="ru"))
        russian = launcher_text.messages("ru")
        lines = result.stdout.decode("utf-8").splitlines()
        self.assertEqual(lines, [russian["Website: {0}"].replace("{0}", "http://127.0.0.1:18090"),
                                 russian["Sign-in mail - a test inbox: {1}"].replace("{1}", "http://127.0.0.1:18227")])
        # One value stays one value (an unrolled string would be splatted character by character).
        single = subprocess.run([shell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                                 str(ROOT / "tooling" / "mk8dx-ui.ps1"), "-Plain", "-Show", "Fail", "-ShowText",
                                 "MK8DX is not installed yet. Start {0} first.", "-ShowValues",
                                 "Start-MK8DX-No-Docker.cmd"],
                                capture_output=True, timeout=120, env=english_env(MK8DX_LANGUAGE="ru"))
        self.assertEqual(single.stdout.decode("utf-8").strip(), "!!  " + russian[
            "MK8DX is not installed yet. Start {0} first."].replace("{0}", "Start-MK8DX-No-Docker.cmd"))

    def test_sh_launcher_texts_follow_the_language(self):
        shells = []
        if shutil.which("sh"):
            shells.append([shutil.which("sh")])
        if sys.platform == "win32" and shutil.which("wsl") and os.environ.get("MK8DX_TEST_WSL_DISTRO"):
            user = ["-u", os.environ["MK8DX_TEST_WSL_USER"]] if os.environ.get("MK8DX_TEST_WSL_USER") else []
            shells.append(["wsl", "-d", os.environ["MK8DX_TEST_WSL_DISTRO"], *user, "--cd", str(ROOT), "--exec", "sh"])
        if not shells:
            self.skipTest("no sh on this host")
        korean = launcher_text.messages("ko")
        for shell in shells:
            with self.subTest(shell[0]):
                result = subprocess.run(shell + ["-c", ". tooling/mk8dx-ui.sh; ui_t 'Website: {0}' 'https://h'; echo;"
                                                 " ui_ok; ui_lap 1/4 \"$(ui_t 'Checking Python')\""],
                                        capture_output=True, cwd=ROOT, timeout=120,
                                        env=english_env(MK8DX_LANGUAGE="ko", MK8DX_PLAIN="1", WSLENV="MK8DX_LANGUAGE"))
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.decode("utf-8").splitlines(),
                                 [korean["Website: {0}"].replace("{0}", "https://h"), "OK  " + korean["Done."],
                                  "[LAP 1/4] " + korean["Checking Python"]])

    def test_sh_language_comes_from_lang(self):
        environment = english_env(LANG="es_MX.UTF-8", LC_ALL="", LC_MESSAGES="")
        if sys.platform == "win32":
            self.skipTest("Windows takes the display language first")
        result = subprocess.run([sys.executable, str(ROOT / "tooling/launcher_text.py"), "--language"],
                                capture_output=True, text=True, env=environment)
        self.assertEqual(result.stdout.strip(), "es-419")


if __name__ == "__main__":
    unittest.main()
