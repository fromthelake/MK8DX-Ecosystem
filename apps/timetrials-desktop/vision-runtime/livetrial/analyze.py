"""LiveTrial CLI — analyze a recorded MK8DX video file.

Usage:
    ..\\.venv\\Scripts\\python.exe livetrial\\analyze.py "path\\to\\video.mp4"
        [--db PATH] [--out DIR] [--start N] [--end N] [--no-easyocr]

Assets come exclusively from the MK8DX Clean Assets folder (single
cross-project baseline); default is <repo>/MK8DX Clean Assets.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2

if hasattr(sys.stdout, "reconfigure"):  # ghost names contain ★ — survive cp1252 consoles
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parent))

from livetrial.report import write_reports
from livetrial.runner import RunProcessor

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = REPO_ROOT / "MK8DX Clean Assets"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("video")
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent / "runs" / "latest"))
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--end", type=int, default=None)
    ap.add_argument("--no-easyocr", action="store_true")
    ap.add_argument("--console-language", default="auto",
                    help="the Switch's system language (en, fr, de, es, it, nl, pt, ru, ja, zh-tw, zh-cn, ko), "
                         "or auto: detect it at the start of the session")
    args = ap.parse_args()

    out = Path(args.out)
    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        sys.exit(f"cannot open video: {args.video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    end = min(args.end or total, total)
    if args.start:
        cap.set(cv2.CAP_PROP_POS_FRAMES, args.start)

    proc = RunProcessor(Path(args.db), out, use_easyocr=not args.no_easyocr,
                        console_language=args.console_language)
    strides = {"MENU": 3, "ARMED": 1, "RACING": 1}
    fno = args.start
    while fno < end:
        ok, bgr = cap.read()
        if not ok:
            break
        # menu frames stride 3 for speed; result-screen sampling still runs
        # every frame because the pending reader gates on its own cadence
        if fno % strides[proc.state] == 0 or proc.pending is not None:
            proc.feed(bgr, int(fno / fps * 1000))
        fno += 1
        if fno % 1800 == 0:
            print(f"  frame {fno}/{end} ({fno / fps:.0f}s) state={proc.state} runs={len(proc.runs)}",
                  flush=True)
    cap.release()
    proc.finalize(int(fno / fps * 1000))

    write_reports(out, args.video, fps, fno - args.start, proc.runs, ghost_log=proc.ghost_log,
                  ghosts=proc.ghost_records.document(args.video), ghost_replays=proc.an.ghost_replays)
    print((out / "report.txt").read_text(encoding="utf-8"))
    print(f"report: {out / 'report.json'}")


if __name__ == "__main__":
    main()
