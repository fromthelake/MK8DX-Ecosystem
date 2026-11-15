"""Extract the Tournament Live spectator dashboard's translatable English texts (English is the key).

  python tooling/i18n/extract_broadcast_messages.py [--check]

Sources (apps/tournament-live/src/live_processor/broadcast_web): `t("<English>", ...)` calls in app.js and the
`data-i18n="<English>"` / `data-i18n-title="<English>"` attributes in index.html and app.js.

The Dutch is kept in apps/tournament-live/i18n/broadcast/dutch.json (English -> Dutch; every text needs one).
Writes apps/tournament-live/i18n/broadcast/messages.source.json; tooling/i18n/build_web_catalogs.mjs turns it and the
shared translations into broadcast_web/i18n/<language>.json (nl.json from the Dutch), which broadcast_server.py
serves at /api/messages/<language>. --check fails when the source is not up to date or a text has no Dutch.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "apps" / "tournament-live" / "src" / "live_processor" / "broadcast_web"
FOLDER = ROOT / "apps" / "tournament-live" / "i18n" / "broadcast"
SOURCE = FOLDER / "messages.source.json"
DUTCH = FOLDER / "dutch.json"
FILES = ("app.js", "index.html")
CALL = re.compile(r'(?<![\w.$])t\(\s*"((?:[^"\\\n]|\\.)*)"')
ATTRIBUTE = re.compile(r'\bdata-i18n(?:-title)?="([^"]*)"')


def collect() -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    for name in FILES:
        text = (WEB / name).read_text(encoding="utf-8")
        for pattern in (CALL, ATTRIBUTE):
            for match in pattern.finditer(text):
                english = json.loads(f'"{match.group(1)}"') if pattern is CALL else match.group(1)
                places = found.setdefault(english, [])
                place = f"{name}:{text.count(chr(10), 0, match.start()) + 1}"
                if place not in places and len(places) < 4:
                    places.append(place)
    return found


def build() -> tuple[str, list[str]]:
    dutch = json.loads(DUTCH.read_text(encoding="utf-8")) if DUTCH.is_file() else {}
    found = collect()
    missing = sorted(english for english in found if not isinstance(dutch.get(english), str))
    entries = [{"key": english, "nl": dutch.get(english, english), "places": found[english]}
               for english in sorted(found)]
    text = json.dumps({"schemaVersion": "mk8dx.tournament-live-broadcast-message-source.v1",
                       "generatedBy": "tooling/i18n/extract_broadcast_messages.py", "messages": entries},
                      ensure_ascii=False, indent=1) + "\n"
    return text, missing


def main() -> int:
    check = "--check" in sys.argv[1:]
    text, missing = build()
    if missing:
        print(f"{len(missing)} dashboard text(s) without Dutch in {DUTCH.relative_to(ROOT).as_posix()}, first:",
              json.dumps(missing[0], ensure_ascii=False))
    current = SOURCE.read_text(encoding="utf-8") if SOURCE.is_file() else None
    if current != text:
        if check:
            print("Out of date; run python tooling/i18n/extract_broadcast_messages.py")
            return 1
        SOURCE.parent.mkdir(parents=True, exist_ok=True)
        SOURCE.write_bytes(text.encode("utf-8"))
    return 1 if missing and check else 0


if __name__ == "__main__":
    sys.exit(main())
