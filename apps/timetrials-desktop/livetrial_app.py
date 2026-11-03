"""A plain-language LiveTrial console for people who do not use flags.

This is deliberately a thin shell: every action is performed by the same
functions the command line uses, so there is one implementation of signing in,
saving runs and synchronising, and one place where security decisions live.

House rules for everything printed here:

* no stack traces, no exception text, no failure identifiers without a sentence;
* no bearer tokens, and no local evidence paths - a person already knows which
  file they picked, and the console output is the thing that gets screenshotted.
"""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import time
import webbrowser
import urllib.request
import threading
from typing import Callable, Mapping

import livetrial_product_cli as cli
import livetrial_dashboard as dashboard
from livetrial_account_actions import LiveTrialAccountActions
from livetrial_capture_requirements import (
    capture_requirements,
    ffmpeg_found_lines,
    missing_ffmpeg_lines,
)
from livetrial_product import create_local_profile_document, write_new_local_profile
from livetrial_capture_devices import (
    SNAPSHOT_FILE_NAME,
    engine_device_argument,
    list_video_devices,
    take_snapshot,
)
from livetrial_capture_requirements import find_ffmpeg
from livetrial_reference import write_reference_from_cache
from livetrial_updates import CURRENT_WINDOWS_VERSION
from livetrial_languages import LANGUAGES, label as language_label, parse_language, translate, uses_catalog
from livetrial_settings import read_settings, write_auto_sync, write_capture_device, write_language
from livetrial_ecosystem import (
    fetch_rank_comparison,
    load_cached_progress,
    player_progress_lines,
    player_progress_view,
    public_rank_view,
    refresh_player_progress,
)
from livetrial_corrections import (
    create_corrected_revision,
    format_time,
    latest_records,
    parse_time,
)
from livetrial_runtime_root import bundled_vision_python, bundled_vision_runtime_root
from livetrial_updates import remember_support_floor, update_from_status, windows_release_status


RUNTIME_ROOT_VARIABLE = "MK8DX_LIVETRIAL_RUNTIME_ROOT"


class _Quit(Exception):
    """The person closed the console."""


_MENU = (
    ("1", "Add an account"),
    ("2", "Switch account"),
    ("3", "Remove an account"),
    ("4", "Analyze a video"),
    ("5", "Capture from the capture card"),
    ("6", "Save a run from a finished report"),
    ("7", "Send all waiting results"),
    ("8", "Check capture requirements"),
    ("9", "Open local dashboard and run history"),
    ("10", "Change automatic send setting"),
    ("11", "Refresh Player progress and rivals"),
    ("12", "Correct a recognized result"),
    ("13", "Change language / Taal wijzigen"),
    ("0", "Quit"),
)

# Plain-language meaning for every bounded outcome a person can actually hit.
_EXPLANATIONS = {
    cli.ACCOUNT_LOCAL_PROFILE_ENTRY: (
        "was recorded while nobody was signed in, so it stays on this PC only"
    ),
    cli.ACCOUNT_UNKNOWN_OWNER: (
        "belongs to a player who is not remembered on this PC any more"
    ),
    cli.ACCOUNT_PLAYER_MISMATCH: (
        "does not match the remembered account that produced it"
    ),
    cli.ACCOUNT_REAUTHORIZATION_REQUIRED: (
        "belongs to an account that has to sign in again"
    ),
    cli.ACCOUNT_SYNCHRONIZATION_UNAVAILABLE: "could not be sent right now",
    "http.unauthorized": "was refused; that account has to sign in again",
    "http.forbidden": "was refused by the server",
    "http.conflict": "was already known to the server",
    "http.unavailable": "could not reach the server",
    "http.failed": "was not accepted by the server",
    "http.implausible-time": (
        "was refused: the proposed time is highly unreasonable, please double check all information"
    ),
    "evidence.not_allowlisted": "does not carry the expected local evidence",
    "response.invalid": "got an answer the app does not trust",
}


def _explain(failure_code: object) -> str:
    if isinstance(failure_code, str) and failure_code in _EXPLANATIONS:
        return _EXPLANATIONS[failure_code]
    return "could not be sent"


def _open_with_default_viewer(path: str) -> None:
    """Show a picture the way Windows would on a double-click."""
    starter = getattr(os, "startfile", None)
    if starter is not None:
        starter(path)
        return
    if not webbrowser.open(Path(path).resolve().as_uri()):
        raise OSError("no viewer")


