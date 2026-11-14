"""The illustrated HTML guide is built from the Markdown guides and stays in step with them."""

import contextlib
import io
import re
import unittest

from tooling import build_guide_html


class GuideHtmlTest(unittest.TestCase):
    def test_committed_html_matches_the_markdown(self):
        # Edit docs/install/A2_*.md, then run: python tooling/build_guide_html.py
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            result = build_guide_html.build(check=True)
        self.assertEqual(result, 0, printed.getvalue())
        self.assertIn("up to date", printed.getvalue())

    def test_both_languages_have_the_same_shape(self):
        pages = {lang: build_guide_html.render(lang, images=set()) for lang in ("nl", "en")}
        for marker in ('class="chapter', 'class="step', "os-windows", "os-linux", "device-android", "device-iphone"):
            with self.subTest(marker=marker):
                self.assertEqual(pages["nl"].count(marker), pages["en"].count(marker))
                self.assertGreater(pages["nl"].count(marker), 0)

    def test_no_inline_script_or_style_and_no_raw_markdown(self):
        page = build_guide_html.render("nl", images=set())
        self.assertNotIn("<script>", page)
        self.assertNotRegex(page, r"\sstyle=")
        self.assertNotRegex(page, r"\son[a-z]+=")
        text = re.sub(r"<code>.*?</code>", "", page)
        self.assertNotIn("**", text)
        self.assertNotIn("<!--", page)

    def test_steps_become_cards_with_their_three_parts(self):
        page = build_guide_html.render("en", images=set())
        self.assertIn('<div class="step-do"><span class="step-label">Do</span>', page)
        self.assertIn('<div class="step-see"><span class="step-label">You see</span>', page)
        self.assertIn('<div class="step-else"><span class="step-label">See something else?</span>', page)

    def test_screenshots_appear_only_when_the_image_exists(self):
        without = build_guide_html.render("nl", images=set())
        self.assertNotIn("<figure>", without)
        with_one = build_guide_html.render("nl", images={"wizard-welkom-nl.png"})
        self.assertIn('<img src="img/wizard-welkom-nl.png"', with_one)

    def test_markdown_shows_real_images_and_hides_missing_ones(self):
        text = build_guide_html.markdown("en", images={"wizard-welcome-en.png"})
        self.assertIn("![wizard welcome](guide/img/wizard-welcome-en.png)", text)
        self.assertNotRegex(text, r"(?m)^\((?:Image|Afbeelding): ")
        self.assertNotIn("guide/img/wizard-check-en.png", text)
        self.assertIn("<!-- image: wizard-check -->", text)
        # Every form of a screenshot line names the same screenshot for the HTML page.
        for line in ("(Image: wizard-check)", "<!-- image: wizard-check -->", "![x](guide/img/wizard-check-en.png)"):
            with self.subTest(line=line):
                self.assertEqual(build_guide_html._picture(line), "wizard-check")
        # A translation's image line points two folders up, at its own or the English screenshot.
        for line in ("![Assistent](../../guide/img/wizard-check-en.png)", "![x](guide/img/wizard-check-zh-TW.png)",
                     "![x](../../guide/img/wizard-check-es-419.png)"):
            with self.subTest(line=line):
                self.assertEqual(build_guide_html._picture(line), "wizard-check")


class TranslatedGuideTest(unittest.TestCase):
    """Every locale folder with A2_HOME_GUIDE.md and guide-words.json becomes its own page."""

    def setUp(self):
        if not build_guide_html.TRANSLATED:
            self.skipTest("no translated guide in this checkout")
        self.lang = build_guide_html.TRANSLATED[0]

    def test_every_translation_has_the_shape_of_the_english_page(self):
        english = build_guide_html.render("en", images=set())
        markers = ('class="chapter', 'class="step', "step-do", "step-see", "step-else", "os-windows", "os-linux",
                   "os-macos", "device-android", "device-iphone")
        for lang in build_guide_html.TRANSLATED:
            page = build_guide_html.render(lang, images=set())
            for marker in markers:
                with self.subTest(lang=lang, marker=marker):
                    self.assertEqual(page.count(marker), english.count(marker))
            self.assertIn(f'<html lang="{lang}">', page)
            self.assertNotRegex(page, r"\sstyle=")
            self.assertNotIn("<script>", page)

    def test_a_translation_reuses_the_english_screenshot_until_it_has_its_own(self):
        lang = self.lang
        page = build_guide_html.render(lang, images={"wizard-welcome-en.png"})
        self.assertIn('<img src="img/wizard-welcome-en.png"', page)
        own = build_guide_html.render(lang, images={"wizard-welcome-en.png", f"wizard-welcome-{lang}.png"})
        self.assertIn(f'<img src="img/wizard-welcome-{lang}.png"', own)
        text = build_guide_html.markdown(lang, images={"wizard-welcome-en.png"})
        self.assertRegex(text, r"!\[[^\]]+\]\(\.\./\.\./guide/img/wizard-welcome-en\.png\)")
        self.assertNotRegex(text, r"\]\(guide/img/")
        self.assertIn("<!-- image: wizard-check -->", text)

    def test_every_page_offers_all_15_languages(self):
        codes = [code for code, _ in build_guide_html.LANGUAGES]
        self.assertEqual(len(codes), 15)
        for lang in ("en", "nl", self.lang):
            page = build_guide_html.render(lang, images=set())
            for code in codes:
                with self.subTest(lang=lang, code=code):
                    self.assertIn(f'hreflang="{code}"', page)
            self.assertIn(f'href="{lang}.html" hreflang="{lang}" lang="{lang}" aria-current="page"', page)
        self.assertEqual(build_guide_html.page_for("pt-BR"), "pt" if "pt" in build_guide_html.SOURCES else "en")
        self.assertEqual(build_guide_html.page_for("xx"), "en")

    def test_github_anchors_and_players_guide_links(self):
        self.assertEqual(build_guide_html.github_slug("7. The Android app and LiveTrial"),
                         "7-the-android-app-and-livetrial")
        self.assertEqual(build_guide_html.github_slug("7. Android アプリと LiveTrial"), "7-android-アプリと-livetrial")
        for path, text in build_guide_html.players_guides().items():
            with self.subTest(path=path.parent.name):
                self.assertNotIn("A2_HOME_GUIDE_EN.md#", text)


if __name__ == "__main__":
    unittest.main()
