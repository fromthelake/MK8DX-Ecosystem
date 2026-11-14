"""Extract the Tournament Analysis window's translatable English texts (English is the key, as for the other products).

  python tooling/i18n/extract_processor_messages.py [--check]

Reads the English/Dutch ``TEXTS`` table of apps/tournament-processor/src/tournament_processor/gui.py (shared by
the Qt window and the classic Tkinter window) and writes apps/tournament-processor/i18n/messages.source.json.
tooling/i18n/build_web_catalogs.mjs turns the shared translations into the catalogs the window loads
(apps/tournament-processor/src/tournament_processor/i18n/). Named placeholders such as {count} stay as they are
in every translation. --check fails when the committed source is not up to date.
"""
from __future__ import annotations

import ast
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GUI = ROOT / "apps" / "tournament-processor" / "src" / "tournament_processor" / "gui.py"
SOURCE = ROOT / "apps" / "tournament-processor" / "i18n" / "messages.source.json"
SCHEMA = "mk8dx.tournament-processor-message-source.v1"


def texts_table() -> dict[str, tuple[str, str]]:
    tree = ast.parse(GUI.read_text(encoding="utf-8"))
    for node in tree.body:
        target = node.target if isinstance(node, ast.AnnAssign) else (
            node.targets[0] if isinstance(node, ast.Assign) and len(node.targets) == 1 else None)
        if isinstance(target, ast.Name) and target.id == "TEXTS" and node.value is not None:
            table = ast.literal_eval(node.value)
            for key, pair in table.items():
                if not (isinstance(pair, tuple) and len(pair) == 2 and all(isinstance(t, str) and t for t in pair)):
                    raise SystemExit(f"{GUI}: TEXTS[{key!r}] must be (English, Dutch)")
            return table
    raise SystemExit(f"{GUI}: no TEXTS table")


def build() -> str:
    messages: dict[str, dict] = {}
    for key, (english, dutch) in texts_table().items():
        entry = messages.setdefault(english, {"key": english, "nl": dutch, "places": []})
        if entry["nl"] != dutch:
            raise SystemExit(f"{GUI}: {english!r} has two Dutch texts")
        if len(entry["places"]) < 4:
            entry["places"].append(f"gui.py:{key}")
    entries = [messages[english] for english in sorted(messages)]
    return json.dumps({"schemaVersion": SCHEMA, "generatedBy": "tooling/i18n/extract_processor_messages.py",
                       "messages": entries}, ensure_ascii=False, indent=1) + "\n"


def main() -> int:
    text = build()
    current = SOURCE.read_text(encoding="utf-8") if SOURCE.is_file() else None
    if current == text:
        return 0
    if "--check" in sys.argv[1:]:
        print("Out of date; run python tooling/i18n/extract_processor_messages.py:", SOURCE.relative_to(ROOT).as_posix())
        return 1
    SOURCE.parent.mkdir(parents=True, exist_ok=True)
    SOURCE.write_bytes(text.encode("utf-8"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
