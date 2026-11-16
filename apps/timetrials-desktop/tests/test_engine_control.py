"""The engine's HTTP server on 8777 (engine-overlay/livetrial/serve.py): reading is a GET,
changing something is a POST that only this computer's own page or the desktop app can make.

Every test runs the real handler on an ephemeral loopback port with a synthetic runs folder,
config folder and settings file; no recording, setting or grid of a real installation is read
or changed.
"""

from __future__ import annotations

import http.client
import importlib.util
import json
import sys
import threading
import time
from pathlib import Path

import pytest

DESKTOP = Path(__file__).resolve().parents[1]
OVERLAY_SERVE = DESKTOP / "engine-overlay" / "livetrial" / "serve.py"
RUNTIME = DESKTOP / "vision-runtime" / "livetrial"
TOKEN = "synthetic-action-proof-" + "x" * 24
SESSION = "20261115-synthetic"
CLIP = f"{SESSION}/clip_120000_run01.mp4"


def test_the_engine_and_its_overlay_serve_the_same_server() -> None:
    assert OVERLAY_SERVE.read_bytes() == (RUNTIME / "serve.py").read_bytes()


@pytest.fixture()
def serve(monkeypatch):
    monkeypatch.setattr(sys, "path", [str(RUNTIME), *sys.path])
    spec = importlib.util.spec_from_file_location("_livetrial_serve_under_test", OVERLAY_SERVE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Engine:
    def __init__(self, serve, root: Path, lan: bool = False):
        self.serve = serve
        self.runs = root / "runs"
        self.config = root / "config"
        self.settings_path = root / "storage.json"
        session = self.runs / SESSION
        session.mkdir(parents=True)
        self.config.mkdir()
        (session / "report.json").write_text(json.dumps({"video": "synthetic.mp4", "runs": [{
            "run": 1, "goAtMs": 1000, "events": [],
            "context": {"trackName": {"trackId": "track.synthetic"}, "cc": "150"},
            "results": {"player": {"totalMs": 90000, "lapTimesMs": [30000, 30000, 30000]}},
        }]}), encoding="utf-8")
        (self.runs / CLIP).write_bytes(b"synthetic clip bytes")
        (self.config / "clock_grid.json").write_text('{"synthetic": true}', encoding="utf-8")
        self.store = serve.RunStore(self.runs, assets_root=root / "assets", config_dir=self.config,
                                    settings_path=self.settings_path)
        self.store.live = True
        self.httpd = serve.QuietServer(("127.0.0.1", 0), serve.make_handler(self.store, TOKEN))
        self.httpd.lan = lan
        self.port = self.httpd.server_address[1]
        self.origin = f"http://127.0.0.1:{self.port}"
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def close(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)

    def request(self, method: str, path: str, body: bytes | None = None, host: str | None = None,
                headers: dict | None = None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            connection.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
            connection.putheader("Host", host if host is not None else f"127.0.0.1:{self.port}")
            for name, value in (headers or {}).items():
                connection.putheader(name, value)
            if body is not None:
                connection.putheader("Content-Length", str(len(body)))
            connection.endheaders(body)
            response = connection.getresponse()
            return response.status, response.read(), dict(response.getheaders())
        finally:
            connection.close()

    def act(self, path: str, document: dict | None = None, *, token: str = TOKEN, origin: str | None = None,
            content_type: str = "application/json", host: str | None = None, extra: dict | None = None,
            raw: bytes | None = None):
        headers = {"Content-Type": content_type, "Origin": origin or self.origin}
        if token:
            headers["X-LiveTrial-Action"] = token
        headers.update(extra or {})
        body = raw if raw is not None else json.dumps(document or {}).encode("utf-8")
        return self.request("POST", path, body, host=host, headers=headers)

    def state_files(self) -> dict:
        """Every byte of the synthetic runs and config folders, plus the settings file."""
        files = {}
        for root in (self.runs, self.config):
            for path in sorted(root.rglob("*")):
                if path.is_file():
                    files[str(path.relative_to(root.parent))] = path.read_bytes()
        if self.settings_path.exists():
            files["storage.json"] = self.settings_path.read_bytes()
        return files

    def memory(self) -> tuple:
        return dict(self.store.record), self.store.stop_requested, json.dumps(
            self.serve.asdict(self.store.settings), sort_keys=True)


@pytest.fixture()
def engine(serve, tmp_path):
    running = Engine(serve, tmp_path)
    yield running
    running.close()


@pytest.fixture()
def lan_engine(serve, tmp_path):
    running = Engine(serve, tmp_path, lan=True)
    yield running
    running.close()


# -- reading -------------------------------------------------------------------

def test_the_local_page_carries_the_proof_and_a_foreign_host_gets_nothing(engine) -> None:
    status, page, headers = engine.request("GET", "/")
    assert status == 200 and f'content="{TOKEN}"'.encode() in page
    assert "frame-ancestors" in headers.get("Content-Security-Policy", "")
    status, page, _ = engine.request("GET", "/", host=f"localhost:{engine.port}")
    assert status == 200 and TOKEN.encode() in page
    for host in ("attacker.example", f"rebound.example:{engine.port}", f"192.168.1.20:{engine.port}", ""):
        status, page, _ = engine.request("GET", "/", host=host)
        assert status == 421 and TOKEN.encode() not in page
        status, body, _ = engine.request("GET", "/api/runs", host=host)
        assert status == 421 and b"synthetic" not in body


def test_a_cross_site_read_is_refused(engine) -> None:
    status, _, _ = engine.request("GET", "/api/runs", headers={"Sec-Fetch-Site": "cross-site"})
    assert status == 403
    for site in ("same-origin", "same-site", "none"):
        status, body, _ = engine.request("GET", "/api/runs", headers={"Sec-Fetch-Site": site})
        assert status == 200 and json.loads(body)["runs"]


def test_former_changing_gets_change_nothing(engine) -> None:
    before_files, before_memory = engine.state_files(), engine.memory()
    for path in ("/api/record?mode=manual&on=1", "/api/record?mode=auto&on=0",
                 "/api/settings?maxTotalGb=0.5&keepLatest=0", "/api/storage/cleanup",
                 "/api/storage/cleanup?dry=0", f"/api/pin?file={CLIP}",
                 "/api/category?key=synthetic.mp4%7C1%7C1000&value=sc",
                 "/api/archive?key=synthetic.mp4%7C1%7C1000", "/api/archive", "/api/pin"):
        status, _, headers = engine.request("GET", path)
        assert status == 405 and headers.get("Allow") == "POST", path
    status, body, _ = engine.request("GET", "/api/storage/cleanup?dry=1")
    assert status == 200 and json.loads(body)["dryRun"] is True
    assert engine.state_files() == before_files
    assert engine.memory() == before_memory
    assert not engine.settings_path.exists()
    # reading what is set still works
    assert json.loads(engine.request("GET", "/api/record")[1])["manual"] is False
    assert json.loads(engine.request("GET", "/api/settings")[1])["maxTotalGb"] == 50.0


def test_the_run_package_leaves_the_runs_folder_as_it_was(engine) -> None:
    before = engine.state_files()
    status, body, headers = engine.request("GET", "/api/export/package?key=synthetic.mp4%7C1%7C1000")
    assert status == 200 and headers["Content-Type"] == "application/zip" and body[:2] == b"PK"
    assert engine.state_files() == before


# -- changing ------------------------------------------------------------------

REFUSED = [
    ("no proof", {"token": ""}),
    ("wrong proof", {"token": "w" * 43}),
    ("foreign origin", {"origin": "https://attacker.example"}),
    ("null origin", {"origin": "null"}),
    ("other loopback port", {"origin": "http://127.0.0.1:8776"}),
    ("rebound host", {"host": "attacker.example:8777"}),
    ("cross-site fetch", {"extra": {"Sec-Fetch-Site": "cross-site"}}),
    ("same-site fetch", {"extra": {"Sec-Fetch-Site": "same-site"}}),
]


@pytest.mark.parametrize("reason,overrides", REFUSED, ids=[r for r, _ in REFUSED])
def test_a_change_without_this_computers_page_changes_nothing(engine, reason, overrides) -> None:
    before_files, before_memory = engine.state_files(), engine.memory()
    attempts = [
        ("/api/stop", {}), ("/api/record", {"mode": "manual", "on": True}),
        ("/api/settings", {"maxTotalGb": "0.5"}), ("/api/storage/cleanup", {"dryRun": False}),
        ("/api/pin", {"file": CLIP}), ("/api/category", {"key": "k", "value": "sc"}),
        ("/api/archive", {"key": "k"}), ("/api/clockgrid", {"replaced": True}), ("/api/grid", {"x": 1}),
    ]
    for path, document in attempts:
        status, _, _ = engine.act(path, document, **overrides)
        assert status == 403, (reason, path)
    assert engine.state_files() == before_files
    assert engine.memory() == before_memory


def test_a_simple_cross_site_form_post_changes_nothing(engine) -> None:
    before_files, before_memory = engine.state_files(), engine.memory()
    for content_type in ("text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"):
        for path in ("/api/stop", "/api/record", "/api/settings"):
            status, _, _ = engine.act(path, raw=b'{"mode":"manual","on":true}', token="",
                                      origin="https://attacker.example", content_type=content_type)
            assert status == 403
    # even with the proof, only JSON is accepted
    status, _, _ = engine.act("/api/stop", raw=b"{}", content_type="text/plain")
    assert status == 415
    assert engine.state_files() == before_files
    assert engine.memory() == before_memory


def test_oversized_slow_or_malformed_input_changes_nothing(engine, serve) -> None:
    before_files, before_memory = engine.state_files(), engine.memory()
    big_grid = json.dumps({"pad": "x" * serve.MAX_CALIBRATION_BYTES}).encode()
    status, _, _ = engine.act("/api/clockgrid", raw=big_grid)
    assert status == 413
    status, _, _ = engine.act("/api/settings", raw=json.dumps({"switchLanguage": "x" * 20000}).encode())
    assert status == 413
    for path, raw in (("/api/clockgrid", b"{not json"), ("/api/clockgrid", b"[1, 2]"),
                      ("/api/record", b'{"mode": "manual", "on": "yes"}'),
                      ("/api/record", b'{"mode": "everything", "on": true}'),
                      ("/api/settings", b'{"maxTotalGb": "1e999"}'),
                      ("/api/settings", b'{"maxTotalGb": "NaN"}'),
                      ("/api/settings", b'{"keepLatest": 10, "unknown": 1}'),
                      ("/api/settings", b'{"keepLatest": 10, "recordHeight": 99999}'),
                      ("/api/settings", b'{"switchLanguage": "../../x"}'),
                      ("/api/settings", b'{"sane": 1}'),
                      ("/api/pin", b'{"file": "../outside/clip_120000.mp4"}'),
                      ("/api/pin", b'{"file": "report.json"}'),
                      ("/api/archive", json.dumps({"key": "k" * 600}).encode()),
                      ("/api/storage/cleanup", b'{"dryRun": "no"}')):
        status, _, _ = engine.act(path, raw=raw)
        assert status == 400, (path, raw)
    assert engine.state_files() == before_files
    assert engine.memory() == before_memory


def test_a_refused_oversized_body_still_gets_its_answer(engine, serve) -> None:
    # The body is refused before it is read; without discarding it, closing the
    # socket resets the connection and the client often sees an abort, not 413.
    before_files, before_memory = engine.state_files(), engine.memory()
    big_grid = json.dumps({"pad": "x" * serve.MAX_CALIBRATION_BYTES}).encode()
    for _ in range(60):
        status, _, headers = engine.act("/api/clockgrid", raw=big_grid)
        assert status == 413 and headers.get("Connection") == "close"
    assert engine.state_files() == before_files
    assert engine.memory() == before_memory


def test_a_declared_body_that_never_comes_gets_413_at_once(engine, serve) -> None:
    # Discarding a refused body is bounded: the answer is sent first, and a body
    # declared far beyond DRAIN_BYTES that never arrives does not hold it back.
    connection = http.client.HTTPConnection("127.0.0.1", engine.port, timeout=10)
    try:
        connection.putrequest("POST", "/api/settings", skip_host=True)
        for name, value in (("Host", f"127.0.0.1:{engine.port}"), ("Origin", engine.origin),
                            ("Content-Type", "application/json"), ("X-LiveTrial-Action", TOKEN),
                            ("Content-Length", str(100 * serve.DRAIN_BYTES))):
            connection.putheader(name, value)
        connection.endheaders(b"{")
        started = time.monotonic()
        response = connection.getresponse()
        assert response.status == 413 and json.loads(response.read())["error"] == "request too large"
        assert time.monotonic() - started < serve.DRAIN_SECONDS
    finally:
        connection.close()


def test_a_body_that_never_arrives_is_dropped(engine, serve, monkeypatch) -> None:
    monkeypatch.setattr(serve, "BODY_READ_SECONDS", 0.5)
    before = engine.memory()
    connection = http.client.HTTPConnection("127.0.0.1", engine.port, timeout=10)
    connection.putrequest("POST", "/api/stop", skip_host=True)
    for name, value in (("Host", f"127.0.0.1:{engine.port}"), ("Origin", engine.origin),
                        ("Content-Type", "application/json"), ("X-LiveTrial-Action", TOKEN),
                        ("Content-Length", "100")):
        connection.putheader(name, value)
    connection.endheaders(b"{")
    started = time.monotonic()
    with pytest.raises((http.client.RemoteDisconnected, ConnectionError)):
        connection.getresponse()
    assert time.monotonic() - started < 5
    connection.close()
    assert engine.memory() == before


def test_one_change_at_a_time(engine, serve) -> None:
    release = threading.Event()
    original = engine.store.update_settings

    def slow(changes):
        release.wait(5)
        return original(changes)

    engine.store.update_settings = slow
    results = {}
    first = threading.Thread(target=lambda: results.setdefault(
        "first", engine.act("/api/settings", {"keepLatest": 30})))
    first.start()
    time.sleep(0.3)
    status, _, headers = engine.act("/api/record", {"mode": "manual", "on": True})
    assert status == 429 and headers.get("Retry-After") == "1"
    assert engine.store.record["manual"] is False
    release.set()
    first.join(10)
    assert results["first"][0] == 200 and engine.store.settings.keepLatest == 30


def test_this_computers_page_controls_the_engine(engine) -> None:
    status, body, _ = engine.act("/api/record", {"mode": "manual", "on": True})
    assert status == 200 and json.loads(body)["manual"] is True and engine.store.record["manual"] is True
    status, body, _ = engine.act("/api/record", {"mode": "auto", "on": False}, origin=f"http://localhost:{engine.port}",
                                 host=f"localhost:{engine.port}", extra={"Sec-Fetch-Site": "same-origin"})
    assert status == 200 and engine.store.record["auto"] is False

    status, body, _ = engine.act("/api/settings", {"maxTotalGb": "12.5", "keepRecords": 0, "switchLanguage": "nl-NL"})
    assert status == 200 and json.loads(body)["maxTotalGb"] == 12.5
    saved = json.loads(engine.settings_path.read_text(encoding="utf-8"))
    assert saved["maxTotalGb"] == 12.5 and saved["keepRecords"] is False and saved["switchLanguage"] == "nl-NL"

    status, body, _ = engine.act("/api/storage/cleanup", {"dryRun": True})
    assert status == 200 and json.loads(body)["dryRun"] is True and (engine.runs / CLIP).is_file()
    status, body, _ = engine.act("/api/storage/cleanup", {"dryRun": False})
    assert status == 200 and json.loads(body)["dryRun"] is False

    status, body, _ = engine.act("/api/pin", {"file": CLIP})
    assert status == 200 and json.loads(body)["pinned"] is True
    status, body, _ = engine.act("/api/category", {"key": "synthetic.mp4|1|1000", "value": "sc"})
    assert status == 200 and json.loads(body)["category"] == "sc"
    status, body, _ = engine.act("/api/archive", {"key": "synthetic.mp4|1|1000"})
    assert status == 200 and json.loads(body)["archived"] is True
    runs = json.loads(engine.request("GET", "/api/runs")[1])["runs"]
    assert runs[0]["category"] == "sc" and runs[0]["archived"] is True

    status, _, _ = engine.act("/api/clockgrid", {"calibrated": 1})
    assert status == 200
    assert json.loads((engine.config / "clock_grid.json").read_text(encoding="utf-8")) == {"calibrated": 1}
    assert json.loads(engine.request("GET", "/api/clockgrid")[1]) == {"calibrated": 1}
    assert not list(engine.config.glob("*.partial"))

    status, body, _ = engine.act("/api/stop", {})
    assert status == 200 and engine.store.stop_requested is True


# -- the network (--lan) -------------------------------------------------------

def test_a_lan_viewer_can_watch_but_not_control(lan_engine, serve, monkeypatch) -> None:
    lan_host = f"192.168.1.20:{lan_engine.port}"
    status, body, _ = lan_engine.request("GET", "/api/runs", host=lan_host)
    assert status == 200 and json.loads(body)["runs"]
    status, page, _ = lan_engine.request("GET", "/", host=lan_host)
    assert status == 200 and b"livetrial-action" not in page.split(b"</head>")[0].split(b"<script>")[0] \
        and TOKEN.encode() not in page
    # a rebinding name stays refused on the network too
    assert lan_engine.request("GET", "/api/runs", host=f"evil.example:{lan_engine.port}")[0] == 421

    before_files, before_memory = lan_engine.state_files(), lan_engine.memory()
    lan_origin = f"http://{lan_host}"
    assert lan_engine.act("/api/stop", {}, host=lan_host, origin=lan_origin)[0] == 403
    assert lan_engine.act("/api/stop", {}, host=lan_host, origin=lan_origin, token="")[0] == 403
    # A peer on the network, even one that forges loopback Host/Origin and somehow
    # has the proof, is not this computer.
    monkeypatch.setattr(serve, "_is_loopback_address", lambda _address: False)
    assert lan_engine.act("/api/stop", {})[0] == 403
    assert lan_engine.act("/api/record", {"mode": "manual", "on": True})[0] == 403
    status, page, _ = lan_engine.request("GET", "/")
    assert status == 200 and TOKEN.encode() not in page
    assert lan_engine.state_files() == before_files
    assert lan_engine.memory() == before_memory


def test_without_lan_an_address_host_is_refused(engine) -> None:
    assert engine.request("GET", "/api/runs", host=f"192.168.1.20:{engine.port}")[0] == 421


# -- the proof itself and its callers ------------------------------------------

def test_the_proof_comes_from_the_desktop_app_or_is_made_fresh(serve) -> None:
    assert serve.action_token({serve.ACTION_VARIABLE: TOKEN}) == TOKEN
    for weak in ("", "short", "x" * 31, "spaces are not allowed in a proof!!!!!!!", "y" * 129):
        made = serve.action_token({serve.ACTION_VARIABLE: weak})
        assert made != weak and serve._ACTION_SHAPE.fullmatch(made)
    assert serve.action_token({}) != serve.action_token({})


def test_the_desktop_app_hands_its_proof_to_the_engine_and_uses_it(engine, monkeypatch, tmp_path) -> None:
    import livetrial_desktop_app as desktop

    assert desktop.ENGINE_ACTION_VARIABLE == engine.serve.ACTION_VARIABLE
    app = desktop.LiveTrialDesktopApp({"LOCALAPPDATA": str(tmp_path / "appdata")})
    proof = app._environment[desktop.ENGINE_ACTION_VARIABLE]
    assert engine.serve.action_token({engine.serve.ACTION_VARIABLE: proof}) == proof
    assert desktop.LiveTrialDesktopApp({"LOCALAPPDATA": str(tmp_path / "appdata")})._engine_action != proof

    # the Stop it sends reaches an engine started with its proof ...
    app._engine_action = TOKEN
    monkeypatch.setattr(desktop, "ENGINE_ORIGIN", engine.origin)
    app._ask_engine_to_stop()
    assert engine.store.stop_requested is True
    # ... and an engine with another proof refuses it
    engine.store.stop_requested = False
    app._engine_action = "z" * 43
    with pytest.raises(Exception):
        app._ask_engine_to_stop()
    assert engine.store.stop_requested is False