class LiveTrialConsole:
    """One menu-driven session over the product's own command functions."""

    def __init__(
        self,
        environment: Mapping[str, str] = os.environ,
        ask: Callable[[str], str] = input,
        say: Callable[[str], None] = print,
        api_origin: str = cli.DEFAULT_API_ORIGIN,
        open_browser: Callable[[str], bool] = webbrowser.open,
        list_devices: Callable[[str], list] = list_video_devices,
        snapshot: Callable[[str, str, str], bool] = take_snapshot,
        open_file: Callable[[str], None] | None = None,
    ) -> None:
        self._environment = dict(environment)
        self._ask = ask
        self._raw_say = say
        self._api_origin = api_origin
        self._open_browser = open_browser
        self._list_devices = list_devices
        self._take_snapshot = snapshot
        self._open_file = open_file or _open_with_default_viewer
        root = cli.product_data_root(self._environment)
        self._data_root = root
        self._profile = root / "profile.json"
        self._accounts_root = root / "accounts"
        self._session = root / "auth-session.dat"
        self._canonical_root = root / "canonical-outbox"
        self._private_root = root / "private-evidence"
        self._say = self._emit
        self._runtime_root = self._environment.get(RUNTIME_ROOT_VARIABLE) or ""
        self._dashboard_process: subprocess.Popen[bytes] | None = None
        self._progress_dashboard: dashboard.ProgressDashboard | None = None
        try:
            # The engine's run history page shows the same favicon as the dashboard.
            icon = dashboard.product_icon_path(dashboard.dashboard_root(self._environment))
            if icon is not None:
                os.environ.setdefault(dashboard.PRODUCT_ICON_VARIABLE, str(icon))
        except Exception:
            pass

    # -- product access ----------------------------------------------------

    def _now_ms(self) -> int:
        return time.time_ns() // 1_000_000

    def _directory(self):
        return cli.account_directory(self._accounts_root, self._session, self._now_ms())

    def _owners(self):
        return cli.entry_owner_index(self._accounts_root)

    def _outbox(self):
        return cli.open_outbox(str(self._canonical_root), str(self._private_root))

    def _command(self, arguments: list[str]) -> int:
        """Run one product command exactly as the command line would."""
        return cli.main(arguments, self._environment)

    def _language(self) -> str:
        try:
            return str(read_settings(self._data_root).get("language", "en"))
        except Exception:
            return "en"

    def _localized(self, value: str) -> str:
        language = self._language()
        if uses_catalog(language):
            # The other game languages read their text from the shared catalogs (livetrial_languages.py).
            return translate(language, value)
        if language != "nl" or not value:
            return value
        exact = {
            "Welcome to MK8DX Time Trials for Windows PC.": "Welkom bij MK8DX Time Trials voor Windows-pc.",
            "Choose": "Kies",
            "Sign in again now? (y/n) [y]": "Nu opnieuw aanmelden? (j/n) [j]",
            "Goodbye.": "Tot ziens.",
            "nobody signed in (runs are still recorded and kept on this PC)": "niemand aangemeld (ritten worden nog steeds op deze pc vastgelegd en bewaard)",
            "Please type one of the numbers above.": "Typ een van de bovenstaande nummers.",
            "There is nothing waiting to be sent.": "Er wacht niets op verzending.",
            "Language / Taal: Nederlands.": "Taal / Language: Nederlands.",
            "Language / Taal: English.": "Taal / Language: Engels.",
            "Type en for English or nl for Nederlands": "Typ en voor Engels of nl voor Nederlands",
            "Video devices on this PC:": "Videoapparaten op deze pc:",
            "No video device was found on this PC.": "Er is geen videoapparaat gevonden op deze pc.",
            "Connect the capture card, wait a few seconds and try again.": "Sluit de capturekaart aan, wacht een paar seconden en probeer het opnieuw.",
            "It may be in use by another program (OBS, a browser), or it is not the capture card.": "Mogelijk is het in gebruik door een ander programma (OBS, een browser), of het is niet de capturekaart.",
            "Try another device? (y/n) [y]": "Een ander apparaat proberen? (j/n) [j]",
            "The picture has opened in your image viewer.": "De foto is geopend in je fotoviewer.",
            "Is that your Switch? (y/n) [y]": "Is dat je Switch? (j/n) [j]",
            "Capturing. This menu is not available while capturing.": "Bezig met opnemen. Dit menu is tijdens het opnemen niet beschikbaar.",
            "  - To stop and come back to this menu: press Ctrl+C in this window,": "  - Stoppen en terug naar dit menu: druk op Ctrl+C in dit venster,",
            "    or click Stop capture on the dashboard.": "    of klik op Opname stoppen op het dashboard.",
            "  - The dashboard with the live picture opens in your browser by itself;": "  - Het dashboard met het livebeeld opent vanzelf in je browser;",
            "    it is at http://127.0.0.1:8777/ if you close it.": "    het staat op http://127.0.0.1:8777/ als je het sluit.",
            "That is not one of the numbers above.": "Dat is niet een van de bovenstaande nummers.",
        }
        if value in exact:
            return exact[value]
        replacements = (
            ("Open local dashboard and run history", "Lokaal dashboard en ritgeschiedenis openen"),
            ("Refresh Player progress and rivals", "Spelervoortgang en rivalen vernieuwen"),
            ("Capture from the capture card", "Opnemen via de capturekaart"),
            ("Which one is the capture card? Type its number", "Welke is de capturekaart? Typ het nummer"),
            ("(used last time)", "(vorige keer gebruikt)"),
            ("Taking a picture from ", "Er wordt een foto gemaakt van "),
            (" to check it is the right one. This takes a few seconds while the device starts...", " om te controleren of het de juiste is. Dit duurt een paar seconden terwijl het apparaat opstart..."),
            ("No picture came from ", "Er kwam geen beeld van "),
            ("The picture is saved as ", "De foto is opgeslagen als "),
            ("Save a run from a finished report", "Een rit uit een voltooid rapport opslaan"),
            ("Send all waiting results", "Alle wachtende resultaten verzenden"),
            ("Check capture requirements", "Opnamevereisten controleren"),
            ("Change automatic send setting", "Instelling automatisch verzenden wijzigen"),
            ("Correct a recognized result", "Een herkend resultaat corrigeren"),
            ("Change language / Taal wijzigen", "Taal wijzigen / Change language"),
            ("Analyze a video", "Een video analyseren"),
            ("Add an account", "Een account toevoegen"),
            ("Sign in again as", "Opnieuw aanmelden als"),
            (" needs to sign in again: until then results wait on this PC and progress is not refreshed.", " moet opnieuw aanmelden: tot die tijd wachten resultaten op deze pc en wordt de voortgang niet vernieuwd."),
            ("Switch account", "Van account wisselen"),
            ("Remove an account", "Een account verwijderen"),
            ("Quit", "Afsluiten"),
            ("Player progress", "Spelervoortgang"),
            ("Player", "Speler"),
            ("nobody signed in (runs are still recorded and kept on this PC)", "niemand aangemeld (ritten worden nog steeds op deze pc vastgelegd en bewaard)"),
            ("Connected to", "Verbonden met"),
            ("Waiting to send", "Wacht op verzending"),
            ("Automatic send", "Automatisch verzenden"),
            ("Nothing was changed", "Er is niets gewijzigd"),
            ("Nothing was lost", "Er is niets verloren gegaan"),
            ("Goodbye", "Tot ziens"),
            ("Dashboard opened at", "Dashboard geopend op"),
            ("Sign in", "Meld je aan"),
            ("Saved results", "Opgeslagen resultaten"),
            ("waiting results", "wachtende resultaten"),
            ("recognized result", "herkend resultaat"),
            ("One result", "Eén resultaat"),
            ("results are safe", "resultaten zijn veilig"),
            ("results stay on this PC", "resultaten blijven op deze pc"),
            (" : Off", " : Uit"),
            (" : On", " : Aan"),
            ("unknown", "onbekend"),
            ("Track", "Circuit"),
            ("Character", "Coureur"),
            ("Body", "Chassis"),
            ("Tires", "Banden"),
            ("Glider", "Paraglider"),
        )
        translated = value
        for english, dutch in replacements:
            translated = translated.replace(english, dutch)
        return translated

    def _emit(self, value: str) -> None:
        self._raw_say(self._localized(value))

    def _ensure_profile(self) -> None:
        """A first run must not fail merely because no local profile exists."""
        try:
            if self._profile.exists():
                return
            write_new_local_profile(
                self._profile,
                create_local_profile_document("livetrial-desktop"),
            )
        except Exception:
            return

    # -- rendering ---------------------------------------------------------

    def _pending_count(self) -> int | None:
        try:
            return cli.waiting_count(self._outbox())
        except Exception:
            return None

    def _current_player(self) -> str:
        try:
            account = cli.active_account(self._directory(), self._now_ms())
        except Exception:
            account = None
        if account is None:
            return "nobody signed in (runs are still recorded and kept on this PC)"
        if not account["signedIn"]:
            return f"{cli.account_label(account)} (needs to sign in again)"
        return cli.account_label(account)

    def _expired_account(self) -> dict | None:
        """The account in use when its sign-in has run out, else None."""
        try:
            account = cli.active_account(self._directory(), self._now_ms())
        except Exception:
            return None
        return account if account is not None and not account["signedIn"] else None

    def _offer_sign_in_again(self) -> None:
        """Ask once at start: an expired sign-in silently freezes progress and sending."""
        account = self._expired_account()
        if account is None:
            return
        name = cli.account_label(account)
        self._say(f"{name} needs to sign in again: until then results wait on this PC and progress is not refreshed.")
        if self._prompt("Sign in again now? (y/n) [y]").lower() in {"", "y", "yes", "j", "ja"}:
            self._add_account()

    def _header(self) -> None:
        pending = self._pending_count()
        self._say("")
        self._say("MK8DX TIME TRIALS | WINDOWS PC")
        self._say(f"  Player          : {self._current_player()}")
        self._say(f"  Connected to    : {self._api_origin}")
        self._say(
            "  Waiting to send : "
            + ("unknown" if pending is None else str(pending))
        )
        self._say(
            "  Automatic send : "
            + ("On" if self._automatic_send_enabled() else "Off")
        )
        self._say("")
        expired = self._expired_account()
        if expired is not None:
            self._say(f"  S) Sign in again as {cli.account_label(expired)}")
        for key, label in _MENU:
            self._say(f"  {key}) {label}")
        self._say("")

    def _accounts(self) -> list[dict]:
        try:
            return cli.account_listing(self._directory(), self._now_ms())
        except Exception:
            return []

    def _automatic_send_enabled(self) -> bool:
        return read_settings(cli.product_data_root(self._environment))[
            "autoSyncCompletedRuns"
        ]

    def _change_automatic_send(self) -> None:
        current = self._automatic_send_enabled()
        self._say("Automatic send is currently " + ("on." if current else "off."))
        answer = self._prompt(
            "Type on to send each completed run, or off to keep manual sending"
        ).lower()
        if answer not in {"on", "off"}:
            self._say("Nothing was changed. Please type on or off next time.")
            return
        enabled = answer == "on"
        write_auto_sync(cli.product_data_root(self._environment), enabled)
        self._say(
            "Automatic send is now on. Runs are still saved locally first."
            if enabled
            else "Automatic send is now off. Use Send all waiting results when ready."
        )

    def _change_language(self) -> None:
        settings = read_settings(cli.product_data_root(self._environment))
        self._say(f"Language / Taal: {language_label(settings['language'])}.")
        for code, name, _ in LANGUAGES:
            self._say(f"  {code:<7} {name}")
        answer = parse_language(self._prompt("Type a language code, for example en, nl or de"))
        if answer is None:
            self._say("Nothing was changed / Er is niets gewijzigd.")
            return
        write_language(cli.product_data_root(self._environment), answer)
        self._say(
            "Taal opgeslagen. Open het dashboard opnieuw om deze toe te passen."
            if answer == "nl"
            else translate(answer, "Language saved. Reopen the dashboard to apply it.")
        )

    def _player_progress(self) -> None:
        directory = self._directory()
        active = directory.active()
        if active is None:
            self._say("Sign in and choose a Player before loading progress.")
            return
        try:
            cache = refresh_player_progress(
                self._data_root,
                active["playerId"],
                directory.store(active["slotId"]),
                self._api_origin,
                self._now_ms,
            )
            self._say("Player progress refreshed from example.invalid.")
        except Exception:
            cache = load_cached_progress(self._data_root, active["playerId"])
            if cache is None:
                self._say("Player progress is unavailable right now. Capture and saved runs still work.")
                return
            self._say("Showing the last safely cached Player progress while offline.")
        self._write_reference()
        try:
            for line in player_progress_lines(cache):
                self._say(line)
        except Exception:
            self._say("Player progress could not be displayed. Capture and saved runs still work.")

    def _dashboard_progress(self, refresh: bool, track_catalog: dict) -> dict:
        pending = self._pending_count()
        directory = self._directory()
        active = directory.active()
        if active is None:
            try:
                return {
                    "status": "public",
                    "message": "Public community Rank · Nintendo Ghost selected as reference.",
                    "view": public_rank_view(self._api_origin, track_catalog),
                    "pendingCount": pending,
                }
            except Exception:
                return {"status": "unavailable", "message": "Public Rank is unavailable right now.", "pendingCount": pending}
        cache = None
        status = "cached"
        message = "Showing the latest safe offline copy."
        if refresh:
            try:
                cache = refresh_player_progress(
                    self._data_root,
                    active["playerId"],
                    directory.store(active["slotId"]),
                    self._api_origin,
                    self._now_ms,
                )
                status = "live"
                message = "Up to date with example.invalid."
            except Exception:
                cache = None
        if cache is None:
            cache = load_cached_progress(self._data_root, active["playerId"])
        if cache is None:
            document = {
                "status": "unavailable",
                "message": "Progress is unavailable right now. Capture and local run history still work.",
                "pendingCount": pending,
            }
            # Signed out with nothing saved on this PC yet: say so and offer the sign-in,
            # rather than a bare "unavailable" (found in the 2026-09-27 mirror run).
            if self._expired_account() is not None:
                document["needsSignIn"] = cli.account_label(active)
            return document
        try:
            result = {
                "status": status,
                "message": message,
                "view": player_progress_view(cache, track_catalog),
                "pendingCount": pending,
            }
            if self._expired_account() is not None:
                # The dashboard says how old the copy is and how to fix it.
                result["needsSignIn"] = cli.account_label(active)
            # The update reminder is part of the permanent notification
            # surface, not of the manual Refresh action. Check whenever the
            # dashboard can use an active session; a failed/offline check
            # never hides local progress.
            try:
                session = directory.store(active["slotId"]).load(self._now_ms())
                if isinstance(session, dict):
                    status = windows_release_status(self._api_origin, session.get("bearerToken"))
                    # The site's floor is kept on this PC: an unsupported version
                    # pauses sending, also offline (owner 2026-09-28).
                    remember_support_floor(self._data_root, status)
                    update = update_from_status(status)
                    if update is not None:
                        result["update"] = update
            except Exception:
                pass
            return result
        except Exception:
            return {
                "status": "unavailable",
                "message": "Progress could not be displayed. Capture and local run history still work.",
            }

    def _account_actions(self) -> LiveTrialAccountActions:
        """Sign in, switch and remove accounts from the dashboard."""
        return LiveTrialAccountActions(
            self._directory,
            lambda: cli.LiveTrialDeviceAuthorizationClient(cli.LiveTrialHttpsExecutor(self._api_origin)),
            session_path=self._session,
            clock_ms=self._now_ms,
            on_change=lambda: self._write_reference(),
            outbox_factory=self._outbox,
            owners_factory=self._owners,
            api_origin=self._api_origin,
        )

    def _dashboard_rank_data(
        self, query: str, player_ids: tuple[str, ...], track_catalog: dict,
    ) -> dict:
        directory = self._directory()
        active = directory.active()
        return fetch_rank_comparison(
            directory.store(active["slotId"]) if active is not None else None, self._api_origin,
            query=query, player_ids=player_ids, track_catalog=track_catalog,
            clock_ms=self._now_ms,
        )

    def _correct_result(self) -> None:
        outbox = self._outbox()
        try:
            records = latest_records(outbox.list())
        except Exception:
            self._say("Saved results could not be listed. Nothing was changed.")
            return
        candidates = [record for record in records if
                      record["canonicalSubmission"]["source"]["kind"].startswith("livetrial_")
                      and record["state"]["state"] in {"pending", "synced"}]
        if not candidates:
            self._say("There are no recognized LiveTrial results to correct.")
            return
        self._say("Choose a result. A correction creates a new revision; the earlier one is kept.")
        for number, record in enumerate(candidates[:30], start=1):
            value = record["canonicalSubmission"]
            self._say(
                f"  {number}) {value['trackId']} | {value['mode']}cc | "
                f"{format_time(value['totalTimeMs'])} | {record['state']['state']}"
            )
        answer = self._prompt("Number (or blank to go back)")
        if not answer:
            return
        try:
            selected = candidates[int(answer) - 1]
        except (ValueError, IndexError):
            self._say("That is not one of the numbers above.")
            return
        prior = selected["canonicalSubmission"]
        changes: dict = {}
        track = self._prompt(f"Track id [{prior['trackId']}]")
        if track:
            changes["trackId"] = track
        mode = self._prompt(f"Engine class [{prior['mode']}]")
        if mode:
            try:
                changes["mode"] = int(mode)
            except ValueError:
                self._say("Engine class must be 150 or 200. Nothing was changed.")
                return
        total_text = self._prompt(f"Total time [{format_time(prior['totalTimeMs'])}]")
        if total_text:
            try:
                changes["totalTimeMs"] = parse_time(total_text)
            except Exception:
                self._say("Use a time such as 1:42.123. Nothing was changed.")
                return
        old_laps = prior.get("laps", [])
        lap_default = ", ".join(format_time(lap["timeMs"]) for lap in old_laps) or "not recorded"
        lap_text = self._prompt(f"Lap times comma-separated [{lap_default}] (type none to clear)")
        if lap_text:
            if lap_text.lower() == "none":
                changes["laps"] = []
            else:
                try:
                    times = [parse_time(value) for value in lap_text.split(",")]
                    if len(times) not in {3, 7}:
                        raise ValueError
                    changes["laps"] = [
                        {
                            "lapNumber": index + 1,
                            "timeMs": value,
                            **({
                                key: old_laps[index][key]
                                for key in ("coinsCollected", "mushroomsUsed")
                                if index < len(old_laps) and key in old_laps[index]
                            }),
                        }
                        for index, value in enumerate(times)
                    ]
                except Exception:
                    self._say("Enter exactly 3 or 7 valid lap times. Nothing was changed.")
                    return
        for lap_key, label, upper, aggregate_upper in [
            ("coinsCollected", "Coin balance per lap", 10, None),
            ("mushroomsUsed", "Mushrooms used per lap", 3, 3),
        ]:
            effective_laps = [dict(lap) for lap in changes.get("laps", old_laps)]
            recorded = effective_laps and all(lap_key in lap for lap in effective_laps)
            default = (
                ", ".join(str(lap[lap_key]) for lap in effective_laps)
                if recorded else "not recorded"
            )
            value = self._prompt(
                f"{label} [{default}] (type none to clear all laps)"
            )
            if not value:
                continue
            if not effective_laps:
                self._say("Enter lap times before lap details. Nothing was changed.")
                return
            if value.lower() == "none":
                for lap in effective_laps:
                    lap.pop(lap_key, None)
            else:
                try:
                    values = [int(part.strip()) for part in value.split(",")]
                    if (
                        len(values) != len(effective_laps)
                        or any(item < 0 or item > upper for item in values)
                        or (aggregate_upper is not None and sum(values) > aggregate_upper)
                    ):
                        raise ValueError
                    for lap, item in zip(effective_laps, values, strict=True):
                        lap[lap_key] = item
                except Exception:
                    self._say(
                        f"Enter exactly {len(effective_laps)} values between 0 and {upper}. "
                        "Nothing was changed."
                    )
                    return
            if effective_laps != old_laps:
                changes["laps"] = effective_laps
        old_loadout = prior.get("loadout") or {}
        loadout = dict(old_loadout)
        touched_loadout: set[str] = set()
        for key, label in [
            ("characterId", "Character id"),
            ("characterVariantId", "Character variant id"),
            ("bodyId", "Body id"),
            ("bodyVariantId", "Body variant id"),
            ("tireId", "Tire id"),
            ("gliderId", "Glider id"),
            ("gliderVariantId", "Glider variant id"),
        ]:
            value = self._prompt(f"{label} [{old_loadout.get(key, 'not recorded')}] (type none to clear)")
            if value:
                touched_loadout.add(key)
                if value.lower() == "none":
                    loadout.pop(key, None)
                else:
                    loadout[key] = value
        for base, variant in [
            ("characterId", "characterVariantId"),
            ("bodyId", "bodyVariantId"),
            ("gliderId", "gliderVariantId"),
        ]:
            if loadout.get(base) != old_loadout.get(base) and variant not in touched_loadout:
                loadout.pop(variant, None)
        if loadout != old_loadout:
            changes["loadout"] = loadout
        for key, label in [
            ("countryId", "Country id"),
            ("observedPlayerName", "Recognized Player name"),
        ]:
            value = self._prompt(
                f"{label} [{prior.get(key, 'not recorded')}] (type none to clear)"
            )
            if value:
                changes[key] = None if value.lower() == "none" else value
        if self._prompt("Type save to create the corrected revision").lower() != "save":
            self._say("Nothing was changed.")
            return
        try:
            record, fields = create_corrected_revision(outbox, selected, changes, self._now_ms())
            owner = self._owners().owner_of(selected["entry"]["entryKey"])
            if owner is not None:
                self._owners().record(
                    record["entry"]["entryKey"],
                    owner["slotId"],
                    record["canonicalSubmission"]["playerReference"],
                    self._now_ms(),
                )
            self._say("Corrected revision saved safely: " + ", ".join(fields) + ".")
            if self._automatic_send_enabled():
                self._say("Use Send all waiting results after reviewing this correction.")
        except Exception:
            self._say("The correction was not valid. Nothing was changed.")

    def _choose_account(self, purpose: str) -> str | None:
        accounts = self._accounts()
        if not accounts:
            self._say("No accounts are remembered on this PC yet.")
            return None
        self._say(f"Which account do you want to {purpose}?")
        for number, account in enumerate(accounts, start=1):
            marks = []
            if account["active"]:
                marks.append("in use")
            if account["expired"]:
                marks.append("needs to sign in again")
            suffix = f" ({', '.join(marks)})" if marks else ""
            self._say(f"  {number}) {cli.account_label(account)}{suffix}")
        answer = self._prompt("Number (or blank to go back)")
        if not answer:
            return None
        try:
            index = int(answer)
        except ValueError:
            self._say("That is not one of the numbers above.")
            return None
        if not 1 <= index <= len(accounts):
            self._say("That is not one of the numbers above.")
            return None
        return accounts[index - 1]["slotId"]

    def _prompt(self, label: str) -> str:
        try:
            return self._ask(f"{self._localized(label)}: ").strip()
        except (EOFError, KeyboardInterrupt):
            raise _Quit() from None

    # -- actions -----------------------------------------------------------

    def _add_account(self) -> None:
        self._say(
            "A browser window will open on "
            f"{self._api_origin} so you can approve this PC."
        )
        if self._command(["sign-in", "--api-origin", self._api_origin]) == 0:
            self._say("That account is now signed in and selected.")
            self._write_reference(refresh=True)
        else:
            self._say("Signing in did not finish. Nothing was changed.")

    def _switch_account(self) -> None:
        slot_id = self._choose_account("use from now on")
        if slot_id is None:
            return
        if self._command(["switch", "--slot", slot_id]) != 0:
            self._say("That account could not be selected.")

    def _remove_account(self) -> None:
        slot_id = self._choose_account("remove")
        if slot_id is None:
            return
        if self._prompt("Type yes to confirm").lower() != "yes":
            self._say("Nothing was removed.")
            return
        # Removing an account never removes results: runs already recorded stay
        # on this PC and stay owned by the player who drove them.
        if self._command(["sign-out", "--slot", slot_id]) == 0:
            self._say("That account was removed. Saved results were kept.")
        else:
            self._say("That account could not be removed.")

    def _runtime_directory(self) -> str | None:
        if self._runtime_root:
            return self._runtime_root
        # A packaged installation carries the recognition engine, so a normal
        # user is never asked where it is. Only a checkout has to say.
        bundled = bundled_vision_runtime_root(self._environment)
        if bundled is not None:
            self._runtime_root = str(bundled)
            return self._runtime_root
        answer = self._prompt("Folder that contains the LiveTrial runtime")
        if not answer:
            return None
        self._runtime_root = answer
        return answer

    def _analyze(self) -> None:
        runtime_root = self._runtime_directory()
        if runtime_root is None:
            return
        video = self._prompt("Video file to analyze")
        if not video:
            return
        self._ensure_profile()
        self._say("Analyzing. This can take a while; results are saved as they appear.")
        if self._command(
            ["analyze", "--runtime-root", runtime_root, "--video", video, "--",
             "--console-language", read_settings(self._data_root).get("consoleLanguage", "auto")]
        ) != 0:
            self._say("The video could not be analyzed. Nothing was changed.")

    def _check_capture(self, quiet_when_found: bool = False) -> bool:
        """Say whether live capture can start; True when it can."""
        data_root = cli.product_data_root(self._environment)
        status = capture_requirements(self._environment, data_root)
        if status["ffmpegAvailable"]:
            if not quiet_when_found:
                for line in ffmpeg_found_lines(status["ffmpeg"]):
                    self._say(line)
            return True
        for line in missing_ffmpeg_lines(data_root):
            self._say(line)
        return False

    def _yes(self, answer: str) -> bool:
        return answer.strip().lower() in {"", "y", "yes", "j", "ja"}

    def _choose_capture_device(self) -> str | None:
        """Which video device the engine should open, or None to go back.

        The list is what FFmpeg sees on this PC right now. The pick is
        checked with one still picture before anything starts, because a
        webcam, a virtual camera or a second card of the same model is a
        wrong pick a person can only see, and the choice is remembered so
        the next session starts on Enter.
        """
        ffmpeg = find_ffmpeg(self._environment, self._data_root)
        if ffmpeg is None:
            return None
        devices = list(self._list_devices(ffmpeg))
        if not devices:
            self._say("No video device was found on this PC.")
            self._say("Connect the capture card, wait a few seconds and try again.")
            return None
        remembered = read_settings(self._data_root).get("captureDevice")
        while True:
            self._say("Video devices on this PC:")
            default_index = 0
            for index, device in enumerate(devices, start=1):
                marker = ""
                if remembered is not None and engine_device_argument(device, devices) == remembered:
                    default_index = index
                    marker = "   (used last time)"
                self._say(f"  {index}) {device.name}{marker}")
            hint = f" [{default_index}]" if default_index else ""
            answer = self._prompt(f"Which one is the capture card? Type its number{hint}")
            if not answer and default_index:
                chosen = default_index
            else:
                try:
                    chosen = int(answer)
                except ValueError:
                    chosen = 0
            if not 1 <= chosen <= len(devices):
                self._say("That is not one of the numbers above.")
                return None
            device = devices[chosen - 1]
            argument = engine_device_argument(device, devices)
            self._say(f"Taking a picture from {device.name} to check it is the right one. This takes a few seconds while the device starts...")
            preview = self._data_root / SNAPSHOT_FILE_NAME
            if not self._take_snapshot(ffmpeg, argument, str(preview)):
                self._say(f"No picture came from {device.name}.")
                self._say("It may be in use by another program (OBS, a browser), or it is not the capture card.")
                if self._yes(self._prompt("Try another device? (y/n) [y]")):
                    continue
                return None
            try:
                self._open_file(str(preview))
                self._say("The picture has opened in your image viewer.")
            except Exception:
                self._say(f"The picture is saved as {preview}.")
            if not self._yes(self._prompt("Is that your Switch? (y/n) [y]")):
                continue
            try:
                write_capture_device(self._data_root, argument)
            except Exception:
                pass
            return argument

    def _write_reference(self, refresh: bool = False) -> None:
        """Hand the signed-in Player's published bests and rivals to the engine.

        Written beside the runs, where the engine's dashboard reads it, so a
        run card can say how far a run is from the Player's own record on
        the site and from the next rival. Best effort: nothing here may
        stop a capture or a sign-in, and nobody signed in means no file.
        """
        try:
            directory = self._directory()
            active = directory.active()
            if active is None:
                return
            update = None
            if refresh:
                try:
                    refresh_player_progress(
                        self._data_root, active["playerId"],
                        directory.store(active["slotId"]), self._api_origin, self._now_ms,
                    )
                except Exception:
                    pass
                # A newer Windows release is part of what the dashboard shows
                # next to its logo; an offline check simply leaves it out.
                try:
                    session = directory.store(active["slotId"]).load(self._now_ms())
                    if isinstance(session, dict):
                        status = windows_release_status(self._api_origin, session.get("bearerToken"))
                        remember_support_floor(self._data_root, status)
                        update = update_from_status(status)
                except Exception:
                    update = None
            runs = cli.product_data_root(self._environment) / "runs"
            write_reference_from_cache(
                self._data_root, active["playerId"], runs, CURRENT_WINDOWS_VERSION, update,
            )
        except Exception:
            return

    def _open_dashboard_when_ready(self, url: str, wait_seconds: float = 120.0) -> None:
        """Open the engine's dashboard once it answers, without blocking.

        The engine starts its dashboard after loading its models, which takes
        a while; a person should not have to know the address or the moment.
        """
        opener = self._open_browser

        def waiter() -> None:
            deadline = time.monotonic() + wait_seconds
            while time.monotonic() < deadline:
                try:
                    with urllib.request.urlopen(url + "api/live", timeout=2) as response:
                        if response.status == 200:
                            break
                except Exception:
                    time.sleep(1.0)
            else:
                return
            try:
                opener(url)
            except Exception:
                pass

        threading.Thread(target=waiter, name="livetrial-dashboard-opener", daemon=True).start()

    def _capture(self) -> None:
        # FFmpeg is not bundled, so a missing one is explained here, before
        # the engine is started and before anything else is asked.
        if not self._check_capture(quiet_when_found=True):
            return
        runtime_root = self._runtime_directory()
        if runtime_root is None:
            return
        device = self._choose_capture_device()
        if device is None:
            return
        self._ensure_profile()
        # Fresh targets for the run cards: the Player's site record and rivals.
        self._write_reference(refresh=True)
        self._say("")
        self._say("Capturing. This menu is not available while capturing.")
        self._say("  - To stop and come back to this menu: press Ctrl+C in this window,")
        self._say("    or click Stop capture on the dashboard.")
        self._say("  - The dashboard with the live picture opens in your browser by itself;")
        self._say("    it is at http://127.0.0.1:8777/ if you close it.")
        self._say("")
        self._open_dashboard_when_ready("http://127.0.0.1:8777/")
        outcome = self._command([
            "capture", "--runtime-root", runtime_root, "--", "--dshow-name", device,
            "--console-language", read_settings(self._data_root).get("consoleLanguage", "auto"),
        ])
        if outcome not in {0, 130, cli.EXIT_CAPTURE_REQUIREMENTS_MISSING}:
            self._say("Capture could not be started.")

    def _open_dashboard(self) -> None:
        runtime_root = self._runtime_directory()
        if runtime_root is None:
            return
        self._write_reference()
        interpreter = bundled_vision_python(self._environment)
        script = os.path.join(runtime_root, "livetrial", "serve.py")
        if interpreter is None or not os.path.isfile(script) or os.path.islink(script):
            self._say("The local dashboard is unavailable in this installation.")
            return
        history_url = dashboard.DEFAULT_HISTORY_URL
        if self._dashboard_process is None or self._dashboard_process.poll() is not None:
            runs = cli.product_data_root(self._environment) / "runs"
            runs.mkdir(parents=True, exist_ok=True)
            environment = dict(os.environ)
            environment.update(self._environment)
            try:
                self._dashboard_process = subprocess.Popen(
                    [interpreter, "-B", script, "--runs-dir", str(runs), "--port", "8777"],
                    cwd=runtime_root,
                    env=environment,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
                time.sleep(0.25)
                if self._dashboard_process.poll() is not None:
                    self._dashboard_process = None
                    self._say("The local dashboard could not be started.")
                    return
            except (OSError, ValueError):
                self._dashboard_process = None
                self._say("The local dashboard could not be started.")
                return
        if self._progress_dashboard is None:
            catalog, assets_root = dashboard.load_track_catalog(runtime_root)
            try:
                self._progress_dashboard = dashboard.start_progress_dashboard(
                    dashboard.dashboard_root(self._environment),
                    lambda refresh: self._dashboard_progress(refresh, catalog),
                    catalog,
                    assets_root,
                    history_url,
                    language=read_settings(cli.product_data_root(self._environment))["language"],
                    rank_provider=lambda query, player_ids: self._dashboard_rank_data(
                        query, player_ids, catalog,
                    ),
                    actions=self._account_actions().dashboard_actions(),
                )
            except Exception:
                self._say("Player progress could not be added to the dashboard. Run history is still available.")
        url = self._progress_dashboard.url if self._progress_dashboard is not None else history_url
        self._open_browser(url)
        self._say(f"Dashboard opened at {url}")

    def _stop_dashboard(self) -> None:
        progress = self._progress_dashboard
        self._progress_dashboard = None
        if progress is not None:
            try:
                progress.stop()
            except Exception:
                pass
        process = self._dashboard_process
        self._dashboard_process = None
        if process is not None and process.poll() is None:
            process.terminate()

    def _save_run(self) -> None:
        report = self._prompt("Finished report file")
        if not report:
            return
        answer = self._prompt("Was this a capture (c) or a recorded video (v)?").lower()
        if answer.startswith("c"):
            source_kind = "livetrial_capture"
        elif answer.startswith("v"):
            source_kind = "livetrial_recorded_video"
        else:
            self._say("Please answer c or v.")
            return
        run_number = self._prompt("Run number")
        if not run_number.isdigit():
            self._say("The run number has to be a whole number.")
            return
        self._ensure_profile()
        if self._command(
            [
                "save-run",
                "--report",
                report,
                "--source-kind",
                source_kind,
                "--run-number",
                run_number,
            ]
        ) != 0:
            self._say("That run could not be saved. Nothing was changed.")

    def _synchronize(self) -> None:
        try:
            report = cli.synchronize_pending(
                self._outbox(),
                self._directory(),
                self._owners(),
                self._api_origin,
                self._now_ms(),
            )
        except Exception:
            self._say("Nothing could be sent right now. Your results are safe.")
            return
        if report["attempted"] == 0:
            self._say("There is nothing waiting to be sent.")
            return
        self._say(f"Sent {report['synced']} of {report['attempted']} results.")
        for result in report["results"]:
            if result["outcome"] == "synced":
                continue
            self._say(f"  One result {_explain(result.get('failureCode'))}.")
        if report["skipped"]:
            self._say("Skipped results stay on this PC and can be sent later.")

    # -- loop --------------------------------------------------------------

    def run(self) -> int:
        self._say("Welcome to MK8DX Time Trials for Windows PC.")
        try:
            self._offer_sign_in_again()
        except _Quit:
            self._say("Goodbye.")
            return 0
        actions = {
            "s": self._add_account,
            "1": self._add_account,
            "2": self._switch_account,
            "3": self._remove_account,
            "4": self._analyze,
            "5": self._capture,
            "6": self._save_run,
            "7": self._synchronize,
            "8": self._check_capture,
            "9": self._open_dashboard,
            "10": self._change_automatic_send,
            "11": self._player_progress,
            "12": self._correct_result,
            "13": self._change_language,
        }
        while True:
            try:
                self._header()
                choice = self._prompt("Choose").lower()
                if choice in {"0", "q", "quit", "exit"}:
                    self._stop_dashboard()
                    self._say("Goodbye.")
                    return 0
                action = actions.get(choice)
                if action is None:
                    self._say("Please type one of the numbers above.")
                    continue
                action()
            except _Quit:
                self._stop_dashboard()
                self._say("")
                self._say("Goodbye.")
                return 0
            except KeyboardInterrupt:
                self._say("")
                self._say("Stopped. Nothing was lost.")
            except Exception:
                # A person gets a sentence, never an exception or a path.
                self._say("Something went wrong. Nothing was changed.")


def main(
    _argv: list[str] | None = None,
    environment: Mapping[str, str] = os.environ,
) -> int:
    return LiveTrialConsole(environment).run()


if __name__ == "__main__":
    raise SystemExit(main())
