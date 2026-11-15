"""Tournament sign-out ends the session on the community server, against a synthetic loopback auth server.

The synthetic server keeps a set of live sessions like Better Auth: ``POST /api/auth/sign-out`` deletes only the
session of the bearer it is sent with, and the native bootstrap answers 401 for a session that no longer exists.
"""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from mk8dx_tournament_connected import cli, client
from mk8dx_tournament_connected.session import SessionStore


OLD = "synthetic-session-old-0123456789"
OTHER = "synthetic-session-other-0123456789"


class AuthServer:
    def __init__(self) -> None:
        self.sessions = {OLD, OTHER}
        self.requests: list[tuple[str, str, str | None]] = []
        self.fail_sign_out = False
        self.forget_to_delete = False
        self.redirect_to: str | None = None
        server = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_args):
                pass

            def _send(self, status, document=None, headers=()):
                payload = b"" if document is None else json.dumps(document).encode()
                self.send_response(status)
                if document is not None:
                    self.send_header("Content-Type", "application/json")
                for name, value in headers:
                    self.send_header(name, value)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def _bearer(self):
                value = self.headers.get("Authorization") or ""
                return value[7:] if value.startswith("Bearer ") else None

            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                self.rfile.read(length)
                server.requests.append(("POST", self.path, self._bearer()))
                if self.path != "/api/auth/sign-out":
                    return self._send(404, {"message": "not found"})
                if server.redirect_to:
                    return self._send(307, None, (("Location", server.redirect_to),))
                if server.fail_sign_out:
                    return self._send(503, {"message": "maintenance"})
                if not server.forget_to_delete:
                    server.sessions.discard(self._bearer())
                return self._send(200, {"success": True})

            def do_GET(self):
                server.requests.append(("GET", self.path, self._bearer()))
                if self.path != "/v1/time-trial-submissions/native-bootstrap-v2":
                    return self._send(404, {"message": "not found"})
                if self._bearer() not in server.sessions:
                    return self._send(401, {"code": "native_time_trial_authentication_required",
                                            "message": "Authentication is required."})
                return self._send(200, {"schemaVersion": "mk8dx.native-time-trial-bootstrap.v2",
                                        "playerId": "player.synthetic", "username": "synthetic",
                                        "displayName": "Synthetic"})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.origin = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()

    def still_valid(self, token: str) -> bool:
        return token in self.sessions

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def auth(monkeypatch, tmp_path):
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("NO_PROXY", "127.0.0.1,localhost")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    server = AuthServer()
    monkeypatch.setenv("MK8DX_TOURNAMENT_API_ORIGIN", server.origin)
    yield server
    server.close()


def _stored(token=OLD) -> SessionStore:
    store = SessionStore()
    store.save(token)
    return store


def test_confirmed_sign_out_revokes_only_this_session(auth):
    store = _stored()
    result = client.sign_out(store)
    assert result.state == client.SIGNED_OUT
    assert store.load() is None
    assert not auth.still_valid(OLD)
    assert auth.still_valid(OTHER)
    # The old bearer is refused afterwards; another legitimate session keeps working.
    with pytest.raises(client.ConnectedError) as refused:
        client.ConnectedClient(type("S", (), {"load": lambda self: OLD})()).account_identity()
    assert refused.value.status == 401
    assert client.ConnectedClient(type("S", (), {"load": lambda self: OTHER})()).account_identity()["displayName"] == "Synthetic"
    assert [request for request in auth.requests if request[0] == "POST"] == [("POST", "/api/auth/sign-out", OLD)]


def test_an_unreachable_server_is_not_reported_as_signed_out(auth):
    store = _stored()
    auth.fail_sign_out = True
    result = client.sign_out(store)
    assert result.state == client.NOT_CONFIRMED
    assert store.load() == OLD, "the session stays so the person can retry or forget it consciously"
    assert auth.still_valid(OLD)


def test_success_without_revocation_is_not_confirmed(auth):
    store = _stored()
    auth.forget_to_delete = True
    assert client.sign_out(store).state == client.NOT_CONFIRMED
    assert store.load() == OLD


def test_a_redirected_sign_out_sends_the_bearer_nowhere_else(auth):
    other = AuthServer()
    try:
        auth.redirect_to = f"{other.origin}/api/auth/sign-out"
        store = _stored()
        assert client.sign_out(store).state == client.NOT_CONFIRMED
        assert other.requests == []
        assert store.load() == OLD
    finally:
        other.close()


def test_server_down_entirely(auth, monkeypatch):
    store = _stored()
    auth.close()
    assert client.sign_out(store).state == client.NOT_CONFIRMED
    assert store.load() == OLD


def test_cli_sign_out_reports_the_server_result(auth, capsys):
    _stored()
    assert cli.main(["sign-out"]) == 0
    out = capsys.readouterr().out
    assert "Signed out on 127.0.0.1:" in out and "no longer works" in out
    assert not auth.still_valid(OLD) and auth.still_valid(OTHER)
    assert OLD not in out


def test_cli_sign_out_failure_is_honest(auth, capsys):
    _stored()
    auth.fail_sign_out = True
    assert cli.main(["sign-out"]) == 2
    out = capsys.readouterr().out
    assert "not confirmed" in out and "still stored on this PC" in out
    assert "Signed out on" not in out
    assert SessionStore().load() == OLD


def test_cli_this_pc_only_says_the_server_session_was_not_ended(auth, capsys):
    _stored()
    assert cli.main(["sign-out", "--this-pc-only"]) == 0
    out = capsys.readouterr().out
    assert "NOT ended on the website" in out
    assert SessionStore().load() is None
    assert auth.still_valid(OLD), "forgetting locally does not pretend to revoke"
    assert auth.requests == []


def test_cli_without_a_stored_session(auth, capsys):
    assert cli.main(["sign-out"]) == 0
    assert "No sign-in is stored" in capsys.readouterr().out
    assert auth.requests == []
