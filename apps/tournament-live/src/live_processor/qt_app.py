"""PySide6 (Qt 6) operator console for the MK8DX live video processor.

This is the modern replacement for the Tkinter console in :mod:`gui_app`. It
reuses the same backend untouched — the virtual-capture controller, the video
preflight, the broadcast server/state, the event bus, and the pure formatting
helpers — and only re-implements the view layer with Qt widgets, a dark theme,
and the painted MK8 banner.

The Tkinter console remains available as a fallback (see ``run_gui``).
"""

from __future__ import annotations

import json
import os
import queue
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import replace
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

import numpy as np
from PySide6 import QtCore, QtGui, QtWidgets
from mk8dx_tournament_connected.client import (
    ConnectionContext,
    ConnectionContextStore,
    ConnectionTargetStore,
    ConnectedClient,
    ConnectedError,
    queued_upload_count,
    retry_queued_uploads,
    session_identity_key,
    score_workflow_step,
    sign_in,
)
from mk8dx_tournament_connected.session import SessionStore
from mk8dx_tournament_extraction.game_messages import AUTO, GAME_LOCALES, normalize_game_locale

from .product_languages import (
    LANGUAGES as PRODUCT_LANGUAGES, english_for, english_for_any_language, parse_language, translate, uses_catalog,
)
from .baseline_assets import IMPORTED_ASSETS_ROOT
from .baseline_export_metadata import character_index
from .broadcast_server import BroadcastServer
from .broadcast_state import BroadcastState
from .capture import CaptureDevice, discover_capture_audio_devices, discover_capture_devices
from .capture_names import CaptureCardNames
from .capture_card_source import CaptureCardSource
from .recording import discover_recoverable_recordings, recover_recording_run
from .recording_lifecycle import RecordingLifecycle, TERMINAL_RECORDING_STATES
from .groups import DEFAULT_GROUP, GROUP_NAMES, group_color, text_color_for
from .gui_app import (
    MAX_SOURCES,
    PLAYBACK_SPEED_OPTIONS,
    format_current_race_card,
    format_analysis_progress,
    format_feed_header,
    format_race_result_rows,
    format_standings_rows,
    playback_is_analysis_gated,
    playback_speed_value,
    resolve_display_stream_label,
    source_count_error,
    sources_ready_to_start,
)
from .gui_events import GuiEventBus, LiveEvent
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
from .config import load_live_config
from .frame_archive import archive_live_frames_folder
from .ocr_runtime import warm_up_ocr_engine
from .paths import DIAGNOSTICS_ROOT, LIVE_ROOT, PERFORMANCE_ROOT
from .performance import PerformanceTracker


def automatic_upload_retry_delay_seconds(failed_attempts: int) -> int:
    """Return a bounded retry delay after a failed automatic attempt."""

    schedule = (5, 15, 30, 60, 120, 300)
    return schedule[min(max(int(failed_attempts), 0), len(schedule) - 1)]
from .qt_theme import COLORS, BannerWidget, build_qss

PROVISIONAL_COLUMNS = ["Pos", "Character", "Driver", "This race"]
# "After race" is intentionally omitted: in confirmed standings it equals "Total".
STANDINGS_COLUMNS = ["Pos", "Character", "Driver", "This race", "Total"]


def refreshed_connection_context(
    previous: ConnectionContext,
    tournament: Any,
) -> tuple[ConnectionContext, bool]:
    """Adopt fresh Manager state without carrying assignments across score steps."""

    fresh = ConnectionContext.from_choice(tournament)
    previous_step = score_workflow_step(previous.workflow_step, previous.stage)
    fresh_step = score_workflow_step(fresh.workflow_step, fresh.stage)
    valid_group_ids = {str(group.get("groupId")) for group in fresh.groups}
    previous_phase = "final" if previous_step >= 7 else "qualifier"
    fresh_phase = "final" if fresh_step >= 7 else "qualifier"
    source_group_ids = (
        {
            source_label: group_id
            for source_label, group_id in previous.source_group_ids.items()
            if group_id in valid_group_ids
        }
        if previous_phase == fresh_phase
        else {}
    )
    refreshed = ConnectionContext(
        tournament_id=fresh.tournament_id,
        tournament_name=fresh.tournament_name,
        start_at_ms=fresh.start_at_ms,
        stage=fresh.stage,
        groups=fresh.groups,
        source_group_ids=source_group_ids,
        workflow_step=fresh.workflow_step,
        source_aliases=previous.source_aliases if previous_phase == fresh_phase else {},
        source_display_labels=previous.source_display_labels if previous_phase == fresh_phase else {},
    )
    previous_groups = {
        (str(group.get("groupId")), str(group.get("phase", "")))
        for group in previous.groups
    }
    fresh_groups = {
        (str(group.get("groupId")), str(group.get("phase", "")))
        for group in fresh.groups
    }
    return refreshed, previous_step != fresh_step or previous_groups != fresh_groups


def missing_connected_source_groups(
    context: ConnectionContext,
    stream_labels: tuple[str, ...],
) -> tuple[str, ...]:
    """List feeds without an advisory mapping in the current Tournament phase."""

    step = score_workflow_step(context.workflow_step, context.stage)
    phase = "final" if step >= 7 else "qualifier"
    active_groups = tuple(
        group
        for group in context.groups
        if str(group.get("phase", "")).strip().casefold() == phase
    ) or context.groups
    valid_group_ids = {
        str(group["groupId"])
        for group in active_groups
        if group.get("groupId") is not None
    }
    return tuple(
        stream_label
        for stream_label in stream_labels
        if str(context.source_group_ids.get(stream_label, "")) not in valid_group_ids
    )


def duplicate_connected_source_groups(
    context: ConnectionContext,
    stream_labels: tuple[str, ...],
) -> tuple[str, ...]:
    """List feeds whose current Tournament group is also assigned to another feed."""

    group_feeds: dict[str, list[str]] = {}
    for stream_label in stream_labels:
        group_id = str(context.source_group_ids.get(stream_label, "")).strip()
        if group_id:
            group_feeds.setdefault(group_id, []).append(stream_label)
    return tuple(
        stream_label
        for stream_label in stream_labels
        if any(
            stream_label in feeds and len(feeds) > 1
            for feeds in group_feeds.values()
        )
    )

_DUTCH_UI = {
    "MK8DX Tournament Live": "MK8DX Tournament Live",
    "Live race capture · scoreboard · OBS overlay": "Live race-opname · scorebord · OBS-overlay",
    "LOCAL / OFFLINE": "LOKAAL / OFFLINE",
    "Optional: sign in to upload this run as an independent evidence record. A Tournament choice is only a suggestion; recording and analysis stay local.": "Optioneel: meld je aan om deze run als zelfstandig bewijsrecord te uploaden. Een gekozen toernooi is alleen een voorstel; opname en analyse blijven lokaal.",
    "Connect to Tournament Manager": "Verbinden met Tournament Manager", "Change Tournament": "Toernooi wijzigen",
    "Work offline": "Offline werken", "Retry upload": "Upload opnieuw proberen",
    "Checking Tournament…": "Toernooi controleren…",
    "Language": "Taal",
    "Sources": "Bronnen", "Races per group": "Races per groep", "Highlight": "Markering",
    "Qualifier": "Kwalificatie", "End Round": "Eindronde", "Stream": "Stream",
    "Group": "Groep", "Video": "Video", "Status": "Status",
    "Load preset videos": "Voorbeeldvideo's laden", "Load con-error preset": "Verbindingsfoutvoorbeeld laden",
    "Add video file": "Videobestand toevoegen", "Add capture device": "Opnameapparaat toevoegen",
    "Remove selected": "Selectie verwijderen", "Clear all": "Alles wissen", "Capture": "Opname",
    "Name capture card": "Capturecard benoemen",
    "Select one capture card in the source list first.": "Selecteer eerst één capturecard in de bronnenlijst.",
    "Card label (for example CC Group 1). Empty restores the device name. Always verify the feed.": "Naam op de card (bijvoorbeeld CC Groep 1). Leeg herstelt de apparaatnaam. Controleer altijd het beeld.",
    "This device has no unique video ID; a remembered name cannot be assigned.": "Dit apparaat heeft geen uniek video-ID; een vaste naam kan niet worden opgeslagen.",
    "Use a single-line name of at most 40 characters.": "Gebruik één regel van maximaal 40 tekens.",
    "That name already belongs to another capture card.": "Die naam hoort al bij een andere capturecard.",
    "The capture-card name could not be saved.": "De naam van de capturecard kon niet worden opgeslagen.",
    "Saved audio is unavailable or ambiguous. Select and verify the audio for this card:": "De bewaarde audio is niet beschikbaar of niet eenduidig. Kies en controleer de audio voor deze card:",
    "Virtual capture mode": "Virtuele opnamemodus",
    "Record feeds to MKV 1280x720 @ 12 Mbps": "Feeds opnemen als MKV 1280x720 @ 12 Mbps",
    "MKV recording is off": "MKV-opnames staan uit",
    "MKV recording ready — starts with Start all": "MKV-opname gereed — begint bij Alles starten",
    "WARNING: MKV RECORDINGS ARE OFF!\n\nDo you really want to START?": "LET OP: MKV-OPNAMES STAAN UIT!\n\nWil je echt STARTEN?",
    "The video feeds will not be saved as MKV files.": "De videofeeds worden niet als MKV-bestanden opgeslagen.",
    "Start without MKV recording": "Start zonder MKV-opname",
    "Capture-card audio": "Audio van capturekaart",
    "No audio (video only)": "Geen audio (alleen video)",
    "DirectShow audio device for this feed:": "DirectShow-audioapparaat voor deze feed:",
    "Recording: off": "Opname: uit",
    "ARMING MKV RECORDINGS": "MKV-OPNAMEN STARTEN",
    "RECORDING ACTIVE": "OPNAME ACTIEF",
    "RECORDING ERROR": "OPNAMEFOUT",
    "RECORDINGS SAFELY SAVED": "OPNAMEN VEILIG OPGESLAGEN",
    "Recover previous recording": "Vorige opname herstellen",
    "Not now": "Niet nu",
    "Stopping capture…": "Opname stoppen…",
    "Closing MKV working parts…": "MKV-werkbestanden veilig sluiten…",
    "Completing final analysis…": "Laatste analyse voltooien…",
    "Finalizing local results…": "Lokale uitslagen afronden…",
    "Saving ecosystem data…": "Ecosysteemgegevens opslaan…",
    "Delivering results to Tournament Manager…": "Uitslagen naar Tournament Manager verzenden…",
    "Waiting for Tournament Manager delivery — recordings retained": "Wachten op levering aan Tournament Manager — opnamen zijn veilig bewaard",
    "Assembling recordings…": "Opnamen samenvoegen…",
    "Verifying recordings…": "Opnamen controleren…",
    "Recovering previous recordings…": "Vorige opnamen herstellen…",
    "Cancel": "Annuleren",
    "Start all": "Alles starten", "Stop all": "Alles stoppen", "Stopping…": "Stoppen…",
    "Pause all": "Alles pauzeren", "Resume all": "Alles hervatten", "Reset session": "Sessie herstellen",
    "Open exports": "Exports openen", "Open recordings": "Opnamen openen",
    "Open Live_Output": "Live_Output openen", "Open diagnostics": "Diagnostiek openen",
    "Clear Frames folder": "Frames-map opschonen", "Export current results": "Huidige uitslagen exporteren",
    "Live scoreboard (OBS / browser)": "Live scorebord (OBS / browser)",
    "Open live scoreboard": "Live scorebord openen",
    "Open fixed all-feeds scoreboard": "Vast scorebord met alle feeds openen",
    "Add this URL as an OBS Browser source.": "Voeg deze URL toe als OBS-browserbron.",
    "Feed preview": "Feedvoorbeeld", "Live status": "Livestatus", "Per-feed standings": "Stand per feed",
    "Live pace (baseline analysis sampling)": "Live tempo (standaard analysesampling)",
    "Fast pace (baseline analysis sampling)": "Snel tempo (standaard analysesampling)",
    "Full speed (baseline analysis sampling)": "Volledige snelheid (standaard analysesampling)",
    "Analysis engine: starting…": "Analyse-engine: starten…", "Status: idle": "Status: inactief",
    "idle": "inactief",
    "not loaded": "niet geladen", "checking": "controleren", "failed": "mislukt", "ready": "gereed",
    "running": "actief", "paused": "gepauzeerd", "stopped": "gestopt", "queued": "in wachtrij",
    "completed": "voltooid", "validated": "gecontroleerd", "review": "controleren",
    "waiting for live capture signal": "wachten op het live opnamesignaal",
    "checking selected videos before start": "geselecteerde video's controleren vóór de start",
    "selected videos ready": "geselecteerde video's zijn gereed",
    "video check failed for one or more sources": "videocontrole is mislukt voor een of meer bronnen",
    "previous run is still stopping — wait a moment": "de vorige sessie wordt nog gestopt — wacht even",
    "resumed": "hervat", "already running": "al actief", "paused with feeds": "gepauzeerd met actieve feeds",
    "stopping...": "stoppen...", "stopping feeds and workers...": "feeds en verwerking stoppen...",
    "stopping feeds before exit...": "feeds stoppen vóór afsluiten...",
    "analyzing race footage": "racebeelden analyseren", "analysis complete": "analyse voltooid",
    "a video feed failed": "een videofeed is uitgevallen",
    "exporting current workbook...": "huidige werkmap exporteren...",
    "Frames folder was already empty; clean folder is ready": "De Frames-map was al leeg en is klaar voor gebruik",
    "No Sources Selected or Loaded": "Geen bronnen geselecteerd of geladen",
    "Open folder": "Map openen", "Live scoreboard": "Live scorebord",
    "The scoreboard server is not running.": "De scorebordserver is niet actief.",
    "Start all": "Alles starten", "Start a session first. The workbook can be exported after at least one race is confirmed.": "Start eerst een sessie. De werkmap kan worden geëxporteerd zodra minstens één race is bevestigd.",
    "Stop the current session before clearing Live_Output\\Frames.": "Stop de huidige sessie voordat je Live_Output\\Frames opschoont.",
    "Add video": "Video toevoegen", "Video files (*.mkv *.mp4 *.avi);;All files (*.*)": "Videobestanden (*.mkv *.mp4 *.avi);;Alle bestanden (*.*)",
    "DirectShow video device:": "DirectShow-videoapparaat:", "Capture device": "Opnameapparaat",
    "Sources": "Bronnen", "Select at least 1 video feed before starting.": "Selecteer minstens één videofeed voordat je start.",
    "Video checks are still running or a source failed.": "De videocontrole is nog bezig of een bron is mislukt.",
    "No unassigned DirectShow video devices found.\nCheck the USB connection (each card should appear as its own camera device) and try again.": "Geen niet-toegewezen DirectShow-videoapparaten gevonden.\nControleer de USB-verbinding (elke kaart hoort als afzonderlijke camera te verschijnen) en probeer het opnieuw.",
    "OCR/analysis engine warm-up status (recording is independent).": "Opwarmstatus van de OCR-/analyse-engine (opnemen werkt onafhankelijk).",
    "Highlight the top 3 of each group (podium).": "Markeer de top 3 van elke groep (podium).",
    "Total races in each group/cup. Shown on the overlay as \"Race X of Y\". Leave at — to show only the current race number.": "Totaalaantal races per groep/beker. De overlay toont dit als \"Race X van Y\". Laat op — staan om alleen het huidige racenummer te tonen.",
    "Split each group's overall standings into advancement bands: top 4 = Kampioen, then the rest evenly into Talent and Wild.": "Verdeel de eindstand van elke groep in doorstroombanden: top 4 = Kampioen, daarna de rest gelijk over Talent en Wild.",
    "Pos": "Pos", "Character": "Coureur", "Driver": "Speler", "This race": "Deze race", "Total": "Totaal",
    "Latest race: waiting for next race": "Laatste race: wacht op de volgende race", "No preview": "Geen voorbeeld",
    "Latest race": "Laatste race", "Confirmed standings": "Bevestigde stand", "no signal": "geen signaal",
    "waiting for detection": "wachten op detectie",
    "monitoring on: CPU/GPU/RAM sampler started": "monitoring actief: CPU/GPU/RAM-meting gestart",
    "Console language": "Consoletaal", "Auto": "Automatisch",
    "The game language of this console (for English, French and Spanish also its region). Auto finds it from the race-end banner; a chosen language reads only that language.":
        "De speltaal van deze console (bij Engels, Frans en Spaans ook de regio). Automatisch herkent hem aan de eindbanner van de race; een gekozen taal leest alleen die taal.",
}
_ENGLISH_UI = {dutch: english for english, dutch in _DUTCH_UI.items()}

# Source table columns. The console language sits beside the group so both
# per-console choices stay visible in the narrow sources panel.
SOURCE_COLUMN_STREAM, SOURCE_COLUMN_GROUP, SOURCE_COLUMN_LANGUAGE, SOURCE_COLUMN_VIDEO, SOURCE_COLUMN_STATUS = range(5)


def _valid_qfont(family: str = "Segoe UI", point_size: int = 10, weight: int = QtGui.QFont.Normal) -> QtGui.QFont:
    font = QtGui.QFont(family, point_size, weight)
    if font.pointSize() <= 0:
        font.setPointSize(point_size)
    return font


def _ensure_valid_point_size(font: QtGui.QFont, fallback: int = 10) -> QtGui.QFont:
    if font.pointSize() <= 0:
        font.setPointSize(fallback)
    return font


