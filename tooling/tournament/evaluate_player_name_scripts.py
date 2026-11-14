"""Measure the player-name reading per script, before and after the script readers.

Reads score frames through the product path (``process_image`` then ``extract_player_names_batched``)
twice: once as before this change (Latin reader ``en,es,fr,de,nl,pl``, no script readers) and once as now
(Latin reader with ``it,pt``, script readers). Prints per script how many names are read exactly, every
Latin row whose reading changed (a false script switch), recognition calls per reader, reader load time
and memory, and the peak working set.

Cases are JSON lines ``{"frame", "layout", "row", "expected", "script"}`` (row is 0-based); every other
row of a case frame, and every row of ``--frames``, is a Latin row that must not change.

    python tooling/tournament/evaluate_player_name_scripts.py --cases cases.jsonl
    python tooling/tournament/evaluate_player_name_scripts.py --frames "<Frames>/**/2RaceScore/*_2p.jpg"

Frames and cases stay outside the repository (recordings and game-font material are private). Needs the
Tools runtime with the recorded assets (MK8DX_TOURNAMENT_REFERENCE_ROOT / ENGINE_DATA_ROOT).
"""
from __future__ import annotations

import argparse
import glob
import json
import time
import unicodedata
from collections import defaultdict
from pathlib import Path

BEFORE_LATIN = "en,es,fr,de,nl,pl"


def _key(text: str) -> str:
    return "".join(unicodedata.normalize("NFKC", str(text or "")).casefold().split())


def _memory_mb(peak: bool = False) -> float | None:
    try:
        import psutil

        info = psutil.Process().memory_info()
        return round((getattr(info, "peak_wset", info.rss) if peak else info.rss) / 2**20)
    except Exception:
        return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--cases", type=Path)
    parser.add_argument("--frames", action="append", default=[], help="glob of Latin-only frames (regression)")
    parser.add_argument("--layout", default="lan2_split_2p", help="layout of --frames")
    parser.add_argument("--before-latin", default=BEFORE_LATIN)
    parser.add_argument("--json", type=Path, help="write every reading here")
    args = parser.parse_args(argv)

    import cv2

    from mk8dx_tournament_extraction.engine import extract_text, player_name_scripts
    from mk8dx_tournament_extraction.engine.ocr_scoreboard_consensus import process_image
    from mk8dx_tournament_extraction.engine.score_layouts import get_score_layout

    frames: dict[tuple[str, str], dict[int, dict]] = defaultdict(dict)
    if args.cases:
        for line in args.cases.read_text(encoding="utf-8").splitlines():
            if line.strip():
                case = json.loads(line)
                frames[(case["frame"], case.get("layout", args.layout))][int(case["row"])] = case
    for pattern in args.frames:
        for path in sorted(glob.glob(pattern, recursive=True)):
            frames.setdefault((path, args.layout), {})

    calls: dict[str, dict[str, int]] = {"before": defaultdict(int), "after": defaultdict(int)}
    phase = {"name": "before"}
    batched = extract_text._run_easyocr_player_names_batched_variant
    single = extract_text._run_easyocr_player_name_for_context

    def counted_batched(*a, languages=None, **k):
        calls[phase["name"]]["latin" if languages is None else "+".join(languages)] += 1
        return batched(*a, languages=languages, **k)

    def counted_single(*a, **k):
        calls[phase["name"]]["latin (row fallback)"] += 1
        return single(*a, **k)

    extract_text._run_easyocr_player_names_batched_variant = counted_batched
    extract_text._run_easyocr_player_name_for_context = counted_single
    after_latin = list(extract_text.PLAYER_NAME_EASYOCR_LANGS)
    before_latin = [part.strip() for part in args.before_latin.split(",") if part.strip()]

    # every reader once, timed, before any reading is timed
    loads = {}
    for label, languages in [("latin (before)", before_latin), ("latin", after_latin),
                             *player_name_scripts.SCRIPT_READERS.items()]:
        rss, started = _memory_mb(), time.perf_counter()
        extract_text._get_easyocr_reader(tuple(languages))
        loads[label] = {"seconds": round(time.perf_counter() - started, 2),
                        "MB": None if rss is None else _memory_mb() - rss}

    def read(image, layout, latin, scripts_on, label):
        phase["name"] = label
        extract_text.PLAYER_NAME_EASYOCR_LANGS[:] = latin
        extract_text.PLAYER_NAME_SCRIPT_READERS_ENABLED = scripts_on
        started = time.perf_counter()
        names, _ = extract_text.extract_player_names_batched(
            image, layout.player_name_coords, bundle_kind="2RaceScore", field_name="RacePlayerName")
        return names, time.perf_counter() - started

    player_name_scripts.SCRIPT_MEMORY.clear()
    stats: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    changed: list[dict] = []
    records: list[dict] = []
    seconds = {"before": 0.0, "after": 0.0}
    for (frame, layout_id), cases in frames.items():
        image = cv2.imread(frame, cv2.IMREAD_COLOR)
        if image is None:
            raise SystemExit(f"cannot read {frame}")
        layout = get_score_layout(layout_id)
        processed = process_image(image, score_layout_id=layout.layout_id)
        before, spent = read(processed, layout, before_latin, False, "before")
        seconds["before"] += spent
        after, spent = read(processed, layout, after_latin, True, "after")
        seconds["after"] += spent
        for row, (old, new) in enumerate(zip(before, after)):
            case = cases.get(row)
            record = {"frame": frame, "row": row, "before": old, "after": new}
            records.append(record)
            if case is None:
                stats["latin"]["rows"] += 1
                if old != new:
                    stats["latin"]["changed"] += 1
                    changed.append(record)
                continue
            record.update(expected=case["expected"], script=case["script"])
            bucket = stats[case["script"]]
            bucket["rows"] += 1
            bucket["exact before"] += _key(old) == _key(case["expected"])
            bucket["exact after"] += _key(new) == _key(case["expected"])
    extract_text.PLAYER_NAME_SCRIPT_READERS_ENABLED = True

    print(f"frames {len(frames)}; name reading before {seconds['before']:.1f}s, after {seconds['after']:.1f}s")
    print("reader loads:", json.dumps(loads))
    print("readers created:", len(extract_text._EASYOCR_READERS), "| peak working set MB:", _memory_mb(peak=True))
    for label in ("before", "after"):
        print(f"recognition calls {label}:", json.dumps(dict(calls[label])))
    print("script fallback:", json.dumps(dict(extract_text.PLAYER_NAME_SCRIPT_STATS)))
    for script in sorted(stats):
        print(f"  {script:22}", json.dumps(dict(stats[script])))
    for record in changed[:20]:
        print("  changed Latin row:", json.dumps(record, ensure_ascii=False))
    if args.json:
        args.json.write_text(json.dumps(records, ensure_ascii=False, indent=1), encoding="utf-8")
    return 1 if changed else 0


if __name__ == "__main__":
    raise SystemExit(main())
