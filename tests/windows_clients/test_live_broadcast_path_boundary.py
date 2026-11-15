"""The local Live scoreboard serves files only from its configured roots."""

import os
from pathlib import Path
import subprocess
import urllib.error
import urllib.request

import pytest

from live_processor import broadcast_server
from live_processor.broadcast_server import BroadcastServer


def _link_directory(linked: Path, outside: Path) -> None:
    try:
        linked.symlink_to(outside, target_is_directory=True)
    except OSError as error:
        if os.name != "nt":
            pytest.skip(f"directory symlinks unavailable: {error}")
        # Windows junctions exercise the same physical containment boundary.
        result = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(linked), str(outside)],
            capture_output=True, text=True, check=False,
        )
        if result.returncode != 0:
            pytest.skip("directory links unavailable")


def test_legacy_asset_route_rejects_a_link_outside_its_root(tmp_path, monkeypatch):
    imported = tmp_path / "imported"
    character = imported / "character"
    character.mkdir(parents=True)
    (character / "001.png").write_bytes(b"allowed-image")
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "002.png").write_bytes(b"private-file")
    _link_directory(imported / "track", outside)
    monkeypatch.setattr(broadcast_server, "IMPORTED_ASSETS_ROOT", imported)
    server = BroadcastServer(port=0)
    try:
        server.start()
        base = f"http://127.0.0.1:{server._httpd.server_port}/assets/"
        with urllib.request.urlopen(base + "character/001.png", timeout=2) as response:
            assert response.read() == b"allowed-image"
        with pytest.raises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(base + "track/002.png", timeout=2)
        assert error.value.code == 404
    finally:
        server.stop()


def test_static_route_rejects_a_link_outside_its_root(tmp_path, monkeypatch):
    web = tmp_path / "broadcast_web"
    web.mkdir()
    (web / "index.html").write_bytes(b"local-home")
    (web / "app.js").write_bytes(b"allowed-script")
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "escape.js").write_bytes(b"private-file")
    _link_directory(web / "linked", outside)
    monkeypatch.setattr(broadcast_server, "WEB_ROOT", web)
    server = BroadcastServer(port=0)
    try:
        server.start()
        base = f"http://127.0.0.1:{server._httpd.server_port}"
        for path, expected in [("/", b"local-home"), ("/static/app.js", b"allowed-script")]:
            with urllib.request.urlopen(base + path, timeout=2) as response:
                assert response.read() == expected
        with pytest.raises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(base + "/static/linked/escape.js", timeout=2)
        assert error.value.code == 404
        with pytest.raises(urllib.error.HTTPError) as unknown:
            urllib.request.urlopen(base + "/static/other.js", timeout=2)
        assert unknown.value.code == 404
    finally:
        server.stop()


def test_display_names_route_serves_the_catalog_slice_by_canonical_id():
    import json

    server = BroadcastServer(port=0)
    try:
        server.start()
        url = f"http://127.0.0.1:{server._httpd.server_port}/api/display-names"
        with urllib.request.urlopen(url, timeout=5) as response:
            data = json.loads(response.read().decode("utf-8"))
        assert len(data["locales"]) == 15
        assert data["tracks"]["track.mario_kart_stadium"]["ja-JP"] == "マリオカートスタジアム"
        assert data["cups"]["cup.mushroom_cup"]["ru-RU"] == "Кубок гриба"
        assert len(data["tracks"]) == 96 and len(data["cups"]) == 24
    finally:
        server.stop()


def test_messages_route_serves_only_the_known_language_catalogs(tmp_path, monkeypatch):
    import json

    messages = tmp_path / "i18n"
    messages.mkdir()
    (messages / "ja.json").write_text(json.dumps({"messages": {"Race result": "レース結果"}}), encoding="utf-8")
    (tmp_path / "secret.json").write_bytes(b"private-file")
    monkeypatch.setattr(broadcast_server, "MESSAGES_ROOT", messages)
    server = BroadcastServer(port=0)
    try:
        server.start()
        base = f"http://127.0.0.1:{server._httpd.server_port}/api/messages/"
        with urllib.request.urlopen(base + "ja", timeout=2) as response:
            assert json.loads(response.read().decode("utf-8"))["messages"]["Race result"] == "レース結果"
        for name in ("de", "xx", "..%2Fsecret", "../secret", "ja.json", ""):
            with pytest.raises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(base + name, timeout=2)
            assert error.value.code == 404, name
    finally:
        server.stop()


def test_messages_route_serves_the_packaged_dashboard_catalogs():
    import json

    assert broadcast_server.MESSAGES_ROOT == broadcast_server.WEB_ROOT / "i18n"
    for language in sorted(broadcast_server.UI_LANGUAGES):
        document = json.loads((broadcast_server.MESSAGES_ROOT / f"{language}.json").read_text(encoding="utf-8"))
        assert document["language"] == language