def _place_window_on_visible_desktop(
    window: QtWidgets.QMainWindow,
    app: QtWidgets.QApplication,
    preferred_width: int = 1680,
    preferred_height: int = 980,
    margin: int = 48,
) -> None:
    """Size and center the window within the usable monitor area.

    Windows display scaling and taskbars can make a fixed-size window open with
    the title bar partly off-screen. Use Qt's available geometry so the resize,
    minimize, maximize, and close buttons stay reachable on first launch.
    """

    screen = window.screen() or app.primaryScreen()
    if screen is None:
        window.resize(preferred_width, preferred_height)
        return

    available = screen.availableGeometry()
    safe_width = max(960, available.width() - (margin * 2))
    safe_height = max(640, available.height() - (margin * 2))
    width = min(preferred_width, safe_width)
    height = min(preferred_height, safe_height)
    x = available.x() + max(margin, (available.width() - width) // 2)
    y = available.y() + max(margin, (available.height() - height) // 2)
    window.setGeometry(x, y, width, height)


def capture_device_display_labels(devices: list[CaptureDevice], names: CaptureCardNames | None = None) -> dict[str, str]:
    """Stable, globally unique display label per device, keyed by its unique
    (alternative) name. Identical friendly names get "#1..#n" by their position
    in the full discovery list — independent of which are already assigned."""
    duplicates = {d.name: sum(1 for x in devices if x.name == d.name) for d in devices}
    counters: dict[str, int] = {}
    labels: dict[str, str] = {}
    for device in devices:
        counters[device.name] = counters.get(device.name, 0) + 1
        label = (
            f"{device.name} #{counters[device.name]}"
            if duplicates[device.name] > 1
            else device.name
        )
        remembered = (
            names.audio_name(device.alternative_name) if device.media_type == 'audio'
            else names.get(device.alternative_name)
        ) if names is not None else ""
        labels[device.alternative_name or device.name] = f"{remembered} · {label}" if remembered else label
    return labels


def capture_device_identity(device: CaptureDevice) -> str:
    """Case-insensitive hardware key used for all duplicate checks."""
    return (device.alternative_name or device.name).strip().casefold()


def paired_capture_audio(
    video_device: CaptureDevice,
    audio_devices: list[CaptureDevice],
    names: CaptureCardNames,
) -> CaptureDevice | None:
    """Resolve only an exact or unique same-physical-device audio endpoint."""
    paired_id = names.paired_audio_id(video_device.alternative_name)
    matches = [
        audio for audio in audio_devices
        if paired_id and audio.alternative_name.strip().casefold() == paired_id
    ]
    if len(matches) != 1:
        paired_container = names.paired_audio_container_id(video_device.alternative_name)
        matches = [
            audio for audio in audio_devices
            if paired_container and audio.container_id.strip().casefold() == paired_container
        ]
    if len(matches) != 1:
        # A USB composite capture card exposes separate Camera and AudioEndpoint
        # interfaces under one PnP ContainerId. This remains the physical-card
        # identity when Windows rotates the AudioEndpoint GUID after a reboot.
        video_container = video_device.container_id.strip().casefold()
        matches = [
            audio for audio in audio_devices
            if video_container and audio.container_id.strip().casefold() == video_container
        ]
    return matches[0] if len(matches) == 1 else None


def _character_icon_path(character_value: str) -> Path | None:
    index = character_index(str(character_value or "").strip())
    if index is None or index < 0:
        fallback = IMPORTED_ASSETS_ROOT / "character" / "unknown.png"
        return fallback if fallback.exists() else None
    path = IMPORTED_ASSETS_ROOT / "character" / f"{index}.png"
    return path if path.exists() else None


class _FeedWidgets:
    """Holds the per-feed widgets so updates can target the right tab."""

    def __init__(self) -> None:
        self.header: QtWidgets.QLabel
        self.recording_health: QtWidgets.QLabel
        self.analysis_progress: QtWidgets.QLabel
        self.race_card: QtWidgets.QLabel
        self.cup_icon: QtWidgets.QLabel
        self.track_icon: QtWidgets.QLabel
        self.provisional_header: QtWidgets.QLabel
        self.provisional_table: QtWidgets.QTableWidget
        self.standings_table: QtWidgets.QTableWidget


class Mk8dxQtGui(QtWidgets.QMainWindow):
    # Emitted from the background OCR warm-up thread with the result dict; a
    # queued connection delivers it to the main thread to update the status dot.
    ocr_engine_ready = QtCore.Signal(object)

    def __init__(self, progress: Callable[[str], None] | None = None) -> None:
        super().__init__()
        self._startup_progress = progress or (lambda _message: None)
        self._settings = QtCore.QSettings("MK8DX", "TournamentLive")
        self._capture_names = CaptureCardNames(self._settings.value("capture_card_names", ""))
        self.language = parse_language(self._settings.value("language", "en")) or "en"
        self.setWindowTitle("MK8DX Tournament Live")
        self.resize(1680, 980)

        self.sources: list[VirtualSourceConfig] = []
        self.controller: GuiVirtualCaptureController | None = None
        # Live capture-card preview sessions, keyed by source_id. Opened the
        # moment a device is assigned (preview before Start All); Start All
        # promotes these same open sessions into the controller.
        self.capture_sessions: dict[str, CaptureCardSource] = {}
        # Created eagerly: GuiEventBus truncates the shared events log when
        # constructed, so building this lazily mid-run would wipe the run's log.
        self._capture_preview_bus = GuiEventBus("gui_capture_preview")
        self._resource_sampler: Any | None = None  # monitoring (MK8DX_MONITOR)

        self.preview_tiles: dict[str, dict[str, Any]] = {}
        self.feed_widgets: dict[str, _FeedWidgets] = {}
        self.feed_tab_index: dict[str, int] = {}
        self.source_groups: dict[str, str] = {}  # stream_label -> group alias
        # stream_label -> game locale ("auto" or EUen, USen, ...: the console's
        # language plus, for en/fr/es, its region). Capture cards remember theirs
        # by device id (the console stays plugged in).
        self.game_locales: dict[str, str] = {}
        # Y in the "Race X of Y" overlay counter; 0 / None hides the "of Y".
        self.races_total: int | None = None
        # Overlay highlight mode: "qualifier" (bands, default) or "end_round" (podium).
        self.highlight_mode = "qualifier"

        self.races_found: dict[str, int] = {}
        self.races_completed: dict[str, int] = {}
        self.analysis_race_states: dict[str, dict[int, str]] = {}
        self.finished_sources: set[str] = set()
        self.current_tracks: dict[str, str] = {}
        self.current_track_metadata: dict[str, dict[str, Any]] = {}

        self.preflight_statuses: dict[str, str] = {}
        self.preflight_results: dict[str, VideoPreflightResult] = {}
        self.preflight_errors: dict[str, str] = {}
        self.live_config = load_live_config()
        self._preflight_queue: queue.Queue[tuple[int, str, VideoPreflightResult | None]] = queue.Queue()
        self._preflight_generation = 0
        self._preflight_thread: threading.Thread | None = None

        self._shutdown_queue: queue.Queue[tuple[str, str]] = queue.Queue()
        self._shutdown_thread: threading.Thread | None = None
        self._closing = False
        self._run_clock_started: float | None = None
        self._run_clock_frozen: float | None = None
        self._recording_feed_health: dict[str, dict[str, object]] = {}
        self._recording_alarm_active = False
        self._stop_progress_stage = 0
        self._stop_progress_state = "hidden"
        self._stop_progress_found = 0
        self._stop_progress_confirmed = 0

        self._connection_queue: queue.Queue[tuple[str, object]] = queue.Queue()
        self._connection_thread: threading.Thread | None = None
        self._identity_thread: threading.Thread | None = None
        self._retry_upload_active = False
        self._automatic_upload_retry_active = False
        self._automatic_upload_retry_failures = 0
        self._automatic_upload_retry_due_at = time.monotonic() + 5
        try:
            self._account_identity = json.loads(str(self._settings.value("account_identity", "{}")))
        except ValueError:
            self._account_identity = {}
        if not isinstance(self._account_identity, dict):
            self._account_identity = {}
        self._connection_store = ConnectionContextStore()
        self.connection_context = self._connection_store.load()
        # A completed run stays mounted until the operator explicitly confirms
        # that a later Start may open a new run. Context refresh can require a
        # second click after new groups have been assigned; remember the first
        # conscious confirmation without mutating the retained run.
        self._new_run_confirmation_controller_id: str | None = None
        self._pending_new_run_context_refresh = False
        self._connected_live_run_id: str | None = None
        self._connected_live_record_id: str | None = None
        self._connected_live_started_at_ms: int | None = None
        self._connected_live_stop_requested = False
        self._connected_live_registration_failures = 0

        # OCR/analysis engine warm-up (recording + capture never wait on this).
        self._ocr_warmup_started = False
        self._ocr_warmup_thread: threading.Thread | None = None

        self._icon_cache: dict[str, QtGui.QIcon] = {}

        self.broadcast_state = BroadcastState()
        self.broadcast_server = BroadcastServer()

        self._startup_progress("Building Qt widgets and feed panels.")
        self._build_ui()
        self._apply_language()
        self._startup_progress("Starting local broadcast server for http://127.0.0.1:8800/.")
        self._start_broadcast_server()

        self._startup_progress("Starting GUI event timer.")
        self._timer = QtCore.QTimer(self)
        self._timer.setInterval(200)
        self._timer.timeout.connect(self._poll_events)
        self._timer.start()
        QtCore.QTimer.singleShot(0, self._offer_recording_recovery)
        QtCore.QTimer.singleShot(0, self._refresh_account_identity)
        QtCore.QTimer.singleShot(150, self._auto_add_remembered_capture_cards)
        self.ocr_engine_ready.connect(self._on_ocr_engine_ready)
        self._refresh_start_button_state()

    # ------------------------------------------------------------------ UI
    def _build_ui(self) -> None:
        central = QtWidgets.QWidget()
        self.setCentralWidget(central)
        outer = QtWidgets.QVBoxLayout(central)
        outer.setContentsMargins(10, 10, 10, 10)
        outer.setSpacing(10)

        self.banner = BannerWidget("MK8DX Tournament Live", "Live race capture · scoreboard · OBS overlay")
        outer.addWidget(self.banner)

        context_bar = QtWidgets.QFrame()
        context_bar.setObjectName("panel")
        context_row = QtWidgets.QHBoxLayout(context_bar)
        context_row.setContentsMargins(12, 7, 12, 7)
        self.connection_mode = QtWidgets.QLabel("LOCAL / OFFLINE")
        self.connection_mode.setTextFormat(QtCore.Qt.TextFormat.PlainText)
        self.connection_mode.setWordWrap(True)
        self.connection_mode.setObjectName("sectionTitle")
        context_row.addWidget(self.connection_mode)
        self.connection_detail = QtWidgets.QLabel(
            "Optional: sign in to upload this run as an independent evidence record. "
            "A Tournament choice is only a suggestion; recording and analysis stay local."
        )
        self.connection_detail.setWordWrap(True)
        context_row.addWidget(self.connection_detail, 1)
        self.connect_button = QtWidgets.QPushButton("Connect to Tournament Manager")
        self.connect_button.clicked.connect(self.connect_tournament)
        context_row.addWidget(self.connect_button)
        self.offline_button = QtWidgets.QPushButton("Work offline")
        self.offline_button.clicked.connect(self.work_offline)
        context_row.addWidget(self.offline_button)
        self.retry_upload_button = QtWidgets.QPushButton("Retry upload")
        self.retry_upload_button.clicked.connect(self.retry_upload)
        context_row.addWidget(self.retry_upload_button)
        context_row.addStretch(1)
        context_row.addWidget(QtWidgets.QLabel("Language"))
        self.language_combo = QtWidgets.QComboBox()
        for code, name, _ in PRODUCT_LANGUAGES:
            self.language_combo.addItem(name, code)
        self.language_combo.setCurrentIndex(max(0, self.language_combo.findData(self.language)))
        self.language_combo.currentIndexChanged.connect(self._change_language)
        context_row.addWidget(self.language_combo)
        outer.addWidget(context_bar)
        self.upload_status = QtWidgets.QLabel()
        self.upload_status.setWordWrap(True)
        self.upload_status.setTextFormat(QtCore.Qt.TextFormat.PlainText)
        outer.addWidget(self.upload_status)
        self._update_connection_bar()

        self.recording_alert = QtWidgets.QLabel(self._tr("MKV recording is off"))
        self.recording_alert.setWordWrap(True)
        self.recording_alert.setStyleSheet(
            "QLabel { background: #5b4a16; color: #ffe8a3; border: 1px solid #9f7f20; "
            "padding: 8px; font-weight: 800; }"
        )
        outer.addWidget(self.recording_alert)

        self.stop_progress_panel = QtWidgets.QFrame()
        self.stop_progress_panel.setObjectName("panel")
        stop_layout = QtWidgets.QHBoxLayout(self.stop_progress_panel)
        stop_layout.setContentsMargins(12, 8, 12, 8)
        stop_layout.setSpacing(12)
        self.stop_progress_text = QtWidgets.QLabel()
        self.stop_progress_text.setWordWrap(True)
        stop_layout.addWidget(self.stop_progress_text, 1)
        self.stop_progress_bar = QtWidgets.QProgressBar()
        self.stop_progress_bar.setRange(0, 5)
        self.stop_progress_bar.setValue(0)
        self.stop_progress_bar.setMinimumWidth(190)
        stop_layout.addWidget(self.stop_progress_bar)
        self.stop_progress_panel.hide()
        outer.addWidget(self.stop_progress_panel)

        splitter = QtWidgets.QSplitter(QtCore.Qt.Horizontal)
        splitter.setChildrenCollapsible(False)
        splitter.addWidget(self._build_left_panel())
        splitter.addWidget(self._build_center_panel())
        splitter.addWidget(self._build_right_panel())
        splitter.setStretchFactor(0, 0)
        splitter.setStretchFactor(1, 2)
        splitter.setStretchFactor(2, 3)
        splitter.setSizes([420, 560, 680])
        outer.addWidget(splitter, 1)

        status_row = QtWidgets.QHBoxLayout()
        status_row.setSpacing(8)
        # Analysis-engine readiness dot (red = warming, green = ready, amber =
        # CPU fallback / failed). Recording and screenshot capture do NOT wait
        # on this — it only reflects the OCR engine warm-up state.
        self.ocr_status_dot = QtWidgets.QLabel("●")
        self.ocr_status_dot.setObjectName("ocrDot")
        self.ocr_status_dot.setToolTip("OCR/analysis engine warm-up status (recording is independent).")
        self.ocr_status_text = QtWidgets.QLabel("Analysis engine: starting…")
        self._set_ocr_dot("#7f8c8d", "Analysis engine: starting…")
        status_row.addWidget(self.ocr_status_dot)
        status_row.addWidget(self.ocr_status_text)
        status_row.addStretch(1)
        # Run clock (hh:mm:ss), centered: counts up from Start all so the
        # operator sees at a glance that (and how long) the run is going.
        self.run_clock = QtWidgets.QLabel("00:00:00")
        self.run_clock.setObjectName("runClock")
        self.run_clock.setStyleSheet("font-size: 15px; font-weight: 700; color: #7f8c8d;")
        status_row.addWidget(self.run_clock)
        status_row.addStretch(1)
        self.status_line = QtWidgets.QLabel("Status: idle")
        self.status_line.setObjectName("statusLine")
        status_row.addWidget(self.status_line)
        outer.addLayout(status_row)
        # Stays visible (unlike the status line) while races still carry the
        # track placeholder: they are kept out of the results/feed until filled.
        self.track_attention_line = QtWidgets.QLabel("")
        self.track_attention_line.setObjectName("trackAttentionLine")
        self.track_attention_line.setWordWrap(True)
        self.track_attention_line.setStyleSheet("color: #f39c12; font-weight: 700;")
        self.track_attention_line.hide()
        outer.addWidget(self.track_attention_line)

    def _panel(self, title: str) -> tuple[QtWidgets.QFrame, QtWidgets.QVBoxLayout]:
        frame = QtWidgets.QFrame()
        frame.setObjectName("panel")
        layout = QtWidgets.QVBoxLayout(frame)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(8)
        label = QtWidgets.QLabel(title)
        label.setObjectName("sectionTitle")
        layout.addWidget(label)
        return frame, layout

    def _tr(self, value: str) -> str:
        # A widget still carries the text of the language switched away from (see english_for_any_language).
        english = (_ENGLISH_UI.get(value) or english_for(self.language, value)
                   or english_for_any_language(value) or value)
        if english.startswith("Analyse-engine: gereed"):
            english = english.replace("Analyse-engine: gereed", "Analysis engine: ready", 1)
        elif english.startswith("Analyse-engine: opwarmen"):
            english = english.replace("Analyse-engine: opwarmen", "Analysis engine: warming up", 1)
        elif english.startswith("Analyse-engine: nog niet voorbereid"):
            english = "Analysis engine: not pre-warmed (builds on first race)"
        if uses_catalog(self.language):
            # The other game languages read the shared catalogs (product_languages.py).
            return translate(self.language, english)
        if self.language != "nl":
            return english
        if english.startswith("Analysis engine: ready"):
            return english.replace("Analysis engine: ready", "Analyse-engine: gereed", 1)
        if english.startswith("Analysis engine: warming up"):
            return english.replace("Analysis engine: warming up", "Analyse-engine: opwarmen", 1)
        if english.startswith("Analysis engine: not pre-warmed"):
            return english.replace(
                "Analysis engine: not pre-warmed (builds on first race)",
                "Analyse-engine: nog niet voorbereid (wordt opgebouwd bij de eerste race)",
                1,
            )
        dynamic_patterns = (
            (r"^unavailable \((.+)\)$", lambda m: f"niet beschikbaar ({m.group(1)})"),
            (r"^Maximum (\d+) feeds supported\.$", lambda m: f"Maximaal {m.group(1)} feeds worden ondersteund."),
            (r"^Select no more than (\d+) video feeds\.$", lambda m: f"Selecteer maximaal {m.group(1)} videofeeds."),
            (r"^Videos not found:\n(.+)$", lambda m: f"Video's niet gevonden:\n{m.group(1)}"),
            (r"^Frames archived to (.+)$", lambda m: f"Frames gearchiveerd in {m.group(1)}"),
            (r"^stale Frames archived to (.+)$", lambda m: f"oude Frames gearchiveerd in {m.group(1)}"),
            (r"^Could not archive stale Frames: (.+)$", lambda m: f"Oude Frames konden niet worden gearchiveerd: {m.group(1)}"),
            (r"^export failed: (.+)$", lambda m: f"export mislukt: {m.group(1)}"),
            (r"^stop failed: (.+)$", lambda m: f"stoppen mislukt: {m.group(1)}"),
            (r"^standings updated for (.+) \((\d+) drivers\)$", lambda m: f"stand bijgewerkt voor {m.group(1)} ({m.group(2)} spelers)"),
            (r"^reading latest race results for (.+)$", lambda m: f"nieuwste race-uitslag lezen voor {m.group(1)}"),
            (r"^latest race results ready for (.+)$", lambda m: f"nieuwste race-uitslag gereed voor {m.group(1)}"),
            (r"^couldn't read latest race for (.+)$", lambda m: f"nieuwste race kon niet worden gelezen voor {m.group(1)}"),
            (r"^new race detected for (.+)$", lambda m: f"nieuwe race gedetecteerd voor {m.group(1)}"),
            (r"^track identified for (.+): (.+)$", lambda m: f"circuit herkend voor {m.group(1)}: {m.group(2)}"),
            (r"^reading track name for (.+)$", lambda m: f"circuitnaam lezen voor {m.group(1)}"),
            (r"^couldn't read track name for (.+): (.+)$", lambda m: f"circuitnaam kon niet worden gelezen voor {m.group(1)}: {m.group(2)}"),
            (r"^(.+) workbook updated: (.+)$", lambda m: f"{m.group(1)}-werkmap bijgewerkt: {m.group(2)}"),
            (r"^workbook export failed: (.+)$", lambda m: f"export van werkmap mislukt: {m.group(1)}"),
            (r"^feed started for (.+)$", lambda m: f"feed gestart voor {m.group(1)}"),
            (r"^capture signal lost on (.+) \(retrying\)$", lambda m: f"opnamesignaal weggevallen op {m.group(1)} (opnieuw proberen)"),
            (r"^capture signal restored on (.+)$", lambda m: f"opnamesignaal hersteld op {m.group(1)}"),
            (r"^black borders on (.+) — fix playback fullscreen/overscan$", lambda m: f"zwarte randen op {m.group(1)} — controleer volledig scherm/overscan"),
            (r"^(.+) fills the frame again$", lambda m: f"{m.group(1)} vult het beeld weer"),
            (r"^border calibration (.+): (.+)$", lambda m: f"randkalibratie {m.group(1)}: {m.group(2)}"),
            (r"^recording (.+) to MKV$", lambda m: f"{m.group(1)} opnemen als MKV"),
            (r"^recording completed for (.+)$", lambda m: f"opname voltooid voor {m.group(1)}"),
            (r"^RECORDING ACTIVE — (\d+)/(\d+) FEEDS$", lambda m: f"OPNAME ACTIEF — {m.group(1)}/{m.group(2)} FEEDS"),
            (r"^RECORDING ERROR — (\d+) FEED\(S\) HAVE INCOMPLETE VIDEO EVIDENCE\. LIVE VIEW AND ANALYSIS CONTINUE\.$", lambda m: f"OPNAMEFOUT — {m.group(1)} FEED(S) HEBBEN ONVOLLEDIG VIDEOBEWIJS. LIVEBEELD EN ANALYSE GAAN DOOR."),
            (r"^Recording active · part (\d+) · ([\d.]+) MiB · audio · ([\d.]+)h remaining · analysis drops (\d+)$", lambda m: f"Opname actief · deel {m.group(1)} · {m.group(2)} MiB · audio · {m.group(3)}u resterend · analyse-uitval {m.group(4)}"),
            (r"^Recording active · part (\d+) · ([\d.]+) MiB · video only · ([\d.]+)h remaining · analysis drops (\d+)$", lambda m: f"Opname actief · deel {m.group(1)} · {m.group(2)} MiB · alleen video · {m.group(3)}u resterend · analyse-uitval {m.group(4)}"),
            (r"^Recording error · part (\d+) retained · ([\d.]+) MiB$", lambda m: f"Opnamefout · deel {m.group(1)} bewaard · {m.group(2)} MiB"),
            (r"^Latest race: reading results for race (.+)$", lambda m: f"Laatste race: uitslag lezen voor race {m.group(1)}"),
            (r"^Latest race (.+): couldn't read results$", lambda m: f"Laatste race {m.group(1)}: uitslag kon niet worden gelezen"),
            (r"^(.+) \| (.+) \| Race: (.+) \| Found: (\d+) \| Completed: (\d+)$", lambda m: f"{m.group(1)} | {m.group(2)} | Race: {'wachten op detectie' if m.group(3) == 'waiting for detection' else m.group(3)} | Gevonden: {m.group(4)} | Voltooid: {m.group(5)}"),
            (r"^Latest race (.+): (\d+) drivers · awaiting confirmation$", lambda m: f"Laatste race {m.group(1)}: {m.group(2)} spelers · wacht op bevestiging"),
            (r"^OCR engine warmed\. Readers: (.+)\. Assets: (.+)\. Recording/capture are independent\.$", lambda m: f"OCR-engine is gereed. Lezers: {m.group(1)}. Assets: {m.group(2)}. Opnemen werkt onafhankelijk."),
            (r"^OCR warm-up incomplete: (.+)\. Recording/capture are unaffected; readers build on first use\.$", lambda m: f"OCR-opwarming onvolledig: {m.group(1)}. Opnemen blijft werken; lezers worden bij het eerste gebruik opgebouwd."),
            (r"^Round (.+) \| waiting for track/cup OCR$", lambda m: f"Ronde {m.group(1)} | wachten op herkenning van circuit/beker"),
            (r"^Round (.+) \| Track UK: (.+) \| Track NL: (.+) \| Cup UK: (.+) \| Cup NL: (.+)$", lambda m: f"Ronde {m.group(1)} | Circuit EN: {m.group(2)} | Circuit NL: {m.group(3)} | Beker EN: {m.group(4)} | Beker NL: {m.group(5)}"),
        )
        for pattern, formatter in dynamic_patterns:
            match = re.match(pattern, english)
            if match:
                return formatter(match)
        return _DUTCH_UI.get(english, english)

    def _change_language(self) -> None:
        self.language = str(self.language_combo.currentData())
        self._settings.setValue("language", self.language)
        self._apply_language()
        self.refresh_sources()

    def _apply_language(self) -> None:
        self.setWindowTitle(self._tr("MK8DX Tournament Live"))
        self.banner.set_copy(
            self._tr("MK8DX Tournament Live"),
            self._tr("Live race capture · scoreboard · OBS overlay"),
        )
        for widget_type in (QtWidgets.QLabel, QtWidgets.QPushButton, QtWidgets.QCheckBox):
            for widget in self.findChildren(widget_type):
                widget.setText(self._tr(widget.text()))
                if widget.toolTip():
                    widget.setToolTip(self._tr(widget.toolTip()))
        for group in self.findChildren(QtWidgets.QGroupBox):
            group.setTitle(self._tr(group.title()))
        for table in self.findChildren(QtWidgets.QTableWidget):
            for index in range(table.columnCount()):
                item = table.horizontalHeaderItem(index)
                if item is not None:
                    item.setText(self._tr(item.text()))
        for tabs in self.findChildren(QtWidgets.QTabWidget):
            for index in range(tabs.count()):
                tabs.setTabText(index, self._tr(tabs.tabText(index)))
        if hasattr(self, "speed_combo"):
            for index in range(self.speed_combo.count()):
                key = str(self.speed_combo.itemData(index) or self.speed_combo.itemText(index))
                self.speed_combo.setItemText(index, self._tr(key))
        self._update_connection_bar()
        if hasattr(self, "feed_widgets"):
            for stream_label in self.feed_widgets:
                self._refresh_analysis_progress(stream_label)
        if hasattr(self, "stop_progress_panel") and self._stop_progress_state != "hidden":
            self._render_stop_progress()

    # ---------------------------------------------------------- connection
    def _context_group_for_name(self, name: str) -> dict[str, Any] | None:
        groups = self._active_connection_groups()
        normalized = name.strip().casefold()
        return next((group for group in groups
                     if str(group.get("name", "")).strip().casefold() == normalized), None)

    def _active_connection_groups(self) -> tuple[dict[str, Any], ...]:
        context = self.connection_context
        if context is None:
            return ()
        step = score_workflow_step(context.workflow_step, context.stage)
        phase = "final" if step >= 7 else "qualifier"
        filtered = tuple(
            group for group in context.groups
            if str(group.get("phase", "")).strip().casefold() == phase
        )
        return filtered or context.groups

    def _infer_group_name(self, path: Path) -> str | None:
        names = ([str(group.get("name", "")) for group in self._active_connection_groups()]
                 if self.connection_context is not None else GROUP_NAMES)
        haystack = "".join(character.casefold() for character in path.stem if character.isalnum())
        matches = [name for name in names
                   if name and "".join(character.casefold() for character in name if character.isalnum()) in haystack]
        return matches[0] if len(matches) == 1 else None

    def _persist_source_group(self, stream_label: str, group_name: str) -> None:
        group = self._context_group_for_name(group_name)
        if group is None:
            return
        updated = self._connection_store.assign_source(stream_label, str(group["groupId"]))
        if updated is not None:
            self.connection_context = updated
            self._update_connection_bar()

    def _signed_in_label(self) -> str:
        token = SessionStore().load()
        identity = getattr(self, "_account_identity", {})
        name = identity.get("displayName")
        if token and identity.get("sessionKey") == session_identity_key(token) and isinstance(name, str) and name:
            return f"Aangemeld als {name}" if self.language == "nl" else f"Signed in as {name}"
        return "Aangemeld" if self.language == "nl" else "Signed in"

    def _refresh_account_identity(self) -> None:
        if self._identity_thread is not None and self._identity_thread.is_alive():
            return
        if SessionStore().load() is None:
            return

        def worker() -> None:
            try:
                self._connection_queue.put(("account_identity", ConnectedClient().account_identity()))
            except (ConnectedError, OSError, ValueError):
                # Name lookup must not block offline capture or open a sign-in
                # prompt. A same-session cached name remains useful offline.
                pass

        self._identity_thread = threading.Thread(target=worker, name="tournament-account-name", daemon=True)
        self._identity_thread.start()

    def _update_connection_bar(self) -> None:
        if not hasattr(self, "connection_mode"):
            return
        Mk8dxQtGui._update_retry_upload_button(self)
        context = self.connection_context
        if context is None:
            if SessionStore().load() is not None:
                self.connection_mode.setText(
                    f"{Mk8dxQtGui._signed_in_label(self)}\nGeen toernooi voorgesteld"
                    if self.language == "nl" else
                    f"{Mk8dxQtGui._signed_in_label(self)}\nNo Tournament suggested"
                )
                self.connection_detail.setText(
                    "De zelfstandige run gaat na STOP online. Je kunt nu of achteraf een toernooi voorstellen; de directeur beslist over de koppeling."
                    if self.language == "nl" else
                    "The independent run goes online after Stop. You can suggest a Tournament now or afterwards; the director decides the link."
                )
            else:
                self.connection_mode.setText(self._tr("LOCAL / OFFLINE"))
                self.connection_detail.setText(self._tr(
                    "Optional: sign in to upload this run as an independent evidence record. A Tournament choice is only a suggestion; recording and analysis stay local."
                ))
            if hasattr(self, "connect_button"):
                self.connect_button.setText(
                    ("Toernooi voorstellen" if self.language == "nl" else "Suggest Tournament")
                    if SessionStore().load() is not None else
                    self._tr("Connect to Tournament Manager")
                )
            return
        self.connection_mode.setText(Mk8dxQtGui._signed_in_label(self))
        assigned_ids = set(context.source_group_ids.values())
        active_groups = self._active_connection_groups()
        assigned = [group for group in active_groups if str(group.get("groupId")) in assigned_ids]
        groups = ", ".join(str(group.get("name")) for group in assigned) or (
            "kies of controleer een groep per bron" if self.language == "nl" else "choose or verify a group per source"
        )
        step = score_workflow_step(context.workflow_step, context.stage)
        score_label = (
            "Kwalificatiebewijs" if step < 7 and self.language == "nl" else
            "Finalebewijs" if step >= 7 and self.language == "nl" else
            "Qualifier evidence" if step < 7 else "Final evidence"
        )
        group_label = "Groep" if self.language == "nl" else "Group"
        step_label = "Stap" if self.language == "nl" else "Step"
        review_help = (
            "Controleer kaart → groep vóór START. Na race 1 kan een sterke naammatch View openen; scores tellen pas na Player-koppeling en groepscontrole na STOP."
            if self.language == "nl" else
            "Check card → group before Start. After race 1 a strong name match may open View; scores count only after Player matching and group review after Stop."
        )
        self.connection_detail.setText(
            f"{context.tournament_name}\n{step_label} {step} · {score_label} · {group_label}: {groups}\n{review_help}"
        )
        self.connect_button.setText(self._tr("Change Tournament"))

    def _update_retry_upload_button(self) -> None:
        if not hasattr(self, "retry_upload_button"):
            return
        pending = queued_upload_count()
        label = "Upload opnieuw proberen" if self.language == "nl" else "Retry upload"
        self.retry_upload_button.setText(f"{label} ({pending})" if pending else label)
        self.retry_upload_button.setToolTip(
            "Automatische verzending begint zodra de verbinding terug is. Gebruik deze knop om nu opnieuw te proberen."
            if self.language == "nl" else
            "Automatic delivery starts when connectivity returns. Use this button to retry now."
        )
        if hasattr(self, "upload_status"):
            if getattr(self, "_automatic_upload_retry_active", False):
                status = "Bewaarde uploads worden automatisch verstuurd…" if self.language == "nl" else "Sending retained uploads automatically…"
            elif getattr(self, "_retry_upload_active", False):
                status = "Bewaarde uploads worden verstuurd…" if self.language == "nl" else "Sending retained uploads…"
            elif pending:
                status = (
                    f"{pending} upload(s) wachten · lokaal bewaard. Automatisch herstel staat aan; handmatig opnieuw proberen kan ook."
                    if self.language == "nl" else
                    f"{pending} upload(s) waiting · saved locally. Automatic recovery is active; manual retry remains available."
                )
            else:
                status = (
                    "Geen uploads in wachtrij. Overnemen in het toernooi gebeurt apart op de website."
                    if self.language == "nl" else
                    "No uploads queued. Accepting results into the Tournament is a separate website action."
                )
            self.upload_status.setText(status)
            self.upload_status.setStyleSheet(f"color: {'#f0b429' if pending else COLORS['muted']}; padding: 2px 8px;")

    def connect_tournament(self) -> None:
        if self._connection_thread is not None and self._connection_thread.is_alive():
            return
        self.connect_button.setEnabled(False)
        self.connection_detail.setText(
            "Browsertoestemming openen…" if self.language == "nl" else "Opening browser authorization…"
        )

        def worker() -> None:
            try:
                session = SessionStore()
                if session.load() is None:
                    sign_in(session, on_authorization=lambda code, url:
                            self._connection_queue.put(("authorization", (code, url))))
                choices = ConnectedClient(session).tournaments()
                self._connection_queue.put(("choices", choices))
            except Exception as error:
                self._connection_queue.put(("error", error))

        self._connection_thread = threading.Thread(
            target=worker, name="tournament-connect", daemon=True
        )
        self._connection_thread.start()

    def _refresh_connected_context_before_new_run(self) -> None:
        """Refresh the selected Tournament without changing retained run data."""

        context = self.connection_context
        if context is None:
            self._start_fresh_run()
            return
        if self._connection_thread is not None and self._connection_thread.is_alive():
            return
        self._pending_new_run_context_refresh = True
        self.connect_button.setEnabled(False)
        self._set_status("checking current Tournament step before new run...")

        def worker() -> None:
            try:
                choices = ConnectedClient(SessionStore()).tournaments()
                selected = next(
                    (choice for choice in choices if choice.tournament_id == context.tournament_id),
                    None,
                )
                self._connection_queue.put(("new_run_context", selected))
            except Exception as error:
                self._connection_queue.put(("new_run_context_error", error))

        self._connection_thread = threading.Thread(
            target=worker,
            name="tournament-new-run-context-refresh",
            daemon=True,
        )
        self._connection_thread.start()

    def _adopt_refreshed_new_run_context(self, tournament: Any) -> bool:
        previous = self.connection_context
        if previous is None:
            return False
        refreshed, changed = refreshed_connection_context(previous, tournament)
        self.connection_context = refreshed
        self._connection_store.save(refreshed)
        active_by_id = {
            str(group.get("groupId")): str(group.get("name", ""))
            for group in self._active_connection_groups()
        }
        for source in self.sources:
            assigned_id = refreshed.source_group_ids.get(source.stream_label)
            assigned_name = active_by_id.get(str(assigned_id)) if assigned_id is not None else None
            if assigned_name:
                self.source_groups[source.stream_label] = assigned_name
            else:
                preferred = self._preferred_capture_group(source)
                if preferred and preferred in active_by_id.values():
                    self.source_groups[source.stream_label] = preferred
                    self._persist_source_group(source.stream_label, preferred)
                else:
                    self.source_groups.pop(source.stream_label, None)
        if changed and hasattr(self, "races_total_spin"):
            # The API does not own the planned number of races. Clear the old
            # overlay total instead of showing (for example) Step 5's 12 during
            # Step 9; the operator explicitly enters the new plan.
            self.races_total_spin.setValue(0)
            if score_workflow_step(refreshed.workflow_step, refreshed.stage) >= 7:
                self.end_round_btn.setChecked(True)
            else:
                self.qualifier_btn.setChecked(True)
        self._refresh_source_group_controls()
        self._update_connection_bar()
        return changed

    def _refresh_source_group_controls(self) -> None:
        """Refresh only routing controls while the completed-run dashboard stays visible."""

        for row, source in enumerate(self.sources):
            self.source_table.setCellWidget(row, SOURCE_COLUMN_GROUP, self._make_group_combo(source.stream_label))
        self._update_capture_routing_status()
        self._refresh_start_button_state()

    def _require_current_group_assignments_for_start(self) -> bool:
        context = self.connection_context
        if context is None:
            return True
        missing = missing_connected_source_groups(
            context,
            tuple(source.stream_label for source in self.sources),
        )
        duplicates = duplicate_connected_source_groups(
            context,
            tuple(source.stream_label for source in self.sources),
        )
        if missing or duplicates:
            details = []
            if missing:
                details.append(
                    ("Geen actuele groep: " if self.language == "nl" else "No current group: ")
                    + ", ".join(missing)
                )
            if duplicates:
                details.append(
                    ("Groep dubbel gebruikt: " if self.language == "nl" else "Group used twice: ")
                    + ", ".join(duplicates)
                )
            instruction = (
                "Koppel iedere feed aan precies één verschillende groep van de huidige stap voordat je START drukt."
                if self.language == "nl" else
                "Assign every feed to exactly one different group from the current step before pressing Start."
            )
            QtWidgets.QMessageBox.warning(
                self,
                "Tournament-koppeling" if self.language == "nl" else "Tournament connection",
                "\n".join((*details, "", instruction)),
            )
            self._set_status(
                "Tournament group routing incomplete; Start blocked"
            )
            return False
        return True

    def _choose_tournament(self, choices: tuple[object, ...]) -> None:
        if not choices:
            self._connection_store.clear()
            ConnectionTargetStore().clear()
            self.connection_context = None
            self._update_connection_bar()
            QtWidgets.QMessageBox.information(
                self,
                "Tournament connection",
                (
                    "Er is geen actief toernooi om voor te stellen. Je blijft aangemeld en de run wordt zonder toernooikoppeling geüpload."
                    if self.language == "nl" else
                    "No active Tournament is available to suggest. You remain signed in and the run uploads without a Tournament link."
                ),
            )
            return
        labels = []
        unassigned_label = (
            "Geen toernooi voorstellen · directeur koppelt later"
            if self.language == "nl" else
            "Do not suggest a Tournament · director links later"
        )
        labels.append(unassigned_label)
        for tournament in choices:
            when = ("date/time unknown" if tournament.start_at_ms is None else
                    datetime.fromtimestamp(tournament.start_at_ms / 1000).astimezone().strftime("%d %b %Y %H:%M"))
            step = score_workflow_step(tournament.workflow_step, tournament.stage)
            score_label = (
                "kwalificatiebewijs" if step < 7 and self.language == "nl" else
                "finalebewijs" if step >= 7 and self.language == "nl" else
                "qualifier evidence" if step < 7 else "final evidence"
            )
            step_label = "Stap" if self.language == "nl" else "Step"
            labels.append(f"{tournament.name} · {when} · {step_label} {step}: {score_label}")
        label, accepted = QtWidgets.QInputDialog.getItem(
            self,
            "Toernooi kiezen" if self.language == "nl" else "Choose Tournament",
            "Toernooi" if self.language == "nl" else "Tournament",
            labels,
            0,
            False,
        )
        if not accepted:
            self._update_connection_bar()
            return
        if label == unassigned_label:
            self._connection_store.clear()
            ConnectionTargetStore().clear()
            self.connection_context = None
            self._update_connection_bar()
            return
        tournament = choices[labels.index(label) - 1]
        self.connection_context = ConnectionContext.from_choice(tournament)
        self._connection_store.save(self.connection_context)
        ConnectionTargetStore().clear()
        for source in self.sources:
            inferred = self._preferred_capture_group(source) or self._infer_group_name(source.video_path)
            if inferred:
                self.source_groups[source.stream_label] = inferred
                self._persist_source_group(source.stream_label, inferred)
        self.refresh_sources()
        self._update_connection_bar()
        self._suggest_tournament_for_completed_run()

    def _suggest_tournament_for_completed_run(self) -> None:
        """Apply a newly chosen advisory Tournament to the retained completed run."""

        controller = self.controller
        if controller is None or controller.pipeline_state != "exported":
            return
        canonical = Path(str(
            (controller.final_export_result or {}).get("files", {}).get("canonical_json") or ""
        ))
        if not canonical.is_file():
            return
        self.connect_button.setEnabled(False)
        self.connection_detail.setText(
            "Voorstel bij afgeronde opname bijwerken…"
            if self.language == "nl" else
            "Updating the completed recording suggestion…"
        )

        def worker() -> None:
            try:
                from mk8dx_tournament_connected.client import connected_delivery_barrier

                result = connected_delivery_barrier(
                    canonical,
                    started_at_ms=controller.started_at_ms,
                    stopped_at_ms=controller.stopped_at_ms,
                    analysis_completed_at_ms=time.time_ns() // 1_000_000,
                )
                if not result.get("delivered"):
                    raise ConnectedError(
                        "The completed recording suggestion is retained for Retry upload."
                    )
                self._connection_queue.put(("completed_run_suggestion", result))
            except Exception as error:
                self._connection_queue.put(("error", error))

        self._connection_thread = threading.Thread(
            target=worker,
            name="tournament-completed-run-suggestion",
            daemon=True,
        )
        self._connection_thread.start()

    def work_offline(self) -> None:
        self._connection_store.clear()
        ConnectionTargetStore().clear()
        SessionStore().clear()
        self._account_identity = {}
        self._settings.remove("account_identity")
        self.connection_context = None
        self._update_connection_bar()
        self.refresh_sources()

    def retry_upload(self) -> None:
        if self._connection_thread is not None and self._connection_thread.is_alive():
            return
        self.retry_upload_button.setEnabled(False)
        self._retry_upload_active = True
        self._update_retry_upload_button()

        def worker() -> None:
            try:
                result = self._retry_saved_uploads(allow_unbound=True)
                self._connection_queue.put(("retry", result))
            except Exception as error:
                self._connection_queue.put(("error", error))

        self._connection_thread = threading.Thread(target=worker, name="tournament-retry", daemon=True)
        self._connection_thread.start()

    def _retry_saved_uploads(self, *, allow_unbound: bool) -> tuple[int, int]:
        """Retry and reconcile the retained recording lifecycle after receipt."""

        controller = self.controller
        recorder = controller.recorder if controller is not None else None
        recording_state = (
            recorder.manifest.state
            if recorder is not None and recorder.manifest is not None
            else None
        )
        pending_delivery_was_queued = bool(
            controller is not None
            and recording_state == RecordingLifecycle.COMPLETED_WITH_PENDING_DELIVERY
            and controller.has_pending_delivery_outbox()
        )
        result = retry_queued_uploads(
            enforce_account_binding=True,
            allow_unbound=allow_unbound,
        )
        if (
            result[1] == 0
            and controller is not None
            and recording_state == RecordingLifecycle.FINALIZATION_FAILED
        ):
            controller.retry_recording_finalization()
        elif (
            result[1] == 0
            and controller is not None
            and pending_delivery_was_queued
        ):
            controller.mark_pending_delivery_completed(uploaded=result[0])
        return result

    def _maybe_retry_upload_automatically(self) -> None:
        if (
            getattr(self, "_automatic_upload_retry_active", False)
            or getattr(self, "_retry_upload_active", False)
            or (self._connection_thread is not None and self._connection_thread.is_alive())
        ):
            return
        pending = queued_upload_count()
        if pending == 0:
            self._automatic_upload_retry_failures = 0
            self._automatic_upload_retry_due_at = time.monotonic() + 5
            return
        if SessionStore().load() is None or time.monotonic() < self._automatic_upload_retry_due_at:
            return

        self._automatic_upload_retry_active = True
        self.retry_upload_button.setEnabled(False)
        self._update_retry_upload_button()

        def worker() -> None:
            try:
                result = self._retry_saved_uploads(allow_unbound=False)
                self._connection_queue.put(("automatic_retry", result))
            except Exception as error:
                self._connection_queue.put(("automatic_retry_error", error))

        self._connection_thread = threading.Thread(
            target=worker,
            name="tournament-automatic-retry",
            daemon=True,
        )
        self._connection_thread.start()

    def _poll_connection_updates(self) -> None:
        while True:
            try:
                kind, payload = self._connection_queue.get_nowait()
            except queue.Empty:
                break
            if kind == "account_identity":
                token = SessionStore().load()
                if token and payload.get("sessionKey") == session_identity_key(token):
                    self._account_identity = payload
                    self._settings.setValue("account_identity", json.dumps(payload))
                    self._update_connection_bar()
                continue
            self.connect_button.setEnabled(True)
            self.retry_upload_button.setEnabled(True)
            if kind in {"retry", "error"}:
                self._retry_upload_active = False
                self._update_retry_upload_button()
            if kind in {"automatic_retry", "automatic_retry_error"}:
                self._automatic_upload_retry_active = False
                self._update_retry_upload_button()
            if kind == "choices":
                self._refresh_account_identity()
                try:
                    self._choose_tournament(payload)
                except Exception as error:
                    QtWidgets.QMessageBox.warning(self, "Tournament connection", str(error))
            elif kind == "new_run_context":
                self._pending_new_run_context_refresh = False
                if payload is None:
                    QtWidgets.QMessageBox.warning(
                        self,
                        "Tournament connection",
                        (
                            "Het geselecteerde toernooi is niet meer actief of beschikbaar. "
                            "De vorige run blijft bewaard. Kies een ander voorstel of kies Offline werken."
                            if self.language == "nl" else
                            "The selected Tournament is no longer active or available. The previous run remains retained. "
                            "Choose another suggestion or choose Work offline."
                        ),
                    )
                    self._set_status("new run cancelled; previous run retained")
                    continue
                changed = self._adopt_refreshed_new_run_context(payload)
                if changed:
                    QtWidgets.QMessageBox.information(
                        self,
                        "Tournament connection",
                        (
                            "De Tournament Manager-stap of groepsindeling is gewijzigd. De vorige run blijft bewaard. "
                            "Koppel iedere feed aan de nieuwe groep, controleer Races per groep en druk daarna opnieuw op START."
                            if self.language == "nl" else
                            "The Tournament Manager step or group layout changed. The previous run remains retained. "
                            "Assign every feed to its new group, verify Races per group, then press START again."
                        ),
                    )
                    self._set_status("Tournament context refreshed; confirm new groups before Start")
                else:
                    if self._require_current_group_assignments_for_start():
                        self._start_fresh_run()
            elif kind == "new_run_context_error":
                self._pending_new_run_context_refresh = False
                QtWidgets.QMessageBox.warning(
                    self,
                    "Tournament connection",
                    (
                        f"De actuele Tournament Manager-context kon niet worden gecontroleerd: {payload}\n\n"
                        "De vorige run blijft bewaard. Probeer opnieuw, kies Toernooi wijzigen of kies Offline werken."
                        if self.language == "nl" else
                        f"The current Tournament Manager context could not be checked: {payload}\n\n"
                        "The previous run remains retained. Retry, choose Change Tournament, or choose Work offline."
                    ),
                )
                self._set_status("new run cancelled; previous run retained")
            elif kind == "authorization":
                code, _url = payload
                self.connection_detail.setText(
                    (f"Browsercode: {code} · keur deze verbinding goed in de geopende browser."
                     if self.language == "nl" else
                     f"Browser code: {code} · approve this connection in the opened browser.")
                )
            elif kind == "retry":
                uploaded, retained = payload
                message = (f"{uploaded} uitslagen geüpload; {retained} lokaal bewaard."
                           if self.language == "nl" else
                           f"{uploaded} results uploaded; {retained} retained locally.")
                self.connection_detail.setText(message)
                self._update_retry_upload_button()
            elif kind == "automatic_retry":
                uploaded, retained = payload
                if retained:
                    self._automatic_upload_retry_failures += 1
                    delay = automatic_upload_retry_delay_seconds(self._automatic_upload_retry_failures)
                    self._automatic_upload_retry_due_at = time.monotonic() + delay
                else:
                    self._automatic_upload_retry_failures = 0
                    self._automatic_upload_retry_due_at = time.monotonic() + 5
                self.connection_detail.setText(
                    (
                        f"Automatisch herstel: {uploaded} uitslagen geüpload; {retained} lokaal bewaard."
                        if self.language == "nl" else
                        f"Automatic recovery: {uploaded} results uploaded; {retained} retained locally."
                    )
                )
                self._update_retry_upload_button()
            elif kind == "automatic_retry_error":
                self._automatic_upload_retry_failures += 1
                delay = automatic_upload_retry_delay_seconds(self._automatic_upload_retry_failures)
                self._automatic_upload_retry_due_at = time.monotonic() + delay
                self.connection_detail.setText(
                    (
                        f"Automatisch uploadherstel probeert het over {delay} seconden opnieuw; resultaten blijven lokaal bewaard."
                        if self.language == "nl" else
                        f"Automatic upload recovery will retry in {delay} seconds; results remain saved locally."
                    )
                )
                self._update_retry_upload_button()
            elif kind == "completed_run_suggestion":
                self._update_connection_bar()
                QtWidgets.QMessageBox.information(
                    self,
                    "Tournament connection",
                    (
                        "Het toernooivoorstel is toegevoegd aan de afgeronde opname. De directeur kiest en controleert de definitieve koppeling."
                        if self.language == "nl" else
                        "The Tournament suggestion was added to the completed recording. The director chooses and reviews the final link."
                    ),
                )
            elif kind == "live_registered":
                run_id, receipt = payload
                if run_id == self._connected_live_run_id:
                    self._connected_live_record_id = receipt.record_id
                    self._connected_live_registration_failures = 0
                    self.connection_detail.setText(
                        "Live-run geregistreerd; race 1 controleert de groepsmatch. Scores wachten op de eindcontrole na STOP."
                        if self.language == "nl" else
                        "Live run registered; race 1 checks the group match. Scores wait for final review after Stop."
                    )
                    if self._connected_live_stop_requested:
                        self._mark_connected_live_stopping(run_id)
            elif kind == "live_registration_error":
                run_id, error = payload
                if run_id == self._connected_live_run_id:
                    self._connected_live_registration_failures += 1
                    delay = automatic_upload_retry_delay_seconds(self._connected_live_registration_failures)
                    self.connection_detail.setText(
                        f"Live-registratie probeert het over {delay}s opnieuw; lokaal opnemen blijft actief: {error}"
                        if self.language == "nl" else
                        f"Live registration retries in {delay}s; local capture remains active: {error}"
                    )
                    QtCore.QTimer.singleShot(delay * 1000, lambda expected=run_id: self._retry_connected_live_registration(expected))
            elif kind == "live_stopping":
                run_id = payload
                if run_id == self._connected_live_run_id:
                    self.connection_detail.setText(
                        "Stop online gemeld; laatste upload en eindcontrole volgen."
                        if self.language == "nl" else
                        "Stop reported online; final upload and review follow."
                    )
            elif kind == "live_stopping_error":
                run_id, error = payload
                if run_id == self._connected_live_run_id:
                    self.connection_detail.setText(
                        f"Stopstatus kon nog niet online worden gemeld; lokale resultaten blijven bewaard: {error}"
                        if self.language == "nl" else
                        f"Stop status is not online yet; local results remain retained: {error}"
                    )
            else:
                QtWidgets.QMessageBox.warning(self, "Tournament connection", str(payload))
                self._update_connection_bar()

    def _build_left_panel(self) -> QtWidgets.QWidget:
        scroll = QtWidgets.QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QtWidgets.QFrame.NoFrame)
        frame, layout = self._panel("Sources")

        title_group = QtWidgets.QGroupBox("Races per group")
        tg = QtWidgets.QVBoxLayout(title_group)
        races_row = QtWidgets.QHBoxLayout()
        races_row.addWidget(QtWidgets.QLabel("Races per group"))
        self.races_total_spin = QtWidgets.QSpinBox()
        self.races_total_spin.setRange(0, 48)
        self.races_total_spin.setValue(0)
        # 0 means "unset" — the overlay then shows just "Race X" with no "of Y".
        self.races_total_spin.setSpecialValueText("—")
        self.races_total_spin.setToolTip(
            "Total races in each group/cup. Shown on the overlay as \"Race X of Y\". "
            "Leave at — to show only the current race number."
        )
        self.races_total_spin.valueChanged.connect(self._on_races_total_changed)
        races_row.addWidget(self.races_total_spin)
        races_row.addStretch(1)
        tg.addLayout(races_row)
        layout.addWidget(title_group)

        # Overlay highlight: a segmented toggle (the active one turns green).
        # Qualifier (default) splits each group's standings into Kampioen/Talent/
        # Wild advancement bands; End Round highlights the podium top 3.
        highlight_group = QtWidgets.QGroupBox("Highlight")
        hg = QtWidgets.QHBoxLayout(highlight_group)
        self.highlight_buttons = QtWidgets.QButtonGroup(self)
        self.highlight_buttons.setExclusive(True)
        self.qualifier_btn = QtWidgets.QPushButton("Qualifier")
        self.qualifier_btn.setObjectName("segment")
        self.qualifier_btn.setCheckable(True)
        self.qualifier_btn.setChecked(True)
        self.qualifier_btn.setMinimumWidth(112)
        self.qualifier_btn.setToolTip(
            "Split each group's overall standings into advancement bands: "
            "top 4 = Kampioen, then the rest evenly into Talent and Wild."
        )
        self.end_round_btn = QtWidgets.QPushButton("End Round")
        self.end_round_btn.setObjectName("segment")
        self.end_round_btn.setCheckable(True)
        self.end_round_btn.setMinimumWidth(96)
        self.end_round_btn.setToolTip("Highlight the top 3 of each group (podium).")
        self.highlight_buttons.addButton(self.qualifier_btn)
        self.highlight_buttons.addButton(self.end_round_btn)
        self.qualifier_btn.toggled.connect(self._on_highlight_mode_changed)
        hg.addWidget(self.qualifier_btn)
        hg.addWidget(self.end_round_btn)
        hg.addStretch(1)
        layout.addWidget(highlight_group)

        self.capture_routing_status = QtWidgets.QLabel(
            "Recognized capture cards will be connected automatically. Check the card-to-group routes below."
        )
        self.capture_routing_status.setWordWrap(True)
        self.capture_routing_status.setTextFormat(QtCore.Qt.TextFormat.PlainText)
        self.capture_routing_status.setStyleSheet(
            "QLabel { background: #172554; color: #dbeafe; border: 1px solid #2563eb; "
            "border-radius: 6px; padding: 7px; font-weight: 650; }"
        )
        layout.addWidget(self.capture_routing_status)

        self.source_table = QtWidgets.QTableWidget(0, 5)
        self.source_table.setHorizontalHeaderLabels(["Stream", "Group", "Console language", "Video", "Status"])
        self.source_table.verticalHeader().setVisible(False)
        self.source_table.setEditTriggers(QtWidgets.QAbstractItemView.NoEditTriggers)
        self.source_table.setWordWrap(False)
        self.source_table.setSelectionBehavior(QtWidgets.QAbstractItemView.SelectRows)
        self.source_table.horizontalHeader().setSectionResizeMode(SOURCE_COLUMN_VIDEO, QtWidgets.QHeaderView.Stretch)
        self.source_table.setColumnWidth(SOURCE_COLUMN_GROUP, 110)
        self.source_table.setColumnWidth(SOURCE_COLUMN_LANGUAGE, 120)
        self.source_table.setMinimumHeight(180)
        layout.addWidget(self.source_table)

        src_btns = QtWidgets.QGridLayout()
        for i, (text, slot) in enumerate(
            [
                ("Load preset videos", self.load_presets),
                ("Load con-error preset", self.load_con_error_preset),
                ("Add video file", self.add_video),
                ("Add capture device", self.add_capture_device),
                ("Remove selected", self.remove_selected),
                ("Clear all", self.clear_sources),
                ("Name capture card", self.rename_capture_card),
            ]
        ):
            btn = QtWidgets.QPushButton(text)
            btn.clicked.connect(slot)
            src_btns.addWidget(btn, i // 2, i % 2)
        layout.addLayout(src_btns)

        mode_group = QtWidgets.QGroupBox("Capture")
        mg = QtWidgets.QVBoxLayout(mode_group)
        mg.addWidget(QtWidgets.QLabel("Virtual capture mode"))
        self.speed_combo = QtWidgets.QComboBox()
        for label in PLAYBACK_SPEED_OPTIONS:
            self.speed_combo.addItem(self._tr(label), label)
        mg.addWidget(self.speed_combo)
        self.record_check = QtWidgets.QCheckBox("Record feeds to MKV 1280x720 @ 12 Mbps")
        self.record_check.toggled.connect(self._refresh_recording_choice_banner)
        mg.addWidget(self.record_check)
        layout.addWidget(mode_group)
        self._refresh_recording_choice_banner()

        # Start all <-> Stop all toggle: red while a run is active so the
        # operator always sees the session state at a glance.
        self.start_button = QtWidgets.QPushButton("Start all")
        self.start_button.setObjectName("primary")
        self.start_button.clicked.connect(self.toggle_start_stop)
        layout.addWidget(self.start_button)

        ctrl_btns = QtWidgets.QGridLayout()
        self.pause_btn = QtWidgets.QPushButton("Pause all")
        self.pause_btn.clicked.connect(self.pause_all)
        self.resume_btn = QtWidgets.QPushButton("Resume all")
        self.resume_btn.clicked.connect(self.resume_all)
        self.reset_btn = QtWidgets.QPushButton("Reset session")
        self.reset_btn.clicked.connect(self.reset_session)
        ctrl_btns.addWidget(self.pause_btn, 0, 0)
        ctrl_btns.addWidget(self.resume_btn, 0, 1)
        ctrl_btns.addWidget(self.reset_btn, 1, 0, 1, 2)
        layout.addLayout(ctrl_btns)

        open_btns = QtWidgets.QGridLayout()
        for i, (text, path) in enumerate(
            [
                ("Open exports", LIVE_ROOT / "Live_Output" / "exports"),
                ("Open recordings", LIVE_ROOT / "Live_Output" / "recordings"),
                ("Open Live_Output", LIVE_ROOT / "Live_Output"),
                ("Open diagnostics", DIAGNOSTICS_ROOT),
            ]
        ):
            btn = QtWidgets.QPushButton(text)
            btn.clicked.connect(lambda _=False, p=path: self.open_path(p))
            open_btns.addWidget(btn, i // 2, i % 2)
        layout.addLayout(open_btns)

        clear_frames_btn = QtWidgets.QPushButton("Clear Frames folder")
        clear_frames_btn.clicked.connect(self.clear_frames_folder)
        layout.addWidget(clear_frames_btn)

        export_current_btn = QtWidgets.QPushButton("Export current results")
        export_current_btn.clicked.connect(self.export_current_results)
        layout.addWidget(export_current_btn)

        bc_group = QtWidgets.QGroupBox("Live scoreboard (OBS / browser)")
        bg = QtWidgets.QVBoxLayout(bc_group)
        open_bc = QtWidgets.QPushButton("Open live scoreboard")
        open_bc.clicked.connect(self.open_broadcast)
        bg.addWidget(open_bc)
        open_grid = QtWidgets.QPushButton("Open fixed all-feeds scoreboard")
        open_grid.clicked.connect(self.open_broadcast_grid)
        bg.addWidget(open_grid)
        self.broadcast_url_edit = QtWidgets.QLineEdit("starting…")
        self.broadcast_url_edit.setReadOnly(True)
        bg.addWidget(self.broadcast_url_edit)
        hint = QtWidgets.QLabel("Add this URL as an OBS Browser source.")
        hint.setObjectName("hint")
        bg.addWidget(hint)
        layout.addWidget(bc_group)

        layout.addStretch(1)
        scroll.setWidget(frame)
        scroll.setMinimumWidth(360)
        return scroll

    def _build_center_panel(self) -> QtWidgets.QWidget:
        frame, layout = self._panel("Feed preview")
        self.preview_container = QtWidgets.QWidget()
        self.preview_grid = QtWidgets.QGridLayout(self.preview_container)
        self.preview_grid.setContentsMargins(0, 0, 0, 0)
        self.preview_grid.setSpacing(8)
        layout.addWidget(self.preview_container, 1)
        return frame

    def _build_right_panel(self) -> QtWidgets.QWidget:
        frame, layout = self._panel("Live status")
        self.event_log = QtWidgets.QListWidget()
        # Every diagnostic row has the same single-line geometry. Measuring the
        # entire growing history on each scroll can hold the GIL long enough to
        # starve the capture decoder during a full tournament.
        self.event_log.setUniformItemSizes(True)
        self.event_log.setMaximumHeight(170)
        layout.addWidget(self.event_log)

        standings_label = QtWidgets.QLabel("Per-feed standings")
        standings_label.setObjectName("sectionTitle")
        layout.addWidget(standings_label)

        self.feed_tabs = QtWidgets.QTabWidget()
        layout.addWidget(self.feed_tabs, 1)
        return frame

    # -------------------------------------------------------------- helpers
    def _start_broadcast_server(self) -> None:
        try:
            url = self.broadcast_server.start()
        except Exception as exc:  # pragma: no cover - defensive
            self.broadcast_url_edit.setText(self._tr(f"unavailable ({exc})"))
            return
        self.broadcast_url_edit.setText(url)

    def _set_status(self, text: str) -> None:
        self.status_line.setText(f"Status: {self._tr(text)}")

    def _show_export_attention(self, races: list[dict], late_starts: list[dict]) -> None:
        nl = self.language == "nl"
        parts: list[str] = []
        if races:
            listed = ", ".join(f"{race.get('video', '')} race {race.get('race', '')}" for race in races[:6])
            if len(races) > 6:
                listed += ", …"
            parts.append(
                f"Baan nog invullen ({len(races)}): {listed}. Geen baankaart in de opname; "
                "in de werkmap staat UNKNOWN. Vul de baan in vóór het importeren. "
                "Deze races gaan pas daarna naar de uitslag en de live-feed."
                if nl else
                f"Track still to fill in ({len(races)}): {listed}. No track card in the recording; "
                "the workbook says UNKNOWN. Fill in the track before importing. "
                "These races reach the results and the live feed only after that."
            )
        for late in late_starts[:3]:
            carried = [entry for entry in late.get("carried") or [] if int(entry.get("points") or 0) > 0]
            example = ", ".join(f"{entry.get('player', '')} {entry.get('points')}" for entry in carried[:3])
            parts.append(
                f"Opname begon later: {late.get('video', '')} start met tussenstanden ({example}…). "
                "De werkmap telt die punten mee, de races niet: neem bij Stap 5/9 de Excel over "
                "(punten van vóór de opname meetellen) of corrigeer de totalen."
                if nl else
                f"Recording started late: {late.get('video', '')} begins with running totals ({example}…). "
                "The workbook counts those points, the races do not: import the Excel at Step 5/9 "
                "(count points from before the recording) or correct the totals."
            )
        if not parts:
            self.track_attention_line.hide()
            return
        self.track_attention_line.setText("\n".join(parts))
        self.track_attention_line.show()

    def _show_stop_progress(
        self,
        stage: int,
        *,
        state: str = "active",
        found: int | None = None,
        confirmed: int | None = None,
    ) -> None:
        """Keep Stop safety progress visible independently from transient events."""

        self._stop_progress_stage = max(1, min(5, int(stage)))
        self._stop_progress_state = state
        if found is not None:
            self._stop_progress_found = max(0, int(found))
        if confirmed is not None:
            self._stop_progress_confirmed = max(0, int(confirmed))
        self._render_stop_progress()

    def _render_stop_progress(self) -> None:
        if self._stop_progress_state == "hidden":
            self.stop_progress_panel.hide()
            return
        nl = self.language == "nl"
        titles = (
            (),
            ("Capture stoppen en MKV-parts sluiten", "Stopping capture and closing MKV parts"),
            ("Laatste analyse voltooien", "Completing final analysis"),
            ("Lokale resultaten veilig opslaan", "Safely saving local results"),
            ("Resultaten aan Tournament Manager leveren", "Delivering results to Tournament Manager"),
            ("Opnames samenvoegen en controleren", "Assembling and verifying recordings"),
        )
        stage = self._stop_progress_stage
        title = titles[stage][0 if nl else 1]
        if self._stop_progress_state == "complete":
            heading = "STOP VOLTOOID — nieuwe START is veilig" if nl else "STOP COMPLETE — a new START is safe"
            detail = (
                "Analyse, ecosystem delivery en opnamefinalisatie zijn afgerond."
                if nl else
                "Analysis, ecosystem delivery and recording finalization are complete."
            )
            colors = ("#123d27", "#b9f6ce", "#2f9d5b")
        elif self._stop_progress_state == "pending_delivery":
            context = getattr(self, "connection_context", None)
            manager_step = score_workflow_step(context.workflow_step, context.stage) if context is not None else "5/9"
            heading = (
                "STOP LOKAAL VOLTOOID — nieuwe START is veilig"
                if nl else
                "STOP LOCALLY COMPLETE — a new START is safe"
            )
            detail = (
                f"Ecosystem delivery wacht nog. Tournament Manager Stap {manager_step} blijft onvolledig; "
                "gebruik Upload opnieuw proberen, Excel-import of handmatige invoer."
                if nl else
                f"Ecosystem delivery is still pending. Tournament Manager Step {manager_step} remains incomplete; "
                "use Retry upload, Excel import, or manual entry."
            )
            colors = ("#5b4a16", "#ffe8a3", "#9f7f20")
        elif self._stop_progress_state == "waiting":
            heading = (
                f"STOP AFRONDEN — stap {stage} van 5: {title}"
                if nl else
                f"FINISHING STOP — step {stage} of 5: {title}"
            )
            detail = (
                "Resultaten staan lokaal veilig in de wachtrij; de opnames worden nu afgerond."
                if nl else
                "Results are safely retained in the outbox; recordings are now being finalized."
            )
            colors = ("#5b4a16", "#ffe8a3", "#9f7f20")
        elif self._stop_progress_state == "failed":
            heading = "STOP KAN NIET VEILIG AFRONDEN" if nl else "STOP COULD NOT FINISH SAFELY"
            detail = (
                "De vorige run blijft bewaard. Los de getoonde fout op voordat je opnieuw START."
                if nl else
                "The previous run remains retained. Resolve the shown error before starting again."
            )
            colors = ("#5a1717", "#ffd0d0", "#d43f3f")
        else:
            heading = (
                f"STOP AFRONDEN — stap {stage} van 5: {title}"
                if nl else
                f"FINISHING STOP — step {stage} of 5: {title}"
            )
            if stage == 2:
                detail = (
                    f"Bevestigd {self._stop_progress_confirmed} van {self._stop_progress_found} gedetecteerde races. "
                    "Niet afsluiten; START blijft geblokkeerd."
                    if nl else
                    f"Confirmed {self._stop_progress_confirmed} of {self._stop_progress_found} detected races. "
                    "Do not close; START remains blocked."
                )
            else:
                detail = (
                    "Niet afsluiten; START blijft geblokkeerd totdat alle stappen klaar zijn."
                    if nl else
                    "Do not close; START remains blocked until every step is complete."
                )
            colors = ("#5b4a16", "#ffe8a3", "#9f7f20")
        background, foreground, border = colors
        self.stop_progress_text.setText(f"{heading}\n{detail}")
        self.stop_progress_text.setStyleSheet(f"color: {foreground}; font-weight: 800;")
        terminal = self._stop_progress_state in {"complete", "pending_delivery"}
        self.stop_progress_bar.setValue(5 if terminal else stage)
        self.stop_progress_bar.setFormat(
            ("Voltooid" if nl else "Complete")
            if self._stop_progress_state == "complete" else
            ("Lokaal voltooid" if nl else "Locally complete")
            if self._stop_progress_state == "pending_delivery" else
            ((f"Stap {stage} / 5") if nl else f"Step {stage} / 5")
        )
        self.stop_progress_panel.setStyleSheet(
            f"QFrame#panel {{ background: {background}; border: 1px solid {border}; }}"
            f"QProgressBar {{ color: {foreground}; border: 1px solid {border}; text-align: center; }}"
            f"QProgressBar::chunk {{ background: {border}; }}"
        )
        self.stop_progress_panel.show()

    def _hide_stop_progress(self) -> None:
        self._stop_progress_stage = 0
        self._stop_progress_state = "hidden"
        self._stop_progress_found = 0
        self._stop_progress_confirmed = 0
        self.stop_progress_panel.hide()

    def _set_recording_banner(self, level: str, text: str) -> None:
        colors = {
            "green": ("#123d27", "#b9f6ce", "#2f9d5b"),
            "amber": ("#5b4a16", "#ffe8a3", "#9f7f20"),
            "red": ("#5a1717", "#ffd0d0", "#d43f3f"),
        }
        background, foreground, border = colors[level]
        self.recording_alert.setText(self._tr(text))
        self.recording_alert.setStyleSheet(
            f"QLabel {{ background: {background}; color: {foreground}; border: 1px solid {border}; "
            "padding: 8px; font-weight: 800; }"
        )

    def _refresh_recording_choice_banner(self, _checked: bool | None = None) -> None:
        if getattr(self, "controller", None) is not None:
            return
        if self.record_check.isChecked():
            self._set_recording_banner("green", "MKV recording ready — starts with Start all")
        else:
            self._set_recording_banner("amber", "MKV recording is off")

    def _offer_recording_recovery(self) -> None:
        manifests = discover_recoverable_recordings()
        if not manifests:
            return
        dialog = QtWidgets.QMessageBox(self)
        dialog.setIcon(QtWidgets.QMessageBox.Icon.Warning)
        dialog.setWindowTitle(self._tr("Recover previous recording"))
        dialog.setText(
            (
                f"{len(manifests)} onafgeronde opname-run(s) zijn veilig lokaal bewaard. Nu controleren en herstellen?"
                if self.language == "nl"
                else f"{len(manifests)} unfinished recording run(s) are retained locally. Validate and recover now?"
            )
        )
        recover = dialog.addButton(self._tr("Recover previous recording"), QtWidgets.QMessageBox.ButtonRole.AcceptRole)
        later = dialog.addButton(self._tr("Not now"), QtWidgets.QMessageBox.ButtonRole.RejectRole)
        dialog.setDefaultButton(recover)
        dialog.setEscapeButton(later)
        dialog.exec()
        if dialog.clickedButton() is not recover:
            return
        self._set_recording_banner("amber", "Recovering previous recordings…")

        def worker() -> None:
            try:
                reports = [recover_recording_run(path) for path in manifests]
                failed_runs = [str(report["run_id"]) for report in reports if report.get("ok") is not True]
                if failed_runs:
                    message = (
                        "Herstelcontrole mislukt; bestanden blijven bewaard voor: "
                        if self.language == "nl" else
                        "Recovery validation failed; retained files remain available for: "
                    )
                    raise RuntimeError(message + ", ".join(failed_runs))
            except Exception as error:
                self._shutdown_queue.put(("recovery_error", str(error)))
            else:
                self._shutdown_queue.put(("recovery_done", json.dumps(reports)))

        threading.Thread(target=worker, name="recording-recovery", daemon=True).start()

    def _update_recording_health(self, stream_label: str, data: dict[str, object], *, failed: bool = False) -> None:
        self._recording_feed_health[stream_label] = dict(data)
        fw = self.feed_widgets.get(stream_label)
        size_mib = int(data.get("current_part_bytes") or 0) / (1024 * 1024)
        part = int(data.get("part_number") or 1)
        audio = "audio" if data.get("audio_device_name") else "video only"
        dropped = int(data.get("analysis_transport_dropped") or 0)
        hours = float(data.get("estimated_hours_remaining") or 0.0)
        if fw is not None:
            if failed or data.get("archive_failed"):
                fw.recording_health.setText(self._tr(f"Recording error · part {part} retained · {size_mib:.1f} MiB"))
                fw.recording_health.setStyleSheet("color: #ff7777; font-weight: 800;")
            else:
                fw.recording_health.setText(
                    self._tr(
                        f"Recording active · part {part} · {size_mib:.1f} MiB · {audio} · "
                        f"{hours:.1f}h remaining · analysis drops {dropped}"
                    )
                )
                fw.recording_health.setStyleSheet("color: #58d68d; font-weight: 800;")
        failures = sum(1 for health in self._recording_feed_health.values() if health.get("archive_failed"))
        total = sum(1 for source in self.sources if source.is_capture)
        healthy = max(0, total - failures)
        if failed or failures:
            self._set_recording_banner(
                "red",
                f"RECORDING ERROR — {failures} FEED(S) HAVE INCOMPLETE VIDEO EVIDENCE. LIVE VIEW AND ANALYSIS CONTINUE.",
            )
            if not self._recording_alarm_active:
                self._recording_alarm_active = True
                QtWidgets.QApplication.beep()
        elif total:
            self._set_recording_banner("green", f"RECORDING ACTIVE — {healthy}/{total} FEEDS")

    # -------------------------------------------------- OCR engine warm-up
    def _set_ocr_dot(self, color: str, text: str) -> None:
        self.ocr_status_dot.setStyleSheet(f"color: {color}; font-size: 16px;")
        self.ocr_status_text.setText(self._tr(text))

    def start_ocr_warmup(self) -> None:
        """Warm the OCR/analysis engine on a background thread so the first race
        does not pay the torch/EasyOCR/CUDA cost. Recording and screenshot
        capture are independent and never wait on this (Runtime Isolation)."""

        if self._ocr_warmup_started:
            return
        self._ocr_warmup_started = True
        self._set_ocr_dot("#c0392b", "Analysis engine: warming up…")  # red

        def worker() -> None:
            result = warm_up_ocr_engine()  # never raises
            self.ocr_engine_ready.emit(result)

        self._ocr_warmup_thread = threading.Thread(
            target=worker, name="ocr-engine-warmup", daemon=True
        )
        self._ocr_warmup_thread.start()

    def _on_ocr_engine_ready(self, result: object) -> None:
        info = result if isinstance(result, dict) else {}
        readers = info.get("warmed_readers") or []
        assets = info.get("assets_loaded") or []
        if info.get("ready"):
            secs = info.get("elapsed_seconds")
            suffix = f" ({'GPU' if info.get('gpu') else 'CPU'}, {secs}s)" if secs is not None else ""
            self._set_ocr_dot("#27ae60", f"Analysis engine: ready{suffix}")  # green
            reader_langs = ", ".join("+".join(r) for r in readers) or "none"
            self.ocr_status_dot.setToolTip(self._tr(
                f"OCR engine warmed. Readers: {reader_langs}. Assets: {', '.join(assets) or 'none'}. "
                "Recording/capture are independent."
            ))
        else:
            # Engine could not warm (no torch/easyocr or error). The pipeline
            # still falls back to building readers on first use; the dot just
            # signals the warm-up did not complete.
            self._set_ocr_dot("#f39c12", "Analysis engine: not pre-warmed (builds on first race)")  # amber
            self.ocr_status_dot.setToolTip(self._tr(
                f"OCR warm-up incomplete: {info.get('error') or 'unknown'}. "
                "Recording/capture are unaffected; readers build on first use."
            ))

    def open_path(self, path: Path) -> None:
        try:
            os.startfile(str(path))  # noqa: S606 - user-requested folder open
        except OSError as exc:
            QtWidgets.QMessageBox.warning(self, self._tr("Open folder"), str(exc))

    def open_broadcast(self) -> None:
        if not self.broadcast_server.running:
            QtWidgets.QMessageBox.warning(self, self._tr("Live scoreboard"), self._tr("The scoreboard server is not running."))
            return
        # Always open the rotating view (no ?feed= pin) so it cycles groups.
        QtGui.QDesktopServices.openUrl(QtCore.QUrl(self.broadcast_server.base_url))

    def open_broadcast_grid(self) -> None:
        if not self.broadcast_server.running:
            QtWidgets.QMessageBox.warning(self, self._tr("Live scoreboard"), self._tr("The scoreboard server is not running."))
            return
        QtGui.QDesktopServices.openUrl(QtCore.QUrl(f"{self.broadcast_server.base_url}?view=grid"))

    def clear_frames_folder(self) -> None:
        if self.controller and (self.controller.has_running_sources() or self.controller.has_resumable_sources()):
            QtWidgets.QMessageBox.warning(
                self,
                self._tr("Clear Frames folder"),
                self._tr("Stop the current session before clearing Live_Output\\Frames."),
            )
            return
        try:
            result = archive_live_frames_folder("gui_clear_frames_button")
        except Exception as exc:  # pragma: no cover - defensive GUI guard
            QtWidgets.QMessageBox.warning(self, self._tr("Clear Frames folder"), str(exc))
            return
        if result.get("archived"):
            self._set_status(f"Frames archived to {result.get('archive_path')}")
        else:
            self._set_status("Frames folder was already empty; clean folder is ready")

    def export_current_results(self) -> None:
        if not self.controller:
            QtWidgets.QMessageBox.information(
                self,
                self._tr("Export current results"),
                self._tr("Start a session first. The workbook can be exported after at least one race is confirmed."),
            )
            return
        self._set_status("exporting current workbook...")

        def worker() -> None:
            try:
                self.controller.export_current_workbook("gui_manual_current_export")
            except Exception as exc:
                self._shutdown_queue.put(("export_error", str(exc)))

        threading.Thread(target=worker, name="qt-export-current-worker", daemon=True).start()

    def _publish_broadcast(self, display_stream: str) -> None:
        if not self.broadcast_server.running:
            return
        board = self.broadcast_state.feed(display_stream)
        board.group = self.source_groups.get(display_stream, DEFAULT_GROUP)
        board.races_total = self.races_total
        board.highlight_mode = self.highlight_mode
        self.broadcast_server.publish(board.to_payload())

    def _on_highlight_mode_changed(self, _checked: bool) -> None:
        self.highlight_mode = "qualifier" if self.qualifier_btn.isChecked() else "end_round"
        self._republish_all_feeds()

    def _on_races_total_changed(self, value: int) -> None:
        # 0 is the spinbox's "unset" sentinel (shown as "—").
        self.races_total = value or None
        self._republish_all_feeds()

    def _republish_all_feeds(self) -> None:
        # Push the updated header config to every group's overlay live.
        for stream_label in list(self.feed_widgets) or [s.stream_label for s in self.sources]:
            self._publish_broadcast(stream_label)

    def _character_icon(self, name: str) -> QtGui.QIcon | None:
        key = str(name or "")
        if key in self._icon_cache:
            return self._icon_cache[key]
        path = _character_icon_path(key)
        icon = QtGui.QIcon(str(path)) if path else None
        if icon is not None:
            self._icon_cache[key] = icon
        return icon

    def _pixmap_icon(self, path_value: Any, size: int) -> QtGui.QPixmap | None:
        path = Path(str(path_value or ""))
        if not path.exists():
            return None
        pix = QtGui.QPixmap(str(path))
        if pix.isNull():
            return None
        return pix.scaled(size, size, QtCore.Qt.KeepAspectRatio, QtCore.Qt.SmoothTransformation)

    # ------------------------------------------------------------- sources
    def load_presets(self) -> None:
        self._close_capture_sessions([s.source_id for s in self.sources])
        self.sources = preset_source_configs()
        self.refresh_sources()
        self._start_preflight()

    def load_con_error_preset(self) -> None:
        # The 2025-01-03 Qualifier (connection-error / reset dataset).
        self._close_capture_sessions([s.source_id for s in self.sources])
        self.sources = con_error_preset_source_configs()
        missing = [str(s.video_path) for s in self.sources if not s.video_path.exists()]
        if missing:
            QtWidgets.QMessageBox.warning(self, self._tr("Con-Error Preset"), self._tr("Videos not found:\n  " + "\n  ".join(missing)))
        self.refresh_sources()
        self._start_preflight()

    def add_video(self) -> None:
        if len(self.sources) >= MAX_SOURCES:
            QtWidgets.QMessageBox.warning(self, self._tr("Sources"), self._tr(f"Maximum {MAX_SOURCES} feeds supported."))
            return
        path, _ = QtWidgets.QFileDialog.getOpenFileName(
            self, self._tr("Add video"), "", self._tr("Video files (*.mkv *.mp4 *.avi);;All files (*.*)")
        )
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
        inferred = self._infer_group_name(Path(path))
        if inferred is not None:
            stream_label = self.sources[-1].stream_label
            self.source_groups[stream_label] = inferred
            self._persist_source_group(stream_label, inferred)
        self.refresh_sources()
        self._start_preflight()

    def _routing_phase(self) -> str:
        context = self.connection_context
        if context is None:
            return "qualifier"
        return "final" if score_workflow_step(context.workflow_step, context.stage) >= 7 else "qualifier"

    def _preferred_capture_group(self, source: VirtualSourceConfig) -> str:
        if source.capture_device is None:
            return ""
        return self._capture_names.group_default(
            source.capture_device.alternative_name,
            self._routing_phase(),
        )

    def _remember_capture_audio(self, device: CaptureDevice, audio_device: CaptureDevice | None) -> None:
        card_name = self._capture_names.get(device.alternative_name)
        if not card_name:
            return
        updated = CaptureCardNames(self._capture_names.serialize())
        updated.set(
            device.alternative_name,
            card_name,
            audio_id=audio_device.alternative_name if audio_device else "",
            audio_device_name=audio_device.name if audio_device else "",
            audio_container_id=audio_device.container_id if audio_device else "",
        )
        self._capture_names = updated
        self._settings.setValue("capture_card_names", updated.serialize())
        self._settings.sync()

    def _choose_capture_audio(
        self,
        device: CaptureDevice,
        audio_devices: list[CaptureDevice],
    ) -> tuple[CaptureDevice | None, bool]:
        paired = paired_capture_audio(device, audio_devices, self._capture_names)
        if paired is not None:
            return paired, True
        audio_labels = capture_device_display_labels(audio_devices, self._capture_names)
        audio_choices = [self._tr("No audio (video only)")] + [
            audio_labels[audio.alternative_name or audio.name] for audio in audio_devices
        ]
        prompt = (
            "Saved audio is unavailable or ambiguous. Select and verify the audio for this card:"
            if self._capture_names.get(device.alternative_name) else
            "DirectShow audio device for this feed:"
        )
        audio_choice, accepted = QtWidgets.QInputDialog.getItem(
            self, self._tr("Capture-card audio"), self._tr(prompt), audio_choices, 0, False,
        )
        if not accepted:
            return None, False
        if audio_choice == self._tr("No audio (video only)"):
            return None, True
        return audio_devices[audio_choices.index(audio_choice) - 1], True

    def _append_capture_device(
        self,
        device: CaptureDevice,
        audio_device: CaptureDevice | None,
        technical_label: str,
    ) -> VirtualSourceConfig | None:
        identity = capture_device_identity(device)
        assigned = {
            capture_device_identity(source.capture_device)
            for source in self.sources
            if source.capture_device is not None
        }
        if not identity or identity in assigned or len(self.sources) >= MAX_SOURCES:
            return None
        index = self._next_source_index()
        stream_label = f"source_{index}"
        config = VirtualSourceConfig(
            source_id=stream_label,
            display_label=technical_label,
            stream_label=stream_label,
            video_path=Path("capture:/") / technical_label,
            capture_device=device,
            capture_audio_device=audio_device,
        )
        preferred = self._preferred_capture_group(config)
        valid_groups = (
            [str(group.get("name", "")) for group in self._active_connection_groups()]
            if self.connection_context is not None else GROUP_NAMES
        )
        if preferred and preferred in valid_groups:
            self.source_groups[stream_label] = preferred
            self._persist_source_group(stream_label, preferred)
        self.sources.append(config)
        self._remember_capture_audio(device, audio_device)
        self._open_capture_preview(config)
        return config

    def _auto_add_remembered_capture_cards(self) -> None:
        """Mount sticker-named cards by stable IDs, independent of USB order or frames."""
        if self._run_is_active() or len(self.sources) >= MAX_SOURCES:
            return
        tracker = PerformanceTracker(PERFORMANCE_ROOT / "capture", enabled=True)
        devices = discover_capture_devices(tracker)
        technical_labels = capture_device_display_labels(devices)
        assigned = {
            capture_device_identity(source.capture_device)
            for source in self.sources
            if source.capture_device is not None
        }
        remembered = [
            device for device in devices
            if capture_device_identity(device) not in assigned
            and self._capture_names.get(device.alternative_name)
        ]
        order = {name: index for index, name in enumerate(GROUP_NAMES)}
        remembered.sort(key=lambda device: (
            order.get(self._capture_names.group_default(device.alternative_name, "qualifier"), 999),
            self._capture_names.get(device.alternative_name).casefold(),
        ))
        if not remembered:
            self._update_capture_routing_status()
            return
        audio_devices = discover_capture_audio_devices(tracker)
        added = False
        for device in remembered[: max(0, MAX_SOURCES - len(self.sources))]:
            audio_device, accepted = self._choose_capture_audio(device, audio_devices)
            if not accepted:
                continue
            technical_label = technical_labels[device.alternative_name or device.name]
            added = self._append_capture_device(device, audio_device, technical_label) is not None or added
        if added:
            self.refresh_sources()
            self._start_preflight()
        else:
            self._update_capture_routing_status()

    def add_capture_device(self) -> None:
        if len(self.sources) >= MAX_SOURCES:
            QtWidgets.QMessageBox.warning(self, self._tr("Sources"), self._tr(f"Maximum {MAX_SOURCES} feeds supported."))
            return
        tracker = PerformanceTracker(PERFORMANCE_ROOT / "capture", enabled=True)
        devices = discover_capture_devices(tracker)
        # Label every device against the FULL discovery list, so identical cards
        # (three "UGREEN 35287") get a stable, globally unique "#n" — numbering
        # against the remaining subset gave two feeds the same label when cards
        # were added one at a time, which merged their export/bundle identities.
        technical_labels = capture_device_display_labels(devices)
        all_labels = capture_device_display_labels(devices, self._capture_names)
        assigned = {
            capture_device_identity(s.capture_device)
            for s in self.sources
            if s.capture_device is not None
        }
        available = [
            d for d in devices if capture_device_identity(d) not in assigned
        ]
        if not available:
            QtWidgets.QMessageBox.information(
                self,
                self._tr("Add capture device"),
                self._tr("No unassigned DirectShow video devices found.\n"
                "Check the USB connection (each card should appear as its own camera device) "
                "and try again."),
            )
            return
        labels = [all_labels[device.alternative_name or device.name] for device in available]
        choice, ok = QtWidgets.QInputDialog.getItem(
            self, self._tr("Add capture device"), self._tr("DirectShow video device:"), labels, 0, False
        )
        if not ok or not choice:
            return
        device = available[labels.index(choice)]
        audio_devices = discover_capture_audio_devices(tracker)
        audio_device, accepted = self._choose_capture_audio(device, audio_devices)
        if not accepted:
            return
        # Remembered labels are presentation only. Keep existing recording,
        # source-path and export identities independent of an operator rename.
        technical_label = technical_labels[device.alternative_name or device.name]
        if self._append_capture_device(device, audio_device, technical_label) is None:
            QtWidgets.QMessageBox.warning(
                self, self._tr("Add capture device"),
                self._tr("This physical capture card is already assigned to a feed."),
            )
            return
        self.refresh_sources()
        self._start_preflight()

    def _capture_name(self, source: VirtualSourceConfig) -> str:
        return self._capture_names.get(source.capture_device.alternative_name) if source.capture_device else ""

    def _capture_description(self, source: VirtualSourceConfig) -> str:
        audio = source.capture_audio_device.name if source.capture_audio_device else self._tr("No audio (video only)")
        return f"{source.display_label}\n{self._tr('Capture-card audio')}: {audio}"

    def rename_capture_card(self) -> None:
        rows = self.source_table.selectionModel().selectedRows()
        if len(rows) != 1 or rows[0].row() >= len(self.sources) or not self.sources[rows[0].row()].is_capture:
            QtWidgets.QMessageBox.information(self, self._tr("Name capture card"), self._tr("Select one capture card in the source list first."))
            return
        source = self.sources[rows[0].row()]
        name, accepted = QtWidgets.QInputDialog.getText(
            self, self._tr("Name capture card"),
            self._tr("Card label (for example CC Group 1). Empty restores the device name. Always verify the feed."),
            text=self._capture_name(source),
        )
        if not accepted:
            return
        updated = CaptureCardNames(self._capture_names.serialize())
        try:
            updated.set(source.capture_device.alternative_name, name,
                        audio_id=source.capture_audio_device.alternative_name if source.capture_audio_device else "",
                        audio_device_name=source.capture_audio_device.name if source.capture_audio_device else "",
                        audio_container_id=source.capture_audio_device.container_id if source.capture_audio_device else "")
        except ValueError as error:
            QtWidgets.QMessageBox.warning(self, self._tr("Name capture card"), self._tr(str(error)))
            return
        self._settings.setValue("capture_card_names", updated.serialize())
        self._settings.sync()
        if self._settings.status() != QtCore.QSettings.Status.NoError:
            QtWidgets.QMessageBox.warning(self, self._tr("Name capture card"), self._tr("The capture-card name could not be saved."))
            return
        self._capture_names = updated
        # Update labels in place: do not reopen capture or clear result tables.
        for row, item in enumerate(self.sources):
            if not item.is_capture:
                continue
            title = self._capture_name(item) or item.stream_label
            self.source_table.item(row, SOURCE_COLUMN_STREAM).setText(title)
            self.source_table.item(row, SOURCE_COLUMN_STREAM).setToolTip(f"{title}\n{item.stream_label}")
            self.source_table.item(row, SOURCE_COLUMN_VIDEO).setText(self._capture_description(item))
            tile = self.preview_tiles.get(item.source_id)
            if tile:
                tile["box"].setTitle(title)
            index = self.feed_tab_index.get(item.stream_label)
            if index is not None:
                self.feed_tabs.setTabText(index, title)

    def _next_source_index(self) -> int:
        taken = set()
        for source in self.sources:
            match = re.match(r"source_(\d+)$", source.source_id)
            if match:
                taken.add(int(match.group(1)))
        index = 1
        while index in taken:
            index += 1
        return index

    def _open_capture_preview(self, config: VirtualSourceConfig) -> None:
        device: CaptureDevice = config.capture_device  # type: ignore[assignment]
        session = CaptureCardSource(
            source_id=config.source_id,
            display_label=config.display_label,
            stream_label=config.stream_label,
            event_bus=self._capture_preview_bus,
            device_name=device.name,
            device_alternative_name=device.alternative_name,
            audio_device_name=config.capture_audio_device.name if config.capture_audio_device else "",
            audio_device_alternative_name=(
                config.capture_audio_device.alternative_name if config.capture_audio_device else ""
            ),
        )
        self.capture_sessions[config.source_id] = session
        try:
            session.open()
        except RuntimeError as exc:
            QtWidgets.QMessageBox.warning(self, self._tr("Capture device"), str(exc))

    def _close_capture_sessions(self, source_ids: list[str]) -> None:
        for source_id in source_ids:
            session = self.capture_sessions.pop(source_id, None)
            if session is not None:
                # stop() is quick (killing ffmpeg unblocks the reader) but keep
                # the UI thread free anyway.
                threading.Thread(
                    target=session.stop, name=f"capture-close-{source_id}", daemon=True
                ).start()

    def remove_selected(self) -> None:
        rows = {idx.row() for idx in self.source_table.selectionModel().selectedRows()}
        if not rows:
            return
        removed = [s.source_id for i, s in enumerate(self.sources) if i in rows]
        self.sources = [s for i, s in enumerate(self.sources) if i not in rows]
        self._close_capture_sessions(removed)
        self.refresh_sources()
        self._start_preflight()

    def clear_sources(self) -> None:
        self._close_capture_sessions([s.source_id for s in self.sources])
        self.sources = []
        self.refresh_sources()
        self._start_preflight()

    def _update_capture_routing_status(self) -> None:
        if not hasattr(self, "capture_routing_status"):
            return
        capture_sources = [source for source in self.sources if source.capture_device is not None]
        identities = [capture_device_identity(source.capture_device) for source in capture_sources]
        if len(identities) != len(set(identities)):
            text = (
                "BLOKKADE: dezelfde fysieke capturekaart staat bij meer dan één feed. Verwijder de dubbele koppeling."
                if self.language == "nl" else
                "BLOCKED: the same physical capture card is assigned to more than one feed. Remove the duplicate route."
            )
            self.capture_routing_status.setStyleSheet(
                "QLabel { background: #4c1d1d; color: #fecaca; border: 1px solid #dc2626; "
                "border-radius: 6px; padding: 7px; font-weight: 700; }"
            )
            self.capture_routing_status.setText(text)
            return
        if not capture_sources:
            text = (
                "Bekende capturekaarten worden automatisch verbonden. Controleer daarna hieronder kaart → groep."
                if self.language == "nl" else
                "Recognized capture cards connect automatically. Then check each card → group route below."
            )
        else:
            routes = []
            for source in capture_sources:
                card = self._capture_name(source) or source.display_label
                group = self.source_groups.get(source.stream_label, DEFAULT_GROUP)
                routes.append(f"{card} → {group}")
            phase = "finale" if self._routing_phase() == "final" and self.language == "nl" else (
                "final" if self._routing_phase() == "final" else
                ("kwalificatie" if self.language == "nl" else "qualifier")
            )
            prefix = "Controleer koppeling" if self.language == "nl" else "Check routing"
            text = f"{prefix} ({phase}): " + "  ·  ".join(routes)
        self.capture_routing_status.setStyleSheet(
            "QLabel { background: #172554; color: #dbeafe; border: 1px solid #2563eb; "
            "border-radius: 6px; padding: 7px; font-weight: 650; }"
        )
        self.capture_routing_status.setText(text)

    def refresh_sources(self) -> None:
        self.source_table.clearSpans()
        if not self.sources:
            self.source_table.setRowCount(1)
            placeholder = QtWidgets.QTableWidgetItem(self._tr("No Sources Selected or Loaded"))
            placeholder.setTextAlignment(QtCore.Qt.AlignCenter)
            placeholder.setForeground(QtGui.QColor(COLORS["faint"]))
            font = _ensure_valid_point_size(placeholder.font())
            font.setItalic(True)
            placeholder.setFont(font)
            placeholder.setFlags(QtCore.Qt.ItemIsEnabled)
            self.source_table.setItem(0, 0, placeholder)
            self.source_table.setSpan(0, 0, 1, self.source_table.columnCount())
        else:
            self.source_table.setRowCount(len(self.sources))
            for row, source in enumerate(self.sources):
                title = self._capture_name(source) or source.stream_label
                source_item = QtWidgets.QTableWidgetItem(title)
                source_item.setToolTip(f"{title}\n{source.stream_label}")
                self.source_table.setItem(row, SOURCE_COLUMN_STREAM, source_item)
                self.source_table.setCellWidget(row, SOURCE_COLUMN_GROUP, self._make_group_combo(source.stream_label))
                self.source_table.setCellWidget(row, SOURCE_COLUMN_LANGUAGE, self._make_console_language_combo(source))
                media_text = source.video_path.name
                if source.is_capture:
                    media_text = self._capture_description(source)
                media_item = QtWidgets.QTableWidgetItem(media_text)
                if source.is_capture:
                    media_item.setToolTip(f"{media_text}\nVideo ID: {source.capture_device.alternative_name}\nAudio ID: {source.capture_audio_device.alternative_name if source.capture_audio_device else '—'}")
                else:
                    media_item.setToolTip(str(source.video_path))
                self.source_table.setItem(row, SOURCE_COLUMN_VIDEO, media_item)
                self.source_table.setItem(row, SOURCE_COLUMN_STATUS, QtWidgets.QTableWidgetItem(self._tr(self._source_status_text(source.source_id))))
            self.source_table.resizeRowsToContents()
        self._update_capture_routing_status()
        self._rebuild_preview_tiles()
        self._rebuild_feed_tabs()
        self._refresh_start_button_state()

    def _make_group_combo(self, stream_label: str) -> QtWidgets.QComboBox:
        combo = QtWidgets.QComboBox()
        group_names = (
            [str(group.get("name", "")) for group in self._active_connection_groups()]
            if self.connection_context is not None
            else GROUP_NAMES
        )
        group_names = [name for name in group_names if name]
        if DEFAULT_GROUP not in group_names:
            group_names.append(DEFAULT_GROUP)
        combo.addItems(group_names)
        if stream_label not in self.source_groups:
            source = next((item for item in self.sources if item.stream_label == stream_label), None)
            preferred = self._preferred_capture_group(source) if source is not None else ""
            self.source_groups[stream_label] = preferred if preferred in group_names else DEFAULT_GROUP
        current = self.source_groups[stream_label]
        if current not in group_names:
            current = DEFAULT_GROUP
            self.source_groups[stream_label] = current
        combo.setCurrentText(current)
        self._style_group_combo(combo, current)
        combo.currentTextChanged.connect(
            lambda name, sl=stream_label, c=combo: self._on_group_changed(sl, name, c)
        )
        return combo

    def _stored_game_locales(self) -> dict[str, str]:
        try:
            stored = json.loads(str(self._settings.value("game_locales", "") or "{}"))
        except (TypeError, ValueError):
            return {}
        return stored if isinstance(stored, dict) else {}

    def _game_locale(self, source: VirtualSourceConfig) -> str:
        if source.stream_label not in self.game_locales and source.capture_device is not None:
            stored = self._stored_game_locales().get(source.capture_device.alternative_name)
            self.game_locales[source.stream_label] = normalize_game_locale(stored)
        return self.game_locales.get(source.stream_label, AUTO)

    def _make_console_language_combo(self, source: VirtualSourceConfig) -> QtWidgets.QComboBox:
        combo = QtWidgets.QComboBox()
        combo.addItem(self._tr("Auto"), AUTO)
        for code, name in GAME_LOCALES:
            combo.addItem(name, code)
        combo.setCurrentIndex(max(0, combo.findData(self._game_locale(source))))
        combo.setToolTip(self._tr(
            "The game language of this console (for English, French and Spanish also its region). "
            "Auto finds it from the race-end banner; a chosen language reads only that language."
        ))
        combo.currentIndexChanged.connect(
            lambda _index, src=source, c=combo: self._on_console_language_changed(src, str(c.currentData()))
        )
        return combo

    def _on_console_language_changed(self, source: VirtualSourceConfig, locale: str) -> None:
        value = normalize_game_locale(locale)
        self.game_locales[source.stream_label] = value
        if source.capture_device is not None:
            stored = self._stored_game_locales()
            stored[source.capture_device.alternative_name] = value
            self._settings.setValue("game_locales", json.dumps(stored, sort_keys=True))
            self._settings.sync()
        if self.controller is not None:
            # A running analysis reads the next race with the new choice.
            self.controller.set_game_locale(source.source_id, value)

    def _style_group_combo(self, combo: QtWidgets.QComboBox, name: str) -> None:
        bg = group_color(name)
        fg = text_color_for(bg)
        combo.setStyleSheet(
            f"QComboBox {{ background: {bg}; color: {fg}; font-weight: 600; "
            f"border: none; border-radius: 7px; padding: 5px 8px; }}"
            f"QComboBox QAbstractItemView {{ background: {COLORS['bg_elev']}; color: {COLORS['text']}; }}"
        )

    def _on_group_changed(self, stream_label: str, name: str, combo: QtWidgets.QComboBox) -> None:
        self.source_groups[stream_label] = name
        self._persist_source_group(stream_label, name)
        source = next((item for item in self.sources if item.stream_label == stream_label), None)
        if source is not None and source.capture_device is not None:
            updated = CaptureCardNames(self._capture_names.serialize())
            if self._routing_phase() == "final":
                updated.set_group_defaults(source.capture_device.alternative_name, final_group=name)
            else:
                updated.set_group_defaults(source.capture_device.alternative_name, qualifier_group=name)
            self._capture_names = updated
            self._settings.setValue("capture_card_names", updated.serialize())
            self._settings.sync()
        self._style_group_combo(combo, name)
        self._update_capture_routing_status()
        # Push the new alias to the overlay immediately, even before any race data.
        self._publish_broadcast(stream_label)

    def _source_status_text(self, source_id: str) -> str:
        config = next((s for s in self.sources if s.source_id == source_id), None)
        if config is not None and config.is_capture:
            session = self.capture_sessions.get(source_id)
            status = self.preflight_statuses.get(source_id, "no signal")
            if status == "ready" and session is not None:
                return f"ready: live signal ({session.measured_fps:0.1f} fps)"
            return status
        result = self.preflight_results.get(source_id)
        if result is not None:
            return result.status_text
        status = self.preflight_statuses.get(source_id, "not loaded")
        if status == "failed":
            return f"failed: {self.preflight_errors.get(source_id, 'unknown error')}"
        return status

    def _poll_capture_liveness(self, refresh: bool = True) -> None:
        """Drive capture-feed readiness from actual frame arrival: 'ready' only
        while live frames are flowing, so Start All stays gated on liveness
        (mirrors sources_ready_to_start for file preflight)."""
        changed = False
        for config in self.sources:
            if not config.is_capture:
                continue
            session = self.capture_sessions.get(config.source_id)
            if session is None:
                status = "no signal"
            elif session.state == "failed":
                status = "failed"
                self.preflight_errors[config.source_id] = session.error_state
            elif session.signal_alive:
                status = "ready"
            else:
                status = "no signal"
            if self.preflight_statuses.get(config.source_id) != status:
                self.preflight_statuses[config.source_id] = status
                changed = True
        if changed and refresh:
            self._refresh_source_status_rows()
            self._refresh_start_button_state()

    def _refresh_source_status_rows(self) -> None:
        if not self.sources:
            return
        for row, source in enumerate(self.sources):
            item = self.source_table.item(row, SOURCE_COLUMN_STATUS)
            text = self._source_status_text(source.source_id)
            if item is None:
                self.source_table.setItem(row, SOURCE_COLUMN_STATUS, QtWidgets.QTableWidgetItem(self._tr(text)))
            else:
                item.setText(self._tr(text))

    # ------------------------------------------------------------- preview
    def _clear_layout(self, layout: QtWidgets.QLayout) -> None:
        while layout.count():
            item = layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.deleteLater()

    _TILE_BORDER_COLORS = {
        "borders": "#e74c3c",  # red: calibrated verdict — fix playback fullscreen/overscan
        "clean": "#7fd88f",  # light green: calibrated verdict — feed fills the frame
        "calibrating": "#f0b429",  # amber: measuring the first ~30s (1 sample/s majority)
        "unknown": "transparent",
    }

    def _tile_style(self, border_state: str) -> str:
        color = self._TILE_BORDER_COLORS.get(border_state, "transparent")
        return (
            f"background: #0a0e26; border-radius: 8px; color: {COLORS['faint']}; "
            f"border: 3px solid {color};"
        )

    def _rebuild_preview_tiles(self) -> None:
        self._clear_layout(self.preview_grid)
        self.preview_tiles.clear()
        for index, source in enumerate(self.sources):
            box = QtWidgets.QGroupBox(self._capture_name(source) or source.stream_label)
            v = QtWidgets.QVBoxLayout(box)
            image = QtWidgets.QLabel("No preview")
            image.setAlignment(QtCore.Qt.AlignCenter)
            image.setMinimumSize(300, 169)
            image.setStyleSheet(self._tile_style("unknown"))
            image.setSizePolicy(QtWidgets.QSizePolicy.Expanding, QtWidgets.QSizePolicy.Expanding)
            status = QtWidgets.QLabel(source.video_path.name)
            status.setObjectName("hint")
            v.addWidget(image, 1)
            v.addWidget(status)
            self.preview_grid.addWidget(box, index // 2, index % 2)
            self.preview_tiles[source.source_id] = {"box": box, "image": image, "status": status, "border_state": "unknown"}

    def _refresh_preview_frames(self) -> None:
        # Capture sessions preview live from the moment a device is assigned
        # (before Start All); controller sources take over the same tiles when
        # a run starts (capture sessions are the same objects in both maps).
        sources_by_id: dict[str, Any] = dict(self.capture_sessions)
        if self.controller:
            for source in self.controller.sources:
                sources_by_id[source.source_id] = source
        for source_id, source in sources_by_id.items():
            tile = self.preview_tiles.get(source_id)
            if not tile:
                continue
            frame = source.latest_preview_frame
            if frame is not None:
                tile["image"].setPixmap(self._frame_to_pixmap(frame, tile["image"].size()))
                tile["image"].setText("")
            status = (
                f"{source.video_path.name} | {source.state} | "
                f"{source.current_timestamp:0.1f}s | frame {source.current_frame_index}"
            )
            if getattr(source, "is_capture_card", False):
                status += (
                    f" | live {source.measured_fps:0.1f} fps"
                    if source.signal_alive
                    else " | NO SIGNAL"
                )
                border_state = source.border_status if source.signal_alive else "unknown"
                if border_state == "borders":
                    status += " | ⚠ ZWARTE RANDEN — zet playback fullscreen/overscan uit"
                elif border_state == "calibrating":
                    status += " | randkalibratie…"
                if tile.get("border_state") != border_state:
                    tile["border_state"] = border_state
                    tile["image"].setStyleSheet(self._tile_style(border_state))
            tile["status"].setText(status)

    @staticmethod
    def _frame_to_pixmap(frame: np.ndarray, target: QtCore.QSize) -> QtGui.QPixmap:
        array = np.ascontiguousarray(frame)
        height, width = array.shape[:2]
        image = QtGui.QImage(array.data, width, height, 3 * width, QtGui.QImage.Format_RGB888)
        pixmap = QtGui.QPixmap.fromImage(image.copy())
        return pixmap.scaled(target, QtCore.Qt.KeepAspectRatio, QtCore.Qt.SmoothTransformation)

    # ---------------------------------------------------------- feed tabs
    def _make_table(self, columns: list[str]) -> QtWidgets.QTableWidget:
        table = QtWidgets.QTableWidget(0, len(columns))
        table.setHorizontalHeaderLabels(columns)
        table.verticalHeader().setVisible(False)
        table.setEditTriggers(QtWidgets.QAbstractItemView.NoEditTriggers)
        table.setSelectionMode(QtWidgets.QAbstractItemView.NoSelection)
        table.horizontalHeader().setSectionResizeMode(QtWidgets.QHeaderView.Stretch)
        table.setIconSize(QtCore.QSize(26, 26))
        return table

    def _rebuild_feed_tabs(self) -> None:
        self.feed_tabs.clear()
        self.feed_widgets.clear()
        self.feed_tab_index.clear()
        for index, source in enumerate(self.sources):
            tab = QtWidgets.QWidget()
            v = QtWidgets.QVBoxLayout(tab)
            v.setContentsMargins(8, 8, 8, 8)
            v.setSpacing(6)

            fw = _FeedWidgets()
            fw.header = QtWidgets.QLabel(
                self._tr(format_feed_header(source.stream_label, source.video_path.name, None, 0, 0))
            )
            fw.header.setWordWrap(True)
            v.addWidget(fw.header)
            fw.recording_health = QtWidgets.QLabel(self._tr("Recording: off"))
            fw.recording_health.setWordWrap(True)
            fw.recording_health.setStyleSheet("color: #b6bcc8; font-weight: 700;")
            v.addWidget(fw.recording_health)
            fw.analysis_progress = QtWidgets.QLabel(format_analysis_progress(0, 0, language=self.language))
            fw.analysis_progress.setWordWrap(True)
            fw.analysis_progress.setStyleSheet("color: #b6bcc8; font-weight: 700;")
            v.addWidget(fw.analysis_progress)

            race_row = QtWidgets.QHBoxLayout()
            fw.cup_icon = QtWidgets.QLabel("cup")
            fw.cup_icon.setFixedSize(40, 40)
            fw.cup_icon.setAlignment(QtCore.Qt.AlignCenter)
            fw.track_icon = QtWidgets.QLabel("track")
            fw.track_icon.setFixedSize(54, 40)
            fw.track_icon.setAlignment(QtCore.Qt.AlignCenter)
            fw.race_card = QtWidgets.QLabel(self._tr(format_current_race_card({}, None)))
            fw.race_card.setWordWrap(True)
            race_row.addWidget(fw.cup_icon)
            race_row.addWidget(fw.track_icon)
            race_row.addWidget(fw.race_card, 1)
            v.addLayout(race_row)

            inner = QtWidgets.QTabWidget()
            prov = QtWidgets.QWidget()
            pv = QtWidgets.QVBoxLayout(prov)
            pv.setContentsMargins(4, 4, 4, 4)
            fw.provisional_header = QtWidgets.QLabel(self._tr("Latest race: waiting for next race"))
            fw.provisional_header.setObjectName("hint")
            pv.addWidget(fw.provisional_header)
            fw.provisional_table = self._make_table(PROVISIONAL_COLUMNS)
            pv.addWidget(fw.provisional_table)
            inner.addTab(prov, self._tr("Latest race"))

            conf = QtWidgets.QWidget()
            cv = QtWidgets.QVBoxLayout(conf)
            cv.setContentsMargins(4, 4, 4, 4)
            fw.standings_table = self._make_table(STANDINGS_COLUMNS)
            cv.addWidget(fw.standings_table)
            inner.addTab(conf, self._tr("Confirmed standings"))

            v.addWidget(inner, 1)

            self.feed_tabs.addTab(tab, self._capture_name(source) or source.stream_label)
            self.feed_widgets[source.stream_label] = fw
            self.feed_tab_index[source.stream_label] = index

    def _fill_table(self, table: QtWidgets.QTableWidget, rows: list[tuple], icon_col: int) -> None:
        table.setRowCount(len(rows))
        for r, values in enumerate(rows):
            for c, value in enumerate(values):
                item = QtWidgets.QTableWidgetItem(str(value))
                if c == icon_col:
                    icon = self._character_icon(str(value))
                    if icon is not None:
                        item.setIcon(icon)
                table.setItem(r, c, item)

    # -------------------------------------------------------------- preflight
    def _start_preflight(self) -> None:
        self._preflight_generation += 1
        generation = self._preflight_generation
        self.preflight_results.clear()
        self.preflight_errors.clear()
        # File sources get the video preflight; capture feeds are readiness-gated
        # on liveness instead (updated every tick by _poll_capture_liveness).
        self.preflight_statuses = {
            s.source_id: ("no signal" if s.is_capture else "checking") for s in self.sources
        }
        self._poll_capture_liveness(refresh=False)
        self._refresh_source_status_rows()
        self._refresh_start_button_state()
        if not self.sources:
            self._set_status("idle")
            return
        sources = [s for s in self.sources if not s.is_capture]
        if not sources:
            self._set_status("waiting for live capture signal")
            return
        self._set_status("checking selected videos before start")

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
                write_gui_preflight_report(f"gui_preflight_{time.strftime('%Y%m%d_%H%M%S')}", results, worker_count=0)
                self._preflight_queue.put((generation, "done", None))
                return
            max_workers = max(1, min(int(self.live_config.gui_preflight_workers), len(sources)))
            indexed_sources = list(enumerate(sources, start=1))
            with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="qt-video-preflight") as executor:
                futures = {
                    executor.submit(preflight_video_source, source, len(sources), index, templates): (index, source)
                    for index, source in indexed_sources
                }
                for future in as_completed(futures):
                    index, source = futures[future]
                    try:
                        result = future.result()
                    except Exception as exc:
                        result = VideoPreflightResult(
                            source_id=source.source_id,
                            stream_label=source.stream_label,
                            video_path=source.video_path,
                            status="failed",
                            error=str(exc),
                        )
                    results.append(result)
                    self._preflight_queue.put((generation, "result", result))
            results.sort(key=lambda item: next((idx for idx, source in indexed_sources if source.source_id == item.source_id), 9999))
            write_gui_preflight_report(f"gui_preflight_{time.strftime('%Y%m%d_%H%M%S')}", results, worker_count=max_workers)
            self._preflight_queue.put((generation, "done", None))

        self._preflight_thread = threading.Thread(target=worker, name="qt-video-preflight", daemon=True)
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
                    self._set_status("selected videos ready")
                else:
                    self._set_status("video check failed for one or more sources")
                changed = True
        if changed:
            self._refresh_source_status_rows()
            self._refresh_start_button_state()

    def _all_sources_preflight_ready(self) -> bool:
        return sources_ready_to_start(self.sources, self.preflight_statuses)

    def _capture_devices_are_unique(self) -> bool:
        identities = [
            capture_device_identity(source.capture_device)
            for source in self.sources
            if source.capture_device is not None
        ]
        return bool(all(identities)) and len(identities) == len(set(identities))

    def _run_is_active(self) -> bool:
        return bool(
            self.controller
            and (self.controller.has_running_sources() or self.controller.has_resumable_sources())
        )

    def _shutdown_in_progress(self) -> bool:
        return bool(self._shutdown_thread and self._shutdown_thread.is_alive())

    def _recording_finalization_incomplete(self) -> bool:
        controller = self.controller
        recorder = controller.recorder if controller is not None else None
        state = (
            recorder.manifest.state
            if recorder is not None and recorder.manifest is not None
            else None
        )
        return state is not None and state not in TERMINAL_RECORDING_STATES

    def _refresh_start_button_state(self) -> None:
        active = self._run_is_active()
        stopping = self._shutdown_in_progress()
        pending = bool(
            (self.controller and self.controller.finalization_pending)
            or self._recording_finalization_incomplete()
        )
        checking_context = self._pending_new_run_context_refresh
        connecting = bool(self._connection_thread and self._connection_thread.is_alive())
        wanted_text = self._tr(
            "Stop all" if active else
            ("Checking Tournament…" if checking_context else
             ("Stopping…" if stopping or pending else "Start all"))
        )
        if self.start_button.text() != wanted_text:
            self.start_button.setText(wanted_text)
            self.start_button.setStyleSheet(
                "QPushButton { background: #c0392b; color: white; font-weight: 700; }"
                "QPushButton:hover { background: #e74c3c; }"
                if active
                else ""  # back to the QSS "primary" style
            )
        if active:
            self.start_button.setEnabled(True)
        else:
            # Never allow a new start while the previous run is still draining:
            # late consensus writes would land in the freshly archived Frames.
            self.start_button.setEnabled(
                not stopping and not pending and not checking_context
                and self._capture_devices_are_unique() and self._all_sources_preflight_ready()
            )
        paused = bool(self.controller and self.controller.has_resumable_sources())
        running = bool(self.controller and self.controller.has_running_sources())
        self.pause_btn.setEnabled(running)
        self.resume_btn.setEnabled(paused)
        # Reset only lights up when there is actually session data to discard.
        self.reset_btn.setEnabled(self.controller is not None and not stopping and not pending)
        self.offline_button.setEnabled(not stopping and not pending)
        self.connect_button.setEnabled(
            not stopping and not pending and not checking_context and not connecting
        )

    def toggle_start_stop(self) -> None:
        if self._run_is_active():
            self.stop_all()
            self._refresh_start_button_state()
            return
        if self._shutdown_in_progress():
            self._set_status("previous run is still stopping — wait a moment")
            return
        if self._pending_new_run_context_refresh:
            self._set_status("checking current Tournament step before new run...")
            return
        self.start_all()
        self._refresh_start_button_state()

    # ------------------------------------------------------------- controls
    def _confirm_start_without_recording(self) -> bool:
        """Require an explicit, safely-defaulted override when MKV recording is off."""
        if self.record_check.isChecked():
            return True

        dialog = QtWidgets.QMessageBox(self)
        dialog.setIcon(QtWidgets.QMessageBox.Icon.Warning)
        dialog.setWindowTitle(self._tr("MKV recording is off"))
        dialog.setText(self._tr("WARNING: MKV RECORDINGS ARE OFF!\n\nDo you really want to START?"))
        dialog.setInformativeText(self._tr("The video feeds will not be saved as MKV files."))
        start_without_recording = dialog.addButton(
            self._tr("Start without MKV recording"),
            QtWidgets.QMessageBox.ButtonRole.DestructiveRole,
        )
        cancel = dialog.addButton(
            self._tr("Cancel"),
            QtWidgets.QMessageBox.ButtonRole.RejectRole,
        )
        dialog.setDefaultButton(cancel)
        dialog.setEscapeButton(cancel)
        dialog.exec()
        return dialog.clickedButton() is start_without_recording

    def _confirm_start_new_run(self) -> bool:
        controller = self.controller
        if controller is None:
            return True
        if self._new_run_confirmation_controller_id == controller.run_id:
            return True
        recorder = controller.recorder
        recording_state = (
            recorder.manifest.state
            if recorder is not None and recorder.manifest is not None
            else None
        )
        if recording_state is not None and recording_state not in TERMINAL_RECORDING_STATES:
            QtWidgets.QMessageBox.warning(
                self,
                "Previous run is not safely finalized",
                (
                    f"Run {controller.run_id} has recording state '{recording_state.value}'. "
                    "A new run is blocked so its retained evidence cannot be hidden. "
                    "Finish/recover the previous recording first."
                    if self.language != "nl" else
                    f"Run {controller.run_id} heeft opnamestatus '{recording_state.value}'. "
                    "Een nieuwe run is geblokkeerd zodat het bewaarde bewijs niet wordt verborgen. "
                    "Rond de vorige opname eerst af of herstel deze."
                ),
            )
            return False

        dialog = QtWidgets.QMessageBox(self)
        dialog.setIcon(QtWidgets.QMessageBox.Icon.Warning)
        dialog.setWindowTitle("Nieuwe run starten?" if self.language == "nl" else "Start a new run?")
        dialog.setText(
            (
                f"De vorige run {controller.run_id} blijft volledig bewaard.\n\n"
                "START maakt nieuwe opnames, analyses en resultaten en maakt alleen het live dashboard leeg. "
                "Er wordt niets van de vorige run verwijderd of overschreven."
                if self.language == "nl" else
                f"The previous run {controller.run_id} remains fully retained.\n\n"
                "START creates new recordings, analysis and results and clears only the live dashboard. "
                "Nothing from the previous run is deleted or overwritten."
            )
        )
        dialog.setInformativeText(
            (
                "Kies Annuleren als deze klik niet bedoeld was. Opnamen en exports blijven bereikbaar via de Open-knoppen."
                if self.language == "nl" else
                "Choose Cancel if this click was accidental. Recordings and exports remain available through the Open buttons."
            )
        )
        start_new = dialog.addButton(
            "Nieuwe run starten" if self.language == "nl" else "Start new run",
            QtWidgets.QMessageBox.ButtonRole.DestructiveRole,
        )
        cancel = dialog.addButton(
            "Annuleren" if self.language == "nl" else "Cancel",
            QtWidgets.QMessageBox.ButtonRole.RejectRole,
        )
        dialog.setDefaultButton(cancel)
        dialog.setEscapeButton(cancel)
        dialog.exec()
        confirmed = dialog.clickedButton() is start_new
        if confirmed:
            self._new_run_confirmation_controller_id = controller.run_id
        return confirmed

    def start_all(self) -> None:
        if self.controller and self.controller.has_resumable_sources():
            self.controller.start_all(run_pipeline=False)
            self._set_status("resumed")
            return
        if self.controller and self.controller.has_running_sources():
            self._set_status("already running")
            return
        if self.controller is not None:
            if not self._confirm_start_new_run():
                self._set_status("new run cancelled; previous run retained")
                return
        if self.connection_context is not None:
            self._refresh_connected_context_before_new_run()
            return
        self._start_fresh_run()

    def _start_fresh_run(self) -> None:
        error = source_count_error(len(self.sources))
        if error:
            QtWidgets.QMessageBox.warning(self, self._tr("Sources"), self._tr(error))
            return
        if not self._capture_devices_are_unique():
            QtWidgets.QMessageBox.warning(
                self,
                self._tr("Sources"),
                (
                    "Dezelfde fysieke capturekaart kan niet voor twee of meer groepen worden gebruikt. "
                    "Verwijder de dubbele bron voordat je start."
                    if self.language == "nl" else
                    "The same physical capture card cannot be used for two or more groups. "
                    "Remove the duplicate source before starting."
                ),
            )
            return
        if not self._all_sources_preflight_ready():
            QtWidgets.QMessageBox.warning(
                self, self._tr("Sources"), self._tr("Video checks are still running or a source failed.")
            )
            self._refresh_start_button_state()
            return
        if not self._confirm_start_without_recording():
            self._set_status("start cancelled — MKV recording remains off")
            return
        speed_label = str(self.speed_combo.currentData() or self.speed_combo.currentText())
        prepared_contexts = {
            source_id: result.context
            for source_id, result in self.preflight_results.items()
            if result.ready and result.context is not None
        }
        # Fresh run -> fresh Frames: stale race bundles from an earlier session
        # are read from disk by the consensus/finalization passes and can
        # contaminate results, so archive them automatically (same as the
        # "Clear Frames folder" button; archived, never deleted).
        try:
            archived = archive_live_frames_folder("gui_start_all_auto_archive")
            if archived.get("archived"):
                self._set_status(f"stale Frames archived to {archived.get('archive_path')}")
        except Exception as exc:  # pragma: no cover - defensive GUI guard
            QtWidgets.QMessageBox.warning(self, self._tr("Start all"), self._tr(f"Could not archive stale Frames: {exc}"))
            return
        if self.controller is not None:
            # The explicit new-run confirmation above protects the old display.
            # Only now, after all start gates passed, clear run-scoped widgets;
            # controller-owned MKV/export artifacts remain untouched on disk.
            self._clear_run_display_state()
            self.controller = None
        self._new_run_confirmation_controller_id = None
        self._hide_stop_progress()
        self.controller = GuiVirtualCaptureController(
            [replace(source, game_locale=self._game_locale(source)) for source in self.sources],
            playback_speed=playback_speed_value(speed_label),
            gate_playback_until_analysis_ready=playback_is_analysis_gated(speed_label),
            prepared_contexts=prepared_contexts,
            record_virtual_feeds=bool(self.record_check.isChecked()),
            # Promote the already-open capture previews into the run (the
            # device is opened once; Start All just enables the taps).
            capture_sessions=dict(self.capture_sessions),
        )
        if self.record_check.isChecked():
            self._recording_feed_health.clear()
            self._recording_alarm_active = False
            self._set_recording_banner("amber", "ARMING MKV RECORDINGS")
        try:
            self.controller.start_all(run_pipeline=True)
        except Exception as exc:
            self._set_recording_banner("red", f"RECORDING ERROR — START CANCELLED: {exc}")
            QtWidgets.QApplication.beep()
            QtWidgets.QMessageBox.critical(self, self._tr("Start all"), self._tr(str(exc)))
            self.controller = None
            self._refresh_start_button_state()
            return
        self._run_clock_started = time.monotonic()
        self._run_clock_frozen: float | None = None
        self.run_clock.setStyleSheet("font-size: 15px; font-weight: 700; color: #27ae60;")
        self._start_resource_sampler_if_monitoring()
        self._register_connected_live_run(self.controller)

    def _register_connected_live_run(self, controller: GuiVirtualCaptureController) -> None:
        context = self.connection_context
        if context is None or SessionStore().load() is None:
            self._connected_live_run_id = None
            self._connected_live_record_id = None
            self._connected_live_started_at_ms = None
            self._connected_live_stop_requested = False
            return
        from mk8dx_tournament_extraction.engine.extract_common import build_video_identity

        source_aliases = dict(context.source_aliases)
        source_display_labels = dict(context.source_display_labels)
        source_group_ids = dict(context.source_group_ids)
        for source in self.sources:
            emitted_label = build_video_identity(Path(source.video_path))
            display_label = self._capture_name(source) or source.stream_label
            source_aliases[emitted_label] = source.stream_label
            source_display_labels[source.stream_label] = display_label
            group_id = source_group_ids.get(source.stream_label)
            if group_id is not None:
                source_group_ids[emitted_label] = group_id
        context = replace(
            context,
            source_aliases=source_aliases,
            source_display_labels=source_display_labels,
            source_group_ids=source_group_ids,
        )
        self.connection_context = context
        self._connection_store.save(context)
        run_id = controller.run_id
        self._connected_live_run_id = run_id
        self._connected_live_record_id = None
        self._connected_live_stop_requested = False
        self._connected_live_registration_failures = 0
        source_labels = [source.stream_label for source in self.sources]
        observed_labels = {
            source.stream_label: self._capture_name(source) or source.stream_label
            for source in self.sources
        }
        started_at_ms = int(time.time() * 1000)
        self._connected_live_started_at_ms = started_at_ms
        self._start_connected_live_registration(
            run_id, context, source_labels, observed_labels, started_at_ms,
        )

    def _start_connected_live_registration(
        self,
        run_id: str,
        context: ConnectionContext,
        source_labels: list[str],
        observed_labels: dict[str, str],
        started_at_ms: int,
    ) -> None:

        def worker() -> None:
            try:
                receipt = ConnectedClient().register_live_run(
                    run_id,
                    context,
                    source_labels,
                    observed_labels=observed_labels,
                    started_at_ms=started_at_ms,
                )
                self._connection_queue.put(("live_registered", (run_id, receipt)))
            except Exception as error:
                self._connection_queue.put(("live_registration_error", (run_id, error)))

        threading.Thread(target=worker, name="tournament-live-register", daemon=True).start()

    def _retry_connected_live_registration(self, run_id: str) -> None:
        controller = self.controller
        context = self.connection_context
        if (run_id != self._connected_live_run_id or self._connected_live_record_id is not None
                or controller is None or controller.run_id != run_id or context is None):
            return
        self._start_connected_live_registration(
            run_id,
            context,
            [source.stream_label for source in self.sources],
            {
                source.stream_label: self._capture_name(source) or source.stream_label
                for source in self.sources
            },
            self._connected_live_started_at_ms or int(time.time() * 1000),
        )

    def _mark_connected_live_stopping(self, run_id: str) -> None:
        record_id = self._connected_live_record_id
        if record_id is None or run_id != self._connected_live_run_id:
            return

        def worker() -> None:
            try:
                ConnectedClient().mark_live_stopping(record_id)
                self._connection_queue.put(("live_stopping", run_id))
            except Exception as error:
                self._connection_queue.put(("live_stopping_error", (run_id, error)))

        threading.Thread(target=worker, name="tournament-live-stopping", daemon=True).start()

    def _start_resource_sampler_if_monitoring(self) -> None:
        from .monitoring import monitoring_enabled

        if not monitoring_enabled() or self._resource_sampler is not None:
            return
        try:
            from .resource_sampler import ResourceSampler

            self._resource_sampler = ResourceSampler()
            self._resource_sampler.start()
            self._set_status("monitoring on: CPU/GPU/RAM sampler started")
        except Exception:
            self._resource_sampler = None

    def _stop_resource_sampler(self) -> None:
        sampler = self._resource_sampler
        self._resource_sampler = None
        if sampler is not None:
            try:
                sampler.stop()
            except Exception:
                pass

    def pause_all(self) -> None:
        if self.controller:
            self.controller.pause_all()
            self._set_status("paused with feeds")

    def resume_all(self) -> None:
        if self.controller:
            self.controller.resume_all()
            self._set_status("resumed")

    def stop_all(self) -> None:
        if not self.controller:
            self._set_status("stopped")
            return
        if self._shutdown_thread and self._shutdown_thread.is_alive():
            self._set_status("stopping...")
            return
        self._stop_resource_sampler()
        controller = self.controller
        if controller.run_id == self._connected_live_run_id:
            self._connected_live_stop_requested = True
            self._mark_connected_live_stopping(controller.run_id)
        self._set_status("stopping feeds and workers...")
        self._show_stop_progress(1)

        def worker() -> None:
            try:
                controller.stop_all()
                self._shutdown_queue.put(("analysis", ""))
                # Final analysis and canonical result delivery are part of Stop;
                # the UI remains responsive because this worker may take as long
                # as the already-offered OCR/consensus jobs require.
                controller.wait(timeout=None)
            except Exception as exc:
                self._shutdown_queue.put(("error", str(exc)))
            else:
                recorder = controller.recorder
                recording_state = (
                    recorder.manifest.state
                    if recorder is not None and recorder.manifest is not None
                    else None
                )
                self._shutdown_queue.put((
                    "pending_delivery"
                    if recording_state == RecordingLifecycle.COMPLETED_WITH_PENDING_DELIVERY
                    else "done",
                    "",
                ))

        self._shutdown_thread = threading.Thread(target=worker, name="qt-stop-all-worker", daemon=True)
        self._shutdown_thread.start()

    def reset_session(self) -> None:
        self.stop_all()
        self.controller = None
        self._new_run_confirmation_controller_id = None
        self._clear_run_display_state()
        self._set_status("idle")
        self._refresh_start_button_state()

    def _clear_run_display_state(self) -> None:
        """Clear only run-scoped presentation state; never remove run artifacts."""

        self._run_clock_started = None
        self._run_clock_frozen = None
        self.run_clock.setText("00:00:00")
        self.run_clock.setStyleSheet("font-size: 15px; font-weight: 700; color: #7f8c8d;")
        self.event_log.clear()
        self.races_found.clear()
        self.races_completed.clear()
        self.analysis_race_states.clear()
        self.finished_sources.clear()
        self.current_tracks.clear()
        self.current_track_metadata.clear()
        self._show_export_attention([], [])
        for stream_label, fw in self.feed_widgets.items():
            source = next((s for s in self.sources if s.stream_label == stream_label), None)
            name = source.video_path.name if source else stream_label
            fw.header.setText(self._tr(format_feed_header(stream_label, name, None, 0, 0)))
            fw.analysis_progress.setText(format_analysis_progress(0, 0, language=self.language))
            fw.analysis_progress.setStyleSheet("color: #b6bcc8; font-weight: 700;")
            fw.race_card.setText(self._tr(format_current_race_card({}, None)))
            fw.cup_icon.setPixmap(QtGui.QPixmap())
            fw.cup_icon.setText("cup")
            fw.track_icon.setPixmap(QtGui.QPixmap())
            fw.track_icon.setText("track")
            fw.provisional_header.setText(self._tr("Latest race: waiting for next race"))
            fw.provisional_table.setRowCount(0)
            fw.standings_table.setRowCount(0)
        self.broadcast_state.reset()
        self.broadcast_server.reset()

    # --------------------------------------------------------------- events
    def _update_run_clock(self) -> None:
        started = getattr(self, "_run_clock_started", None)
        if started is None:
            return
        frozen = getattr(self, "_run_clock_frozen", None)
        if frozen is None and not self._run_is_active() and not self._shutdown_in_progress():
            # Run ended: freeze the clock at its final time and dim it.
            self._run_clock_frozen = time.monotonic() - started
            self.run_clock.setStyleSheet("font-size: 15px; font-weight: 700; color: #7f8c8d;")
        elapsed = frozen if frozen is not None else (time.monotonic() - started)
        hours, remainder = divmod(int(elapsed), 3600)
        minutes, seconds = divmod(remainder, 60)
        self.run_clock.setText(f"{hours:02d}:{minutes:02d}:{seconds:02d}")

    def _poll_events(self) -> None:
        self._poll_connection_updates()
        self._maybe_retry_upload_automatically()
        self._poll_shutdown_updates()
        self._poll_preflight_updates()
        self._poll_capture_liveness()
        self._update_run_clock()
        self._refresh_start_button_state()
        if self.controller:
            events = self.controller.event_bus.poll(1000)
            events.sort(key=lambda item: item.event_type == "FRAME_DECODED")
            previous_log_count = self.event_log.count()
            for event in events:
                self._handle_event(event)
            if self.event_log.count() != previous_log_count:
                self.event_log.scrollToBottom()
        self._refresh_preview_frames()
        if self._closing and (self._shutdown_thread is None or not self._shutdown_thread.is_alive()):
            QtWidgets.QApplication.quit()

    def _poll_shutdown_updates(self) -> None:
        while True:
            try:
                status, detail = self._shutdown_queue.get_nowait()
            except queue.Empty:
                break
            if status == "done":
                self._set_status("stopped")
                self._show_stop_progress(5, state="complete")
                self._reopen_capture_previews()
            elif status == "pending_delivery":
                self._set_status("stopped locally; Tournament Manager delivery remains queued")
                self._show_stop_progress(5, state="pending_delivery")
                self._update_retry_upload_button()
                self._reopen_capture_previews()
            elif status == "waiting":
                self._set_status("results retained; waiting for Tournament Manager delivery; Retry upload")
                self._show_stop_progress(4, state="waiting")
                self._reopen_capture_previews()
            elif status == "analysis":
                self._show_stop_progress(
                    2,
                    found=sum(self.races_found.values()),
                    confirmed=sum(self.races_completed.values()),
                )
            elif status == "export_error":
                self._set_status(f"export failed: {detail}")
                self._show_stop_progress(max(3, self._stop_progress_stage), state="failed")
            elif status == "recovery_done":
                self._set_recording_banner("green", "RECORDINGS SAFELY SAVED")
                self._set_status("previous recordings recovered")
            elif status == "recovery_error":
                self._set_recording_banner("red", f"RECORDING ERROR — RECOVERY FAILED: {detail}")
                self._set_status(f"recording recovery failed: {detail}")
            else:
                self._set_status(f"stop failed: {detail}")
                self._show_stop_progress(max(1, self._stop_progress_stage), state="failed")

    def _reopen_capture_previews(self) -> None:
        """After Stop All, bring the capture previews back so the operator keeps
        seeing the live signal (and Start All can re-gate on liveness)."""
        if self._closing:
            return
        configured = {s.source_id for s in self.sources if s.is_capture}
        for source_id, session in self.capture_sessions.items():
            if source_id in configured and session.state in {"stopped", "ready"}:
                try:
                    session.open()
                except RuntimeError:
                    pass  # surfaced as "no signal" by the liveness poll

    def _display_stream_label(self, event: LiveEvent) -> str:
        return resolve_display_stream_label(
            event.stream_label, event.source_id, self.sources, set(self.feed_widgets)
        )

    def _handle_event(self, event: LiveEvent) -> None:
        display_stream = self._display_stream_label(event)
        if event.event_type != "FRAME_DECODED":
            line = (
                f"{event.event_type} {display_stream} race={event.race_sequence or ''} "
                f"frame={event.frame_index or ''} {event.message}"
            )
            self.event_log.addItem(line)

        if event.event_type == "SCOREBOARD_UPDATED":
            self.races_completed[display_stream] = self.races_completed.get(display_stream, 0) + 1
            if event.race_sequence is not None:
                self.analysis_race_states.setdefault(display_stream, {})[int(event.race_sequence)] = "confirmed"
            rows = event.data.get("rows", [])
            self._set_status(f"standings updated for {display_stream} ({len(rows)} drivers)")
            self._update_standings(display_stream, rows, event.race_sequence)
            self.broadcast_state.feed(display_stream).apply_confirmed(rows, event.race_sequence)
            self._refresh_analysis_progress(display_stream)
            self._publish_broadcast(display_stream)
        elif event.event_type == "PROVISIONAL_RACE_RESULT_OCR_STARTED":
            fw = self.feed_widgets.get(display_stream)
            if fw is not None:
                fw.provisional_header.setText(self._tr(f"Latest race: reading results for race {event.race_sequence or '-'}"))
            self._set_status(f"reading latest race results for {display_stream}")
        elif event.event_type == "PROVISIONAL_RACE_RESULT_UPDATED":
            self._set_status(f"latest race results ready for {display_stream}")
            self._update_provisional(display_stream, event.data.get("rows", []), event.race_sequence)
            self.broadcast_state.feed(display_stream).apply_provisional(event.data.get("rows", []), event.race_sequence)
            self._publish_broadcast(display_stream)
        elif event.event_type == "PROVISIONAL_RACE_RESULT_FAILED":
            fw = self.feed_widgets.get(display_stream)
            if fw is not None:
                fw.provisional_header.setText(self._tr(f"Latest race {event.race_sequence or '-'}: couldn't read results"))
            self._set_status(f"couldn't read latest race for {display_stream}")
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
            self._set_status(detail)
            payload = dict(event.data)
            payload["message"] = detail
            if event.race_sequence is not None:
                self.analysis_race_states.setdefault(display_stream, {})[int(event.race_sequence)] = status
            self.broadcast_state.feed(display_stream).apply_consensus_status(status, payload, event.race_sequence)
            self._refresh_analysis_progress(display_stream)
            self._publish_broadcast(display_stream)
        elif event.event_type == "RACE_ANCHOR_DETECTED":
            self.races_found[display_stream] = self.races_found.get(display_stream, 0) + 1
            if event.race_sequence is not None:
                self.analysis_race_states.setdefault(display_stream, {}).setdefault(
                    int(event.race_sequence), "detected"
                )
            self._set_status(f"new race detected for {display_stream}")
            self._refresh_feed_header(display_stream)
            self._refresh_analysis_progress(display_stream)
            self.broadcast_state.feed(display_stream).apply_anchor()
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
            self._refresh_race_card(display_stream, event.race_sequence)
            self._set_status(f"track identified for {display_stream}: {self.current_tracks[display_stream]}")
            self._refresh_feed_header(display_stream)
            self.broadcast_state.feed(display_stream).apply_track(dict(event.data), event.race_sequence)
            self._publish_broadcast(display_stream)
        elif event.event_type == "TRACK_NAME_OCR_STARTED":
            self._set_status(f"reading track name for {display_stream}")
        elif event.event_type == "TRACK_NAME_OCR_FAILED":
            self._set_status(f"couldn't read track name for {display_stream}: {event.message}")
        elif event.event_type == "ANALYSIS_STARTED":
            self._set_status("analyzing race footage")
        elif event.event_type == "ANALYSIS_COMPLETED":
            self._set_status("analysis complete")
        elif event.event_type == "LIVE_WORKBOOK_UPDATED":
            export_type = str(event.data.get("export_type") or "current")
            files = event.data.get("files") or {}
            workbook = files.get("workbook", "")
            connected_feed = str(event.data.get("connected_feed") or "")
            if connected_feed.startswith("uploaded:"):
                uploaded = connected_feed.partition(":")[2]
                message = (
                    f"{uploaded} uitslag(en) naar Tournament Manager verzonden; lokale werkmap bijgewerkt"
                    if self.language == "nl"
                    else f"{uploaded} result(s) sent to Tournament Manager; local workbook updated"
                )
                self.status_line.setText(f"Status: {message}")
            elif connected_feed.startswith("offline_or_queued"):
                message = (
                    "Uitslag lokaal bewaard; upload staat klaar voor Opnieuw proberen"
                    if self.language == "nl"
                    else "Result retained locally; upload is ready for Retry"
                )
                self.status_line.setText(f"Status: {message}")
                self._update_retry_upload_button()
            elif connected_feed == "offline":
                message = (
                    "Uitslag lokaal bewaard; offline werken blijft actief"
                    if self.language == "nl"
                    else "Result retained locally; continuing offline"
                )
                self.status_line.setText(f"Status: {message}")
            else:
                self._set_status(f"{export_type} workbook updated: {workbook}")
        elif event.event_type == "LIVE_WORKBOOK_FAILED":
            self._set_status(f"workbook export failed: {event.message}")
        elif event.event_type == "LIVE_EXPORT_ATTENTION":
            self._show_export_attention(
                list(event.data.get("races") or []),
                list(event.data.get("late_starts") or []),
            )
        elif event.event_type == "SOURCE_STARTED":
            self.finished_sources.discard(display_stream)
            self._set_status(f"feed started for {display_stream}")
            self._refresh_analysis_progress(display_stream)
            # Refresh the overlay header (tournament title + waiting) right away.
            self._publish_broadcast(display_stream)
        elif event.event_type in {"SOURCE_ENDED", "SOURCE_STOPPED"}:
            self.finished_sources.add(display_stream)
            self._refresh_analysis_progress(display_stream)
        elif event.event_type == "SOURCE_FAILED":
            self._set_status("a video feed failed")
        elif event.event_type == "SOURCE_SIGNAL_LOST":
            self._set_status(f"capture signal lost on {display_stream} (retrying)")
        elif event.event_type == "SOURCE_SIGNAL_RESTORED":
            self._set_status(f"capture signal restored on {display_stream}")
        elif event.event_type == "CAPTURE_BORDERS_DETECTED":
            self._set_status(f"black borders on {display_stream} — fix playback fullscreen/overscan")
        elif event.event_type == "CAPTURE_BORDERS_CLEARED":
            self._set_status(f"{display_stream} fills the frame again")
        elif event.event_type == "CAPTURE_BORDER_CALIBRATED":
            self._set_status(f"border calibration {display_stream}: {(event.message or '')[:80]}")
        elif event.event_type == "RECORDING_STARTED":
            self._set_status(f"recording {display_stream} to MKV")
            self._update_recording_health(display_stream, event.data)
        elif event.event_type == "RECORDING_STATUS":
            self._update_recording_health(display_stream, event.data)
        elif event.event_type == "RECORDING_FAILED":
            self._update_recording_health(display_stream, event.data, failed=True)
            self._set_status(f"recording failed for {display_stream}: {event.message}")
        elif event.event_type == "RECORDING_LIFECYCLE":
            lifecycle = str(event.data.get("state") or "")
            progress = {
                "stopping_capture": "Stopping capture…",
                "closing_working_parts": "Closing MKV working parts…",
                "draining_final_analysis": "Completing final analysis…",
                "finalizing_results": "Finalizing local results…",
                "persisting_ecosystem_data": "Saving ecosystem data…",
                "delivering_connected_results": "Delivering results to Tournament Manager…",
                "waiting_for_ecosystem_delivery": "Waiting for Tournament Manager delivery — recordings retained",
                "assembling_recordings": "Assembling recordings…",
                "verifying_recordings": "Verifying recordings…",
            }
            stop_stage = {
                "stopping_capture": 1,
                "closing_working_parts": 1,
                "draining_final_analysis": 2,
                "finalizing_results": 3,
                "persisting_ecosystem_data": 3,
                "delivering_connected_results": 4,
                "waiting_for_ecosystem_delivery": 4,
                "assembling_recordings": 5,
                "verifying_recordings": 5,
            }
            if lifecycle in progress:
                self._set_recording_banner("amber", progress[lifecycle])
                self._show_stop_progress(
                    stop_stage[lifecycle],
                    state="waiting" if lifecycle == "waiting_for_ecosystem_delivery" else "active",
                    found=sum(self.races_found.values()),
                    confirmed=sum(self.races_completed.values()),
                )
            elif lifecycle == "completed":
                self._set_recording_banner("green", "RECORDINGS SAFELY SAVED")
                self._show_stop_progress(5, state="complete")
            elif lifecycle == "completed_with_pending_delivery":
                self._set_recording_banner("amber", "RECORDINGS SAFE — TOURNAMENT MANAGER DELIVERY PENDING")
                self._show_stop_progress(5, state="pending_delivery")
            elif lifecycle in {"completed_with_evidence_gaps", "finalization_failed", "arming_failed"}:
                self._set_recording_banner("red", f"RECORDING ERROR — {event.message or lifecycle}")
                self._show_stop_progress(max(1, self._stop_progress_stage), state="failed")
        elif event.event_type == "RECORDING_COMPLETED":
            self._set_status(f"recording completed for {display_stream}")

    def _update_standings(self, stream_label: str, rows: list[dict[str, Any]], race_sequence: int | None) -> None:
        fw = self.feed_widgets.get(stream_label)
        if fw is None:
            self._set_status(f"standings update had no matching feed for {stream_label}")
            return
        # format_standings_rows -> (pos, character, driver, this_race, after_race, total)
        # Drop "after_race" (index 4): it duplicates "total" in confirmed standings.
        standings = [
            (row[0], row[1], row[2], row[3], row[5])
            for row in format_standings_rows(rows, race_sequence)
        ]
        self._fill_table(fw.standings_table, standings, icon_col=1)
        self._refresh_feed_header(stream_label)

    def _update_provisional(self, stream_label: str, rows: list[dict[str, Any]], race_sequence: int | None) -> None:
        fw = self.feed_widgets.get(stream_label)
        if fw is None:
            self._set_status(f"latest-race update had no matching feed for {stream_label}")
            return
        self._fill_table(fw.provisional_table, format_race_result_rows(rows), icon_col=1)
        fw.provisional_header.setText(
            self._tr(f"Latest race {race_sequence or '-'}: {len(rows)} drivers · awaiting confirmation")
        )
        self._refresh_race_card(stream_label, race_sequence)

    def _refresh_feed_header(self, stream_label: str) -> None:
        fw = self.feed_widgets.get(stream_label)
        if fw is None:
            return
        source = next((s for s in self.sources if s.stream_label == stream_label), None)
        name = source.video_path.name if source else stream_label
        fw.header.setText(
            self._tr(format_feed_header(
                stream_label,
                name,
                self.current_tracks.get(stream_label, "waiting for detection"),
                self.races_found.get(stream_label, 0),
                self.races_completed.get(stream_label, 0),
            ))
        )

    def _refresh_analysis_progress(self, stream_label: str) -> None:
        fw = self.feed_widgets.get(stream_label)
        if fw is None:
            return
        states = self.analysis_race_states.get(stream_label, {})
        running = sum(1 for state in states.values() if state == "running")
        source = next((item for item in self.sources if item.stream_label == stream_label), None)
        found = self.races_found.get(stream_label, 0)
        confirmed = self.races_completed.get(stream_label, 0)
        fw.analysis_progress.setText(format_analysis_progress(
            found,
            confirmed,
            running,
            source_finished=stream_label in self.finished_sources,
            is_capture=bool(source and source.is_capture),
            language=self.language,
        ))
        if found > 0 and confirmed >= found:
            color = "#2ecc71"
        elif found > confirmed:
            color = "#f39c12"
        else:
            color = "#b6bcc8"
        fw.analysis_progress.setStyleSheet(f"color: {color}; font-weight: 700;")
        shutdown_in_progress = getattr(self, "_shutdown_in_progress", lambda: False)
        if shutdown_in_progress() and getattr(self, "_stop_progress_stage", 0) <= 2:
            self._show_stop_progress(
                2,
                found=sum(self.races_found.values()),
                confirmed=sum(self.races_completed.values()),
            )

    def _refresh_race_card(self, stream_label: str, race_sequence: int | None) -> None:
        fw = self.feed_widgets.get(stream_label)
        if fw is None:
            return
        metadata = self.current_track_metadata.get(stream_label, {})
        fw.race_card.setText(self._tr(format_current_race_card(metadata, race_sequence)))
        from .display_assets import canonical_asset_file, resolve_track_assets

        assets = resolve_track_assets(metadata)
        cup_path = canonical_asset_file(assets["cupIconPath"]) if assets else None
        track_path = canonical_asset_file(assets["previewPath"]) if assets else None
        cup_pix = self._pixmap_icon(cup_path, 40) if cup_path else None
        track_pix = self._pixmap_icon(track_path, 40) if track_path else None
        if cup_pix is not None:
            fw.cup_icon.setPixmap(cup_pix)
            fw.cup_icon.setText("")
        else:
            fw.cup_icon.clear()
        if track_pix is not None:
            fw.track_icon.setPixmap(track_pix)
            fw.track_icon.setText("")
        else:
            fw.track_icon.clear()

    # --------------------------------------------------------------- close
    def closeEvent(self, event: QtGui.QCloseEvent) -> None:  # noqa: N802 - Qt API
        if self._closing:
            event.accept()
            return
        self._closing = True
        try:
            self.broadcast_server.stop()
        except Exception:
            pass
        # Stop capture previews so no ffmpeg reader outlives the GUI. Parallel:
        # each stop is quick (killing ffmpeg unblocks the reader thread).
        stoppers = [
            threading.Thread(target=session.stop, daemon=True)
            for session in self.capture_sessions.values()
        ]
        for stopper in stoppers:
            stopper.start()
        for stopper in stoppers:
            stopper.join(timeout=6.0)
        if self.controller and (self.controller.has_running_sources() or self.controller.has_resumable_sources()):
            self.stop_all()
            self._set_status("stopping feeds before exit...")
            event.ignore()  # _poll_events quits once the stop worker finishes
        else:
            event.accept()


def main(progress: Callable[[str], None] | None = None) -> int:
    progress = progress or (lambda _message: None)
    progress("Creating Qt application.")
    app = QtWidgets.QApplication.instance() or QtWidgets.QApplication([])
    progress("Applying Qt font and theme.")
    app.setFont(_valid_qfont())
    app.setStyleSheet(build_qss())
    progress("Constructing main window.")
    window = Mk8dxQtGui(progress=progress)
    progress("Positioning main window inside the visible desktop.")
    _place_window_on_visible_desktop(window, app)
    progress("Showing main window.")
    window.show()
    progress("GUI ready. Load videos to start preflight checks.")
    # Fire once the event loop has processed the first paint -> true "GUI visible"
    # moment (window.show() only schedules the paint). Completes the startup chain.
    QtCore.QTimer.singleShot(0, lambda: progress("GUI visible (first paint)"))
    # Warm the OCR/analysis engine in the background after the window is visible,
    # so torch/EasyOCR/CUDA load off the startup critical path. Recording and
    # screenshot capture do not depend on it.
    QtCore.QTimer.singleShot(0, window.start_ocr_warmup)
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
