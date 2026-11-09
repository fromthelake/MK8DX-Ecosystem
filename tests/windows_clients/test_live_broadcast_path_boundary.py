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
