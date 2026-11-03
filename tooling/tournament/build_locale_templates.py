"""Build Tournament's per-locale banner templates and `locale_templates.json` from Clean Assets.

  .venv\\Scripts\\python.exe tooling/tournament/build_locale_templates.py \
      --clean-assets "path/to/clean-assets" --templates <private-assets>/assets/templates

Reads `images/hud/templates/<bucket>/064_lan_results_banner.png` (the 12th-place results banner) and, once
captured, `<bucket>/091_lan_race_counter_word.png` (the "Race" word of the counter banner, template 091 since the
2026-11-01 LAN capture) for every bucket
except English and Dutch, which the engine already has built in. A bucket whose file is byte-identical to the
English or Dutch one (a linked regional copy, e.g. en-us) is skipped. A results-banner cut-out becomes an
alpha-premultiplied grey image thresholded at 180 without an alpha mask; a counter word (a rectangle over the race
band's 60 rows) goes through the engine's own preprocess_roi(..., 0), which is how the engine sees that band — measured on the Wild 2026-03-27 recording, that form scores
0.92 on the banner frame (the hand-made English template 0.55) and about 0.1 on frames without it.

Writes `<templates>/locale/<kind>_<locale>.png` and `<templates>/locale_templates.json`; prints a JSON summary.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages" / "tournament-extraction" / "python" / "src"))

from mk8dx_tournament_extraction.locale_templates import (  # noqa: E402
    DEFAULT_ROIS,
    DEFAULT_THRESHOLDS,
    MANIFEST_NAME,
    SCHEMA_VERSION,
)

# Clean Assets template buckets -> game locales (Clean Assets `gameLocales`). English and Dutch are built in.
BUCKET_LOCALES = {
    "en-us": "USen", "fr": "EUfr", "fr-ca": "USfr", "de": "EUde", "es": "EUes", "es-419": "USes",
    "it": "EUit", "pt": "EUpt", "ru": "EUru", "ja": "JPja", "ko": "KRko", "zh-cn": "CNzh", "zh-tw": "TWzh",
}
# (kind, Clean Assets file, output suffix). 093 is the final-race word where it is not the 091 word (Russian
# "Финал" against "заезд"); every other language's final-race banner contains its 091 word.
SOURCES = (
    ("twelfth", "064_lan_results_banner.png", ""),
    ("race", "091_lan_race_counter_word.png", ""),
    ("race", "093_lan_race_counter_final_word.png", "_final"),
)


def race_template(path: Path) -> np.ndarray:
    """The counter word (Clean Assets 091, a rectangle cut with its yellow band) as the engine sees it: its own
    `preprocess_roi(..., 0)` re-thresholds white-dominated rows at 120, dilates and inverts them, so the template
    is that processed image (the dark letter outline becomes the white pattern)."""
    from mk8dx_tournament_extraction.engine.extract_common import preprocess_roi

    image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise ValueError(f"cannot read {path}")
    gray = cv2.cvtColor(image[:, :, :3], cv2.COLOR_BGR2GRAY)
    # preprocess_roi decides per stripe on the white/black majority across the whole width, so process the word
    # inside a band as wide as the search ROI (edge-replicated band colour), then cut the word back out.
    width = DEFAULT_ROIS["race"][2]
    left = max(0, (width - gray.shape[1]) // 2)
    right = max(0, width - gray.shape[1] - left)
    padded = cv2.copyMakeBorder(gray, 0, 0, left, right, cv2.BORDER_REPLICATE)
    return preprocess_roi(padded, 0)[:, left:left + gray.shape[1]]


def binary_template(path: Path) -> np.ndarray:
    image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise ValueError(f"cannot read {path}")
    if image.ndim == 3 and image.shape[2] == 4:
        alpha = image[:, :, 3:4].astype(np.float32) / 255.0
        image = (image[:, :, :3].astype(np.float32) * alpha).astype(np.uint8)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    _, binary = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY)
    return binary


def build(clean_assets: Path, templates: Path) -> dict:
    root = clean_assets / "images" / "hud" / "templates"
    out_dir = templates / "locale"
    out_dir.mkdir(parents=True, exist_ok=True)
    entries, skipped = [], []
    for kind, file_name, suffix in SOURCES:
        built_in = {
            hashlib.sha256((root / bucket / file_name).read_bytes()).hexdigest()
            for bucket in ("en", "nl") if (root / bucket / file_name).is_file()
        }
        for bucket, locale in BUCKET_LOCALES.items():
            source = root / bucket / file_name
            if not source.is_file():
                continue
            if hashlib.sha256(source.read_bytes()).hexdigest() in built_in:
                skipped.append(f"{kind}:{bucket} (same as built-in)")
                continue
            target = out_dir / f"{kind}{suffix}_{locale}.png"
            cv2.imwrite(str(target), race_template(source) if kind == "race" else binary_template(source))
            entries.append({
                "locale": locale,
                "kind": kind,
                "file": f"locale/{target.name}",
                "roi": list(DEFAULT_ROIS[kind]),
                "threshold": DEFAULT_THRESHOLDS[kind],
                "source": f"Clean Assets images/hud/templates/{bucket}/{file_name}",
                "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            })
    manifest = {"schemaVersion": SCHEMA_VERSION, "templates": entries}
    (templates / MANIFEST_NAME).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return {"templates": len(entries), "locales": sorted({e["locale"] for e in entries}), "skipped": skipped}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--clean-assets", required=True, type=Path)
    parser.add_argument("--templates", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(build(args.clean_assets, args.templates)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
