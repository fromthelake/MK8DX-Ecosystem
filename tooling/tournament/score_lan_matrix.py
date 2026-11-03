"""Cross-score the per-language LAN banner templates on the captured frames (roadmap LANGUAGES_15 A6 acceptance).

    .venv\\Scripts\\python.exe tooling/tournament/score_lan_matrix.py --clean-assets "<Clean Assets>" \
        --frames private-qa/lan-15lang-20261031 --langs en,nl,de,fr,es,it

For each language L and element (064 results banner, 091 counter word) it scores L's template in the form Tournament
ships it (build_locale_templates.py) with the engine's own preprocessing (score_locale_templates.py), on every captured frame of that element
in every language, inside the Tournament search band. A template is fit when its own language scores high and
every other language and the no-banner frames score clearly lower. Prints a matrix per element and a verdict.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_locale_templates import binary_template, race_template  # noqa: E402
from score_locale_templates import score  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "packages" / "tournament-extraction" / "python" / "src"))
from mk8dx_tournament_extraction.locale_templates import DEFAULT_ROIS  # noqa: E402

ELEMENTS = {"twelfth": ("064_lan_results_banner.png", "twelfth"), "race": ("091_lan_race_counter_word.png", "race")}
# Which frames of a language show which element: picked by lan_cutouts.py runs, listed in frames.json per language.


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--clean-assets", type=Path, required=True)
    parser.add_argument("--frames", type=Path, required=True, help="folder with frames.json (lang -> element -> png)")
    parser.add_argument("--langs", required=True)
    args = parser.parse_args()
    langs = args.langs.split(",")
    index = json.loads((args.frames / "frames.json").read_text(encoding="utf-8"))
    negatives = [args.frames / p for p in index.get("negatives", [])]
    report = {}
    for element, (filename, kind) in ELEMENTS.items():
        roi = DEFAULT_ROIS[kind]
        matrix = {}
        for lang in langs:
            # the form Tournament ships (build_locale_templates.py): premultiplied grey > 180, no alpha mask
            source = args.clean_assets / "images" / "hud" / "templates" / lang / filename
            template = (race_template(source) if kind == "race" else binary_template(source), None)
            row = {}
            for other in langs:
                path = index.get(other, {}).get(element)
                if not path:
                    continue
                gray = cv2.cvtColor(cv2.resize(cv2.imread(str(args.frames / path)), (1280, 720),
                                               interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
                row[other] = round(score(gray, roi, template, 0), 3)
            row["_none"] = round(max((score(cv2.cvtColor(cv2.resize(cv2.imread(str(n)), (1280, 720)),
                                                          cv2.COLOR_BGR2GRAY), roi, template, 0)
                                      for n in negatives), default=0.0), 3)
            matrix[lang] = row
        report[element] = matrix
        print(f"\n{element} (rows: template language, columns: frame language, _none: best no-banner frame)")
        cols = langs + ["_none"]
        print("      " + " ".join(f"{c:>6}" for c in cols))
        for lang, row in matrix.items():
            print(f"{lang:>5} " + " ".join(f"{row.get(c, float('nan')):>6.3f}" for c in cols))
    verdict = {}
    for element, matrix in report.items():
        for lang, row in matrix.items():
            own = row.get(lang)
            others = [v for k, v in row.items() if k not in (lang, "_none")]
            margin = None if own is None else round(own - max(others + [row["_none"]]), 3)
            verdict[f"{element}:{lang}"] = {"own": own, "margin": margin}
    print("\n" + json.dumps(verdict))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
