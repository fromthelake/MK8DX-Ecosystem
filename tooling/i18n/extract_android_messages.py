"""Extract the Android app's translatable English texts into apps/timetrials-android/i18n/messages.source.json.

  python tooling/i18n/extract_android_messages.py

Collects every `androidText(..., "<English>", "<Dutch>")` call whose English and Dutch arguments are string
literals (optionally joined with `+`), the code's own language branches (`if (dutch) "<Dutch>" else "<English>"`),
the Dutch copy dictionary's English (AndroidDutchUiCopy, `"<English>" to "<Dutch>"`) and literal English passed to
`Text(...)` or a design-system `Mk8dx...(...)` component — the text ProductText/LocalizedText translate at render.
Kotlin string templates (`$name`, `${expression}`) become placeholders
`{0}`, `{1}`, ... in reading order — the same key form as the web extraction, so both products share one
translation pipeline and the runtime matches the evaluated English against the template.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "apps" / "timetrials-android" / "app" / "src" / "main" / "java"
OUTPUT = ROOT / "apps" / "timetrials-android" / "i18n" / "messages.source.json"

STRING = r'"(?:[^"\\$]|\\.|\$(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|[A-Za-z_][A-Za-z0-9_.]*))*"'
JOINED = rf'{STRING}(?:\s*\+\s*{STRING})*'
# androidText and the local (english, dutch) helpers: Mk8dxAppearanceSection's t(), the activity headings.
CALL = re.compile(rf'\b(?:androidText|t|ActivitySectionHeading)\(\s*(?:[A-Za-z_][A-Za-z0-9_.]*\s*,\s*)?({JOINED})\s*,\s*({JOINED})\s*[,)]', re.S)
DUTCH_CONDITION = r'(?:dutch|isDutch|nl|language\s*==\s*AndroidProductLanguage\.DUTCH|language\.code\s*==\s*"nl")'
BRANCH = re.compile(rf'if\s*\(\s*{DUTCH_CONDITION}\s*\)\s*\{{?\s*({JOINED})\s*\}}?\s*else\s*\{{?\s*({JOINED})', re.S)
COPY_PAIR = re.compile(rf'({STRING})\s+to\s+({STRING})')
RENDERED = re.compile(rf'\b(?:Text|Mk8dx[A-Za-z]+)\(\s*(?:(?:text|label|title|meta)\s*=\s*)?({JOINED})\s*[,)]', re.S)
DUTCH_WORDS = {
    "de", "het", "een", "van", "naar", "niet", "voor", "deze", "stap", "wordt", "worden", "geen", "kies", "toernooi",
    "deelnemers", "opslaan", "terug", "groepen", "uitslag", "uitslagen", "spelers", "wachten", "klaar", "je", "nog",
    "ook", "zijn", "op", "met", "bij", "als", "verder", "knop", "eerst", "nieuwe", "bewaren", "uit", "aantal",
    "annuleren", "inactief", "nieuw", "heeft", "lege", "plek", "plaatsen", "aanwezig", "afwezig", "toevoegen",
    "verwijderen", "koppeling", "wissen", "markeer", "eigenaren", "indeling", "plaatsing", "beschikbaar",
    "toernooibord", "bijv", "gem", "spreiding", "afstaan", "wissel", "kolommen", "ja", "groep", "deelnemer",
}
TEMPLATE = re.compile(r'\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|\$[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*')


def literal_text(joined: str) -> str:
    """The joined Kotlin literals as one string, templates as numbered placeholders."""
    parts = re.findall(STRING, joined, re.S)
    text = "".join(part[1:-1] for part in parts)
    counter = iter(range(1000))
    text = TEMPLATE.sub(lambda _: "{%d}" % next(counter), text)
    text = re.sub(r"\\u([0-9a-fA-F]{4})", lambda match: chr(int(match.group(1), 16)), text)
    return (text.replace('\\"', '"').replace("\\n", "\n").replace("\\t", "\t")
            .replace("\\$", "$").replace("\\\\", "\\"))


def main() -> int:
    messages: dict[str, dict] = {}
    for path in sorted(SOURCE.rglob("*.kt")):
        text = path.read_text(encoding="utf-8")
        found = [(m, literal_text(m.group(1)), literal_text(m.group(2))) for m in CALL.finditer(text)]
        found += [(m, literal_text(m.group(2)), literal_text(m.group(1))) for m in BRANCH.finditer(text)]
        if path.name == "AndroidDutchUiCopy.kt":
            found += [(m, literal_text(m.group(1)), literal_text(m.group(2))) for m in COPY_PAIR.finditer(text)]
        found += [(m, literal_text(m.group(1)), None) for m in RENDERED.finditer(text)]
        for match, english, dutch in found:
            plain = re.sub(r"\{\d+\}", " ", english)
            if not re.search(r"[A-Za-z]{2,}", plain):
                continue
            # A bare lower-case word without a Dutch counterpart is an identifier, not text.
            if dutch is None and re.fullmatch(r"[a-z0-9_.:/#?=&-]+", plain.strip()):
                continue
            # Some screens are Dutch-only (the Director's tournament steps): their literals are not English.
            if dutch is None and DUTCH_WORDS.intersection(re.findall(r"[a-zë]+", plain.lower())):
                continue
            line = text.count("\n", 0, match.start()) + 1
            entry = messages.setdefault(english, {"key": english, "places": []})
            if dutch is not None and "nl" not in entry:
                entry["nl"] = dutch
            if len(entry["places"]) < 4:
                entry["places"].append(f"{path.name}:{line}")
    entries = [messages[key] for key in sorted(messages)]
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({
        "schemaVersion": "mk8dx.android-message-source.v1",
        "generatedBy": "tooling/i18n/extract_android_messages.py",
        "messages": entries,
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    calls = sum(1 for path in SOURCE.rglob("*.kt") for _ in re.finditer(r"androidText\(", path.read_text(encoding="utf-8")))
    print(json.dumps({"messages": len(entries), "androidTextCalls": calls,
                      "templates": sum(1 for e in entries if re.search(r"\{\d+\}", e["key"]))}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
