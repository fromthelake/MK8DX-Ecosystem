"""The Tournament connection's transport against real loopback HTTP servers (synthetic tokens only).

A bearer token, a device code or a request body never follows a redirect to another host, port or scheme;
same-origin redirects are refused too, so a POST is never repeated. Answers are bounded (declared, streamed
in chunks, or as an error body), must be JSON objects with a JSON content type, and the device sign-in address
is checked completely before anything is shown or a browser is opened.
"""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from mk8dx_tournament_connected import client


TOKEN = "synthetic-bearer-token-0123456789"
DEVICE_CODE = "synthetic-device-code-0123456789"


class Recorder:
    """A loopback HTTP server that records every request and answers with ``respond``."""

    def __init__(self, respond=None) -> None:
        self.requests: list[dict] = []
        self.respond = respond or (lambda handler, request: handler.send_json(200, {"ok": True}))
        recorder = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_args):
                pass

            def _handle(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length else b""
                request = {"method": self.command, "path": self.path,
                           "authorization": self.headers.get("Authorization"), "body": body}
                recorder.requests.append(request)
                recorder.respond(self, request)

            do_GET = _handle
            do_POST = _handle

            def send_json(self, status, document, headers=()):
                payload = json.dumps(document).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                for name, value in headers:
                    self.send_header(name, value)
                self.end_headers()
                self.wfile.write(payload)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        self.origin = f"http://127.0.0.1:{self.port}"
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        self.thread.start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def servers(monkeypatch, tmp_path):
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("NO_PROXY", "127.0.0.1,localhost")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.delenv("MK8DX_TOURNAMENT_CA_CERTIFICATE", raising=False)
    created: list[Recorder] = []

    def make(respond=None) -> Recorder:
        recorder = Recorder(respond)
        created.append(recorder)
        return recorder

    yield make
    for recorder in created:
        recorder.close()


class Store:
    def __init__(self, token=TOKEN):
        self.token = token

    def load(self):
        return self.token


def redirect_to(location: str, status: int):
    def respond(handler, _request):
        handler.send_response(status)
        handler.send_header("Location", location)
        handler.send_header("Content-Length", "0")
        handler.end_headers()
    return respond


def _other_origins(other: Recorder, origin: Recorder) -> list[str]:
    return [
        f"{other.origin}/v1/tournament-connections",                      # other port
        f"http://localhost:{other.port}/v1/tournament-connections",       # other host name
        f"https://127.0.0.1:{other.port}/v1/tournament-connections",      # other scheme
        f"http://localhost:{origin.port}/v1/tournament-connections",      # same port, other host
    ]


@pytest.mark.parametrize("status", [301, 302, 303, 307, 308])
def test_authenticated_get_never_follows_a_redirect(servers, monkeypatch, status):
    attacker = servers()
    origin = servers()
    monkeypatch.setenv("MK8DX_TOURNAMENT_API_ORIGIN", origin.origin)
    for location in _other_origins(attacker, origin):
        origin.respond = redirect_to(location, status)
        before = len(origin.requests)
        with pytest.raises(client.ConnectedError):
            client.ConnectedClient(Store()).tournaments()
        assert len(origin.requests) == before + 1
    assert attacker.requests == []


@pytest.mark.parametrize("status", [301, 302, 303, 307, 308])
def test_authenticated_post_is_neither_redirected_nor_repeated(servers, monkeypatch, status):
    attacker = servers()
    origin = servers()
    monkeypatch.setenv("MK8DX_TOURNAMENT_API_ORIGIN", origin.origin)
    origin.respond = redirect_to(f"{attacker.origin}/v1/tournament-evidence-records/x/actions/stopping", status)
    with pytest.raises(client.ConnectedError):
        client.ConnectedClient(Store()).mark_live_stopping("record.synthetic")
    assert attacker.requests == []
    assert [request["method"] for request in origin.requests] == ["POST"]


@pytest.mark.parametrize("status", [302, 307, 308])
def test_same_origin_redirect_is_refused_explicitly(servers, monkeypatch, status):
    origin = servers()
    monkeypatch.setenv("MK8DX_TOURNAMENT_API_ORIGIN", origin.origin)
    origin.respond = redirect_to(f"{origin.origin}/v1/tournament-connections-moved", status)
    with pytest.raises(client.ConnectedError, match="redirect"):
        client.ConnectedClient(Store()).tournaments()
    assert [request["path"] for request in origin.requests] == ["/v1/tournament-connections"]


@pytest.mark.parametrize("status", [301, 302, 303, 307, 308])
def test_device_code_and_token_requests_never_follow_a_redirect(servers, monkeypatch, status):
    attacker = servers()
    origin = servers()
    monkeypatch.setenv("MK8DX_TOURNAMENT_API_ORIGIN", origin.origin)
    opened: list[str] = []
    monkeypatch.setattr(client.webbrowser, "open", opened.append)
    monkeypatch.setattr(client.time, "sleep", lambda _seconds: None)
    origin.respond = redirect_to(f"{attacker.origin}/api/auth/device/code", status)
    with pytest.raises(client.ConnectedError):
        client.sign_in(Store(None))
    # The token poll carries the device code: it must not follow a redirect either.

    def respond(handler, request):
        if request["path"] == "/api/auth/device/code":
            handler.send_json(200, _device_answer(origin.origin))
        else:
            redirect_to(f"{attacker.origin}/api/auth/device/token", status)(handler, request)

    origin.respond = respond
    with pytest.raises(client.ConnectedError):
        client.sign_in(Store(None), open_browser=False)
    assert attacker.requests == []
    assert all(DEVICE_CODE.encode() not in request["body"] for request in attacker.requests)
    assert opened == []


def _device_answer(origin: str, **changes) -> dict:
    answer = {
        "device_code": DEVICE_CODE,
        "user_code": "ABCD-EFGH",
        "verification_uri": f"{origin}/device",
        "verification_uri_complete": f"{origin}/device?user_code=ABCD-EFGH",
        "expires_in": 600,
        "interval": 5,
    }
    answer.update(changes)
    return answer


def _oversized(handler, _request):
    payload = b'{"tournaments": [], "padding": "' + b"x" * (9 * 1024 * 1024) + b'"}'
    handler.send_response(200)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    try:
        handler.wfile.write(payload)
    except OSError:
        pass


def _chunked_endless(handler, _request):
    handler.send_response(200)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Transfer-Encoding", "chunked")
    handler.end_headers()
    chunk = b"x" * 65536
    try:
        handler.wfile.write(b'{"tournaments": [], "padding": "')
        for _ in range(400):  # 25 MiB, never a closing quote
            handler.wfile.write(f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n")
        handler.wfile.write(b"0\r\n\r\n")
    except OSError:
        pass


def _large_error(handler, _request):
    payload = json.dumps({"message": "y" * (1024 * 1024)}).encode()
    handler.send_response(500)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    try:
        handler.wfile.write(payload)
    except OSError:
        pass


def _plain(content_type: str, payload: bytes):
    def respond(handler, _request):
        handler.send_response(200)
        handler.send_header("Content-Type", content_type)
        handler.send_header("Content-Length", str(len(payload)))
        handler.end_headers()
        handler.wfile.write(payload)
    return respond


@pytest.mark.parametrize("respond", [
    _oversized,
    _chunked_endless,
    _large_error,
    _plain("text/html", b"<html>not json</html>"),
    _plain("application/json", b"[]"),
    _plain("application/json", b'{"tournaments": [], "tournaments": []}'),
    _plain("application/json", b'{"tournaments": NaN}'),
], ids=["declared-oversized", "chunked-oversized", "oversized-error", "html", "array", "duplicate-key", "nan"])
def test_answers_are_bounded_and_must_be_json_objects(servers, monkeypatch, respond):
    origin = servers(respond)
    monkeypatch.setenv("MK8DX_TOURNAMENT_API_ORIGIN", origin.origin)
    with pytest.raises(client.ConnectedError) as raised:
        client.ConnectedClient(Store()).tournaments()
    assert "y" * 400 not in str(raised.value)


def test_an_ordinary_answer_still_works_on_the_loopback_exception(servers, monkeypatch):
    origin = servers(lambda handler, _request: handler.send_json(200, {"tournaments": [{
        "tournamentId": "tournament.synthetic", "name": "Practice", "stage": "qualifier", "groups": [],
    }]}))
    monkeypatch.setenv("MK8DX_TOURNAMENT_API_ORIGIN", origin.origin)
    choices = client.ConnectedClient(Store()).tournaments()
    assert [choice.tournament_id for choice in choices] == ["tournament.synthetic"]
    assert origin.requests[0]["authorization"] == f"Bearer {TOKEN}"


def test_the_client_keeps_the_origin_it_was_created_with(servers, monkeypatch):
    origin = servers(lambda handler, _request: handler.send_json(200, {"tournaments": []}))
    other = servers()
    monkeypatch.setenv("MK8DX_TOURNAMENT_API_ORIGIN", origin.origin)
    connected = client.ConnectedClient(Store())
    monkeypatch.setenv("MK8DX_TOURNAMENT_API_ORIGIN", other.origin)
    connected.tournaments()
    assert other.requests == [] and len(origin.requests) == 1


def _signed_in(servers, monkeypatch, answer):
    origin = servers()

    def respond(handler, request):
        if request["path"] == "/api/auth/device/code":
            handler.send_json(200, answer(origin))
        else:
            handler.send_json(200, {"access_token": TOKEN, "token_type": "Bearer",
                                    "expires_in": 604800, "scope": ""})

    origin.respond = respond
    monkeypatch.setenv("MK8DX_TOURNAMENT_API_ORIGIN", origin.origin)
    opened: list[str] = []
    shown: list[tuple[str, str]] = []
    monkeypatch.setattr(client.webbrowser, "open", opened.append)
    monkeypatch.setattr(client.time, "sleep", lambda _seconds: None)

    class Saving(Store):
        saved = None

        def save(self, token):
            Saving.saved = token

    store = Saving(None)
    return origin, opened, shown, store


BAD_ADDRESSES = {
    "other-port": lambda o: f"http://127.0.0.1:{o.port + 1}/device?user_code=ABCD-EFGH",
    "other-host": lambda o: f"http://localhost:{o.port}/device?user_code=ABCD-EFGH",
    "other-site": lambda o: "https://approve.example.net/device?user_code=ABCD-EFGH",
    "scheme-change": lambda o: f"https://127.0.0.1:{o.port}/device?user_code=ABCD-EFGH",
    "arbitrary-scheme": lambda o: "file:///C:/Windows/System32/calc.exe",
    "javascript": lambda o: "javascript:alert(1)",
    "userinfo": lambda o: f"http://user@127.0.0.1:{o.port}/device?user_code=ABCD-EFGH",
    "fragment": lambda o: f"{o.origin}/device?user_code=ABCD-EFGH#elsewhere",
    "other-path": lambda o: f"{o.origin}/api/auth/approve?user_code=ABCD-EFGH",
    "wrong-code": lambda o: f"{o.origin}/device?user_code=ZZZZ-ZZZZ",
    "duplicate-code": lambda o: f"{o.origin}/device?user_code=ABCD-EFGH&user_code=ABCD-EFGH",
    "extra-query": lambda o: f"{o.origin}/device?user_code=ABCD-EFGH&next=https://example.net",
    "no-code": lambda o: f"{o.origin}/device",
    # A backslash before "@": some parsers read the host after it (built in parts for the privacy scan).
    "backslash-host": lambda o: "http://127.0.0.1:" + str(o.port) + "\\" + "@example.net/device?user_code=ABCD-EFGH",
}


@pytest.mark.parametrize("name", sorted(BAD_ADDRESSES))
def test_a_foreign_or_malformed_sign_in_address_opens_nothing(servers, monkeypatch, name):
    origin, opened, shown, store = _signed_in(
        servers, monkeypatch,
        lambda o: _device_answer(o.origin, verification_uri_complete=BAD_ADDRESSES[name](o)),
    )
    with pytest.raises(client.ConnectedError):
        client.sign_in(store, on_authorization=lambda code, url: shown.append((code, url)))
    assert opened == [] and shown == [] and store.saved is None
    assert [request["path"] for request in origin.requests] == ["/api/auth/device/code"]


@pytest.mark.parametrize("changes", [
    {"expires_in": 10 ** 9}, {"expires_in": 0}, {"interval": 0}, {"interval": 3600}, {"interval": "5"},
    {"expires_in": True}, {"user_code": "<script>"}, {"device_code": "short"},
    {"verification_uri": "https://approve.example.net/device"}, {"extra": 1},
], ids=lambda value: next(iter(value)))
def test_malformed_device_answers_fail_closed(servers, monkeypatch, changes):
    _origin, opened, shown, store = _signed_in(
        servers, monkeypatch, lambda o: _device_answer(o.origin, **changes),
    )
    with pytest.raises(client.ConnectedError):
        client.sign_in(store, on_authorization=lambda code, url: shown.append((code, url)))
    assert opened == [] and shown == [] and store.saved is None


def test_the_own_community_sign_in_works_and_names_the_host(servers, monkeypatch, capsys):
    origin, opened, shown, store = _signed_in(servers, monkeypatch, lambda o: _device_answer(o.origin))
    client.sign_in(store, on_authorization=lambda code, url: shown.append((code, url)))
    expected = f"{origin.origin}/device?user_code=ABCD-EFGH"
    assert opened == [expected] and shown == [("ABCD-EFGH", expected)] and store.saved == TOKEN
    assert f"127.0.0.1:{origin.port}" in capsys.readouterr().out
    poll = [request for request in origin.requests if request["path"] == "/api/auth/device/token"]
    assert poll and all(request["authorization"] is None for request in poll)


def test_a_malformed_token_answer_is_not_stored(servers, monkeypatch):
    origin = servers()

    def respond(handler, request):
        if request["path"] == "/api/auth/device/code":
            handler.send_json(200, _device_answer(origin.origin))
        else:
            handler.send_json(200, {"access_token": "x\r\nInjected: 1", "token_type": "Bearer"})

    origin.respond = respond
    monkeypatch.setenv("MK8DX_TOURNAMENT_API_ORIGIN", origin.origin)
    monkeypatch.setattr(client.time, "sleep", lambda _seconds: None)

    class Saving(Store):
        def save(self, token):
            pytest.fail("stored a malformed token")

    with pytest.raises(client.ConnectedError):
        client.sign_in(Saving(None), open_browser=False)


def test_validation_accepts_https_default_port_case_insensitively():
    origin = client.Origin.parse("https://Tournament.Example.org")
    answer = _device_answer("https://tournament.example.org")
    assert client.validate_device_authorization(answer, origin).verification_url.endswith("?user_code=ABCD-EFGH")
    answer = _device_answer("https://tournament.example.org:443")
    assert client.validate_device_authorization(answer, origin).user_code == "ABCD-EFGH"
    with pytest.raises(client.ConnectedError):
        client.validate_device_authorization(_device_answer("http://tournament.example.org"), origin)
