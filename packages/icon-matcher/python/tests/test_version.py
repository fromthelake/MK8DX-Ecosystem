"""The field-semantics version is one value across languages and packaging."""

from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import mk8dx_icon_matcher  # noqa: E402

PACKAGE = Path(__file__).resolve().parents[2]


def test_python_typescript_java_and_wheel_name_one_field_version():
    pyproject = (PACKAGE / "python" / "pyproject.toml").read_text(encoding="utf-8")
    typescript = (PACKAGE / "ts" / "sharedFieldVersion.ts").read_text(encoding="utf-8")
    wheel = re.search(r'^version = "([^"]+)"', pyproject, re.M).group(1)
    ts = re.search(r"SHARED_FIELD_SEMANTICS_VERSION = '([^']+)'", typescript).group(1)
    java_source = (PACKAGE / "java" / "src" / "main" / "java" / "nl" / "mariokart8" / "iconmatcher"
                   / "FieldSemantics.java").read_text(encoding="utf-8")
    java = re.search(r'VERSION = "([^"]+)"', java_source).group(1)
    assert mk8dx_icon_matcher.FIELD_SEMANTICS_VERSION == mk8dx_icon_matcher.__version__
    assert {wheel, ts, java} == {mk8dx_icon_matcher.__version__}
