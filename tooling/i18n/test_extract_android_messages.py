"""Bounded Kotlin string matching for the Android translation extractor."""

import re
import time
import unittest

from tooling.i18n.extract_android_messages import STRING


class AndroidStringPatternTest(unittest.TestCase):
    def test_nested_template_and_unfinished_repetition(self) -> None:
        pattern = re.compile(STRING)
        self.assertIsNotNone(pattern.fullmatch('"${track?.let { " on $it" } ?: ""}"'))
        malformed = '"${' + '{value}' * 10_000 + 'unfinished"'
        started = time.perf_counter()
        self.assertIsNone(pattern.fullmatch(malformed))
        self.assertLess(time.perf_counter() - started, 2)


if __name__ == "__main__":
    unittest.main()
