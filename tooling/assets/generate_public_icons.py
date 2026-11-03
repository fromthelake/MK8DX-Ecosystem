"""Generate original, neutral MK8DX distribution icons (Pillow 11.3.0)."""

from pathlib import Path

from PIL import Image, ImageDraw


STYLES = Path(__file__).resolve().parents[2] / "apps" / "timetrials-web" / "styles"


def app_icon(size: int) -> None:
    scale = size / 512
    image = Image.new("RGB", (size, size), "#102035")
    draw = ImageDraw.Draw(image)

    def box(coords):
        return tuple(round(value * scale) for value in coords)

    draw.rounded_rectangle(box((35, 35, 477, 477)), radius=round(92 * scale), fill="#163756")
    draw.ellipse(box((101, 101, 411, 411)), outline="#f4f7fb", width=max(2, round(30 * scale)))
    draw.arc(box((101, 101, 411, 411)), 200, 325, fill="#ef654d", width=max(2, round(30 * scale)))
    draw.arc(box((101, 101, 411, 411)), 20, 145, fill="#52acd1", width=max(2, round(30 * scale)))
    draw.ellipse(box((188, 139, 324, 257)), outline="#f7d46a", width=max(2, round(29 * scale)))
    draw.ellipse(box((174, 245, 338, 380)), outline="#f7d46a", width=max(2, round(31 * scale)))
    image.save(STYLES / f"app-icon-{size}.png", optimize=True)


def console_icon(number: int) -> None:
    image = Image.new("RGBA", (128, 96), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((4, 8, 123, 87), radius=18, fill="#18344d", outline="#d3e8f3", width=3)
    draw.rounded_rectangle((28, 15, 99, 80), radius=6, fill="#6bb0cd")
    draw.rounded_rectangle((34, 21, 93, 74), radius=3, fill="#203f55")
    draw.ellipse((12, 24, 23, 35), fill="#f3d776")
    draw.ellipse((105, 60, 116, 71), fill="#f3d776")
    if number == 2:
        draw.ellipse((51, 38, 62, 49), fill="#f3d776")
        draw.ellipse((67, 38, 78, 49), fill="#f3d776")
    else:
        draw.ellipse((58, 38, 70, 50), fill="#f3d776")
    image.save(STYLES / f"mk8dx_ns{number}.png", optimize=True)


if __name__ == "__main__":
    STYLES.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        app_icon(size)
    for number in (1, 2):
        console_icon(number)
