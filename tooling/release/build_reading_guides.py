"""Render the two self-contained UTF-8 reading guides as Word documents.

Maintainer-only dependency: python-docx. The checked-in TXT is authoritative;
ordinary installers only open the prebuilt DOCX or TXT in docs/install.
"""
from __future__ import annotations

import re
from pathlib import Path

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[2]
GUIDES = {
    "MK8DX_Handleiding_NL": {
        "chapters": {
            "Welkom", "Op één computer proberen", "Op je eigen netwerk gebruiken",
            "Lokaal zonder Docker: XAMPP en Node.js", "Publiek op gedeelde Node.js-hosting zonder Docker",
            "Een openbare website op een VPS maken",
            "Android, LiveTrial, scanner en Tournament gebruiken",
            "Instellingen en dagelijks beheer", "Backup, herstel en updates",
            "Als het niet lukt en zelf bouwen", "Linux gebruiken", "macOS gebruiken",
        },
        "subheadings": {"De volgorde in deze handleiding", "Een backup herstellen",
                        "Wat je nu lokaal kunt proberen", "Wat nog ontwikkeling vraagt"},
    },
    "MK8DX_User_Guide_EN": {
        "chapters": {
            "Welcome", "Try it on one computer", "Use it on your home network",
            "On one computer without Docker: XAMPP and Node.js", "Public shared hosting with Node.js, without Docker",
            "Make a public website on a VPS",
            "Use Android, LiveTrial, the scanner, and Tournament",
            "Change settings and manage the site", "Back up, restore, and update",
            "Troubleshooting and building it yourself", "Use Linux", "Use macOS",
        },
        "subheadings": {"What is in this guide", "Restore a backup",
                        "What you can try locally now", "What still needs development"},
    },
}
URL = re.compile(r"https?://[^\s]+")
COMMAND = re.compile(
    r"^(?:docker |python |python3 |node |npm |powershell |scp |ssh |ssh-keygen |sha256sum |shasum |New-Item |Get-FileHash |"
    r"Resolve-DnsName |ping |cat |apt |install |curl |chmod |"
    r"command -v |systemctl |uname |free |df |pwd$|ls |mkdir |mv |unzip |cd |"
    r"sh |\.\\TournamentConnect|\$state =|\$compose =|\$serverIp =|\$sshPort =|"
    r"\$key =|Types:|URIs:|Suites:|Components:|Architectures:|Signed-By:|EOF$)"
)


def hyperlink(paragraph, url):
    part = paragraph.part
    relation = part.relate_to(
        url,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
        is_external=True,
    )
    element = OxmlElement("w:hyperlink")
    element.set(qn("r:id"), relation)
    run = OxmlElement("w:r")
    properties = OxmlElement("w:rPr")
    color = OxmlElement("w:color")
    color.set(qn("w:val"), "145A82")
    properties.append(color)
    run.append(properties)
    content = OxmlElement("w:t")
    content.text = url
    run.append(content)
    element.append(run)
    paragraph._p.append(element)


def add_text(paragraph, line):
    offset = 0
    for match in URL.finditer(line):
        if match.start() > offset:
            paragraph.add_run(line[offset:match.start()])
        hyperlink(paragraph, match.group())
        offset = match.end()
    if offset < len(line):
        paragraph.add_run(line[offset:])


def page_number(footer):
    paragraph = footer.paragraphs[0]
    paragraph.alignment = 2
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instruction = OxmlElement("w:instrText")
    instruction.set(qn("xml:space"), "preserve")
    instruction.text = " PAGE "
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.extend((begin, instruction, end))


def build(stem, layout):
    text_path = ROOT / "docs" / "install" / f"{stem}.txt"
    lines = text_path.read_text(encoding="utf-8-sig").splitlines()
    if len(lines) < 100 or not lines[0].strip() or lines[1].strip():
        raise ValueError(f"Unexpected reading guide shape: {text_path}")
    document = Document()
    section = document.sections[0]
    section.page_height, section.page_width = Cm(29.7), Cm(21)
    section.top_margin = Cm(1.9)
    section.bottom_margin = Cm(1.75)
    section.left_margin = Cm(2.1)
    section.right_margin = Cm(1.9)
    section.footer_distance = Cm(0.85)
    styles = document.styles
    normal = styles["Normal"]
    normal.font.name = "Aptos"
    normal.font.size = Pt(11)
    normal.font.color.rgb = RGBColor(25, 31, 36)
    normal.paragraph_format.space_after = Pt(5.5)
    normal.paragraph_format.line_spacing = 1.12
    normal.paragraph_format.widow_control = True
    for name, size, above, below in (("Title", 19, 0, 12), ("Heading 1", 14, 18, 8), ("Heading 2", 11.5, 13, 6)):
        style = styles[name]
        style.font.name = "Aptos Display" if name != "Heading 2" else "Aptos"
        style.font.size = Pt(size)
        style.font.bold = name != "Title"
        style.font.color.rgb = RGBColor(20, 42, 55)
        style.paragraph_format.space_before = Pt(above)
        style.paragraph_format.space_after = Pt(below)
        style.paragraph_format.keep_with_next = True
    title = styles["Title"]
    title.font.color.rgb = RGBColor(0, 0, 0)
    for border in title._element.pPr.xpath("./w:pBdr"):
        title._element.pPr.remove(border)
    command = styles.add_style("Command", 1)
    command.base_style = normal
    command.font.name = "Consolas"
    command.font.size = Pt(8.5)
    command.paragraph_format.left_indent = Cm(0.35)
    command.paragraph_format.space_after = Pt(2.5)
    command.paragraph_format.line_spacing = 1.05
    command.paragraph_format.keep_together = True
    subtitle = styles.add_style("Guide Subtitle", 1)
    subtitle.base_style = normal
    subtitle.font.size = Pt(9.5)
    subtitle.font.color.rgb = RGBColor(75, 85, 95)
    subtitle.paragraph_format.space_after = Pt(17)
    page_number(section.footer)
    document.core_properties.author = "MK8DX"
    document.core_properties.last_modified_by = "MK8DX"
    document.core_properties.title = lines[0]
    document.core_properties.subject = "Local installation guide"

    nonempty = 0
    for line in lines:
        line = line.rstrip()
        if not line:
            continue
        nonempty += 1
        if nonempty == 1:
            paragraph = document.add_paragraph(style="Title")
        elif nonempty == 2:
            paragraph = document.add_paragraph(style="Guide Subtitle")
        elif line in layout["chapters"]:
            paragraph = document.add_paragraph(style="Heading 1")
            if stem == "MK8DX_Handleiding_NL" and line == "Als het niet lukt en zelf bouwen":
                paragraph.paragraph_format.page_break_before = True
        elif line in layout["subheadings"]:
            paragraph = document.add_paragraph(style="Heading 2")
        elif COMMAND.match(line):
            paragraph = document.add_paragraph(style="Command")
        else:
            paragraph = document.add_paragraph(style="Normal")
        add_text(paragraph, line)
    out = text_path.with_suffix(".docx")
    document.save(out)
    print(f"{out} ({nonempty} paragraphs)")


if __name__ == "__main__":
    for name, layout in GUIDES.items():
        build(name, layout)
