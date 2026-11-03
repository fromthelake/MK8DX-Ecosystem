from __future__ import annotations

import os
import queue
import subprocess
import threading
import tkinter as tk
import time
import webbrowser
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from typing import Any

from PIL import Image, ImageTk

from .broadcast_server import BroadcastServer
from .broadcast_state import BroadcastState
from .gui_events import LiveEvent
from .gui_virtual_pipeline import (
    GuiVirtualCaptureController,
    VideoPreflightResult,
    VirtualSourceConfig,
    con_error_preset_source_configs,
    load_initial_scan_templates,
    preflight_video_source,
    preset_source_configs,
    write_gui_preflight_report,
)
from .paths import DIAGNOSTICS_ROOT, LIVE_ROOT


PLAYBACK_SPEED_OPTIONS = {
    "Live pace (baseline analysis sampling)": 1.0,
    "Fast pace (baseline analysis sampling)": 5.0,
    "Full speed (baseline analysis sampling)": 0.0,
}
MIN_SOURCES = 1
MAX_SOURCES = 4


def playback_speed_value(label: str) -> float:
    return PLAYBACK_SPEED_OPTIONS.get(label, 1.0)


def playback_is_analysis_gated(label: str) -> bool:
    return False


def source_count_error(count: int) -> str:
    if count < MIN_SOURCES:
        return "Select at least 1 video feed before starting."
    if count > MAX_SOURCES:
        return f"Select no more than {MAX_SOURCES} video feeds."
    return ""


def sources_ready_to_start(sources: list[VirtualSourceConfig], preflight_statuses: dict[str, str]) -> bool:
    if source_count_error(len(sources)):
        return False
    return all(preflight_statuses.get(source.source_id) == "ready" for source in sources)


def _row_total_points(row: dict[str, Any]) -> int:
    for key in ("TotalPoints", "Total", "NewTotalRacePoint", "DetectedNewTotalScore"):
        value = row.get(key)
        if value in (None, ""):
            continue
        try:
            return int(value)
        except (TypeError, ValueError):
            continue
    return 0


