"""Align the 15 READMEs: the language switcher (line 5) and own-language guide links in Get started.

README.md stays at the repository root; the 14 translations live in docs/readme/. Every link is written
relative to the README's own folder.

  python tooling/build_readme_links.py          # rewrite the READMEs
  python tooling/build_readme_links.py --check  # fail when a README is out of date

The Get started table's A2 row lists the reader's own A2 guide first (where a translation exists), then English
and Dutch, then the reading guide (DOCX + TXT, named after the TXT's first line), then the illustrated guide of
the reader's language as PDF and single-file HTML from the latest release (tooling/build_guide_bundle.mjs,
named after the <title> of docs/install/guide/<lang>.html). The rows after it link the
Players, LiveTrial and Tournament Directors guides in the reader's language when
docs/guides/translations/<locale>/<FILE>.md exists, otherwise the English guide.
"""
from __future__ import annotations

import argparse
import html
import posixpath
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
README = (("en", "English", "README.md"), ("en-US", "English (US)", "docs/readme/README_EN_US.md"),
          ("nl", "Nederlands", "docs/readme/README_NL.md"), ("de", "Deutsch", "docs/readme/README_DE.md"),
          ("es", "Español", "docs/readme/README_ES.md"),
          ("es-419", "Español (Latinoamérica)", "docs/readme/README_ES_419.md"),
          ("fr", "Français", "docs/readme/README_FR.md"), ("fr-CA", "Français (Canada)", "docs/readme/README_FR_CA.md"),
          ("it", "Italiano", "docs/readme/README_IT.md"), ("pt", "Português", "docs/readme/README_PT.md"),
          ("ru", "Русский", "docs/readme/README_RU.md"), ("ja", "日本語", "docs/readme/README_JA.md"),
          ("ko", "한국어", "docs/readme/README_KO.md"), ("zh-CN", "简体中文", "docs/readme/README_ZH_CN.md"),
          ("zh-TW", "繁體中文", "docs/readme/README_ZH_TW.md"))
EN_A2 = "docs/install/A2_HOME_GUIDE_EN.md"
NL_A2 = "docs/install/A2_THUIS_HANDLEIDING_NL.md"
CLUB_GUIDES = ("PLAYERS.md", "LIVETRIAL.md", "TOURNAMENT_DIRECTORS.md")
RELEASE = "https://github.com/fromthelake/MK8DX-Ecosystem/releases/latest/download"


def rel(target: str, base: str) -> str:
    """A repository path as a link from the folder `base` ("" for the root)."""
    return posixpath.relpath(target, base or ".")


def title(path: Path) -> str:
    return path.read_text(encoding="utf-8").splitlines()[0].strip()


def guide_tail(lang: str, label: str, base: str = "") -> str:
    install = ROOT / "docs/install"
    en_a2, nl_a2 = f"[English]({rel(EN_A2, base)})", f"[Nederlands]({rel(NL_A2, base)})"
    if lang == "en":
        parts = [en_a2, nl_a2]
        txt, docx = "docs/install/MK8DX_User_Guide_EN.txt", "docs/install/MK8DX_User_Guide_EN.docx"
    elif lang == "nl":
        parts = [nl_a2, en_a2]
        txt, docx = "docs/install/MK8DX_Handleiding_NL.txt", "docs/install/MK8DX_Handleiding_NL.docx"
    else:
        parts = []
        if (install / "translations" / lang / "A2_HOME_GUIDE.md").is_file():
            parts.append(f"[{label}]({rel(f'docs/install/translations/{lang}/A2_HOME_GUIDE.md', base)})")
        parts += [en_a2, nl_a2]
        txt = f"docs/install/translations/{lang}/MK8DX_User_Guide.txt"
        docx = f"docs/install/translations/{lang}/MK8DX_User_Guide_{lang}.docx"
    if (ROOT / txt).is_file() and (ROOT / docx).is_file():
        parts.append(f"[{title(ROOT / txt)}]({rel(docx, base)}) ([TXT]({rel(txt, base)}))")
    page = install / "guide" / f"{lang}.html"
    if page.is_file():
        name = html.unescape(re.search(r"<title>(.*?)</title>", page.read_text(encoding="utf-8")).group(1))
        parts.append(f"[{name} (PDF)]({RELEASE}/MK8DX_Guide_{lang}.pdf) ([HTML]({RELEASE}/MK8DX_Guide_{lang}.html))")
    return " · ".join(parts)


def tail_start(row: str, base: str = "") -> int:
    starts = [row.find(f"]({rel(EN_A2, base)})"), row.find(f"]({rel(NL_A2, base)})")]
    marker = row.find(f"]({rel('docs/install/translations', base)}/")
    if marker >= 0:
        starts.append(marker)
    return min(row.rfind("[", 0, s) for s in starts if s >= 0)


def club_links(lang: str, row: str, base: str = "") -> str:
    guides = rel("docs/guides", base)
    for name in CLUB_GUIDES:
        target = f"docs/guides/translations/{lang}/{name}"
        if lang != "en" and (ROOT / target).is_file():
            pattern = (r"\]\(" + re.escape(guides) + r"/(?:translations/[A-Za-z0-9-]+/)?" + re.escape(name) +
                       r"\)( \(Engels\))?")
            row = re.sub(pattern, f"]({rel(target, base)})", row)
    return row


def render(lang: str, label: str, text: str, switch: str, base: str = "") -> str:
    lines = text.split("\n")
    prefix = re.match(r"^(.*?[:：] ?)", lines[4]).group(1)
    lines[4] = prefix + switch
    en_a2, translated = f"]({rel(EN_A2, base)})", f"]({rel('docs/install/translations', base)}/"
    a2 = next(i for i, line in enumerate(lines) if line.startswith("| ") and
              (en_a2 in line or translated in line and "A2_HOME_GUIDE.md" in line))
    row = lines[a2]
    end = row.rstrip().rfind(" |")
    lines[a2] = row[:tail_start(row, base)] + guide_tail(lang, label, base) + row[end:]
    i = a2 + 1
    while i < len(lines) and lines[i].startswith("| "):
        lines[i] = club_links(lang, lines[i], base)
        i += 1
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="only report READMEs that are out of date")
    args = parser.parse_args(argv)
    stale = []
    for lang, label, name in README:
        base = posixpath.dirname(name)
        switch = " · ".join(label if code == lang else f"[{text}]({rel(file, base)})" for code, text, file in README)
        path = ROOT / name
        if not path.is_file():
            print("missing", name)
            stale.append(name)
            continue
        text = path.read_bytes().decode("utf-8")
        if "\r" in text:
            raise SystemExit(f"{name} must use LF line endings")
        new = render(lang, label, text, switch, base)
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
