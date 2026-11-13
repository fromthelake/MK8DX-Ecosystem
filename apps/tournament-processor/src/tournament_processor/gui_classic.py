"""The classic Tkinter analysis window: the fallback when PySide6 is missing, or with --classic-gui.

The Qt window (``tournament_processor.qt``) is the normal one. Both drive the same plan, staging and
``vision_cli all`` command from ``tournament_processor.gui``.
"""

from __future__ import annotations

import os
import queue
import sys
import time
from pathlib import Path
from typing import Sequence

from .gui import (
    VIDEO_SUFFIXES, AnalysisRun, PlanError, Texts, build_plan, check_environment, default_runtime_root,
    default_session_id, entry_is_folder, folder_videos, format_elapsed, open_folder,
)


# --------------------------------------------------------------------------- #
# Window                                                                       #
# --------------------------------------------------------------------------- #

# packages/design-tokens/tokens.json, dark theme.
COLORS = {
    "app": "#080C1C",       # navy.975 surface.app
    "raised": "#0E152B",    # navy.950 surface.raised
    "field": "#131B35",     # navy.925
    "line": "#34406A",      # navy.800
    "text": "#EEF1FA",      # slate.50
    "muted": "#A1AAC7",     # slate.200
    "accent": "#FF5A36",    # flare.400
    "accent_ink": "#1C0700",
    "accent_down": "#C8391A",
    "volt": "#C6F432",
    "volt_ink": "#141A00",
    "danger": "#FF7465",    # coral.dark
    "focus": "#8FB4FF",
}
LOG_LINE_LIMIT = 5000


