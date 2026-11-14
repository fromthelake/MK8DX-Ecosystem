"""Measure the player-name reading per script, before and after the script readers.

Reads score frames through the product path (``process_image`` then ``extract_player_names_batched``)
twice: once with the Latin reader only and no roster ("before"), once with the current Latin languages and
the roster ("after"). Prints per script: exact readings and roster matches (right / wrong / none), and for
every row that is not a case, whether its reading changed.

Cases are JSON lines ``{"frame", "layout", "row", "expected", "script"}`` (row is 0-based). A case whose
expected name is not in the roster is a guest: any roster match for it is a wrong match.

    python tooling/tournament/evaluate_player_name_scripts.py --cases cases.jsonl --roster players.txt
    python tooling/tournament/evaluate_player_name_scripts.py --frames "<Frames>/**/2RaceScore/*_2p.jpg" \\
        --layout lan2_split_2p --roster players.txt          # regression: no cases, only changed rows

Frames and cases stay outside the repository (recordings and game-font material are private). Needs the
Tools runtime with the recorded assets (MK8DX_TOURNAMENT_REFERENCE_ROOT / ENGINE_DATA_ROOT).
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import time
import unicodedata
from collections import defaultdict
from pathlib import Path

BEFORE_LATIN = "en,es,fr,de,nl,pl"


def _key(text: str) -> str:
    return "".join(unicodedata.normalize("NFKC", str(text or "")).casefold().split())


def _rss_mb(peak: bool = False) -> float | None:
    try:
        import psutil

        info = psutil.Process().memory_info()
        return (getattr(info, "peak_wset", info.rss) if peak else info.rss) / 2**20
    except Exception:
        return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--cases", type=Path)
    parser.add_argument("--frames", action="append", default=[], help="glob of extra frames (regression rows)")
    parser.add_argument("--layout", default="lan2_split_2p", help="layout of --frames")
    parser.add_argument("--roster", type=Path, required=True)
    parser.add_argument("--before-latin", default=BEFORE_LATIN)
    parser.add_argument("--json", type=Path, help="write every reading here")
    args = parser.parse_args(argv)

    import cv2

    from mk8dx_tournament_extraction.engine import extract_text, player_name_scripts
    from mk8dx_tournament_extraction.engine.ocr_scoreboard_consensus import process_image
    from mk8dx_tournament_extraction.engine.score_layouts import get_score_layout

    roster = player_name_scripts.load_roster(args.roster)
    roster_keys = {_key(name) for name in roster.names}
    cases_by_frame: dict[tuple[str, str], dict[int, dict]] = defaultdict(dict)
    if args.cases:
        for line in args.cases.read_text(encoding="utf-8").splitlines():
            if line.strip():
                case = json.loads(line)
                cases_by_frame[(case["frame"], case.get("layout", args.layout))][int(case["row"])] = case
    for pattern in args.frames:
        for path in sorted(glob.glob(pattern, recursive=True)):
            cases_by_frame.setdefault((path, args.layout), {})

    # count every recognition call by reader, per phase
    calls: dict[str, dict[str, int]] = {"before": defaultdict(int), "after": defaultdict(int)}
    phase = {"name": "before"}
    batched, single = extract_text._run_easyocr_player_names_batched_variant, extract_text._run_easyocr_player_name_for_context

    def counted_batched(*a, languages=None, **k):
        reader = "latin" if languages is None else "+".join(languages)
        calls[phase["name"]][reader] += 1
        return batched(*a, languages=languages, **k)

    def counted_single(*a, **k):
        calls[phase["name"]]["latin(row fallback)"] += 1
        return single(*a, **k)

    extract_text._run_easyocr_player_names_batched_variant = counted_batched
    extract_text._run_easyocr_player_name_for_context = counted_single
    after_latin = list(extract_text.PLAYER_NAME_EASYOCR_LANGS)
    before_latin = [part.strip() for part in args.before_latin.split(",") if part.strip()]

    def read(image, layout, latin, use_roster):
        phase["name"] = "after" if use_roster else "before"
        extract_text.PLAYER_NAME_EASYOCR_LANGS[:] = latin
        player_name_scripts.set_roster(roster if use_roster else None)
        started = time.perf_counter()
        names, confidences = extract_text.extract_player_names_batched(
            image, layout.player_name_coords, bundle_kind="2RaceScore", field_name="RacePlayerName")
        return names, confidences, time.perf_counter() - started

    # load the readers before timing, and measure what each one costs
    loads = {}
    rss = _rss_mb()
    started = time.perf_counter()
    extract_text._get_easyocr_reader(tuple(before_latin))
    loads["latin (before)"] = (round(time.perf_counter() - started, 2), None if rss is None else round(_rss_mb() - rss))
    rss = _rss_mb()
    started = time.perf_counter()
    extract_text._get_easyocr_reader(tuple(after_latin))
    loads["latin"] = (round(time.perf_counter() - started, 2), None if rss is None else round(_rss_mb() - rss))
    for script in roster.scripts:
        rss = _rss_mb()
        started = time.perf_counter()
        extract_text._get_player_name_script_reader(script)
        loads[script] = (round(time.perf_counter() - started, 2), None if rss is None else round(_rss_mb() - rss))

    stats: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    other_rows = changed_rows = 0
    changed: list[dict] = []
    records: list[dict] = []
    seconds = {"before": 0.0, "after": 0.0}
    for (frame, layout_id), cases in cases_by_frame.items():
        image = cv2.imread(frame, cv2.IMREAD_COLOR)
        if image is None:
            raise SystemExit(f"cannot read {frame}")
        layout = get_score_layout(layout_id)
        processed = process_image(image, score_layout_id=layout.layout_id)
        before, _, spent = read(processed, layout, before_latin, False)
        seconds["before"] += spent
        after, after_conf, spent = read(processed, layout, after_latin, True)
        seconds["after"] += spent
        for row, (old, new) in enumerate(zip(before, after)):
            record = {"frame": frame, "row": row, "before": old, "after": new, "confidence": after_conf[row]}
            case = cases.get(row)
            if case is None:
                other_rows += 1
                if old != new:
                    changed_rows += 1
                    changed.append(record)
                records.append(record)
                continue
            expected, script = case["expected"], case["script"]
            guest = _key(expected) not in roster_keys
            record.update(expected=expected, script=script, guest=guest)
            records.append(record)
            bucket = stats[script + (" (guest)" if guest else "")]
            bucket["cases"] += 1
            for label, text in (("before", old), ("after", new)):
                bucket[f"{label}_exact"] += _key(text) == _key(expected)
                match = roster.best_match(text)
                if match.score < player_name_scripts.ROSTER_MATCH_THRESHOLD:
                    bucket[f"{label}_unmatched"] += 1
                elif not guest and _key(match.name) in {_key(name) for name in roster.players[match.player]} \
                        and any(_key(name) == _key(expected) for name in roster.players[match.player]):
                    bucket[f"{label}_right"] += 1
                else:
                    bucket[f"{label}_wrong"] += 1
    player_name_scripts.clear_roster_override()

    print(f"frames {len(cases_by_frame)}; name reading before {seconds['before']:.1f}s, after {seconds['after']:.1f}s")
    print("reader load (s, RSS MB):", json.dumps(loads))
    print("readers created:", len(extract_text._EASYOCR_READERS), "| peak working set MB:", _rss_mb(peak=True))
    for label in ("before", "after"):
        print(f"recognition calls {label}:", json.dumps(dict(calls[label])))
    print("script fallback:", json.dumps(dict(extract_text.PLAYER_NAME_SCRIPT_STATS)))
    print(f"{'script':28} cases  exact b/a   right b/a   wrong b/a   none b/a")
    for script in sorted(stats):
        b = stats[script]
        print(f"{script:28} {b['cases']:5}  {b['before_exact']:4}/{b['after_exact']:<4}  {b['before_right']:4}/{b['after_right']:<4}"
              f"  {b['before_wrong']:4}/{b['after_wrong']:<4}  {b['before_unmatched']:4}/{b['after_unmatched']:<4}")
    print(f"other rows {other_rows}, readings changed {changed_rows}")
    for record in changed[:20]:
        print("  changed:", json.dumps(record, ensure_ascii=False))
    if args.json:
        args.json.write_text(json.dumps(records, ensure_ascii=False, indent=1), encoding="utf-8")
    wrong = sum(bucket["after_wrong"] - bucket["before_wrong"] for bucket in stats.values())
    return 1 if wrong > 0 or changed_rows else 0


if __name__ == "__main__":
    raise SystemExit(main())
