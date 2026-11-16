"""Extract the A2 offline pages' translatable English texts (English is the key, as for the other products).

  python tooling/i18n/extract_a2_messages.py [--check]

* Setup wizard "MK8DX beheer" (tooling/setup_wizard_static/wizard.js): the `SOURCE = { nl: {...}, en: {...} }`
  tables, and the host's /setup page "Prepare this device" (tooling/offline_lan_ca.py `_SETUP_TEXT`).
  -> tooling/i18n/a2-setup/messages.source.json
* Invitation page (infrastructure/docker/offline-invite/app.js): its `SOURCE` tables.
  -> tooling/i18n/a2-invite/messages.source.json
* The technical host page's unlock section (backend/api/src/administration/offline-host-text.ts): its `SOURCE`.
  -> tooling/i18n/a2-host/messages.source.json

tooling/i18n/build_web_catalogs.mjs turns the shared translations into the catalogs these pages load
(tooling/setup_wizard_static/i18n/, infrastructure/docker/offline-invite/i18n/,
backend/api/src/administration/offline-host-text.generated.ts). Named placeholders such as
{name} stay as they are in every translation. --check fails when a committed file is not up to date.
"""
from __future__ import annotations

import ast
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
JS_STRING = r'"(?:[^"\\]|\\.)*"'
ENTRY = re.compile(rf'\b([A-Za-z_][A-Za-z0-9_]*)\s*:\s*({JS_STRING})')
SETUP = ROOT / "tooling" / "i18n" / "a2-setup" / "messages.source.json"
INVITE = ROOT / "tooling" / "i18n" / "a2-invite" / "messages.source.json"
HOST = ROOT / "tooling" / "i18n" / "a2-host" / "messages.source.json"


def js_string(token: str) -> str:
    return json.loads(token)


def source_tables(path: Path) -> dict[str, dict[str, str]]:
    """The `const SOURCE = { nl: {...}, en: {...} };` tables of a page script, key -> text per language."""
    text = path.read_text(encoding="utf-8")
    block = re.search(r"^const SOURCE = \{\n(.*?)\n\};\n", text, re.S | re.M)
    if not block:
        raise SystemExit(f"{path}: no SOURCE table")
    tables: dict[str, dict[str, str]] = {}
    for language, body in re.findall(r"^  (nl|en): \{\n(.*?)\n  \},", block.group(1) + "\n", re.S | re.M):
        tables[language] = {key: js_string(value) for key, value in ENTRY.findall(body)}
    if set(tables) != {"nl", "en"} or set(tables["nl"]) != set(tables["en"]):
        raise SystemExit(f"{path}: the nl and en tables must have the same keys")
    return tables


def setup_page_text() -> dict[str, dict]:
    tree = ast.parse((ROOT / "tooling" / "offline_lan_ca.py").read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == "_SETUP_TEXT" for t in node.targets):
            return ast.literal_eval(node.value)
    raise SystemExit("tooling/offline_lan_ca.py: no _SETUP_TEXT")


def add(messages: dict[str, dict], english: str, dutch: str, place: str) -> None:
    entry = messages.setdefault(english, {"key": english, "nl": dutch, "places": []})
    if place not in entry["places"] and len(entry["places"]) < 4:
        entry["places"].append(place)


def render(schema: str, messages: dict[str, dict]) -> str:
    entries = [messages[key] for key in sorted(messages)]
    return json.dumps({"schemaVersion": schema, "generatedBy": "tooling/i18n/extract_a2_messages.py",
                       "messages": entries}, ensure_ascii=False, indent=1) + "\n"


def build() -> dict[Path, str]:
    setup: dict[str, dict] = {}
    wizard = source_tables(ROOT / "tooling" / "setup_wizard_static" / "wizard.js")
    for key, english in wizard["en"].items():
        add(setup, english, wizard["nl"][key], f"wizard.js:{key}")
    page = setup_page_text()
    for key, english in page["en"].items():
        if key == "names":  # platform names (Android, iPhone / iPad, ...) stay as they are
            continue
        dutch = page["nl"][key]
        if isinstance(english, list):
            for index, (en_step, nl_step) in enumerate(zip(english, dutch, strict=True)):
                add(setup, en_step, nl_step, f"offline_lan_ca.py:{key}[{index}]")
        else:
            add(setup, english, dutch, f"offline_lan_ca.py:{key}")
    invite: dict[str, dict] = {}
    tables = source_tables(ROOT / "infrastructure" / "docker" / "offline-invite" / "app.js")
    for key, english in tables["en"].items():
        add(invite, english, tables["nl"][key], f"app.js:{key}")
    host: dict[str, dict] = {}
    tables = source_tables(ROOT / "backend" / "api" / "src" / "administration" / "offline-host-text.ts")
    for key, english in tables["en"].items():
        add(host, english, tables["nl"][key], f"offline-host-text.ts:{key}")
    return {SETUP: render("mk8dx.a2-setup-message-source.v1", setup),
            INVITE: render("mk8dx.a2-invite-message-source.v1", invite),
            HOST: render("mk8dx.a2-host-message-source.v1", host)}


def main() -> int:
    check = "--check" in sys.argv[1:]
    stale = []
    for path, text in build().items():
        current = path.read_text(encoding="utf-8") if path.is_file() else None
        if current == text:
            continue
        if check:
            stale.append(path.relative_to(ROOT).as_posix())
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    if stale:
        print("Out of date; run python tooling/i18n/extract_a2_messages.py:", ", ".join(stale))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
