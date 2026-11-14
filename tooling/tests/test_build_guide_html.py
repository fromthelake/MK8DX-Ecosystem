"""The illustrated HTML guide is built from the Markdown guides and stays in step with them."""

import re
import unittest

from tooling import build_guide_html


class GuideHtmlTest(unittest.TestCase):
    def test_committed_html_matches_the_markdown(self):
        # Edit docs/install/A2_*.md, then run: python tooling/build_guide_html.py
        self.assertEqual(build_guide_html.build(check=True), 0)

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


if __name__ == "__main__":
    unittest.main()
