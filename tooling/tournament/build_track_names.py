"""Write the packaged track-name table (15 game locales) for Tournament track recognition from Clean Assets.

  .venv\\Scripts\\python.exe tooling/tournament/build_track_names.py \
      --clean-assets "path/to/clean-assets"

Output: packages/tournament-extraction/python/src/mk8dx_tournament_extraction/track-names-v1.json, keyed by the
UK English name the engine already reports, with every Clean Assets `names` locale (en-GB, en-US, nl-NL, fr-FR,
fr-CA, de-DE, es-ES, es-419, it-IT, pt-PT, ru-RU, ja-JP, ko-KR, zh-CN, zh-TW). Game names come from the catalog,
never from hand translation.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "packages" / "tournament-extraction" / "python" / "src" / "mk8dx_tournament_extraction" / "track-names-v1.json"
LOCALES = ("en-GB", "en-US", "nl-NL", "fr-FR", "fr-CA", "de-DE", "es-ES", "es-419",
           "it-IT", "pt-PT", "ru-RU", "ja-JP", "ko-KR", "zh-CN", "zh-TW")


def build(clean_assets: Path) -> dict:
    database_path = clean_assets / "database.json"
    database = json.loads(database_path.read_text(encoding="utf-8"))
    tracks = []
    for track in sorted(database["collections"]["tracks"], key=lambda item: int(item["index"])):
        names = track["names"]
        missing = [locale for locale in LOCALES if not str(names.get(locale, "")).strip()]
        if missing:
            raise SystemExit(f"track {track['id']} lacks names for {missing}")
        tracks.append({"index": int(track["index"]), "slug": track["slug"],
                       "names": {locale: names[locale] for locale in LOCALES}})
    return {
        "schemaVersion": "mk8dx.tournament-track-names.v1",
        "source": "Clean Assets database.json collections.tracks[].names",
        "sourceSha256": hashlib.sha256(database_path.read_bytes()).hexdigest(),
        "locales": list(LOCALES),
        "tracks": tracks,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--clean-assets", required=True, type=Path)
    args = parser.parse_args()
    document = build(args.clean_assets)
    TARGET.write_text(json.dumps(document, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"tracks": len(document["tracks"]), "target": str(TARGET)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
