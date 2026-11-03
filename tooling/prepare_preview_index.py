"""Enable a separately staged scanner in a local-only Web preview index."""

import argparse
import stat
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "apps/timetrials-web/index.html"
BEFORE = 'name="mk8dx-scanner-base" content="off"'
AFTER = 'name="mk8dx-scanner-base" content="/scanner/"'


def is_link(path: Path) -> bool:
    if not path.exists():
        return False
    details = path.lstat()
    return path.is_symlink() or bool(getattr(details, "st_file_attributes", 0)
                                     & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    output = args.output.absolute()
    state = ROOT / ".mk8dx-local"
    if not state.is_dir() or output.parent != state or output.exists():
        raise SystemExit("Choose a new file directly inside the local installation state")
    for path in (ROOT, SOURCE, state, output.parent):
        if is_link(path):
            raise SystemExit("Reparse path in preview index input/output")
    text = SOURCE.read_text(encoding="utf-8")
    if text.count(BEFORE) != 1:
        raise SystemExit("Web scanner seam changed")
    with output.open("x", encoding="utf-8") as stream:
        stream.write(text.replace(BEFORE, AFTER))
    print("Private local preview index created")


if __name__ == "__main__":
    main()
