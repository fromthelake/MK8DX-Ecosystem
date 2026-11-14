"""Align the 15 READMEs: the language switcher (line 5) and own-language guide links in Get started.

  python tooling/build_readme_links.py          # rewrite the READMEs
  python tooling/build_readme_links.py --check  # fail when a README is out of date

The Get started table's A2 row lists the reader's own A2 guide first (where a translation exists), then English
and Dutch, then the reading guide (DOCX + TXT, named after the TXT's first line). The rows after it link the
Players, LiveTrial and Tournament Directors guides in the reader's language when
docs/guides/translations/<locale>/<FILE>.md exists, otherwise the English guide.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
README = (("en", "English", "README.md"), ("en-US", "English (US)", "README_EN_US.md"),
          ("nl", "Nederlands", "README_NL.md"), ("de", "Deutsch", "README_DE.md"),
          ("es", "Español", "README_ES.md"), ("es-419", "Español (Latinoamérica)", "README_ES_419.md"),
          ("fr", "Français", "README_FR.md"), ("fr-CA", "Français (Canada)", "README_FR_CA.md"),
          ("it", "Italiano", "README_IT.md"), ("pt", "Português", "README_PT.md"), ("ru", "Русский", "README_RU.md"),
          ("ja", "日本語", "README_JA.md"), ("ko", "한국어", "README_KO.md"), ("zh-CN", "简体中文", "README_ZH_CN.md"),
          ("zh-TW", "繁體中文", "README_ZH_TW.md"))
EN_A2 = "[English](docs/install/A2_HOME_GUIDE_EN.md)"
NL_A2 = "[Nederlands](docs/install/A2_THUIS_HANDLEIDING_NL.md)"
CLUB_GUIDES = ("PLAYERS.md", "LIVETRIAL.md", "TOURNAMENT_DIRECTORS.md")


def title(path: Path) -> str:
    return path.read_text(encoding="utf-8").splitlines()[0].strip()


def guide_tail(lang: str, label: str) -> str:
    install = ROOT / "docs/install"
    if lang == "en":
        parts = [EN_A2, NL_A2]
        txt, docx = "docs/install/MK8DX_User_Guide_EN.txt", "docs/install/MK8DX_User_Guide_EN.docx"
    elif lang == "nl":
        parts = [NL_A2, EN_A2]
        txt, docx = "docs/install/MK8DX_Handleiding_NL.txt", "docs/install/MK8DX_Handleiding_NL.docx"
    else:
        parts = []
        if (install / "translations" / lang / "A2_HOME_GUIDE.md").is_file():
            parts.append(f"[{label}](docs/install/translations/{lang}/A2_HOME_GUIDE.md)")
        parts += [EN_A2, NL_A2]
        txt = f"docs/install/translations/{lang}/MK8DX_User_Guide.txt"
        docx = f"docs/install/translations/{lang}/MK8DX_User_Guide_{lang}.docx"
    if (ROOT / txt).is_file() and (ROOT / docx).is_file():
        parts.append(f"[{title(ROOT / txt)}]({docx}) ([TXT]({txt}))")
    return " · ".join(parts)


def tail_start(row: str) -> int:
    starts = [row.find(EN_A2), row.find(NL_A2)]
    marker = row.find("](docs/install/translations/")
    if marker >= 0:
        starts.append(row.rfind("[", 0, marker))
    return min(s for s in starts if s >= 0)


def club_links(lang: str, row: str) -> str:
    for name in CLUB_GUIDES:
        target = f"docs/guides/translations/{lang}/{name}"
        if lang != "en" and (ROOT / target).is_file():
            pattern = r"\]\(docs/guides/(?:translations/[A-Za-z0-9-]+/)?" + re.escape(name) + r"\)( \(Engels\))?"
            row = re.sub(pattern, f"]({target})", row)
    return row


def render(lang: str, label: str, text: str, switch: str) -> str:
    lines = text.split("\n")
    prefix = re.match(r"^(.*?[:：] ?)", lines[4]).group(1)
    lines[4] = prefix + switch
    a2 = next(i for i, line in enumerate(lines) if line.startswith("| ") and
              (EN_A2 in line or "](docs/install/translations/" in line and "A2_HOME_GUIDE.md" in line))
    row = lines[a2]
    end = row.rstrip().rfind(" |")
    lines[a2] = row[:tail_start(row)] + guide_tail(lang, label) + row[end:]
    i = a2 + 1
    while i < len(lines) and lines[i].startswith("| "):
        lines[i] = club_links(lang, lines[i])
        i += 1
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="only report READMEs that are out of date")
    args = parser.parse_args(argv)
    stale = []
    for lang, label, name in README:
        switch = " · ".join(label if code == lang else f"[{text}]({file})" for code, text, file in README)
        path = ROOT / name
        if not path.is_file():
            print("missing", name)
            stale.append(name)
            continue
        text = path.read_bytes().decode("utf-8")
        if "\r" in text:
            raise SystemExit(f"{name} must use LF line endings")
        new = render(lang, label, text, switch)
        if new != text:
            stale.append(name)
            if not args.check:
                path.write_bytes(new.encode("utf-8"))
                print(name, "updated")
    if args.check and stale:
        print("Out of date:", ", ".join(stale), "- run python tooling/build_readme_links.py")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
