"""PySide6 (Qt) window for analysing recorded tournament videos afterwards.

A port of the MK8DX Video Result Extractor's Qt GUI (same owner) onto this product's processing: the window
plans and stages the recordings with ``tournament_processor.gui`` and runs ``vision_cli all`` as a child process.
Only imported when the window opens; ``python -m tournament_processor.gui`` falls back to the classic Tkinter
window when PySide6 is missing. Install it with the processor's ``gui`` extra.
"""
