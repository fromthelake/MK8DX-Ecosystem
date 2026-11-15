"""Extract the launcher windows' translatable English texts (English is the key, as for the other products).

  python tooling/i18n/extract_launcher_messages.py [--check]

Sources, each read the way it marks a text:
* PowerShell (tooling/start-mk8dx.ps1, tooling/mk8dx-ui.ps1): `Tr '<English>'` (values: `Tr 'Website: {0}' $x`).
* POSIX sh (tooling/start-mk8dx.sh, tooling/mk8dx-ui.sh): `ui_t '<English>'`.
* cmd (Start-MK8DX*.cmd, Manage-MK8DX-No-Docker.cmd): the `-ShowText`, `-ShowSubtitle` and `-ShowItems` texts they
  hand to tooling/mk8dx-ui.ps1 ('|' separates lines, ';' menu items, '=' the item key).
* The Tournament Tools package's cmd files and setup helper (tooling/tournament/build_windows_package.py).
* Python (tooling/install.py, tooling/native_install.py, tooling/scheduled_backup.py, tooling/lifecycle.py,
  tooling/setup_wizard.py): `t("<English>", ...)` calls and the ROUTE_CHOICES menu.

The Dutch is kept in tooling/i18n/launcher/dutch.json (English -> Dutch; every text needs one). Writes
tooling/i18n/launcher/messages.source.json; tooling/i18n/build_web_catalogs.mjs turns it and the shared translations
into tooling/launcher_i18n/<language>.json (nl.json from the Dutch). --check fails when the source is not up to date
or a text has no Dutch.
"""
from __future__ import annotations

import ast
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FOLDER = ROOT / "tooling" / "i18n" / "launcher"
SOURCE = FOLDER / "messages.source.json"
DUTCH = FOLDER / "dutch.json"
POWERSHELL = ("tooling/start-mk8dx.ps1", "tooling/mk8dx-ui.ps1")
SHELL = ("tooling/start-mk8dx.sh", "tooling/mk8dx-ui.sh")
CMD = ("Start-MK8DX.cmd", "Start-MK8DX-LAN.cmd", "Start-MK8DX-No-Docker.cmd", "Manage-MK8DX-No-Docker.cmd")
PYTHON = ("tooling/install.py", "tooling/native_install.py", "tooling/scheduled_backup.py", "tooling/lifecycle.py",
          "tooling/setup_wizard.py")
# The Tournament Tools package (tooling/tournament/build_windows_package.py) ships these catalogs: its cmd files'
# `call :say "<English>"` / `call :title "<English>"` and its setup helper's `_text("<English>", ...)`.
PACKAGE = "tooling/tournament/build_windows_package.py"
PACKAGE_CALL = re.compile(r'call :(?:say|title) "([^"]*)"')
PS_CALL = re.compile(r"(?<![\w-])Tr\s+(?:'((?:[^']|'')*)'|\"([^\"$`]*)\")")
SH_CALL = re.compile(r"\bui_t\s+(?:'([^']*)'|\"([^\"$`\\]*)\")")
CMD_ARG = re.compile(r"-Show(Text|Subtitle|Items)\s+\"([^\"]*)\"")


def line_of(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def collect() -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}

    def add(english: str, place: str) -> None:
        if not re.search(r"[A-Za-z]{2,}", english):
            return
        places = found.setdefault(english, [])
        if place not in places and len(places) < 4:
            places.append(place)

    for name in POWERSHELL:
        text = (ROOT / name).read_text(encoding="utf-8")
        for match in PS_CALL.finditer(text):
            english = match.group(1).replace("''", "'") if match.group(1) is not None else match.group(2)
            add(english, f"{Path(name).name}:{line_of(text, match.start())}")
    for name in SHELL:
        text = (ROOT / name).read_text(encoding="utf-8")
        for match in SH_CALL.finditer(text):
            add(match.group(1) if match.group(1) is not None else match.group(2),
                f"{Path(name).name}:{line_of(text, match.start())}")
    for name in CMD:
        text = (ROOT / name).read_text(encoding="utf-8")
        for match in CMD_ARG.finditer(text):
            kind, value = match.groups()
            place = f"{name}:{line_of(text, match.start())}"
            if kind == "Items":
                for item in value.split(";"):
                    if "=" in item:
                        add(item.split("=", 1)[1].strip(), place)
            else:
                for part in value.split("|"):
                    add(part, place)
    for name in PYTHON:
        text = (ROOT / name).read_text(encoding="utf-8")
        for node in ast.walk(ast.parse(text)):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "t"
                    and node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)):
                add(node.args[0].value, f"{Path(name).name}:{node.lineno}")
            if isinstance(node, ast.Assign) and any(getattr(target, "id", "") == "ROUTE_CHOICES"
                                                    for target in node.targets):
                for value in node.value.values:
                    add(ast.literal_eval(value), f"{Path(name).name}:{value.lineno}")
    text = (ROOT / PACKAGE).read_text(encoding="utf-8")
    for match in PACKAGE_CALL.finditer(text):
        add(match.group(1), f"{Path(PACKAGE).name}:{line_of(text, match.start())}")
    helper = next(ast.literal_eval(node.value) for node in ast.parse(text).body if isinstance(node, ast.Assign)
                  and getattr(node.targets[0], "id", "") == "SETUP_HELPER_PY")
    offset = line_of(text, text.index("SETUP_HELPER_PY = ")) - 1
    for node in ast.walk(ast.parse(helper)):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "_text"
                and node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)):
            add(node.args[0].value, f"{Path(PACKAGE).name}:{offset + node.lineno}")
    return found


def build() -> tuple[str, list[str]]:
    dutch = json.loads(DUTCH.read_text(encoding="utf-8")) if DUTCH.is_file() else {}
    found = collect()
    missing = sorted(english for english in found if not isinstance(dutch.get(english), str))
    entries = [{"key": english, "nl": dutch.get(english, english), "places": found[english]}
               for english in sorted(found)]
    text = json.dumps({"schemaVersion": "mk8dx.launcher-message-source.v1",
                       "generatedBy": "tooling/i18n/extract_launcher_messages.py", "messages": entries},
                      ensure_ascii=False, indent=1) + "\n"
    return text, missing


def main() -> int:
    check = "--check" in sys.argv[1:]
    text, missing = build()
    if missing:
        print(f"{len(missing)} launcher text(s) without Dutch in {DUTCH.relative_to(ROOT).as_posix()}, first:",
              json.dumps(missing[0], ensure_ascii=False))
    current = SOURCE.read_text(encoding="utf-8") if SOURCE.is_file() else None
    if current != text:
        if check:
            print("Out of date; run python tooling/i18n/extract_launcher_messages.py")
            return 1
        SOURCE.parent.mkdir(parents=True, exist_ok=True)
        SOURCE.write_bytes(text.encode("utf-8"))
    return 1 if missing and check else 0


if __name__ == "__main__":
    sys.exit(main())
