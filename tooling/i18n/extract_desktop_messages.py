"""Extract the desktop UIs' translatable English texts (languages roadmap B5).

  python tooling/i18n/extract_desktop_messages.py

* LiveTrial dashboard (apps/timetrials-desktop/dashboard/app.js): `tr("<English>", "<Dutch>")` calls with string
  or template literals; `${...}` becomes `{0}`, `{1}`, ... in reading order, the key form of the web extraction.
* Tournament Live (apps/tournament-live/src/live_processor/qt_app.py): the `_DUTCH_UI` English -> Dutch table.
Writes apps/timetrials-desktop/i18n/messages.source.json and apps/tournament-live/i18n/messages.source.json.
"""
from __future__ import annotations

import ast
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
JS_STRING = r'"(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\'|`(?:[^`\\]|\\.|\$\{(?:[^{}]|\{[^{}]*\})*\})*`'
TR_CALL = re.compile(rf'\btr\(\s*({JS_STRING})\s*,\s*({JS_STRING})\s*\)', re.S)
JS_TEMPLATE = re.compile(r'\$\{(?:[^{}]|\{[^{}]*\})*\}')


def js_literal(token: str) -> str:
    body = token[1:-1]
    if token[0] == "`":
        counter = iter(range(1000))
        body = JS_TEMPLATE.sub(lambda _: "{%d}" % next(counter), body)
    return (body.replace('\\"', '"').replace("\\'", "'").replace("\\`", "`")
            .replace("\\n", "\n").replace("\\\\", "\\"))


def write(target: Path, schema: str, messages: dict[str, dict]) -> int:
    target.parent.mkdir(parents=True, exist_ok=True)
    entries = [messages[key] for key in sorted(messages)]
    target.write_text(json.dumps({"schemaVersion": schema, "generatedBy": "tooling/i18n/extract_desktop_messages.py",
                                  "messages": entries}, ensure_ascii=False, indent=1) + "\n",
                      encoding="utf-8", newline="\n")
    return len(entries)


def dashboard() -> int:
    path = ROOT / "apps" / "timetrials-desktop" / "dashboard" / "app.js"
    text = path.read_text(encoding="utf-8")
    messages: dict[str, dict] = {}
    for match in TR_CALL.finditer(text):
        english, dutch = js_literal(match.group(1)), js_literal(match.group(2))
        if not re.search(r"[A-Za-z]{2,}", english):
            continue
        line = text.count("\n", 0, match.start()) + 1
        entry = messages.setdefault(english, {"key": english, "nl": dutch, "places": []})
        if len(entry["places"]) < 4:
            entry["places"].append(f"app.js:{line}")
    # The dashboard's own Dutch page copy: English-only page text with its Dutch.
    # Its first block and the later `Object.assign(dutchUiCopy, {...})` additions.
    blocks = re.findall(r"const dutchUiCopy = \{(.*?)\n\};", text, re.S)
    blocks += re.findall(r"Object\.assign\(dutchUiCopy, \{(.*?)\n\}\);", text, re.S)
    for block in blocks:
        for pair in re.finditer(rf'({JS_STRING})\s*:\s*({JS_STRING})', block, re.S):
            english, dutch = js_literal(pair.group(1)), js_literal(pair.group(2))
            messages.setdefault(english, {"key": english, "nl": dutch, "places": ["app.js:dutchUiCopy"]})
    # The static page: visible text and placeholder/title/aria-label in index.html.
    page = (ROOT / "apps" / "timetrials-desktop" / "dashboard" / "index.html").read_text(encoding="utf-8")
    page = re.sub(r"<(script|style)\b.*?</\1>", "", page, flags=re.S)
    found = [html.unescape(value).strip() for value in re.findall(r">([^<>]+)<", page)]
    found += [html.unescape(value).strip() for value in
              re.findall(r'\b(?:placeholder|title|aria-label)="([^"]+)"', page)]
    for value in found:
        value = re.sub(r"\s+", " ", value)
        if re.search(r"[A-Za-z]{2,}", value) and not re.fullmatch(r"[a-z0-9_.:/#?=&-]+", value):
            messages.setdefault(value, {"key": value, "places": ["index.html"]})
    # The console app's English -> Dutch tables (livetrial_app.py: `exact` in _localized and the menu pairs).
    console = ROOT / "apps" / "timetrials-desktop" / "livetrial_app.py"
    for node in ast.walk(ast.parse(console.read_text(encoding="utf-8"))):
        pairs: list[tuple[ast.expr, ast.expr]] = []
        if isinstance(node, ast.Dict):
            pairs = [(key, value) for key, value in zip(node.keys, node.values) if key is not None]
        elif isinstance(node, ast.Tuple) and len(node.elts) == 2:
            pairs = [(node.elts[0], node.elts[1])]
        for key, value in pairs:
            if isinstance(key, ast.Constant) and isinstance(value, ast.Constant) \
                    and isinstance(key.value, str) and isinstance(value.value, str) \
                    and re.search(r"[A-Za-z]{3,}\s", key.value) and key.value != value.value:
                messages.setdefault(key.value, {"key": key.value, "nl": value.value,
                                                "places": [f"livetrial_app.py:{key.lineno}"]})
    return write(ROOT / "apps" / "timetrials-desktop" / "i18n" / "messages.source.json",
                 "mk8dx.livetrial-dashboard-message-source.v1", messages)


def tournament_live() -> int:
    path = ROOT / "apps" / "tournament-live" / "src" / "live_processor" / "qt_app.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    messages: dict[str, dict] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "_DUTCH_UI" for t in node.targets):
            for key, value in zip(node.value.keys, node.value.values):
                english, dutch = ast.literal_eval(key), ast.literal_eval(value)
                messages[english] = {"key": english, "nl": dutch, "places": [f"qt_app.py:{key.lineno}"]}
        # The status lines `_tr` formats itself (`dynamic_patterns`): each regex becomes a message template, its
        # capture groups {0}, {1}, ... in order, so the catalog languages translate them like any other template.
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "dynamic_patterns" for t in node.targets):
            for entry in node.value.elts:
                pattern = ast.literal_eval(entry.elts[0]).removeprefix("^").removesuffix("$")
                counter = iter(range(100))
                template = re.sub(r"\((?!\?)(?:[^()\\]|\\.)*\)", lambda _: "{%d}" % next(counter), pattern)
                template = re.sub(r"\\(.)", lambda m: "\n" if m.group(1) == "n" else m.group(1), template)
                messages.setdefault(template, {"key": template, "places": [f"qt_app.py:{entry.lineno}"]})
    return write(ROOT / "apps" / "tournament-live" / "i18n" / "messages.source.json",
                 "mk8dx.tournament-live-message-source.v1", messages)


if __name__ == "__main__":
    print(json.dumps({"livetrialDashboard": dashboard(), "tournamentLive": tournament_live()}))
