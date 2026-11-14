"""Build the offline HTML version of the A2 home/club guides from their Markdown source.

  python tooling/build_guide_html.py          # writes docs/install/guide/
  python tooling/build_guide_html.py --check  # fails when the committed HTML is out of date

The Markdown stays the single source: docs/install/A2_HOME_GUIDE_EN.md (English, authoritative),
docs/install/A2_THUIS_HANDLEIDING_NL.md (Nederlands) and every translation folder
docs/install/translations/<locale>/ that holds A2_HOME_GUIDE.md and guide-words.json (step labels and
page texts of that language). Each becomes docs/install/guide/<locale>.html (en.html, nl.html, de.html,
es-419.html, zh-CN.html, ...); a new locale folder is picked up without a code change.

The page adds what a beginner needs: a filter for their computer (Windows/Linux/macOS) and for the
device they prepare (Android, iPhone, ...), a table of contents, chapters that open and close, a
search box, step cards (Do / You see / See something else?), screenshots and a language switcher
with all 15 languages of the game (a language without its own page opens the closest one). It works
offline and under the setup wizard's strict CSP: no inline script or style, only guide.js and guide.css.

Markdown it understands: "# " and "## " headings, a line that is only **bold** (a sub-heading),
"1. " and "- " list items, paragraphs, **bold**, *italic*, `code`, screenshot lines, and
two HTML comments that GitHub hides: "<!-- os: windows -->" … "<!-- /os -->" around a block for one
or more computers, and "<!-- filter: device -->" … "<!-- /filter -->" around a block whose list
items are filtered by device instead of by computer. A list item that starts with **Windows**,
**Linux**, **macOS**/**Mac**, **Android** or **iPhone** is filtered automatically.

A screenshot line is a real Markdown image, "![alt](guide/img/<name>-<lang>.png)", while that file
exists, and a slot that GitHub hides, "<!-- image: name -->" / "<!-- afbeelding: name -->", while it
does not. A translation reuses the English screenshot when it has none of its own, with the path
that resolves from its folder: "![alt](../../guide/img/<name>-en.png)". This tool keeps those lines
in step with docs/install/guide/img (a plain "(Image: name)" line is accepted and rewritten too), so
GitHub shows the screenshots and never a placeholder. It also points a translated players guide's
link to the English A2 guide at the same chapter of that locale's A2 guide. --check fails while a
Markdown guide's screenshot lines, such a link or the HTML are out of date.
"""
from __future__ import annotations

import argparse
import html
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / "docs" / "install"
TRANSLATIONS = INSTALL / "translations"
PLAYER_TRANSLATIONS = ROOT / "docs" / "guides" / "translations"
OUT = INSTALL / "guide"
# The 15 languages of the game, in the order of the language switcher, with their own names.
LANGUAGES = (("en", "English"), ("en-US", "English (US)"), ("nl", "Nederlands"), ("de", "Deutsch"),
             ("es", "Español (España)"), ("es-419", "Español (Latinoamérica)"), ("fr", "Français (France)"),
             ("fr-CA", "Français (Canada)"), ("it", "Italiano"), ("ja", "日本語"), ("ko", "한국어"),
             ("pt", "Português"), ("ru", "Русский"), ("zh-CN", "简体中文"), ("zh-TW", "繁體中文"))
STEP_WORDS = {"nl": ("Doe:", "Je ziet:", "Zie je iets anders?"),
              "en": ("Do:", "You see:", "See something else?")}
TEXT = {
    "nl": {"title": "MK8DX thuis of op de club — handleiding", "computer": "Mijn computer", "device": "Mijn apparaat",
           "all": "Alles", "search": "Zoeken in de handleiding", "contents": "Inhoud", "print": "Afdrukken",
           "open": "Alles openklappen", "close": "Alles dichtklappen", "none": "Niets gevonden.",
           "do": "Doe", "see": "Je ziet", "else": "Zie je iets anders?",
           "filtered": "Alleen de stappen voor jouw keuze worden getoond."},
    "en": {"title": "MK8DX at home or at your club — guide", "computer": "My computer", "device": "My device",
           "all": "All", "search": "Search the guide", "contents": "Contents", "print": "Print",
           "open": "Open all", "close": "Close all", "none": "Nothing found.",
           "do": "Do", "see": "You see", "else": "See something else?",
           "filtered": "Only the steps for your choice are shown."},
}
SOURCES = {"nl": INSTALL / "A2_THUIS_HANDLEIDING_NL.md", "en": INSTALL / "A2_HOME_GUIDE_EN.md"}
SLOT_WORD = {"nl": "afbeelding", "en": "image"}


