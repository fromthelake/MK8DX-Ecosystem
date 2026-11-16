"""The A2 setup wizard, the /setup page and the invitation page in the 15 languages of the game."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WIZARD_LANGUAGE = ROOT / "tooling" / "setup_wizard_static" / "language.js"
INVITE_LANGUAGE = ROOT / "infrastructure" / "docker" / "offline-invite" / "language.js"
CATALOG_LANGUAGES = ("en-US", "fr", "fr-CA", "de", "es", "es-419", "it", "pt", "ru", "ja", "ko", "zh-CN", "zh-TW")
PRODUCTS = {
    "a2-setup": ROOT / "tooling" / "setup_wizard_static" / "i18n",
    "a2-invite": ROOT / "infrastructure" / "docker" / "offline-invite" / "i18n",
}
PLACEHOLDER = re.compile(r"\{[A-Za-z0-9_]+\}")


def source_keys(product: str) -> list[str]:
    path = ROOT / "tooling" / "i18n" / product / "messages.source.json"
    return [message["key"] for message in json.loads(path.read_text(encoding="utf-8"))["messages"]]


class LanguageChoiceTest(unittest.TestCase):
    def test_the_two_copies_are_identical(self):
        self.assertEqual(WIZARD_LANGUAGE.read_bytes(), INVITE_LANGUAGE.read_bytes())

    @unittest.skipUnless(shutil.which("node"), "needs Node.js")
    def test_saved_then_exact_regional_base_then_english(self):
        cases = [
            (None, ["de-DE", "en"], "de"), (None, ["es-MX"], "es-419"), (None, ["es-419"], "es-419"),
            (None, ["es-ES"], "es"), (None, ["es"], "es"), (None, ["zh-Hant-HK"], "zh-TW"), (None, ["zh-HK"], "zh-TW"),
            (None, ["zh-TW"], "zh-TW"), (None, ["zh"], "zh-CN"), (None, ["zh-Hans-SG"], "zh-CN"),
            (None, ["fr-CA"], "fr-CA"), (None, ["fr-BE"], "fr"), (None, ["en-US"], "en-US"), (None, ["en-AU"], "en"),
            (None, ["pt-BR"], "pt"), (None, ["nl-BE"], "nl"), (None, ["xx-YY", "ja-JP"], "ja"), (None, ["*"], "en"),
            (None, [], "en"), (None, ["sv", "ko_KR"], "ko"), ("es-419", ["de"], "es-419"), ("zh-tw", ["de"], "zh-TW"),
            ("klingon", ["ru-RU"], "ru"), ("", ["it-CH"], "it"),
        ]
        script = (WIZARD_LANGUAGE.read_text(encoding="utf-8") +
                  "\nconst cases = JSON.parse(process.argv[1]);"
                  "console.log(JSON.stringify(cases.map(([s, p]) => globalThis.MK8DXLanguage.choose(s, p))));")
        result = subprocess.run(["node", "-e", script, json.dumps([[s, p] for s, p, _ in cases])],
                                capture_output=True, text=True, check=True, timeout=30)
        chosen = json.loads(result.stdout)
        for (saved, preferred, expected), got in zip(cases, chosen):
            with self.subTest(saved=saved, preferred=preferred):
                self.assertEqual(got, expected)

    @unittest.skipUnless(shutil.which("node"), "needs Node.js")
    def test_the_selector_lists_the_15_game_languages(self):
        script = WIZARD_LANGUAGE.read_text(encoding="utf-8") + \
            "\nconsole.log(JSON.stringify(globalThis.MK8DXLanguage.LANGUAGES.map(([c]) => c)));"
        codes = json.loads(subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True,
                                          timeout=30).stdout)
        self.assertEqual(sorted(codes), sorted(("en", "nl") + CATALOG_LANGUAGES))


class CatalogTest(unittest.TestCase):
    def test_sources_are_up_to_date(self):
        result = subprocess.run([sys.executable, str(ROOT / "tooling" / "i18n" / "extract_a2_messages.py"), "--check"],
                                capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_every_catalog_has_every_text_with_the_same_placeholders(self):
        for product, folder in PRODUCTS.items():
            keys = source_keys(product)
            self.assertEqual(sorted(p.name for p in folder.iterdir()),
                             sorted(f"{language}.json" for language in CATALOG_LANGUAGES))
            for language in CATALOG_LANGUAGES:
                with self.subTest(product=product, language=language):
                    catalog = json.loads((folder / f"{language}.json").read_text(encoding="utf-8"))
                    self.assertEqual(catalog["language"], language)
                    self.assertNotIn("gameNames", catalog)
                    messages = catalog["messages"]
                    self.assertEqual(sorted(set(messages) - set(keys)), [])
                    if language == "en-US":  # English (US) is the English source text
                        continue
                    self.assertEqual([key for key in keys if key not in messages], [])
                    for english, translated in messages.items():
                        self.assertTrue(translated.strip(), english)
                        self.assertEqual(sorted(PLACEHOLDER.findall(translated)), sorted(PLACEHOLDER.findall(english)),
                                         f"{language}: {english}")

    def test_wizard_and_invitation_texts_are_translated_not_english(self):
        # A few texts that must differ from the English in every translated language.
        for product, english in (("a2-setup", "Prepare this device"), ("a2-setup", "Welcome to MK8DX"),
                                 ("a2-invite", "Join this MK8DX installation"), ("a2-invite", "Accept invitation")):
            for language in CATALOG_LANGUAGES[1:]:
                with self.subTest(product=product, language=language):
                    catalog = json.loads((PRODUCTS[product] / f"{language}.json").read_text(encoding="utf-8"))
                    self.assertNotEqual(catalog["messages"][english], english)

    def test_host_page_module_has_every_text_in_every_language(self):
        # The API image ships compiled TypeScript only, so the host page's catalogs are one generated module.
        module = (ROOT / "backend" / "api" / "src" / "administration" / "offline-host-text.generated.ts").read_text(
            encoding="utf-8")
        catalogs = json.loads(module.split(" = ", 1)[1].rstrip().rstrip(";"))
        keys = source_keys("a2-host")
        self.assertEqual(sorted(catalogs), sorted(CATALOG_LANGUAGES))
        for language in CATALOG_LANGUAGES[1:]:
            with self.subTest(language=language):
                messages = catalogs[language]
                self.assertEqual([key for key in keys if key not in messages], [])
                self.assertEqual(sorted(set(messages) - set(keys)), [])
                self.assertNotEqual(messages["Use the 'MK8DX beheer' shortcut"], "Use the 'MK8DX beheer' shortcut")
                for english, translated in messages.items():
                    if "MK8DX beheer" in english:  # the shortcut's name is the same in every language
                        self.assertIn("MK8DX beheer", translated)
                    self.assertEqual(sorted(PLACEHOLDER.findall(translated)), sorted(PLACEHOLDER.findall(english)))


class SetupPageTest(unittest.TestCase):
    def setUp(self):
        try:
            from tooling import offline_lan_ca
        except ImportError as error:  # cryptography is part of the offline closure
            self.skipTest(f"offline LAN tools unavailable: {error}")
        self.ca = offline_lan_ca
        self.page = offline_lan_ca.setup_page("https://192.168.1.20",
                                              {"certificateSha256": "ab" * 32, "spkiSha256": "cd" * 32})

    def test_all_15_languages_english_first_without_javascript(self):
        blocks = re.findall(r'<div class="lang" lang="([^"]+)" data-lang="[^"]+" data-label="[^"]*"( hidden)?>',
                            self.page)
        self.assertEqual(sorted(code for code, _ in blocks), sorted(("en", "nl") + CATALOG_LANGUAGES))
        self.assertEqual([code for code, hidden in blocks if not hidden], ["en"])
        for language in ("de", "ja", "es-419"):
            title = self.ca.setup_texts(language)["title"]
            self.assertNotEqual(title, "Prepare this device")
            self.assertIn(title, self.page)

    def test_steps_are_translated_lists(self):
        german = self.ca.setup_texts("de")
        self.assertEqual(len(german["android"]), len(self.ca._SETUP_TEXT["en"]["android"]))
        self.assertNotEqual(german["android"], self.ca._SETUP_TEXT["en"]["android"])
        self.assertEqual(german["names"], self.ca._SETUP_TEXT["en"]["names"])


if __name__ == "__main__":
    unittest.main()
