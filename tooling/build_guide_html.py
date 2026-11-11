"""Build the offline HTML version of the A2 home/club guides from their Markdown source.

  python tooling/build_guide_html.py          # writes docs/install/guide/
  python tooling/build_guide_html.py --check  # fails when the committed HTML is out of date

The Markdown (docs/install/A2_THUIS_HANDLEIDING_NL.md, A2_HOME_GUIDE_EN.md) stays the single source;
this page adds what a beginner needs: a filter for their computer (Windows/Linux/macOS) and for the
device they prepare (Android, iPhone, ...), a table of contents, chapters that open and close, a
search box, step cards (Do / You see / See something else?) and screenshots. It works offline and
under the setup wizard's strict CSP: no inline script or style, only guide.js and guide.css.

Markdown it understands: "# " and "## " headings, a line that is only **bold** (a sub-heading),
"1. " and "- " list items, paragraphs, **bold**, *italic*, `code`, "(Afbeelding: name)" /
"(Image: name)" screenshot lines (img/<name>-<lang>.png, skipped while the file is missing), and
two HTML comments that GitHub hides: "<!-- os: windows -->" … "<!-- /os -->" around a block for one
or more computers, and "<!-- filter: device -->" … "<!-- /filter -->" around a block whose list
items are filtered by device instead of by computer. A list item that starts with **Windows**,
**Linux**, **macOS**/**Mac**, **Android** or **iPhone** is filtered automatically.
"""
from __future__ import annotations

import argparse
import html
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {"nl": ROOT / "docs" / "install" / "A2_THUIS_HANDLEIDING_NL.md",
           "en": ROOT / "docs" / "install" / "A2_HOME_GUIDE_EN.md"}
OUT = ROOT / "docs" / "install" / "guide"
STEP_WORDS = {"nl": ("Doe:", "Je ziet:", "Zie je iets anders?"),
              "en": ("Do:", "You see:", "See something else?")}
TEXT = {
    "nl": {"title": "MK8DX thuis of op de club — handleiding", "computer": "Mijn computer", "device": "Mijn apparaat",
           "all": "Alles", "search": "Zoeken in de handleiding", "contents": "Inhoud", "print": "Afdrukken",
           "open": "Alles openklappen", "close": "Alles dichtklappen", "none": "Niets gevonden.",
           "other": "English", "other_href": "en.html", "do": "Doe", "see": "Je ziet", "else": "Zie je iets anders?",
           "filtered": "Alleen de stappen voor jouw keuze worden getoond."},
    "en": {"title": "MK8DX at home or at your club — guide", "computer": "My computer", "device": "My device",
           "all": "All", "search": "Search the guide", "contents": "Contents", "print": "Print",
           "open": "Open all", "close": "Close all", "none": "Nothing found.",
           "other": "Nederlands", "other_href": "nl.html", "do": "Do", "see": "You see", "else": "See something else?",
           "filtered": "Only the steps for your choice are shown."},
}
COMPUTERS = (("windows", "Windows"), ("linux", "Linux"), ("macos", "macOS"))
DEVICES = (("android", "Android"), ("iphone", "iPhone / iPad"), ("windows", "Windows"), ("mac", "Mac"), ("linux", "Linux"))


def _inline(text: str) -> str:
    text = html.escape(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", text)
    return re.sub(r"`(.+?)`", r"<code>\1</code>", text)


def _anchor(text: str) -> str:
    return "h-" + re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:48]


def _item_filter(raw: str, device_block: bool) -> str | None:
    """A list item that starts with a system name belongs to that system only."""
    names = r"(?:Windows|Linux|macOS|Mac|Android|iPhone)"
    match = re.match(rf"\*\*(?:Alleen )?({names}(?: (?:en|and) {names})?)(?: only)?\b", raw)
    if not match:
        return None
    found = re.findall(names, match.group(1))
    if device_block:
        table = {"Windows": "windows", "Linux": "linux", "macOS": "mac", "Mac": "mac", "Android": "android", "iPhone": "iphone"}
        return " ".join("device-" + table[name] for name in found)
    table = {"Windows": "windows", "Linux": "linux", "macOS": "macos", "Mac": "macos"}
    classes = [f"os-{table[name]}" for name in found if name in table]
    return " ".join(classes) or None