def _discover() -> None:
    """Add every translation folder with an A2 guide and its guide-words.json."""
    for folder in sorted(TRANSLATIONS.iterdir()) if TRANSLATIONS.is_dir() else ():
        words_file, guide = folder / "guide-words.json", folder / "A2_HOME_GUIDE.md"
        if folder.name in SOURCES or not (words_file.is_file() and guide.is_file()):
            continue
        words = json.loads(words_file.read_text(encoding="utf-8"))
        SOURCES[folder.name] = guide
        steps = words["steps"]
        STEP_WORDS[folder.name] = (steps["do"], steps["see"], steps["else"])
        TEXT[folder.name] = {key: words["html"][key] for key in TEXT["en"]}
        SLOT_WORD[folder.name] = "image"  # HTML comments stay in English in a translation


_discover()
TRANSLATED = tuple(lang for lang in SOURCES if lang not in ("en", "nl"))
COMPUTERS = (("windows", "Windows"), ("linux", "Linux"), ("macos", "macOS"))
DEVICES = (("android", "Android"), ("iphone", "iPhone / iPad"), ("windows", "Windows"), ("mac", "Mac"), ("linux", "Linux"))
LOCALE_SUFFIX = r"[a-z]{2}(?:-[A-Z]{2}|-[0-9]{3})?"
PICTURE = re.compile(r"\((?:Afbeelding|Image): ([a-z0-9-]+)\)"
                     r"|<!-- (?:afbeelding|image): ([a-z0-9-]+) -->"
                     rf"|!\[([^\]]*)\]\((?:\.\./\.\./)?guide/img/([a-z0-9-]+)-{LOCALE_SUFFIX}\.png\)")


def _picture(line: str) -> str | None:
    """The screenshot name of a screenshot line (in any of its three forms), else None."""
    match = PICTURE.fullmatch(line.strip())
    return (match.group(1) or match.group(2) or match.group(4)) if match else None


def _alt(line: str, name: str) -> str:
    """The alt text of a screenshot line that is an image already (a translation keeps its own words)."""
    match = PICTURE.fullmatch(line.strip())
    return (match.group(3) if match and match.group(3) else None) or name.replace("-", " ")


def _images() -> set[str]:
    return {p.name for p in (OUT / "img").glob("*.png")} if (OUT / "img").is_dir() else set()


def _image_file(name: str, lang: str, images: set[str]) -> str | None:
    """The screenshot for this language; a translation falls back to the English one."""
    for candidate in (lang, "en") if lang in TRANSLATED else (lang,):
        if f"{name}-{candidate}.png" in images:
            return f"{name}-{candidate}.png"
    return None


def markdown(lang: str, images: set[str] | None = None) -> str:
    """The Markdown guide with every screenshot line in its current form: an image, or a hidden slot."""
    images = images if images is not None else _images()
    prefix = "../../guide/img/" if lang in TRANSLATED else "guide/img/"
    lines = []
    for line in SOURCES[lang].read_bytes().decode("utf-8").split("\n"):
        name = _picture(line)
        if name:
            ending = "\r" if line.endswith("\r") else ""
            file = _image_file(name, lang, images)
            if file:
                line = f"![{_alt(line, name)}]({prefix}{file}){ending}"
            else:
                line = f"<!-- {SLOT_WORD[lang]}: {name} -->{ending}"
        lines.append(line)
    return "\n".join(lines)


def github_slug(heading: str) -> str:
    """The anchor GitHub gives a Markdown heading (lower case, punctuation dropped, spaces to hyphens)."""
    text = re.sub(r"[*`]", "", heading.strip()).lower()
    return re.sub(r"[^\w\- ]", "", text).replace(" ", "-")


def _headings(path: Path) -> list[str]:
    return [line[3:].strip() for line in path.read_text(encoding="utf-8").splitlines() if line.startswith("## ")]


