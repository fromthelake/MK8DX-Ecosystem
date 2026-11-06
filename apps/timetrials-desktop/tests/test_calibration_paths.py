"""The engine overlay is partial; test its pure path guard without staging a model."""

import ast
import re
from pathlib import Path


OVERLAY = Path(__file__).resolve().parents[1] / "engine-overlay" / "livetrial" / "serve.py"


def _guard():
    tree = ast.parse(OVERLAY.read_text(encoding="utf-8"))
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                    and node.name == "_calibration_image")
    namespace = {"Path": Path, "re": re}
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(OVERLAY), "exec"), namespace)
    return namespace["_calibration_image"]


def test_calibration_reference_is_one_file_under_its_own_root(tmp_path: Path) -> None:
    guard = _guard()
    root = tmp_path / "refs"
    root.mkdir()
    inside = root / "3lap.jpg"
    inside.write_bytes(b"local image")
    (tmp_path / "private.jpg").write_bytes(b"outside")

    assert guard(root, "3lap.jpg", ".jpg") == inside.resolve()
    for filename in ("../private.jpg", r"..\private.jpg", "/private.jpg",
                     "private.txt", "missing.jpg", "not%20a%20name.jpg"):
        assert guard(root, filename, ".jpg") is None

    link = root / "outside.jpg"
    try:
        link.symlink_to(tmp_path / "private.jpg")
    except (OSError, NotImplementedError):
        pass  # Windows without developer-mode symlink permission.
    else:
        assert guard(root, "outside.jpg", ".jpg") is None