def _step(raw: str, lang: str) -> str | None:
    """'**Doe:** … → **Je ziet:** … → **Zie je iets anders?** …' as a three-part card."""
    words = STEP_WORDS[lang]
    start = raw.find(f"**{words[0]}**")
    if start < 0 or start > 160:
        return None
    # A step may open with its own short title, e.g. "**Welkom bij MK8DX.** **Doe:** …".
    title = raw[:start].strip()
    # Split only where the next part starts (a label, or a bold note such as "→ **Op Linux en macOS**"
    # that closes the step); arrows inside menu paths ("Instellingen → Apps") stay in the text.
    labels_pattern = "|".join(re.escape(word) for word in words[1:])
    parts = [part.strip() for part in re.split(rf"\s→\s(?=\*\*(?:{labels_pattern}))", raw[start:])]
    labels = {f"**{words[0]}**": ("do", TEXT[lang]["do"]), f"**{words[1]}**": ("see", TEXT[lang]["see"]),
              f"**{words[2]}**": ("else", TEXT[lang]["else"])}
    cells = []
    for part in parts:
        for prefix, (kind, label) in labels.items():
            if part.startswith(prefix):
                cells.append(f'<div class="step-{kind}"><span class="step-label">{html.escape(label)}</span> '
                             f'{_inline(part[len(prefix):].strip())}</div>')
                break
        else:
            if cells:  # a plain continuation such as "→ **Op Linux en macOS** …"
                cells.append(f'<div class="step-note">{_inline(part)}</div>')
    if not cells:
        return None
    heading = f'<div class="step-title">{_inline(title)}</div>' if title else ""
    return heading + "".join(cells)


def render(lang: str, images: set[str] | None = None) -> str:
    source = SOURCES[lang].read_text(encoding="utf-8")
    images = images if images is not None else {p.name for p in (OUT / "img").glob("*.png")} if (OUT / "img").is_dir() else set()
    text = TEXT[lang]
    body: list[str] = []
    toc: list[tuple[str, str]] = []
    in_list: str | None = None
    in_chapter = False
    block_os: list[str] = []
    device_block = False

    def close_list():
        nonlocal in_list
        if in_list:
            body.append(f"</{in_list}>")
            in_list = None

    for line in source.splitlines():
        os_open = re.fullmatch(r"<!-- os: ([a-z ,]+) -->", line.strip())
        if os_open:
            close_list()
            block_os = [name.strip() for name in re.split(r"[ ,]+", os_open.group(1)) if name.strip()]
            body.append('<div class="filtered ' + " ".join(f"os-{name}" for name in block_os) + '">')
            continue
        if line.strip() == "<!-- /os -->":
            close_list()
            body.append("</div>")
            block_os = []
            continue
        if line.strip() == "<!-- filter: device -->":
            close_list()
            device_block = True
            continue
        if line.strip() == "<!-- /filter -->":
            close_list()
            device_block = False
            continue
        picture = re.fullmatch(r"\((?:Afbeelding|Image): ([a-z0-9-]+)\)", line.strip())
        if picture:
            close_list()
            name = f"{picture.group(1)}-{lang}.png"
            if name in images:
                body.append(f'<figure><img src="img/{name}" alt="{html.escape(picture.group(1))}" loading="lazy"></figure>')
            continue
        kind = "ol" if re.match(r"\d+\. ", line) else "ul" if line.startswith("- ") else None
        if in_list and kind != in_list:
            close_list()
        if kind:
            if not in_list:
                body.append(f'<{kind} class="steps">' if kind == "ol" else "<ul>")
                in_list = kind
            raw = re.sub(r"^(\d+\. |- )", "", line)
            card = _step(raw, lang)
            target = _item_filter(raw, device_block)
            classes = (["step"] if card else []) + (["filtered", target] if target else [])
            attribute = f' class="{" ".join(classes)}"' if classes else ""
            body.append(f"<li{attribute}>{card or _inline(raw)}</li>")
            continue
        if line.startswith("## "):
            if in_chapter:
                body.append("</div></details>")
            title = line[3:].strip()
            anchor = _anchor(title)
            toc.append((anchor, title))
            chapter_os = re.match(r"\d+[A-Z]\. .*\b(Windows|Linux|macOS)\b", title)
            classes = "chapter"
            if chapter_os:
                classes += " filtered os-" + chapter_os.group(1).lower()
            body.append(f'<details class="{classes}" id="{anchor}" open><summary><h2>{_inline(title)}</h2></summary>'
                        '<div class="chapter-body">')
            in_chapter = True
        elif line.startswith("# "):
            body.append(f"<h1>{_inline(line[2:].strip())}</h1>")
        elif re.fullmatch(r"\*\*[^*]+\*\*", line.strip()):
            body.append(f"<h3>{_inline(line.strip()[2:-2])}</h3>")
        elif line.strip() and line.strip() != "---":
            body.append(f"<p>{_inline(line)}</p>")
    close_list()
    if in_chapter:
        body.append("</div></details>")
    computers = "".join(f'<button type="button" data-os="{key}">{label}</button>' for key, label in COMPUTERS)
    devices = "".join(f'<button type="button" data-device="{key}">{html.escape(label)}</button>' for key, label in DEVICES)
    contents = "".join(f'<li><a href="#{anchor}">{_inline(title)}</a></li>' for anchor, title in toc)
    return (
        '<!doctype html>\n<html lang="' + lang + '"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>{html.escape(text['title'])}</title>"
        '<link rel="icon" href="img/mk8dx-icon.png">'
        '<link rel="stylesheet" href="guide.css"><script src="guide.js" defer></script></head>'
        '<body class="os-all device-all"><header class="bar">'
        '<a class="brand" href="#guide"><img src="img/mk8dx-icon.png" alt="" width="40" height="40">'
        '<span class="brand-word">MK8DX</span></a>'
        f'<div class="filters"><span class="filter-label">{text["computer"]}</span>'
        f'<div class="choice" role="group" aria-label="{text["computer"]}">{computers}'
        f'<button type="button" data-os="all">{text["all"]}</button></div>'
        f'<span class="filter-label">{text["device"]}</span>'
        f'<div class="choice" role="group" aria-label="{text["device"]}">{devices}'
        f'<button type="button" data-device="all">{text["all"]}</button></div></div>'
        f'<div class="tools"><input type="search" id="search" placeholder="{text["search"]}" aria-label="{text["search"]}">'
        f'<button type="button" id="open-all">{text["open"]}</button><button type="button" id="close-all">{text["close"]}</button>'
        f'<button type="button" id="print">{text["print"]}</button>'
        f'<a class="lang" href="{text["other_href"]}">{text["other"]}</a></div></header>'
        f'<div class="layout"><nav class="toc"><details id="toc" open><summary>{text["contents"]}</summary>'
        f'<ol>{contents}</ol></details></nav>'
        f'<main id="guide"><p class="hint">{text["filtered"]}</p>{"".join(body)}'
        f'<p id="nothing" class="hint" hidden>{text["none"]}</p></main></div></body></html>\n')