def players_guides() -> dict[Path, str]:
    """Each translated players guide with its links to the English A2 guide pointed at the same
    chapter of that locale's own A2 guide (where the chapter can be matched)."""
    english = _headings(SOURCES["en"])
    english_slugs = [github_slug(title) for title in english]
    result = {}
    for folder in sorted(PLAYER_TRANSLATIONS.iterdir()) if PLAYER_TRANSLATIONS.is_dir() else ():
        players = folder / "PLAYERS.md"
        lang = folder.name
        if not players.is_file() or lang not in SOURCES or lang == "en":
            continue
        local = _headings(SOURCES[lang])
        if len(local) != len(english):
            continue
        target = ("../../../install/A2_THUIS_HANDLEIDING_NL.md" if lang == "nl"
                  else f"../../../install/translations/{lang}/A2_HOME_GUIDE.md")

        def point(match: re.Match) -> str:
            anchor = match.group(1)
            if anchor not in english_slugs:
                return match.group(0)
            return f"({target}#{github_slug(local[english_slugs.index(anchor)])})"

        text = players.read_bytes().decode("utf-8")
        result[players] = re.sub(r"\(\.\./\.\./\.\./install/A2_HOME_GUIDE_EN\.md#([^)\s]+)\)", point, text)
    return result


def _link(match: re.Match) -> str:
    """A Markdown link: web addresses and the other guide pages stay links, other repository files plain text."""
    label, target = match.group(1), match.group(2)
    if target.startswith("https://"):
        return f'<a href="{target}">{label}</a>'
    page = re.search(r"(?:^|/)(?:A2_HOME_GUIDE_EN\.md|A2_THUIS_HANDLEIDING_NL\.md|translations/"
                     rf"({LOCALE_SUFFIX})/A2_HOME_GUIDE\.md)(?:#.*)?$", target)
    if page:
        lang = page.group(1) or ("nl" if "A2_THUIS" in target else "en")
        return f'<a href="{lang}.html">{label}</a>'
    return label


def _inline(text: str) -> str:
    text = html.escape(text)
    text = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", _link, text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", text)
    return re.sub(r"`(.+?)`", r"<code>\1</code>", text)


def _anchor(text: str, lang: str = "en") -> str:
    if lang in TRANSLATED:  # letters of every script, so a Japanese chapter still gets its own anchor
        return "h-" + re.sub(r"[\W_]+", "-", text.lower()).strip("-")[:48]
    return "h-" + re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:48]


def _item_filter(raw: str, device_block: bool, lang: str = "en") -> str | None:
    """A list item that starts with a system name belongs to that system only."""
    names = r"(?:Windows|Linux|macOS|Mac|Android|iPhone)"
    if lang in TRANSLATED:
        # A translation joins two systems with its own word ("und", "et", "と", "和", ...) and may put a
        # short word such as "Nur"/"Только" before the name or a particle right after it ("Linux만").
        pattern = rf"\*\*(?:\w{{1,8}} ){{0,2}}?({names}(?:\s?\w{{1,4}}\s{names})?)(?![A-Za-z])"
    else:
        pattern = rf"\*\*(?:Alleen )?({names}(?: (?:en|and) {names})?)(?: only)?\b"
    match = re.match(pattern, raw)
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
    # A translation's own short title before the first label is often longer than the Dutch or English one.
    if start < 0 or start > (400 if lang in TRANSLATED else 160):
        return None
    # A step may open with its own short title, e.g. "**Welkom bij MK8DX.** **Doe:** …".
    title = raw[:start].strip()
    # Split only where the next part starts (a label, or a bold note such as "→ **Op Linux en macOS**"
    # that closes the step); arrows inside menu paths ("Instellingen → Apps") stay in the text.
    labels_pattern = "|".join(re.escape(word) for word in words[1:])
    # Chinese and Japanese write "。→ **表示：**" without a space before the arrow.
    arrow = r"\s*→\s*" if lang in TRANSLATED else r"\s→\s"
    parts = [part.strip() for part in re.split(rf"{arrow}(?=\*\*(?:{labels_pattern}))", raw[start:])]
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


def page_for(locale: str) -> str:
    """The guide page a language opens: its own, else its base language's, else English."""
    for candidate in (locale, locale.split("-")[0]):
        if candidate in SOURCES:
            return candidate
    return "en"