def _row_value(row: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = row.get(key)
        if value not in (None, ""):
            return str(value)
    return ""


def format_standings_rows(rows: list[dict[str, Any]], race_sequence: int | None = None) -> list[tuple[str, str, str, str, str, str]]:
    sorted_rows = sorted(rows, key=_row_total_points, reverse=True)
    formatted: list[tuple[str, str, str, str, str, str]] = []
    for standing_position, row in enumerate(sorted_rows, start=1):
        total_points = str(_row_total_points(row))
        formatted.append(
            (
                str(standing_position),
                _row_value(row, "Character", "character_icon"),
                _row_value(row, "Player", "player_name"),
                _row_value(row, "RacePoints", "race_points"),
                _row_value(row, "NewTotalRacePoint", "new_total_race_points") or total_points,
                total_points,
            )
        )
    return formatted


def format_race_result_rows(rows: list[dict[str, Any]]) -> list[tuple[str, str, str, str]]:
    formatted: list[tuple[str, str, str, str]] = []
    for fallback_position, row in enumerate(rows, start=1):
        formatted.append(
            (
                _row_value(row, "Position", "position") or str(fallback_position),
                _row_value(row, "Character", "character_icon"),
                _row_value(row, "Player", "player_name"),
                _row_value(row, "RacePoints", "race_points"),
            )
        )
    return formatted


def format_feed_header(stream_label: str, video_name: str, race_name: str | None, found: int, completed: int) -> str:
    race = race_name or "waiting for detection"
    return f"{stream_label} | {video_name} | Race: {race} | Found: {found} | Completed: {completed}"


def format_analysis_progress(
    found: int,
    confirmed: int,
    running: int = 0,
    *,
    source_finished: bool = False,
    is_capture: bool = False,
    language: str = "en",
) -> str:
    """Human progress that includes work not yet submitted to an OCR worker.

    The executor's queue size is intentionally *not* the backlog: a detected
    race may still be pairing/selecting frames before a worker slot becomes
    available. ``found - confirmed - running`` therefore gives the operator the
    useful end-to-end waiting count instead of a deceptively empty job queue.
    """

    detected = max(0, int(found))
    done = min(detected, max(0, int(confirmed)))
    active = min(max(0, detected - done), max(0, int(running)))
    waiting = max(0, detected - done - active)
    dutch = language == "nl"
    if detected == 0:
        return "OCR & stand: wacht op de eerste race" if dutch else (
            "OCR & standings: waiting for the first race"
        )
    prefix = ""
    if source_finished:
        if is_capture:
            prefix = "Feed gestopt · " if dutch else "Feed stopped · "
        else:
            prefix = "Video ingelezen · " if dutch else "Video loaded · "
    if done >= detected:
        return prefix + (
            f"OCR & stand bij: {done}/{detected} races bevestigd"
            if dutch
            else f"OCR & standings up to date: {done}/{detected} races confirmed"
        )
    state = "OCR & stand loopt achter" if source_finished and dutch else (
        "OCR & standings catching up" if source_finished else (
            "OCR & stand" if dutch else "OCR & standings"
        )
    )
    labels = (
        f"{done}/{detected} bevestigd · {active} bezig · {waiting} wachtend"
        if dutch
        else f"{done}/{detected} confirmed · {active} active · {waiting} waiting"
    )
    return f"{prefix}{state}: {labels}"


def format_current_race_card(data: dict[str, Any], race_sequence: int | None) -> str:
    track_uk = str(data.get("track_name") or "").strip()
    track_nl = str(data.get("track_name_nl") or "").strip()
    cup_uk = str(data.get("cup_name") or "").strip()
    cup_nl = str(data.get("cup_name_nl") or "").strip()
    race = f"Round {race_sequence}" if race_sequence else "Round pending"
    if track_uk or cup_uk:
        return f"{race} | Track UK: {track_uk or '-'} | Track NL: {track_nl or '-'} | Cup UK: {cup_uk or '-'} | Cup NL: {cup_nl or '-'}"
    return f"{race} | waiting for track/cup OCR"


def resolve_display_stream_label(
    event_stream_label: str,
    event_source_id: str,
    sources: list[VirtualSourceConfig],
    known_stream_labels: set[str],
) -> str:
    if event_stream_label in known_stream_labels:
        return event_stream_label
    if event_source_id:
        source = next((item for item in sources if item.source_id == event_source_id), None)
        if source:
            return source.stream_label
    return event_stream_label


class Mk8dxLiveGui(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("MK8DX Live Video Processor")
        self.geometry("1680x980")
        self.sources: list[VirtualSourceConfig] = []
        self.controller: GuiVirtualCaptureController | None = None
        self.preview_images: dict[str, ImageTk.PhotoImage] = {}
        self.source_rows: dict[str, str] = {}
        self.status_vars: dict[str, tk.StringVar] = {}
        self.scoreboard_tables: dict[str, ttk.Treeview] = {}
        self.provisional_tables: dict[str, ttk.Treeview] = {}
        self.scoreboard_headers: dict[str, tk.StringVar] = {}
        self.current_race_cards: dict[str, tk.StringVar] = {}
        self.current_race_icon_labels: dict[str, tuple[ttk.Label, ttk.Label]] = {}
        self.current_race_images: dict[str, tuple[ImageTk.PhotoImage | None, ImageTk.PhotoImage | None]] = {}
        self.provisional_headers: dict[str, tk.StringVar] = {}
        self.races_found: dict[str, int] = {}
        self.races_completed: dict[str, int] = {}
        self.current_tracks: dict[str, str] = {}
        self.current_track_metadata: dict[str, dict[str, Any]] = {}
        self.event_rows: list[str] = []
        self.preflight_statuses: dict[str, str] = {}
        self.preflight_results: dict[str, VideoPreflightResult] = {}
        self.preflight_errors: dict[str, str] = {}
        self._preflight_queue: queue.Queue[tuple[int, str, VideoPreflightResult | None]] = queue.Queue()
        self._preflight_generation = 0
        self._preflight_thread: threading.Thread | None = None
        self._shutdown_queue: queue.Queue[tuple[str, str]] = queue.Queue()
        self._shutdown_thread: threading.Thread | None = None
        self._closing = False
        self.playback_speed = tk.StringVar(value="Live pace (analyze all frames)")
        self.record_virtual_feeds = tk.BooleanVar(value=False)
        self.analysis_status = tk.StringVar(value="Status: idle")
        self.broadcast_state = BroadcastState()
        self.broadcast_server = BroadcastServer()
        self.broadcast_url = tk.StringVar(value="Live scoreboard: starting...")
        self._start_broadcast_server()
        self._build_widgets()
        self.protocol("WM_DELETE_WINDOW", self._on_close)
        self.after(200, self._poll_events)

    def _start_broadcast_server(self) -> None:
        try:
            url = self.broadcast_server.start()
        except Exception as exc:  # pragma: no cover - defensive, GUI must still open
            self.broadcast_url.set(f"Live scoreboard: unavailable ({exc})")
            return
        self.broadcast_url.set(url)

    def _build_widgets(self) -> None:
        root = ttk.PanedWindow(self, orient=tk.HORIZONTAL)
        root.pack(fill=tk.BOTH, expand=True)

        left = ttk.Frame(root, padding=8)
        center = ttk.Frame(root, padding=8)
        right = ttk.Frame(root, padding=8)
        root.add(left, weight=1)
        root.add(center, weight=2)
        root.add(right, weight=4)

        ttk.Label(left, text="Sources").pack(anchor=tk.W)
        self.source_tree = ttk.Treeview(left, columns=("label", "file", "status"), show="headings", height=12)
        for column, text, width in [("label", "Stream", 90), ("file", "Video", 280), ("status", "Status", 90)]:
            self.source_tree.heading(column, text=text)
            self.source_tree.column(column, width=width)
        self.source_tree.pack(fill=tk.BOTH, expand=False, pady=(4, 8))

        buttons = ttk.Frame(left)
        buttons.pack(fill=tk.X)
        ttk.Button(buttons, text="Load Preset Fixture Videos", command=self.load_presets).pack(fill=tk.X, pady=2)
        ttk.Button(buttons, text="Load Con-Error Preset", command=self.load_con_error_preset).pack(fill=tk.X, pady=2)
        ttk.Button(buttons, text="Add Local Video File", command=self.add_video).pack(fill=tk.X, pady=2)
        ttk.Button(buttons, text="Remove Selected Source", command=self.remove_selected).pack(fill=tk.X, pady=2)
        ttk.Button(buttons, text="Clear All Sources", command=self.clear_sources).pack(fill=tk.X, pady=2)

        speed_frame = ttk.Frame(left)
        speed_frame.pack(fill=tk.X, pady=(12, 4))
        ttk.Label(speed_frame, text="Virtual capture mode").pack(anchor=tk.W)
        ttk.Combobox(speed_frame, textvariable=self.playback_speed, values=list(PLAYBACK_SPEED_OPTIONS), state="readonly").pack(fill=tk.X)
        ttk.Checkbutton(
            speed_frame,
            text="Record virtual feeds to MKV 1280x720 @ 12 Mbps",
            variable=self.record_virtual_feeds,
        ).pack(anchor=tk.W, pady=(6, 0))

        controls = ttk.Frame(left)
        controls.pack(fill=tk.X, pady=(12, 4))
        self.start_button = ttk.Button(controls, text="Start All", command=self.start_all)
        self.start_button.pack(fill=tk.X, pady=2)
        for label, command in [
            ("Pause All", self.pause_all),
            ("Resume All", self.resume_all),
            ("Stop All", self.stop_all),
            ("Reset Session", self.reset_session),
            ("Open Exports", self.open_exports),
            ("Open Recordings", lambda: self.open_path(LIVE_ROOT / "Live_Output" / "recordings")),
            ("Open Live_Output", lambda: self.open_path(LIVE_ROOT / "Live_Output")),
            ("Open Diagnostics", lambda: self.open_path(DIAGNOSTICS_ROOT)),
        ]:
            ttk.Button(controls, text=label, command=command).pack(fill=tk.X, pady=2)
        self._refresh_start_button_state()

        broadcast = ttk.LabelFrame(left, text="Live Scoreboard (OBS / browser)", padding=6)
        broadcast.pack(fill=tk.X, pady=(12, 4))
        ttk.Button(broadcast, text="Open Live Scoreboard", command=self.open_broadcast).pack(fill=tk.X, pady=2)
        url_entry = ttk.Entry(broadcast, textvariable=self.broadcast_url, state="readonly")
        url_entry.pack(fill=tk.X, pady=(4, 2))
        ttk.Label(
            broadcast,
            text="Add this URL as an OBS Browser source.",
            foreground="#666666",
        ).pack(anchor=tk.W)

        ttk.Label(center, text="Feed Preview").pack(anchor=tk.W)
        self.preview_frame = ttk.Frame(center)
        self.preview_frame.pack(fill=tk.BOTH, expand=True)
        self.preview_tiles: dict[str, dict[str, Any]] = {}

        ttk.Label(right, text="Live Status").pack(anchor=tk.W)
        ttk.Label(right, textvariable=self.analysis_status).pack(fill=tk.X, pady=(0, 4))
        self.event_list = tk.Listbox(right, height=8)
        self.event_list.pack(fill=tk.BOTH, expand=False, pady=(4, 8))

        ttk.Label(right, text="Per-Feed Standings").pack(anchor=tk.W)
        self.scoreboard_frame = ttk.Frame(right)
        self.scoreboard_frame.pack(fill=tk.BOTH, expand=True)

    def load_presets(self) -> None:
        self.sources = preset_source_configs()
        self.refresh_sources()
        self._start_preflight()

    def load_con_error_preset(self) -> None:
        # The 2025-01-03 Qualifier (connection-error / reset dataset).
        self.sources = con_error_preset_source_configs()
        missing = [str(s.video_path) for s in self.sources if not s.video_path.exists()]
        if missing:
            messagebox.showwarning("Con-Error Preset", "Videos not found:\n  " + "\n  ".join(missing))
        self.refresh_sources()
        self._start_preflight()

    def add_video(self) -> None:
        if len(self.sources) >= MAX_SOURCES:
            messagebox.showwarning("Sources", f"Maximum {MAX_SOURCES} video feeds are supported for now.")
            return
        path = filedialog.askopenfilename(filetypes=[("Video files", "*.mkv *.mp4 *.avi"), ("All files", "*.*")])
        if not path:
            return
        index = len(self.sources) + 1
        self.sources.append(
            VirtualSourceConfig(
                source_id=f"source_{index}",
                display_label=Path(path).name,
                stream_label=f"source_{index}",
                video_path=Path(path),
            )
        )
        self.refresh_sources()
        self._start_preflight()

    def remove_selected(self) -> None:
        selected = set(self.source_tree.selection())
        self.sources = [source for source in self.sources if source.source_id not in selected]
        self.refresh_sources()
        self._start_preflight()

    def clear_sources(self) -> None:
        self.sources = []
        self.refresh_sources()
        self._start_preflight()

    def refresh_sources(self) -> None:
        self.source_tree.delete(*self.source_tree.get_children())
        for source in self.sources:
            self.source_tree.insert("", tk.END, iid=source.source_id, values=(source.stream_label, source.video_path.name, self._source_status_text(source.source_id)))
        self._rebuild_preview_tiles()
        self._rebuild_scoreboard_panels()
        self._refresh_start_button_state()

    def _source_status_text(self, source_id: str) -> str:
        result = self.preflight_results.get(source_id)
        if result is not None:
            return result.status_text
        status = self.preflight_statuses.get(source_id, "not loaded")
        if status == "failed":
            return f"failed: {self.preflight_errors.get(source_id, 'unknown error')}"
        return status

    def _start_preflight(self) -> None:
        self._preflight_generation += 1
        generation = self._preflight_generation
        self.preflight_results.clear()
        self.preflight_errors.clear()
        self.preflight_statuses = {source.source_id: "checking" for source in self.sources}
        self._refresh_source_status_rows()
        self._refresh_start_button_state()
        if not self.sources:
            self.analysis_status.set("Status: idle")
            return
        self.analysis_status.set("Status: checking selected videos before start")
        sources = list(self.sources)

        def worker() -> None:
            results: list[VideoPreflightResult] = []
            try:
                templates = load_initial_scan_templates()
            except Exception as exc:
                for source in sources:
                    result = VideoPreflightResult(
                        source_id=source.source_id,
                        stream_label=source.stream_label,
                        video_path=source.video_path,
                        status="failed",
                        error=str(exc),
                    )
                    results.append(result)
                    self._preflight_queue.put((generation, "result", result))
                write_gui_preflight_report(f"gui_preflight_{time.strftime('%Y%m%d_%H%M%S')}", results)
                self._preflight_queue.put((generation, "done", None))
                return
            for index, source in enumerate(sources, start=1):
                result = preflight_video_source(source, len(sources), index, templates)
                results.append(result)
                self._preflight_queue.put((generation, "result", result))
            write_gui_preflight_report(f"gui_preflight_{time.strftime('%Y%m%d_%H%M%S')}", results)
            self._preflight_queue.put((generation, "done", None))

        self._preflight_thread = threading.Thread(target=worker, name="gui-video-preflight", daemon=True)
        self._preflight_thread.start()

    def _poll_preflight_updates(self) -> None:
        changed = False
        while True:
            try:
                generation, kind, result = self._preflight_queue.get_nowait()
            except queue.Empty:
                break
            if generation != self._preflight_generation:
                continue
            if kind == "result" and result is not None:
                self.preflight_results[result.source_id] = result
                self.preflight_statuses[result.source_id] = result.status
                if result.error:
                    self.preflight_errors[result.source_id] = result.error
                changed = True
            elif kind == "done":
                if self._all_sources_preflight_ready():
                    self.analysis_status.set("Status: selected videos ready")
                else:
                    self.analysis_status.set("Status: video check failed for one or more sources")
                changed = True
        if changed:
            self._refresh_source_status_rows()
            self._refresh_start_button_state()

    def _refresh_source_status_rows(self) -> None:
        for source in self.sources:
            if source.source_id not in self.source_tree.get_children():
                continue
            values = list(self.source_tree.item(source.source_id, "values"))
            if values:
                values[2] = self._source_status_text(source.source_id)
                self.source_tree.item(source.source_id, values=values)

    def _all_sources_preflight_ready(self) -> bool:
        return sources_ready_to_start(self.sources, self.preflight_statuses)

    def _refresh_start_button_state(self) -> None:
        button = getattr(self, "start_button", None)
        if button is None:
            return
        if self.controller and (self.controller.has_running_sources() or self.controller.has_resumable_sources()):
            button.configure(state=tk.NORMAL)
            return
        button.configure(state=tk.NORMAL if self._all_sources_preflight_ready() else tk.DISABLED)

    def start_all(self) -> None:
        if self.controller and self.controller.has_resumable_sources():
            self.controller.start_all(run_pipeline=False)
            self.analysis_status.set("Status: resumed")
            return
        if self.controller and self.controller.has_running_sources():
            self.analysis_status.set("Status: already running")
            return
        error = source_count_error(len(self.sources))
        if error:
            messagebox.showwarning("Sources", error)
            return
        if not self._all_sources_preflight_ready():
            messagebox.showwarning("Sources", "Video checks are still running or one source failed. Start is available after every selected source is ready.")
            self._refresh_start_button_state()
            return
        if not bool(self.record_virtual_feeds.get()):
            proceed = messagebox.askyesno(
                "MKV recording is off",
                "WARNING: MKV RECORDINGS ARE OFF!\n\nDo you really want to START?\n\n"
                "The video feeds will not be saved as MKV files.",
                default=messagebox.NO,
                icon=messagebox.WARNING,
            )
            if not proceed:
                self.analysis_status.set("Status: start cancelled — MKV recording remains off")
                return
        speed_label = self.playback_speed.get()
        prepared_contexts = {
            source_id: result.context
            for source_id, result in self.preflight_results.items()
            if result.ready and result.context is not None
        }
        self.controller = GuiVirtualCaptureController(
            self.sources,
            playback_speed=playback_speed_value(speed_label),
            gate_playback_until_analysis_ready=playback_is_analysis_gated(speed_label),
            prepared_contexts=prepared_contexts,
            record_virtual_feeds=bool(self.record_virtual_feeds.get()),
        )
        self.controller.start_all(run_pipeline=True)

    def pause_all(self) -> None:
        if self.controller:
            self.controller.pause_all()
            self.analysis_status.set("Status: paused with feeds")

    def resume_all(self) -> None:
        if self.controller:
            self.controller.resume_all()
            self.analysis_status.set("Status: resumed")

    def stop_all(self) -> None:
        if not self.controller:
            self.analysis_status.set("Status: stopped")
            return
        if self._shutdown_thread and self._shutdown_thread.is_alive():
            self.analysis_status.set("Status: stopping...")
            return

        controller = self.controller
        self.analysis_status.set("Status: stopping feeds and workers...")
        self._shutdown_thread = threading.Thread(
            target=self._stop_controller_worker,
            args=(controller,),
            name="gui-stop-all-worker",
            daemon=True,
        )
        self._shutdown_thread.start()

    def _stop_controller_worker(self, controller: GuiVirtualCaptureController) -> None:
        try:
            controller.stop_all()
            controller.wait(timeout=None)
        except Exception as exc:
            self._shutdown_queue.put(("error", str(exc)))
        else:
            self._shutdown_queue.put(("done", ""))

    def reset_session(self) -> None:
        self.stop_all()
        self.controller = None
        self.event_list.delete(0, tk.END)
        self.analysis_status.set("Status: idle")
        self.races_found.clear()
        self.races_completed.clear()
        self.current_tracks.clear()
        self.current_track_metadata.clear()
        for header in self.scoreboard_headers.values():
            header.set("Races found: 0 | Completed: 0")
        for card in self.current_race_cards.values():
            card.set(format_current_race_card({}, None))
        for cup_label, track_label in self.current_race_icon_labels.values():
            cup_label.configure(image="", text="[cup]")
            track_label.configure(image="", text="[track]")
        self.current_race_images.clear()
        for header in self.provisional_headers.values():
            header.set("Latest race: waiting for next race")
        for tree in self.scoreboard_tables.values():
            tree.delete(*tree.get_children())
        for tree in self.provisional_tables.values():
            tree.delete(*tree.get_children())
        self.broadcast_state.reset()
        self.broadcast_server.reset()

    def open_broadcast(self) -> None:
        if not self.broadcast_server.running:
            messagebox.showwarning("Live Scoreboard", "The live scoreboard server is not running.")
            return
        # Always open the rotating view (no ?feed= pin) so it cycles groups.
        webbrowser.open(self.broadcast_server.base_url)

    def _broadcast_title(self, display_stream: str) -> str:
        # Classic GUI has no tournament-title field; leave it blank so the overlay
        # shows "Waiting for feed…" rather than the video filename.
        return ""

    def _publish_broadcast(self, display_stream: str) -> None:
        if not self.broadcast_server.running:
            return
        board = self.broadcast_state.feed(display_stream, title=self._broadcast_title(display_stream))
        self.broadcast_server.publish(board.to_payload())

    def open_exports(self) -> None:
        self.open_path(LIVE_ROOT / "Live_Output" / "exports")

    def open_path(self, path: Path) -> None:
        os.startfile(str(path))  # noqa: S606 - local user-requested folder open.

    def _rebuild_preview_tiles(self) -> None:
        for child in self.preview_frame.winfo_children():
            child.destroy()
        self.preview_tiles.clear()
        for index, source in enumerate(self.sources):
            frame = ttk.LabelFrame(self.preview_frame, text=source.stream_label)
            row_index = index // 2
            column_index = index % 2
            frame.grid(row=row_index, column=column_index, sticky="nsew", padx=4, pady=4)
            image = ttk.Label(frame, text="No preview")
            image.pack(fill=tk.BOTH, expand=True)
            status = ttk.Label(frame, text=source.video_path.name)
            status.pack(fill=tk.X)
            self.preview_tiles[source.source_id] = {"image": image, "status": status}
        for column in range(2):
            self.preview_frame.columnconfigure(column, weight=1)
        for row in range(max(1, (len(self.sources) + 1) // 2)):
            self.preview_frame.rowconfigure(row, weight=1)

    def _rebuild_scoreboard_panels(self) -> None:
        for child in self.scoreboard_frame.winfo_children():
            child.destroy()
        self.scoreboard_tables.clear()
        self.provisional_tables.clear()
        self.scoreboard_headers.clear()
        self.current_race_cards.clear()
        self.current_race_icon_labels.clear()
        self.current_race_images.clear()
        self.provisional_headers.clear()
        for index, source in enumerate(self.sources):
            panel = ttk.LabelFrame(self.scoreboard_frame, text=source.stream_label)
            row_index = index // 2
            column_index = index % 2
            panel.grid(row=row_index, column=column_index, sticky="nsew", padx=4, pady=4)
            header = tk.StringVar(value=format_feed_header(source.stream_label, source.video_path.name, None, 0, 0))
            ttk.Label(panel, textvariable=header).pack(fill=tk.X, pady=(0, 4))
            race_card = tk.StringVar(value=format_current_race_card({}, None))
            race_frame = ttk.Frame(panel)
            race_frame.pack(fill=tk.X, pady=(0, 4))
            cup_icon = ttk.Label(race_frame, text="[cup]")
            cup_icon.pack(side=tk.LEFT, padx=(0, 6))
            track_icon = ttk.Label(race_frame, text="[track]")
            track_icon.pack(side=tk.LEFT, padx=(0, 6))
            ttk.Label(race_frame, textvariable=race_card).pack(side=tk.LEFT, fill=tk.X, expand=True)
            notebook = ttk.Notebook(panel)
            notebook.pack(fill=tk.BOTH, expand=True)
            provisional_frame = ttk.Frame(notebook)
            standings_frame = ttk.Frame(notebook)
            notebook.add(provisional_frame, text="Latest Race Outcome")
            notebook.add(standings_frame, text="Confirmed Standings")
            provisional_header = tk.StringVar(value="Latest race: waiting for next race")
            ttk.Label(provisional_frame, textvariable=provisional_header).pack(fill=tk.X, pady=(0, 4))
            provisional_tree = ttk.Treeview(
                provisional_frame,
                columns=("position", "character", "player", "race_points"),
                show="headings",
                height=8,
            )
            for column, text, width in [
                ("position", "Pos", 60),
                ("character", "Character", 130),
                ("player", "Driver", 170),
                ("race_points", "This race", 90),
            ]:
                provisional_tree.heading(column, text=text)
                provisional_tree.column(column, width=width, anchor=tk.W)
            provisional_tree.pack(fill=tk.BOTH, expand=True)
            tree = ttk.Treeview(
                standings_frame,
                columns=("standing", "character", "player", "race_points", "new_total", "total_points"),
                show="headings",
                height=12,
            )
            for column, text, width in [
                ("standing", "Pos", 60),
                ("character", "Character", 130),
                ("player", "Driver", 150),
                ("race_points", "This race", 90),
                ("new_total", "After race", 110),
                ("total_points", "Total", 90),
            ]:
                tree.heading(column, text=text)
                tree.column(column, width=width, anchor=tk.W)
            tree.pack(fill=tk.BOTH, expand=True)
            self.scoreboard_tables[source.stream_label] = tree
            self.provisional_tables[source.stream_label] = provisional_tree
            self.scoreboard_headers[source.stream_label] = header
            self.current_race_cards[source.stream_label] = race_card
            self.current_race_icon_labels[source.stream_label] = (cup_icon, track_icon)
            self.provisional_headers[source.stream_label] = provisional_header
            self.scoreboard_frame.rowconfigure(row_index, weight=1)
        for column in range(2):
            self.scoreboard_frame.columnconfigure(column, weight=1)

    def _poll_events(self) -> None:
        self._poll_shutdown_updates()
        self._poll_preflight_updates()
        if self.controller:
            events = self.controller.event_bus.poll(1000)
            events.sort(key=lambda item: item.event_type == "FRAME_DECODED")
            for event in events:
                self._handle_event(event)
            self._refresh_preview_frames()
        if self._closing:
            if self._shutdown_thread is None or not self._shutdown_thread.is_alive():
                self.destroy()
            else:
                self.after(200, self._poll_events)
            return
        self.after(200, self._poll_events)

    def _poll_shutdown_updates(self) -> None:
        while True:
            try:
                status, detail = self._shutdown_queue.get_nowait()
            except queue.Empty:
                break
            if status == "done":
                self.analysis_status.set("Status: stopped")
            else:
                self.analysis_status.set(f"Status: stop failed: {detail}")

    def _on_close(self) -> None:
        if self._closing:
            return
        self._closing = True
        try:
            self.broadcast_server.stop()
        except Exception:
            pass
        if self.controller:
            self.stop_all()
        else:
            self.destroy()

    def _display_stream_label(self, event: LiveEvent) -> str:
        return resolve_display_stream_label(event.stream_label, event.source_id, self.sources, set(self.scoreboard_tables))

    def _handle_event(self, event: LiveEvent) -> None:
        display_stream = self._display_stream_label(event)
        if event.event_type != "FRAME_DECODED":
            line = f"{event.event_type} {display_stream} race={event.race_sequence or ''} frame={event.frame_index or ''} {event.message}"
            self.event_list.insert(tk.END, line)
            self.event_list.yview_moveto(1.0)
        if event.source_id in self.source_tree.get_children():
            values = list(self.source_tree.item(event.source_id, "values"))
            if values:
                status = event.event_type.replace("SOURCE_", "").lower()
                if event.event_type in {"SOURCE_STARTED", "SOURCE_ENDED", "SOURCE_FAILED", "SOURCE_STOPPED"}:
                    values[2] = status
                    self.source_tree.item(event.source_id, values=values)
        if event.event_type == "SCOREBOARD_UPDATED":
            self.races_completed[display_stream] = self.races_completed.get(display_stream, 0) + 1
            row_count = len(event.data.get("rows", []))
            self.analysis_status.set(f"Standings updated for {display_stream} ({row_count} drivers)")
            self._update_scoreboard(event, display_stream)
            self.broadcast_state.feed(
                display_stream, title=self._broadcast_title(display_stream)
            ).apply_confirmed(event.data.get("rows", []), event.race_sequence)
            self._publish_broadcast(display_stream)
        elif event.event_type == "PROVISIONAL_RACE_RESULT_OCR_STARTED":
            header = self.provisional_headers.get(display_stream)
            if header is not None:
                header.set(f"Latest race: reading results for race {event.race_sequence or '-'}")
            self.analysis_status.set(f"Reading latest race results for {display_stream}")
        elif event.event_type == "PROVISIONAL_RACE_RESULT_UPDATED":
            self.analysis_status.set(f"Latest race results ready for {display_stream}")
            self._update_provisional_race_result(event, display_stream)
            self.broadcast_state.feed(
                display_stream, title=self._broadcast_title(display_stream)
            ).apply_provisional(event.data.get("rows", []), event.race_sequence)
            self._publish_broadcast(display_stream)
        elif event.event_type == "PROVISIONAL_RACE_RESULT_FAILED":
            header = self.provisional_headers.get(display_stream)
            if header is not None:
                header.set(f"Latest race {event.race_sequence or '-'}: couldn't read results")
            self.analysis_status.set(f"Couldn't read latest race for {display_stream}")
        elif event.event_type in {"CONSENSUS_QUEUED", "CONSENSUS_RUNNING", "CONSENSUS_COMPLETED", "CONSENSUS_VALIDATED"}:
            status_map = {
                "CONSENSUS_QUEUED": "queued",
                "CONSENSUS_RUNNING": "running",
                "CONSENSUS_COMPLETED": "completed" if event.data.get("returncode", 0) == 0 else "failed",
                "CONSENSUS_VALIDATED": (
                    "validated"
                    if (event.data.get("validation") or {}).get("final_validation_status") == "validated"
                    else "review"
                ),
            }
            status = status_map[event.event_type]
            detail = event.message
            if event.event_type == "CONSENSUS_COMPLETED" and event.data.get("duration_seconds") is not None:
                detail = f"confirmed standings {status} in {event.data.get('duration_seconds')}s"
            self.analysis_status.set(detail)
            payload = dict(event.data)
            payload["message"] = detail
            self.broadcast_state.feed(
                display_stream, title=self._broadcast_title(display_stream)
            ).apply_consensus_status(status, payload, event.race_sequence)
            self._publish_broadcast(display_stream)
        elif event.event_type == "RACE_ANCHOR_DETECTED":
            self.races_found[display_stream] = self.races_found.get(display_stream, 0) + 1
            self.analysis_status.set(f"New race detected for {display_stream}")
            self._refresh_scoreboard_header(display_stream)
            self.broadcast_state.feed(
                display_stream, title=self._broadcast_title(display_stream)
            ).apply_anchor()
            self._publish_broadcast(display_stream)
        elif event.event_type == "TRACK_NAME_DETECTED":
            track = str(event.data.get("track_name") or event.message or "").strip()
            cup = str(event.data.get("cup_name") or "").strip()
            if track and cup:
                self.current_tracks[display_stream] = f"{track} ({cup})"
            elif track:
                self.current_tracks[display_stream] = track
            else:
                self.current_tracks[display_stream] = f"Race {event.race_sequence or ''}".strip()
            self.current_track_metadata[display_stream] = dict(event.data)
            self._refresh_current_race_card(display_stream, event.race_sequence)
            self.analysis_status.set(f"Track identified for {display_stream}: {self.current_tracks[display_stream]}")
            self._refresh_scoreboard_header(display_stream)
            self.broadcast_state.feed(
                display_stream, title=self._broadcast_title(display_stream)
            ).apply_track(dict(event.data), event.race_sequence)
            self._publish_broadcast(display_stream)
        elif event.event_type == "TRACK_NAME_FRAME_RETAINED":
            self.analysis_status.set(f"Track frame captured for {display_stream}, reading name")
        elif event.event_type == "TRACK_NAME_OCR_STARTED":
            self.analysis_status.set(f"Reading track name for {display_stream}")
        elif event.event_type == "TRACK_NAME_OCR_FAILED":
            self.analysis_status.set(f"Couldn't read track name for {display_stream}: {event.message}")
        elif event.event_type == "ANALYSIS_STARTED":
            self.analysis_status.set("Analyzing race footage")
        elif event.event_type == "ANALYSIS_WAITING_TO_START_PLAYBACK":
            self.analysis_status.set("Preparing results before playback")
        elif event.event_type == "ANALYSIS_REPORTS_READY":
            self.analysis_status.set("Results ready, syncing to feed")
        elif event.event_type == "ANALYSIS_COMPLETED":
            self.analysis_status.set("Analysis complete")
        elif event.event_type == "SOURCE_FAILED":
            self.analysis_status.set("A video feed failed")
        elif event.event_type == "SOURCE_STARTED":
            self._publish_broadcast(display_stream)
        elif event.event_type == "RECORDING_STARTED":
            self.analysis_status.set(f"Recording: {display_stream} recording to MKV")
        elif event.event_type == "RECORDING_FAILED":
            self.analysis_status.set(f"Recording failed for {display_stream}: {event.message}")
        elif event.event_type == "RECORDING_COMPLETED":
            self.analysis_status.set(f"Recording completed for {display_stream}")

    def _refresh_preview_frames(self) -> None:
        if not self.controller:
            return
        for source in self.controller.sources:
            tile = self.preview_tiles.get(source.source_id)
            if not tile:
                continue
            frame = source.latest_preview_frame
            if frame is not None:
                image = ImageTk.PhotoImage(Image.fromarray(frame))
                self.preview_images[source.source_id] = image
                tile["image"].configure(image=image, text="")
            tile["status"].configure(text=f"{source.video_path.name} | {source.state} | {source.current_timestamp:0.1f}s | frame {source.current_frame_index}")

    def _update_scoreboard(self, event: LiveEvent, display_stream: str | None = None) -> None:
        stream_label = display_stream or self._display_stream_label(event)
        tree = self.scoreboard_tables.get(stream_label)
        if tree is None:
            self.analysis_status.set(f"Standings update had no matching feed for {stream_label}")
            return
        tree.delete(*tree.get_children())
        for row in format_standings_rows(event.data.get("rows", []), event.race_sequence):
            tree.insert("", tk.END, values=row)
        self._refresh_scoreboard_header(stream_label)

    def _update_provisional_race_result(self, event: LiveEvent, display_stream: str | None = None) -> None:
        stream_label = display_stream or self._display_stream_label(event)
        tree = self.provisional_tables.get(stream_label)
        if tree is None:
            self.analysis_status.set(f"Latest-race update had no matching feed for {stream_label}")
            return
        tree.delete(*tree.get_children())
        for row in format_race_result_rows(event.data.get("rows", [])):
            tree.insert("", tk.END, values=row)
        header = self.provisional_headers.get(stream_label)
        if header is not None:
            row_count = len(event.data.get("rows", []))
            header.set(f"Latest race {event.race_sequence or '-'}: {row_count} drivers · awaiting confirmation")
        self._refresh_current_race_card(stream_label, event.race_sequence)

    def _refresh_scoreboard_header(self, stream_label: str) -> None:
        header = self.scoreboard_headers.get(stream_label)
        if header is None:
            return
        source = next((item for item in self.sources if item.stream_label == stream_label), None)
        name = source.video_path.name if source else stream_label
        found = self.races_found.get(stream_label, 0)
        completed = self.races_completed.get(stream_label, 0)
        race_name = self.current_tracks.get(stream_label, "waiting for detection")
        header.set(format_feed_header(stream_label, name, race_name, found, completed))

    def _refresh_current_race_card(self, stream_label: str, race_sequence: int | None = None) -> None:
        card = self.current_race_cards.get(stream_label)
        if card is None:
            return
        metadata = self.current_track_metadata.get(stream_label, {})
        card.set(format_current_race_card(metadata, race_sequence))
        labels = self.current_race_icon_labels.get(stream_label)
        if labels is None:
            return
        cup_label, track_label = labels
        cup_image = self._load_icon(metadata.get("cup_icon_path"))
        track_image = self._load_icon(metadata.get("track_icon_path"))
        self.current_race_images[stream_label] = (cup_image, track_image)
        if cup_image is not None:
            cup_label.configure(image=cup_image, text="")
        else:
            cup_label.configure(image="", text="[cup]")
        if track_image is not None:
            track_label.configure(image=track_image, text="")
        else:
            track_label.configure(image="", text="[track]")

    def _load_icon(self, path_value: Any) -> ImageTk.PhotoImage | None:
        path = Path(str(path_value or ""))
        if not path.exists():
            return None
        try:
            with Image.open(path, formats=["PNG"]) as image:
                image.thumbnail((54, 54))
                return ImageTk.PhotoImage(image.copy())
        except Exception:
            return None


def main() -> int:
    app = Mk8dxLiveGui()
    app.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
