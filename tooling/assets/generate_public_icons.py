"""Generate the project's neutral console icons, leaving owner app art intact."""

from pathlib import Path

from PIL import Image, ImageDraw


STYLES = Path(__file__).resolve().parents[2] / "apps" / "timetrials-web" / "styles"


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
    for number in (1, 2):
        console_icon(number)