class AnalysisWindow:
    def __init__(self, root, texts: Texts, entries: Sequence[Path] = (), runtime_root: Path | None = None,
                 session_id: str | None = None) -> None:
        import tkinter as tk
        from tkinter import ttk

        self.tk = tk
        self.ttk = ttk
        self.root = root
        self.t = texts
        try:
            self.scale = max(1.0, float(root.winfo_fpixels("1i")) / 96.0)
        except Exception:  # noqa: BLE001 - a missing DPI reading keeps 1:1 pixels
            self.scale = 1.0
        self.entries: list[Path] = []
        self.run: AnalysisRun | None = None
        self.events: queue.Queue[tuple[str, object]] = queue.Queue()
        self.started_at: float | None = None
        self.last_output: Path | None = None
        self.session_var = tk.StringVar(value=session_id or "")
        self.root_var = tk.StringVar(value=str(runtime_root) if runtime_root else "")
        self.status_var = tk.StringVar()
        self.session_edited = session_id is not None
        self.root_edited = runtime_root is not None
        self._build()
        self.add_entries(entries)
        self._log(self.t("log_intro"))
        if not os.environ.get("MK8DX_TOURNAMENT_ASSETS_ROOT"):
            self._log(self.t("log_assets_default"))
        self._refresh()
        self.root.after(100, self._poll)
        self.root.protocol("WM_DELETE_WINDOW", self._close)

    # -- layout ------------------------------------------------------------ #

    def px(self, value: int) -> int:
        """Pixels at this display's scale (the window is DPI aware on Windows)."""
        return int(round(value * self.scale))

    def _style(self) -> None:
        ttk = self.ttk
        style = ttk.Style(self.root)
        style.theme_use("clam")
        base = ("Segoe UI", 10) if sys.platform == "win32" else ("TkDefaultFont", 10)
        self.fonts = {
            "base": base, "small": (base[0], 9), "title": (base[0], 18, "bold"),
            "section": (base[0], 11, "bold"), "button": (base[0], 10, "bold"),
            "mono": ("Consolas", 9) if sys.platform == "win32" else ("TkFixedFont", 9),
        }
        c = COLORS
        style.configure(".", background=c["raised"], foreground=c["text"], fieldbackground=c["field"],
                        bordercolor=c["line"], lightcolor=c["raised"], darkcolor=c["raised"], font=base,
                        focuscolor=c["focus"], troughcolor=c["field"], selectbackground=c["line"],
                        selectforeground=c["text"], insertcolor=c["text"])
        style.configure("App.TFrame", background=c["app"])
        style.configure("Raised.TFrame", background=c["raised"])
        style.configure("TLabel", background=c["raised"], foreground=c["text"])
        style.configure("Muted.TLabel", background=c["raised"], foreground=c["muted"], font=self.fonts["small"])
        style.configure("Section.TLabel", background=c["raised"], foreground=c["text"], font=self.fonts["section"])
        style.configure("Status.TLabel", background=c["app"], foreground=c["muted"])
        style.configure("TEntry", fieldbackground=c["field"], foreground=c["text"], bordercolor=c["line"],
                        lightcolor=c["line"], darkcolor=c["line"], padding=5)
        style.map("TEntry", bordercolor=[("focus", c["focus"])], lightcolor=[("focus", c["focus"])])
        style.configure("TButton", background=c["field"], foreground=c["text"], bordercolor=c["line"],
                        lightcolor=c["field"], darkcolor=c["field"], padding=(12, 6), font=self.fonts["button"])
        style.map("TButton", background=[("disabled", c["raised"]), ("pressed", c["line"]), ("active", c["line"])],
                  foreground=[("disabled", c["line"])])
        style.configure("Accent.TButton", background=c["accent"], foreground=c["accent_ink"],
                        lightcolor=c["accent"], darkcolor=c["accent"], bordercolor=c["accent"], padding=(16, 7))
        style.map("Accent.TButton",
                  background=[("disabled", c["field"]), ("pressed", c["accent_down"]), ("active", "#FF7352")],
                  foreground=[("disabled", c["line"])])
        style.configure("Volt.TButton", background=c["volt"], foreground=c["volt_ink"], lightcolor=c["volt"],
                        darkcolor=c["volt"], bordercolor=c["volt"])
        style.map("Volt.TButton", background=[("disabled", c["field"]), ("active", "#D8FF4A")],
                  foreground=[("disabled", c["line"])], bordercolor=[("disabled", c["line"])],
                  lightcolor=[("disabled", c["field"])], darkcolor=[("disabled", c["field"])])
        style.map("Accent.TButton", bordercolor=[("disabled", c["line"])], lightcolor=[("disabled", c["field"])],
                  darkcolor=[("disabled", c["field"])])
        style.configure("Treeview", background=c["field"], fieldbackground=c["field"], foreground=c["text"],
                        bordercolor=c["line"], rowheight=self.px(26))
        style.map("Treeview", background=[("selected", c["line"])])
        style.configure("Treeview.Heading", background=c["raised"], foreground=c["muted"], bordercolor=c["line"],
                        lightcolor=c["raised"], darkcolor=c["raised"], font=self.fonts["small"], padding=(6, 4))
        style.configure("Horizontal.TProgressbar", background=c["accent"], troughcolor=c["field"],
                        bordercolor=c["line"], lightcolor=c["accent"], darkcolor=c["accent"])
        style.configure("Vertical.TScrollbar", background=c["line"], troughcolor=c["field"],
                        bordercolor=c["field"], lightcolor=c["line"], darkcolor=c["line"], arrowcolor=c["muted"])
        style.map("Vertical.TScrollbar", background=[("active", c["muted"])])

    def _card(self, parent, row: int, title: str):
        ttk = self.ttk
        card = ttk.Frame(parent, style="Raised.TFrame", padding=(16, 12))
        card.grid(row=row, column=0, sticky="nsew", pady=(0, 10))
        card.columnconfigure(0, weight=1)
        ttk.Label(card, text=title, style="Section.TLabel").grid(row=0, column=0, sticky="w")
        return card

    def _build(self) -> None:
        tk, ttk = self.tk, self.ttk
        self._style()
        c = COLORS
        self.root.title(self.t("title"))
        self.root.geometry(f"{self.px(1000)}x{self.px(860)}")
        self.root.configure(background=c["app"])
        self.root.minsize(self.px(860), self.px(700))
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(1, weight=1)

        header = tk.Frame(self.root, background=c["app"], padx=20, pady=14)
        header.grid(row=0, column=0, sticky="ew")
        header.columnconfigure(0, weight=1)
        tk.Label(header, text=self.t("title"), background=c["app"], foreground=c["text"],
                 font=self.fonts["title"], anchor="w").grid(row=0, column=0, sticky="w")
        tk.Label(header, text=self.t("intro"), background=c["app"], foreground=c["muted"], anchor="w",
                 justify="left", wraplength=self.px(900), font=self.fonts["base"]).grid(row=1, column=0, sticky="w",
                                                                                 pady=(4, 0))
        tk.Label(header, text=self.t("intro_live"), background=c["app"], foreground=c["volt"], anchor="w",
                 justify="left", wraplength=self.px(900), font=self.fonts["base"]).grid(row=2, column=0, sticky="w")
        tk.Frame(header, background=c["accent"], height=3).grid(row=3, column=0, sticky="ew", pady=(10, 0))

        body = ttk.Frame(self.root, style="App.TFrame", padding=(20, 0, 20, 8))
        body.grid(row=1, column=0, sticky="nsew")
        body.columnconfigure(0, weight=1)
        body.rowconfigure(0, weight=1)
        body.rowconfigure(3, weight=2)

        # 1 Recordings
        card = self._card(body, 0, self.t("step_recordings"))
        card.rowconfigure(2, weight=1)
        ttk.Label(card, text=self.t("recordings_hint"), style="Muted.TLabel").grid(row=1, column=0, sticky="w",
                                                                                   pady=(2, 6))
        table = ttk.Frame(card, style="Raised.TFrame")
        table.grid(row=2, column=0, sticky="nsew")
        table.columnconfigure(0, weight=1)
        table.rowconfigure(0, weight=1)
        self.tree = ttk.Treeview(table, columns=("kind", "location"), height=5, selectmode="extended")
        self.tree.heading("#0", text=self.t("col_name"), anchor="w")
        self.tree.heading("kind", text=self.t("col_kind"), anchor="w")
        self.tree.heading("location", text=self.t("col_location"), anchor="w")
        self.tree.column("#0", width=self.px(280), minwidth=self.px(160))
        self.tree.column("kind", width=self.px(150), minwidth=self.px(100), stretch=False)
        self.tree.column("location", width=self.px(320), minwidth=self.px(160))
        self.tree.grid(row=0, column=0, sticky="nsew")
        tree_scroll = ttk.Scrollbar(table, orient="vertical", command=self.tree.yview)
        tree_scroll.grid(row=0, column=1, sticky="ns")
        self.tree.configure(yscrollcommand=tree_scroll.set)
        self.tree.bind("<Delete>", lambda _event: self._remove())
        self.tree.bind("<<TreeviewSelect>>", lambda _event: self._refresh())
        buttons = ttk.Frame(card, style="Raised.TFrame")
        buttons.grid(row=3, column=0, sticky="w", pady=(8, 0))
        self.add_videos_button = ttk.Button(buttons, text=self.t("add_videos"), command=self._pick_videos)
        self.add_folder_button = ttk.Button(buttons, text=self.t("add_folder"), command=self._pick_folder)
        self.remove_button = ttk.Button(buttons, text=self.t("remove"), command=self._remove)
        self.clear_button = ttk.Button(buttons, text=self.t("clear"), command=self._clear)
        for column, button in enumerate((self.add_videos_button, self.add_folder_button, self.remove_button,
                                         self.clear_button)):
            button.grid(row=0, column=column, padx=(0, 8))

        # 2 Session
        card = self._card(body, 1, self.t("step_session"))
        form = ttk.Frame(card, style="Raised.TFrame")
        form.grid(row=1, column=0, sticky="ew", pady=(6, 0))
        form.columnconfigure(1, weight=1)
        ttk.Label(form, text=self.t("session_id")).grid(row=0, column=0, sticky="w", padx=(0, 12))
        self.session_entry = ttk.Entry(form, textvariable=self.session_var)
        self.session_entry.grid(row=0, column=1, sticky="ew")
        self.session_entry.bind("<Key>", lambda _event: setattr(self, "session_edited", True))
        ttk.Label(form, text=self.t("session_hint"), style="Muted.TLabel").grid(row=1, column=1, sticky="w",
                                                                                pady=(2, 6))
        ttk.Label(form, text=self.t("results_folder")).grid(row=2, column=0, sticky="w", padx=(0, 12))
        self.root_entry = ttk.Entry(form, textvariable=self.root_var)
        self.root_entry.grid(row=2, column=1, sticky="ew")
        self.root_entry.bind("<Key>", lambda _event: setattr(self, "root_edited", True))
        self.browse_button = ttk.Button(form, text=self.t("browse"), command=self._pick_results)
        self.browse_button.grid(row=2, column=2, padx=(8, 0))

        # 3 Run
        card = self._card(body, 2, self.t("step_run"))
        actions = ttk.Frame(card, style="Raised.TFrame")
        actions.grid(row=1, column=0, sticky="ew", pady=(8, 0))
        actions.columnconfigure(3, weight=1)
        self.start_button = ttk.Button(actions, text=self.t("start"), style="Accent.TButton", command=self._start)
        self.stop_button = ttk.Button(actions, text=self.t("stop"), command=self._stop)
        self.open_button = ttk.Button(actions, text=self.t("open_results"), style="Volt.TButton",
                                      command=self._open_results)
        self.start_button.grid(row=0, column=0, padx=(0, 8))
        self.stop_button.grid(row=0, column=1, padx=(0, 8))
        self.open_button.grid(row=0, column=2, padx=(0, 16))
        self.progress = ttk.Progressbar(actions, mode="determinate", length=self.px(200))
        self.progress.grid(row=0, column=3, sticky="ew")

        # Log
        log_card = self._card(body, 3, self.t("log"))
        log_card.rowconfigure(1, weight=1)
        log_frame = ttk.Frame(log_card, style="Raised.TFrame")
        log_frame.grid(row=1, column=0, sticky="nsew", pady=(6, 0))
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(0, weight=1)
        self.log = tk.Text(log_frame, height=9, wrap="word", background=c["app"], foreground=c["text"],
                           insertbackground=c["text"], relief="flat", borderwidth=0, highlightthickness=1,
                           highlightbackground=c["line"], highlightcolor=c["focus"], font=self.fonts["mono"],
                           padx=8, pady=6, state="disabled")
        self.log.grid(row=0, column=0, sticky="nsew")
        self.log.tag_configure("error", foreground=c["danger"])
        self.log.tag_configure("note", foreground=c["muted"])
        log_scroll = ttk.Scrollbar(log_frame, orient="vertical", command=self.log.yview)
        log_scroll.grid(row=0, column=1, sticky="ns")
        self.log.configure(yscrollcommand=log_scroll.set)

        status = tk.Frame(self.root, background=c["app"], padx=20)
        status.grid(row=2, column=0, sticky="ew", pady=(0, 12))
        ttk.Label(status, textvariable=self.status_var, style="Status.TLabel").grid(row=0, column=0, sticky="w")

    # -- state ------------------------------------------------------------- #

    @property
    def running(self) -> bool:
        return self.run is not None

    def add_entries(self, paths: Sequence[Path | str]) -> None:
        known = {str(path).lower() for path in self.entries}
        for raw in paths:
            path = Path(raw)
            if str(path).lower() in known:
                continue
            known.add(str(path).lower())
            self.entries.append(path)
            if entry_is_folder(path):
                count = len(folder_videos(path)) if path.is_dir() else 0
                kind = self.t("kind_folder_count", count=count) if count else self.t("kind_folder")
            else:
                kind = self.t("kind_video")
            self.tree.insert("", "end", iid=str(len(self.entries) - 1) + ":" + str(path), text=path.name,
                             values=(kind, str(path.parent)))
        self._defaults()
        self._ready_status()
        self._refresh()

    def _defaults(self) -> None:
        if not self.session_edited:
            self.session_var.set(default_session_id(self.entries))
        if not self.root_edited:
            default = default_runtime_root(self.entries)
            self.root_var.set(str(default) if default else "")

    def _refresh(self) -> None:
        running = self.running
        idle = "disabled" if running else "normal"
        for widget in (self.add_videos_button, self.add_folder_button, self.clear_button, self.browse_button,
                       self.session_entry, self.root_entry):
            widget.configure(state=idle)
        self.remove_button.configure(state="normal" if not running and self.tree.selection() else idle)
        self.start_button.configure(state="disabled" if running or not self.entries else "normal")
        self.stop_button.configure(state="normal" if running else "disabled")
        self.open_button.configure(state="normal" if self.last_output else "disabled")

    def _ready_status(self) -> None:
        if self.entries:
            self.status_var.set(self.t("status_ready_count", count=len(self.entries)))
        else:
            self.status_var.set(self.t("status_ready"))

    def _log(self, text: str, tag: str | None = None) -> None:
        self.log.configure(state="normal")
        self.log.insert("end", text + "\n", (tag,) if tag else ())
        lines = int(self.log.index("end-1c").split(".")[0])
        if lines > LOG_LINE_LIMIT:
            self.log.delete("1.0", f"{lines - LOG_LINE_LIMIT}.0")
        self.log.see("end")
        self.log.configure(state="disabled")

    # -- actions ----------------------------------------------------------- #

    def _pick_videos(self) -> None:
        from tkinter import filedialog

        patterns = " ".join(f"*{suffix}" for suffix in VIDEO_SUFFIXES)
        chosen = filedialog.askopenfilenames(parent=self.root, title=self.t("pick_videos"),
                                             filetypes=[(self.t("video_files"), patterns),
                                                        (self.t("all_files"), "*.*")])
        self.add_entries([Path(item) for item in chosen])

    def _pick_folder(self) -> None:
        from tkinter import filedialog

        chosen = filedialog.askdirectory(parent=self.root, title=self.t("pick_folder"), mustexist=True)
        if chosen:
            self.add_entries([Path(chosen)])

    def _pick_results(self) -> None:
        from tkinter import filedialog

        chosen = filedialog.askdirectory(parent=self.root, title=self.t("pick_results"))
        if chosen:
            self.root_var.set(str(Path(chosen)))
            self.root_edited = True

    def _remove(self) -> None:
        if self.running:
            return
        selected = set(self.tree.selection())
        keep = [path for index, path in enumerate(self.entries) if f"{index}:{path}" not in selected]
        self._reset_entries(keep)

    def _clear(self) -> None:
        if not self.running:
            self._reset_entries([])

    def _reset_entries(self, paths: list[Path]) -> None:
        self.entries = []
        self.tree.delete(*self.tree.get_children())
        self.add_entries(paths)

    def _error(self, message: str) -> None:
        from tkinter import messagebox

        self._log(message, "error")
        messagebox.showerror(self.t("error_title"), message, parent=self.root)

    def _start(self) -> None:
        if self.running:
            return
        try:
            check_environment()
            plan = build_plan(self.entries, self.session_var.get(), self.root_var.get())
        except PlanError as error:
            self._error(error.message(self.t))
            return
        self.session_var.set(plan.session_id)
        self.last_output = None
        self.started_at = None
        self.run = AnalysisRun(plan, self.events)
        self.progress.configure(mode="indeterminate")
        self.progress.start(12)
        self.run.start()
        self._refresh()

    def _stop(self) -> None:
        if self.run is not None:
            self._log(self.t("log_stopping"), "note")
            self.run.stop()

    def _open_results(self) -> None:
        if self.last_output:
            open_folder(self.last_output)

    def _close(self) -> None:
        if self.running:
            from tkinter import messagebox

            if not messagebox.askyesno(self.t("confirm_close_title"), self.t("confirm_close"), parent=self.root):
                return
            self.run.stop()
        self.root.destroy()

    def _poll(self) -> None:
        try:
            while True:
                kind, payload = self.events.get_nowait()
                self._handle(kind, payload)
        except queue.Empty:
            pass
        if self.running and self.started_at is not None:
            self.status_var.set(self.t("status_running", elapsed=format_elapsed(time.monotonic() - self.started_at)))
        self.root.after(250, self._poll)

    def _handle(self, kind: str, payload) -> None:
        if kind == "text":
            key, values = payload
            if key == "status_staging":
                self.status_var.set(self.t(key, **values))
            else:
                self._log(self.t(key, **values), "note")
        elif kind == "running":
            self.started_at = payload
        elif kind == "line":
            self._log(payload, "error" if payload.startswith(("Traceback", "Error", "--session-id")) else None)
        elif kind == "error":
            self._finish()
            self._error(payload.message(self.t))
            self.status_var.set(payload.message(self.t))
        elif kind == "finished":
            elapsed = format_elapsed(time.monotonic() - self.started_at) if self.started_at else "0:00"
            plan = self.run.plan if self.run else None
            self._finish()
            if payload is None:
                self.status_var.set(self.t("status_stopped"))
                self.last_output = plan.output_dir if plan and plan.output_dir.is_dir() else None
            elif payload == 0 and plan is not None:
                self.last_output = plan.output_dir
                self._log(self.t("log_results", path=plan.output_dir))
                self.status_var.set(self.t("status_done", elapsed=elapsed))
            else:
                self.status_var.set(self.t("status_failed", code=payload))
                self._log(self.t("status_failed", code=payload), "error")
            self._refresh()

    def _finish(self) -> None:
        self.progress.stop()
        self.progress.configure(mode="determinate", value=0)
        self.run = None
        self._refresh()


def _dpi_aware() -> None:
    if sys.platform != "win32":
        return
    try:
        import ctypes

        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except (AttributeError, OSError):
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except (AttributeError, OSError):
            pass


def run(texts: Texts, entries: Sequence[Path] = (), runtime_root: Path | None = None,
        session_id: str | None = None) -> int:
    try:
        import tkinter as tk
    except ImportError:
        print(texts("no_display"), file=sys.stderr)
        return 1
    _dpi_aware()
    try:
        root = tk.Tk()
    except tk.TclError:
        print(texts("no_display"), file=sys.stderr)
        return 1
    AnalysisWindow(root, texts, entries, runtime_root, session_id)
    root.mainloop()
    return 0
