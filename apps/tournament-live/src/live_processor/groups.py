"""Stream group aliases and their badge colours.

Each live feed can be tagged with a group (a qualifying group or an "eindgroep"
final group). The alias is shown on the broadcast scoreboard badge, coloured by
the group, and as a per-source dropdown in the operator console.
"""

from __future__ import annotations

# Insertion order defines the dropdown order.
GROUP_COLORS: dict[str, str] = {
    # Qualifying groups
    "Groep 1": "#DC2626",  # red
    "Groep 2": "#0D9488",  # teal
    "Groep 3": "#475569",  # slate
    "Groep 4": "#1D4ED8",  # blue
    "Groep 5": "#B45309",  # amber/brown
    # Final groups (eindgroepen)
    "Kampioen": "#F59E0B",  # gold/orange
    "Talent": "#38BDF8",  # light blue
    "Wild": "#A78BFA",  # purple
    "Avontuur": "#4ADE80",  # green
    "Feest": "#EC4899",  # pink
    "Nieuw": "#F97316",  # orange
    "Onbekend": "#94A3B8",  # gray (default / unassigned)
}

GROUP_NAMES: list[str] = list(GROUP_COLORS)
DEFAULT_GROUP = "Onbekend"


def group_color(name: str | None) -> str:
    return GROUP_COLORS.get(str(name or ""), GROUP_COLORS[DEFAULT_GROUP])


def text_color_for(background_hex: str) -> str:
    """Pick black or white text for legibility against a badge colour."""

    value = background_hex.lstrip("#")
    if len(value) != 6:
        return "#ffffff"
    r, g, b = (int(value[i : i + 2], 16) for i in (0, 2, 4))
    # Relative luminance (sRGB approximation).
    luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return "#0a0e26" if luminance > 0.6 else "#ffffff"