def build(check: bool = False) -> int:
    expected = {f"{lang}.html": render(lang) for lang in SOURCES}
    stale = [name for name, content in expected.items()
             if not (OUT / name).is_file() or (OUT / name).read_text(encoding="utf-8") != content]
    if check:
        if stale:
            print("Out of date: " + ", ".join(f"docs/install/guide/{name}" for name in stale) +
                  " (run python tooling/build_guide_html.py)")
            return 1
        print("guide HTML up to date")
        return 0
    OUT.mkdir(parents=True, exist_ok=True)
    for name, content in expected.items():
        (OUT / name).write_bytes(content.encode("utf-8"))
    print("wrote " + ", ".join(f"docs/install/guide/{name}" for name in expected))
    return 0


def review_images() -> int:
    """Record the screenshots a person has just looked at (no names, no real addresses, no codes)."""
    import hashlib
    files = {}
    for path in sorted((OUT / "img").glob("*.png")):
        content = path.read_bytes()
        files[path.relative_to(ROOT).as_posix()] = {"sizeBytes": len(content),
                                                    "sha256": hashlib.sha256(content).hexdigest()}
    manifest = {"schemaVersion": "mk8dx.guide-images-reviewed.v1",
                "note": "Each screenshot was looked at before it was listed: example data only.", "files": files}
    (OUT / "images-reviewed-v1.json").write_bytes((json.dumps(manifest, indent=2) + "\n").encode("utf-8"))
    print(f"recorded {len(files)} reviewed guide images")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--review-images", action="store_true",
                        help="after looking at every screenshot, record their exact bytes for the privacy scan")
    args = parser.parse_args(argv)
    if args.review_images:
        return review_images()
    return build(args.check)


if __name__ == "__main__":
    raise SystemExit(main())
