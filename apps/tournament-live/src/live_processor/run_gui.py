"""GUI launcher: prefers the PySide6 (Qt) console, falls back to Tkinter.

Usage::

    python -m live_processor.run_gui            # Qt if available, else Tkinter
    python -m live_processor.run_gui --classic-gui   # force the Tkinter console
"""

from __future__ import annotations

import sys
import time

_START_TIME = time.perf_counter()


def _progress(message: str) -> None:
    elapsed = time.perf_counter() - _START_TIME
    print(f"[GUI startup +{elapsed:05.1f}s] {message}", flush=True)
    try:  # monitoring (gated by MK8DX_MONITOR); never let it break startup
        from .monitoring import log_startup

        log_startup(message)
    except Exception:
        pass


def main() -> int:
    try:
        from .monitoring import reset_startup_log

        reset_startup_log()
    except Exception:
        pass
    _progress("Python launcher started.")
    if "--classic-gui" not in sys.argv:
        _progress("Loading Qt GUI modules: PySide6, broadcast server, and live pipeline adapters.")
        try:
            from .qt_app import main as qt_main
        except FileNotFoundError:
            print(
                "Tournament Live needs the private recognition data before its first launch.\n"
                "Open README-FIRST.txt and copy the documented assets into the package's "
                "private-assets folder, then start TournamentLive.cmd again.",
                file=sys.stderr,
                flush=True,
            )
            return 3
        except ImportError:
            print(
                "PySide6 not installed; falling back to the classic Tkinter GUI. "
                "Install the modern GUI with:  pip install PySide6",
                file=sys.stderr,
                flush=True,
            )
        else:
            _progress("Qt GUI modules loaded. Creating the main window.")
            return qt_main(progress=_progress)
    _progress("Loading classic Tkinter GUI modules.")
    from .gui_app import main as tk_main

    _progress("Starting classic Tkinter GUI.")
    return tk_main()


if __name__ == "__main__":
    raise SystemExit(main())
