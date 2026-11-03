"""Per-Player YouTube connection and manual clip upload for the dashboard (ADR-0213).

Everything here belongs to the *active* LiveTrial Player: the connection shown,
the channel a clip goes to. Switching Player switches the connection with it,
because each Player's authorization lives in their own slot file
(``<slot>.youtube.dat``). Nothing is uploaded unless the person presses Upload
on one clip; at most one upload runs at a time, and pressing again while it
runs never starts a second one.

The dashboard only ever receives plain dictionaries: states, messages, the
public video link. Tokens stay inside ``livetrial_youtube``.
"""

from __future__ import annotations

from pathlib import Path
import threading
import time
from typing import Callable, Mapping
import webbrowser

from livetrial_clips import ClipUploadRecords, LiveTrialClipError, list_clips, mk8dx_video_metadata, resolve_clip
from livetrial_youtube import (
    AVAILABLE_PRIVACY_STATUSES,
    OAUTH_CLIENT_VARIABLE,
    PRIVACY_STATUSES,
    LiveTrialYouTubeError,
    VideoMetadata,
    YouTubeAuthorizationFlow,
    YouTubeAuthorizationStore,
    YouTubeClient,
    YouTubeTransport,
    authorization_path,
    clean_metadata,
    validate_upload_text,
    default_client_location,
    find_oauth_client,
    video_url,
    windows_authorization_store,
)


NOT_CONFIGURED = "YouTube integration is not configured"


def _fail(message: str, code: str = "failed") -> None:
    raise LiveTrialYouTubeError(message, code) from None


class _UploadJob:
    def __init__(self, clip_id: str, slot_id: str, total: int, clock=time.monotonic) -> None:
        self.clip_id = clip_id
        self.slot_id = slot_id
        self.state = "preparing"
        self.sent = 0
        self.total = total
        self.message = ""
        self.url: str | None = None
        self._clock = clock
        # (time, bytes) of the first progress report: speed is measured from there, so the
        # sign-in and the upload's start-up do not count as slow sending
        self._first: tuple[float, int] | None = None

    def report(self, phase: str, sent: int, total: int) -> None:
        self.state = phase
        self.sent = sent
        self.total = total
        if phase == "uploading" and self._first is None:
            self._first = (self._clock(), sent)

    def speed(self) -> tuple[int, int] | None:
        """(bytes per second, seconds left) once there is something to measure."""
        if self.state != "uploading" or self._first is None:
            return None
        started_at, started_bytes = self._first
        elapsed = self._clock() - started_at
        moved = self.sent - started_bytes
        if elapsed < 0.5 or moved <= 0:
            return None
        rate = moved / elapsed
        return int(rate), int((self.total - self.sent) / rate + 0.999)

    @property
    def running(self) -> bool:
        return self.state in {"preparing", "uploading", "processing"}

    def public(self) -> dict:
        percent = int(self.sent * 100 / self.total) if self.total else 0
        document = {"clipId": self.clip_id, "state": self.state, "sentBytes": self.sent,
                    "totalBytes": self.total, "percent": min(100, percent), "message": self.message}
        measured = self.speed()
        if measured is not None:
            document["bytesPerSecond"], document["secondsLeft"] = measured
        if self.url:
            document["url"] = self.url
        return document


