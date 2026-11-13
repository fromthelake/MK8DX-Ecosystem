"""PySide6 (Qt) window for analysing recorded tournament videos afterwards.

A port of the MK8DX Live Video Processor post-analysis Qt GUI (live_processor/baseline_extractor/gui/, same
owner), presentation only. The window plans and stages the recordings with ``tournament_processor.gui`` and runs
the central ``vision_cli all`` route as a child process; it imports no recognition code.
Only imported when the window opens; ``python -m tournament_processor.gui`` falls back to the classic Tkinter
window when PySide6 is missing. Install it with the processor's ``gui`` extra.
"""