def _languages(lang: str) -> str:
    """The language switcher: all 15 languages of the game, each by its own name."""
    names = dict(LANGUAGES)
    items = []
    for code, name in LANGUAGES:
        current = ' aria-current="page"' if code == lang else ""
        items.append(f'<li><a href="{page_for(code)}.html" hreflang="{code}" lang="{code}"{current}>'
                     f"{html.escape(name)}</a></li>")
    return (f'<details class="langs"><summary lang="{lang}">{html.escape(names.get(lang, lang))}</summary>'
            f'<ul>{"".join(items)}</ul></details>')


def render(lang: str, images: set[str] | None = None) -> str:
    source = SOURCES[lang].read_text(encoding="utf-8")
    images = images if images is not None else _images()
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
        picture = _picture(line)
        if picture:
            close_list()
            name = _image_file(picture, lang, images)
            if name:
                body.append(f'<figure><img src="img/{name}" alt="{html.escape(_alt(line, picture))}" loading="lazy"></figure>')
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
            target = _item_filter(raw, device_block, lang)
            classes = (["step"] if card else []) + (["filtered", target] if target else [])
            attribute = f' class="{" ".join(classes)}"' if classes else ""
            body.append(f"<li{attribute}>{card or _inline(raw)}</li>")
            continue
        if line.startswith("## "):
            if in_chapter:
                body.append("</div></details>")
            title = line[3:].strip()
            anchor = _anchor(title, lang)
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
    words = {key: html.escape(value, quote=True) for key, value in text.items()}
    return (
        '<!doctype html>\n<html lang="' + lang + '"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>{words['title']}</title>"
        '<link rel="icon" href="img/mk8dx-icon.png">'
        '<link rel="stylesheet" href="guide.css"><script src="guide.js" defer></script></head>'
        '<body class="os-all device-all"><header class="bar">'
        '<a class="brand" href="#guide"><img src="img/mk8dx-icon.png" alt="" width="40" height="40">'
        '<span class="brand-word">MK8DX</span></a>'
        f'<div class="filters"><span class="filter-label">{words["computer"]}</span>'
        f'<div class="choice" role="group" aria-label="{words["computer"]}">{computers}'
        f'<button type="button" data-os="all">{words["all"]}</button></div>'
        f'<span class="filter-label">{words["device"]}</span>'
        f'<div class="choice" role="group" aria-label="{words["device"]}">{devices}'
        f'<button type="button" data-device="all">{words["all"]}</button></div></div>'
        f'<div class="tools"><input type="search" id="search" placeholder="{words["search"]}" aria-label="{words["search"]}">'
        f'<button type="button" id="open-all">{words["open"]}</button><button type="button" id="close-all">{words["close"]}</button>'
        f'<button type="button" id="print">{words["print"]}</button>'
        f'{_languages(lang)}</div></header>'
        f'<div class="layout"><nav class="toc"><details id="toc" open><summary>{words["contents"]}</summary>'
        f'<ol>{contents}</ol></details></nav>'
        f'<main id="guide"><p class="hint">{words["filtered"]}</p>{"".join(body)}'
        f'<p id="nothing" class="hint" hidden>{words["none"]}</p></main></div></body></html>\n')


def build(check: bool = False) -> int:
    sources = {SOURCES[lang]: markdown(lang) for lang in SOURCES}
    sources.update(players_guides())
    stale_sources = [path for path, content in sources.items() if path.read_bytes().decode("utf-8") != content]
    if check:
        pages = {OUT / f"{lang}.html": render(lang) for lang in SOURCES}
        stale = stale_sources + [path for path, content in pages.items()
                                 if not path.is_file() or path.read_text(encoding="utf-8") != content]
        if stale:
            print("Out of date: " + ", ".join(path.relative_to(ROOT).as_posix() for path in stale) +
                  " (run python tooling/build_guide_html.py)")
            return 1
        print(f"guide Markdown screenshot lines and HTML up to date ({len(pages)} languages)")
        return 0
    for path in stale_sources:
        path.write_bytes(sources[path].encode("utf-8"))
    pages = {f"{lang}.html": render(lang) for lang in SOURCES}
    OUT.mkdir(parents=True, exist_ok=True)
    for name, content in pages.items():
        (OUT / name).write_bytes(content.encode("utf-8"))
    print("wrote " + ", ".join([path.relative_to(ROOT).as_posix() for path in stale_sources] +
                               [f"docs/install/guide/{name}" for name in pages]))
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