class LiveTrialYouTubePublisher:
    def __init__(
        self,
        data_root: str | Path,
        accounts_root: Callable[[], Path],
        active_account: Callable[[], dict | None],
        environment: Mapping[str, str],
        transport: YouTubeTransport | None = None,
        store_factory: Callable[[Path], YouTubeAuthorizationStore] = windows_authorization_store,
        open_browser: Callable[[str], object] = webbrowser.open,
        now_ms: Callable[[], int] | None = None,
        metadata: Callable[[dict], VideoMetadata] = mk8dx_video_metadata,
        sleep: Callable[[float], None] = time.sleep,
        log: Callable[[str], None] = lambda _message: None,
        flow_factory: Callable[..., YouTubeAuthorizationFlow] = YouTubeAuthorizationFlow,
        clock: Callable[[], float] = time.monotonic,
        website_origin: str | None = None,
    ) -> None:
        self._data_root = Path(data_root)
        self._runs_root = self._data_root / "runs"
        self._accounts_root = accounts_root
        self._active_account = active_account
        self._environment = dict(environment)
        self._transport = transport
        self._store_factory = store_factory
        self._open_browser = open_browser
        self._now_ms = now_ms or (lambda: time.time_ns() // 1_000_000)
        self._metadata = metadata
        self._sleep = sleep
        self._log = log
        self._flow_factory = flow_factory
        self._clock = clock
        self._website_origin = website_origin.rstrip("/") if isinstance(website_origin, str) else None
        self._records = ClipUploadRecords(self._data_root)
        self._lock = threading.Lock()
        self._flows: dict[str, YouTubeAuthorizationFlow] = {}
        self._jobs: dict[str, _UploadJob] = {}

    # -- plumbing ---------------------------------------------------------------

    def _client(self) -> YouTubeClient | None:
        """Read the client file every time: placing it later needs no restart."""
        oauth_client = find_oauth_client(self._environment, self._data_root)
        if oauth_client is None:
            return None
        return YouTubeClient(oauth_client, self._transport, self._now_ms, self._sleep)

    def _store(self, slot_id: str) -> YouTubeAuthorizationStore:
        return self._store_factory(authorization_path(self._accounts_root(), slot_id))

    def _active(self) -> dict | None:
        try:
            account = self._active_account()
        except Exception:
            return None
        return account if isinstance(account, dict) and isinstance(account.get("slotId"), str) else None

    def _require(self) -> tuple[YouTubeClient, dict]:
        client = self._client()
        if client is None:
            _fail(NOT_CONFIGURED + ".", "not_configured")
        account = self._active()
        if account is None:
            _fail("Choose or add a LiveTrial account first.", "no_account")
        return client, account

    # -- connection ---------------------------------------------------------------

    def status(self) -> dict:
        privacy = {"default": "private", "options": [
            {"value": value, "available": value in AVAILABLE_PRIVACY_STATUSES} for value in PRIVACY_STATUSES]}
        base = {"configured": False, "state": "unavailable", "privacy": privacy,
                "clientLocation": str(default_client_location(self._data_root)),
                "clientVariable": OAUTH_CLIENT_VARIABLE,
                # Shown where a Player connects: what they agree to and how to take the permission back.
                "links": {"youtubeTerms": "https://www.youtube.com/t/terms",
                          "googlePrivacy": "https://policies.google.com/privacy",
                          "googlePermissions": "https://myaccount.google.com/permissions",
                          **({"privacy": f"{self._website_origin}/privacy", "terms": f"{self._website_origin}/terms"}
                             if self._website_origin else {})}}
        try:
            client = self._client()
        except LiveTrialYouTubeError as error:
            return {**base, "problem": "invalid_client", "message": str(error)}
        if client is None:
            return {**base, "problem": "not_configured", "message": NOT_CONFIGURED}
        account = self._active()
        if account is None:
            return {**base, "configured": True, "state": "no_account",
                    "message": "Choose or add a LiveTrial account to connect its YouTube channel."}
        slot = account["slotId"]
        document = {**base, "configured": True, "account": account.get("label")}
        with self._lock:
            flow = self._flows.get(slot)
        if flow is not None and flow.state == "pending":
            return {**document, "state": "connecting", "flow": flow.public()}
        stored = self._store(slot).load()
        if flow is not None and flow.state != "connected":
            document["notice"] = flow.message
        document["uploadCount"] = self._records.count_for(slot)
        if stored is None:
            return {**document, "state": "disconnected"}
        if stored.get("reconnectRequired"):
            return {**document, "state": "reconnect_required",
                    "message": "Google ended LiveTrial's YouTube access. Connect again to upload."}
        return {**document, "state": "connected", "connectedAtMs": stored.get("connectedAtMs")}

    def connect(self) -> dict:
        client, account = self._require()
        slot = account["slotId"]
        with self._lock:
            current = self._flows.get(slot)
            if current is not None and current.state == "pending":
                return self.status()
            flow = self._flow_factory(client, self._store(slot), slot, self._open_browser, now_ms=self._now_ms)
            self._flows[slot] = flow
        self._log("youtube: connect started")
        flow.start()
        return self.status()

    def cancel_connect(self) -> dict:
        account = self._active()
        if account is not None:
            with self._lock:
                flow = self._flows.get(account["slotId"])
            if flow is not None:
                flow.cancel()
                flow.done.wait(2.0)
        return self.status()

    def disconnect(self, forget_history: object = False) -> dict:
        """Remove this Player's YouTube authorization from this PC.

        With ``forget_history`` the Player's local upload records (video ids,
        links) go too; other Players' records stay. Videos already on YouTube
        are never touched; Google's own record of the permission can be
        removed at myaccount.google.com/permissions.
        """
        account = self._active()
        if account is None:
            _fail("Choose or add a LiveTrial account first.", "no_account")
        slot = account["slotId"]
        with self._lock:
            flow = self._flows.pop(slot, None)
        if flow is not None:
            flow.cancel()
        self._store(slot).clear()
        forgotten = self._records.forget_player(slot) if forget_history is True else []
        with self._lock:
            # the finished uploads this session remembers go too, or the clips would still show as uploaded
            for clip_id in forgotten:
                job = self._jobs.get(clip_id)
                if job is not None and not job.running:
                    del self._jobs[clip_id]
        self._log("youtube: disconnected" + (" and upload history forgotten" if forgotten else ""))
        return {**self.status(), "forgotten": len(forgotten)}

    # -- clips and uploads ---------------------------------------------------------

    def clips(self, catalog: dict | None = None) -> dict:
        records = self._records.load()
        with self._lock:
            jobs = {clip_id: job.public() for clip_id, job in self._jobs.items()}
        rows = []
        for clip in list_clips(self._runs_root, catalog):
            row = dict(clip)
            row["title"] = clean_metadata(self._metadata(clip)).title
            if clip["clipId"] in records:
                upload = records[clip["clipId"]]
                row["upload"] = {"state": "uploaded", "url": upload.get("url"),
                                 "privacyStatus": upload.get("privacyStatus")}
            elif clip["clipId"] in jobs:
                row["upload"] = jobs[clip["clipId"]]
            rows.append(row)
        return {"clips": rows, "youtube": self.status(),
                "uploading": any(job["state"] in {"preparing", "uploading", "processing"} for job in jobs.values())}

    def _facts(self, clip_id: object, catalog: dict | None, account: dict | None) -> dict:
        facts = next((clip for clip in list_clips(self._runs_root, catalog, limit=10_000)
                      if clip["clipId"] == clip_id), {"clipId": clip_id})
        # The Player whose channel receives the video is the one the description names.
        if account is not None and isinstance(account.get("playerId"), str):
            facts = {**facts, "playerName": account.get("label"), "playerId": account["playerId"]}
            if isinstance(account.get("username"), str):
                facts["playerUsername"] = account["username"]
        return facts

    def draft(self, clip_id: object, catalog: dict | None = None) -> dict:
        """The title and description LiveTrial proposes for a clip, for the Player to edit."""
        try:
            resolve_clip(self._runs_root, clip_id)
        except LiveTrialClipError as error:
            _fail(str(error), "missing_clip")
        proposed = clean_metadata(self._metadata(self._facts(clip_id, catalog, self._active())))
        return {"clipId": clip_id, "title": proposed.title, "description": proposed.description,
                "limits": {"titleCharacters": 100, "descriptionBytes": 5000},
                "privacy": self.status()["privacy"]}

    def upload(self, clip_id: object, privacy_status: object = "private", catalog: dict | None = None,
               title: object = None, description: object = None) -> dict:
        """Start uploading one clip with the Player's title and description; answer at once.

        The text is sent exactly as given (after YouTube's limits are checked);
        without it the proposed text is used. Never uploads twice.
        """
        client, account = self._require()
        slot = account["slotId"]
        if privacy_status not in PRIVACY_STATUSES:
            _fail("Choose Private, Unlisted or Public.")
        if privacy_status not in AVAILABLE_PRIVACY_STATUSES:
            _fail("Google allows LiveTrial to upload Private videos only for now.", "privacy_unavailable")
        try:
            path = resolve_clip(self._runs_root, clip_id)
        except LiveTrialClipError as error:
            _fail(str(error), "missing_clip")
        done = self._records.get(clip_id)
        if done is not None:
            _fail(f"This clip is already on YouTube: {done.get('url')}", "already_uploaded")
        state = self.status()["state"]
        if state == "reconnect_required":
            _fail("Connect YouTube again first: Google ended LiveTrial's access.", "reconnect_required")
        if state != "connected":
            _fail("Connect YouTube first.", "not_connected")
        if title is None and description is None:
            proposed = clean_metadata(self._metadata(self._facts(clip_id, catalog, account)))
            title, description = proposed.title, proposed.description
        metadata = validate_upload_text(title, description)
        with self._lock:
            existing = self._jobs.get(clip_id)
            if existing is not None and existing.running:
                return existing.public()
            if any(job.running for job in self._jobs.values()):
                _fail("Another clip is uploading. Wait until it has finished.", "busy")
            job = _UploadJob(clip_id, slot, path.stat().st_size, self._clock)
            self._jobs[clip_id] = job
        store = self._store(slot)
        thread = threading.Thread(target=self._run_upload, args=(job, client, store, path, metadata, privacy_status),
                                  daemon=True, name="livetrial-youtube-upload")
        thread.start()
        self._log("youtube: upload started")
        return job.public()

    def forget(self, clip_id: object, catalog: dict | None = None) -> dict:
        """Forget one clip's upload on this PC, so it can be uploaded again.

        Only LiveTrial's record goes; the video stays on YouTube (delete it in
        YouTube Studio if that is wanted). A clip that is uploading right now is
        left alone.
        """
        if not isinstance(clip_id, str):
            _fail("That clip is not on this PC.", "missing_clip")
        with self._lock:
            job = self._jobs.get(clip_id)
            if job is not None and job.running:
                _fail("This clip is uploading. Wait until it has finished.", "busy")
            self._jobs.pop(clip_id, None)
        if not self._records.forget(clip_id):
            _fail("LiveTrial has no upload of this clip to forget.", "not_uploaded")
        self._log("youtube: upload forgotten")
        return self.clips(catalog)

    def _run_upload(self, job: _UploadJob, client: YouTubeClient, store: YouTubeAuthorizationStore, path: Path,
                    metadata: VideoMetadata, privacy_status: str) -> None:
        def progress(phase: str, sent: int, total: int) -> None:
            job.report(phase, sent, total)

        try:
            video_id = client.upload(store, path, metadata, privacy_status, progress)
            url = video_url(video_id)
            self._records.record(job.clip_id, video_id, url, privacy_status, job.slot_id, self._now_ms(),
                                 metadata.title)
            job.url = url
            job.sent = job.total
            job.state = "uploaded"
            self._log("youtube: upload finished")
        except LiveTrialYouTubeError as error:
            job.state = "failed"
            job.message = str(error)
            self._log(f"youtube: upload failed ({error.code})")
        except Exception:
            job.state = "failed"
            job.message = "The upload failed. The clip is still on this PC; try again."
            self._log("youtube: upload failed (unexpected)")

    def wait_for_uploads(self, seconds: float = 10.0) -> None:
        """Tests: until no upload runs any more."""
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            with self._lock:
                if not any(job.running for job in self._jobs.values()):
                    return
            time.sleep(0.01)
