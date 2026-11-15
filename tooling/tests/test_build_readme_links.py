"""The READMEs' language switcher and own-language guide links stay in step with the translated guides."""

import contextlib
import io
import unittest

from tooling import build_readme_links


class ReadmeLinksTest(unittest.TestCase):
    def test_committed_readmes_are_up_to_date(self):
        # After adding or renaming a translated guide, run: python tooling/build_readme_links.py
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            result = build_readme_links.main(["--check"])
        self.assertEqual(result, 0, printed.getvalue())

    def test_club_guides_link_the_readers_language_only_when_it_exists(self):
        row = "| x | [LiveTrial](docs/guides/LIVETRIAL.md) (Engels) — y; [Players](docs/guides/PLAYERS.md) |"
        self.assertEqual(build_readme_links.club_links("en", row), row)
        nl = build_readme_links.club_links("nl", row)
        self.assertIn("](docs/guides/translations/nl/LIVETRIAL.md) —", nl)
        self.assertIn("](docs/guides/translations/nl/PLAYERS.md)", nl)
        self.assertEqual(build_readme_links.club_links("xx", row), row)

    def test_translations_live_in_docs_readme_and_link_relative_to_it(self):
        root = build_readme_links.ROOT
        self.assertEqual(sorted(p.name for p in root.glob("README*.md")), ["README.md"])
        for code, _, name in build_readme_links.README[1:]:
            with self.subTest(code=code):
                self.assertTrue(name.startswith("docs/readme/README_"), name)
                text = (root / name).read_text(encoding="utf-8")
                self.assertIn("](../../README.md)", text.splitlines()[4])
                self.assertIn(f"/MK8DX_Guide_{code}.pdf)", text)
        row = "| x | [LiveTrial](../guides/LIVETRIAL.md) (Engels) |"
        self.assertIn("](../guides/translations/nl/LIVETRIAL.md)",
                      build_readme_links.club_links("nl", row, "docs/readme"))


if __name__ == "__main__":
    unittest.main()
