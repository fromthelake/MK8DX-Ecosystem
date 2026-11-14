"""Tournament Connect/Live website address: loopback HTTP for A1/A3, and sign-in asks once."""
import io
import json

import pytest

from mk8dx_tournament_connected import cli, client, server
from live_processor import ocr_runtime


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.delenv("MK8DX_TOURNAMENT_API_ORIGIN", raising=False)
    monkeypatch.delenv("MK8DX_TOURNAMENT_ALLOW_INSECURE_LOOPBACK", raising=False)


@pytest.mark.parametrize("origin", ["http://127.0.0.1:18090", "http://localhost:8080", "https://tournament.example.org"])
def test_loopback_http_and_https_are_accepted_without_opt_in(monkeypatch, origin):
    monkeypatch.setenv("MK8DX_TOURNAMENT_API_ORIGIN", origin)
    assert client.api_origin() == origin


@pytest.mark.parametrize("origin", [
    "http://tournament.example.org", "http://192.168.1.20:8080", "http://127.0.0.1", "http://127.0.0.1:8080/",
    "http://127.0.0.2:8080", "http://localhost.example.org:8080",
])
def test_other_plain_http_still_requires_https(monkeypatch, origin):
    monkeypatch.setenv("MK8DX_TOURNAMENT_API_ORIGIN", origin)
    with pytest.raises(client.ConnectedError, match="requires HTTPS"):
        client.api_origin()


def test_old_opt_in_variable_is_harmless(monkeypatch):
    monkeypatch.setenv("MK8DX_TOURNAMENT_ALLOW_INSECURE_LOOPBACK", "1")
    monkeypatch.setenv("MK8DX_TOURNAMENT_API_ORIGIN", "http://127.0.0.1:18090")
    assert client.api_origin() == "http://127.0.0.1:18090"
    monkeypatch.setenv("MK8DX_TOURNAMENT_API_ORIGIN", "http://tournament.example.org")
    with pytest.raises(client.ConnectedError):
        client.api_origin()


class Tty(io.StringIO):
    def isatty(self):
        return True


def test_sign_in_asks_for_the_address_once_and_stores_it(monkeypatch, capsys):
    signed_in = []
    monkeypatch.setattr(cli.sys, "stdin", Tty())
    monkeypatch.setattr("builtins.input", lambda _prompt: "http://127.0.0.1:18090")
    monkeypatch.setattr(cli, "sign_in", lambda store: signed_in.append(client.api_origin()))
    assert cli.main(["sign-in"]) == 0
    assert signed_in == ["http://127.0.0.1:18090"]
    saved = json.loads((server.base_dir() / "server.json").read_text(encoding="utf-8"))
    assert saved == {"schemaVersion": "mk8dx.tournament-server.v1", "origin": "http://127.0.0.1:18090"}
    # The second sign-in uses the stored address and does not ask again.
    monkeypatch.setattr("builtins.input", lambda _prompt: pytest.fail("asked again"))
    assert cli.main(["sign-in"]) == 0
    assert signed_in[-1] == "http://127.0.0.1:18090"


def test_sign_in_rejects_an_invalid_address_like_the_server_command(monkeypatch, capsys):
    monkeypatch.setattr(cli.sys, "stdin", Tty())
    monkeypatch.setattr("builtins.input", lambda _prompt: "http://tournament.example.org")
    monkeypatch.setattr(cli, "sign_in", lambda store: pytest.fail("signed in without an address"))
    assert cli.main(["sign-in"]) == 2
    assert "Connection workflow stopped" in capsys.readouterr().out
    assert server.selected_origin() is None


def test_sign_in_without_a_terminal_names_the_server_command(monkeypatch, capsys):
    monkeypatch.setattr(cli.sys, "stdin", io.StringIO(""))
    monkeypatch.setattr(cli, "sign_in", lambda store: pytest.fail("signed in without an address"))
    assert cli.main(["sign-in"]) == 2
    assert "TournamentConnect.cmd server <address>" in capsys.readouterr().out


def test_model_message_says_loading_when_the_models_are_on_disk(monkeypatch, tmp_path, capsys):
    (tmp_path / "model").mkdir()
    for name in ("english_g2.pth", "latin_g2.pth"):
        (tmp_path / "model" / name).write_bytes(b"x")
    monkeypatch.setenv("EASYOCR_MODULE_PATH", str(tmp_path))
    message = ocr_runtime.announce_easyocr_models([["en"], ["en", "nl"]])
    assert message.startswith("Loading recognition models") and "Download" not in message


def test_model_message_names_a_real_one_time_download(monkeypatch, tmp_path):
    (tmp_path / "model").mkdir()
    (tmp_path / "model" / "latin_g2.pth").write_bytes(b"x")
    monkeypatch.setenv("EASYOCR_MODULE_PATH", str(tmp_path))
    assert ocr_runtime.missing_easyocr_models([["en"], ["en", "nl"]]) == ["english_g2.pth"]
    assert "english_g2.pth once" in ocr_runtime.announce_easyocr_models([["en"], ["en", "nl"]])
