"""Reading the processor's console output for the analysis window, without Qt.

The recognition engine prints coloured console output (ANSI/SGR codes, requested through MK8_FORCE_COLOR) and a
``Comp  NN%`` progress field while it extracts frames. The Qt log view turns the colour runs into text formats;
the parsing lives here so it is tested without a display. Ported from the MK8DX Live Video Processor post-analysis GUI
(gui/ansi_log.py and gui/process_runner.py).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace

SGR_RE = re.compile(r"\x1b\[([0-9;]*)m")
# The engine's extraction status line ("Comp  35%"); the Extractor's own pipeline printed "Perc  16%".
PERCENT_RE = re.compile(r"\b(?:Comp|Perc)\s+(\d{1,3})%")

DEFAULT_FG = "#cdd6e5"
# Bright 16-colour ANSI palette (the logger uses the bold/bright variants).
BASIC = {
    30: "#3b4252", 31: "#e0555a", 32: "#5fd07a", 33: "#e8c44a",
    34: "#5b9bf0", 35: "#c678dd", 36: "#56c8d8", 37: "#cdd6e5",
    90: "#6b7689", 91: "#ff6b6b", 92: "#6bff9a", 93: "#ffe066",
    94: "#74a9ff", 95: "#e89bff", 96: "#6ff0ff", 97: "#ffffff",
}


@dataclass(frozen=True)
class Style:
    fg: str = DEFAULT_FG
    bold: bool = False
    dim: bool = False

    def color(self) -> str:
        """The foreground to draw: dimmed text is halfway to the log background."""
        if not self.dim:
            return self.fg
        red, green, blue = (int(self.fg[index:index + 2], 16) for index in (1, 3, 5))
        return "#{:02x}{:02x}{:02x}".format((red + 9) // 2, (green + 9) // 2, (blue + 9) // 2)


@dataclass
class AnsiState:
    """Colour state carried from line to line, as a terminal keeps it."""

    style: Style = field(default_factory=Style)

    def reset(self) -> None:
        self.style = Style()

    def runs(self, line: str) -> list[tuple[str, Style]]:
        """Split one line into (text, style) runs and advance the state past its codes."""
        result: list[tuple[str, Style]] = []
        position = 0
        for match in SGR_RE.finditer(line):
            if match.start() > position:
                result.append((line[position:match.start()], self.style))
            self.apply(match.group(1))
            position = match.end()
        if position < len(line):
            result.append((line[position:], self.style))
        return result

    def apply(self, raw: str) -> None:
        codes = [int(part) for part in raw.split(";") if part != ""] or [0]
        style = self.style
        index = 0
        while index < len(codes):
            code = codes[index]
            if code == 0:
                style = Style()
            elif code == 1:
                style = replace(style, bold=True)
            elif code == 2:
                style = replace(style, dim=True)
            elif code == 22:
                style = replace(style, bold=False, dim=False)
            elif code == 39:
                style = replace(style, fg=DEFAULT_FG)
            elif code in BASIC:
                style = replace(style, fg=BASIC[code])
            elif code == 38 and index + 1 < len(codes):
                mode = codes[index + 1]
                if mode == 5 and index + 2 < len(codes):
                    style = replace(style, fg=xterm256(codes[index + 2]))
                    index += 2
                elif mode == 2 and index + 4 < len(codes):
                    red, green, blue = (max(0, min(255, value)) for value in codes[index + 2:index + 5])
                    style = replace(style, fg=f"#{red:02x}{green:02x}{blue:02x}")
                    index += 4
            index += 1
        self.style = style


def xterm256(index: int) -> str:
    if index < 16:
        key = 30 + index if index < 8 else 90 + (index - 8)
        return BASIC.get(key, DEFAULT_FG)
    if index >= 232:
        value = 8 + 10 * (index - 232)
        return f"#{value:02x}{value:02x}{value:02x}"
    index -= 16
    red, green, blue = index // 36, (index % 36) // 6, index % 6

    def convert(channel: int) -> int:
        return 0 if channel == 0 else 55 + 40 * channel

    return f"#{convert(red):02x}{convert(green):02x}{convert(blue):02x}"


def strip_ansi(line: str) -> str:
    return SGR_RE.sub("", line)


def parse_percent(line: str) -> int | None:
    """The progress percentage on a status line, clamped to 0-100, or None."""
    match = PERCENT_RE.search(strip_ansi(line))
    if not match:
        return None
    return max(0, min(100, int(match.group(1))))


class LineBuffer:
    """Splits a byte stream into lines the way the Extractor's runner did (\\n, trailing \\r dropped)."""

    def __init__(self) -> None:
        self._pending = ""

    def feed(self, text: str) -> list[str]:
        self._pending += text
        *complete, self._pending = self._pending.split("\n")
        return [line.rstrip("\r") for line in complete]

    def flush(self) -> list[str]:
        rest, self._pending = self._pending, ""
        return [rest.rstrip("\r")] if rest else []
