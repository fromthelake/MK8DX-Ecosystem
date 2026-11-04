"""Derive the round Android launcher mark from the owner Time Trials icon."""

from __future__ import annotations

import argparse
import io
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "apps/timetrials-web/styles/app-icon-512.png"
TARGET = (
    ROOT
    / "apps/timetrials-android/app/src/main/res/drawable-nodpi"
    / "mk8dx_product_launcher_mark.png"
)


def derived_png() -> bytes:
    with Image.open(SOURCE) as original:
        mark = original.convert("RGBA").crop((60, 12, 490, 355))
    pixels = mark.load()
    for y in range(mark.height):
        for x in range(mark.width):
            red, green, blue, _ = pixels[x, y]
            luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
            chroma = max(red, green, blue) - min(red, green, blue)
            alpha = max(
                0,
                min(255, round(255 * max((luminance - 60) / 28, (chroma - 48) / 28))),
            )
            pixels[x, y] = red, green, blue, alpha
    mark = mark.resize((300, 240), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    canvas.alpha_composite(mark, (106, 136))
    output = io.BytesIO()
    canvas.save(output, format="PNG", optimize=True)
    return output.getvalue()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="regenerate the tracked icon")
    args = parser.parse_args()
    expected = derived_png()
    if args.write:
        TARGET.parent.mkdir(parents=True, exist_ok=True)
        TARGET.write_bytes(expected)
        print(f"Wrote {TARGET}")
    elif not TARGET.is_file() or TARGET.read_bytes() != expected:
        raise SystemExit(f"Android launcher mark differs from {SOURCE}; run --write")
    else:
        print("Android launcher mark matches owner artwork")


if __name__ == "__main__":
    main()
