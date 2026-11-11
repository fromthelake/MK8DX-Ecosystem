"""MK8DX setup wizard: a local, browser-based "setup.exe" for an A2 offline installation.

Runs only on this computer (127.0.0.1, random port, per-launch secret, exact Host).
It drives the existing installer (tooling/install.py) and the loopback host service
(first administrator, people, invitation cards); it adds no new authority. See
docs/install/A2_HOME_GUIDE_EN.md and ADR-0223.
"""
from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
from urllib import error as urlerror
from urllib import request as urlrequest
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tooling import install  # noqa: E402

STATIC = ROOT / "tooling" / "setup_wizard_static"
TYPES = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
         ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png"}
ADMIN_QUERY = ("SELECT u.public_id FROM offline_auth_accounts o JOIN user_accounts u "
               "ON u.user_account_id = o.user_account_id WHERE o.account_role = 'administrator' "
               "AND o.active = 1 ORDER BY u.user_account_id LIMIT 1")


def default_route_address() -> str | None:
    """The local address Windows uses for its default route (no packet is sent)."""
    import socket
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("192.0.2.1", 9))
            return probe.getsockname()[0]
    except OSError:
        return None


def clean_env():
    return {k: v for k, v in os.environ.items() if not k.startswith(("COMPOSE_", "MK8DX_"))}


def compose(state: Path, *args, timeout=600) -> str:
    run = subprocess.run(install.compose_command(state) + list(args), cwd=ROOT, env=clean_env(),
                         capture_output=True, text=True, timeout=timeout, check=False)
    if run.returncode != 0:
        raise RuntimeError((run.stderr or run.stdout).strip().splitlines()[-1][:300] if (run.stderr or run.stdout).strip()
                           else f"docker compose {args[0]} failed")
    return run.stdout


def administrator_id(state: Path) -> str | None:
    out = compose(state, "exec", "-T", "mysql", "sh", "-c",
                  f'mysql -N -s -u root -p"$MYSQL_ROOT_PASSWORD" mk8dx -e "{ADMIN_QUERY}" 2>/dev/null').strip()
    return out if re.fullmatch(r"user_account\.[0-9a-f-]{36}", out) else None


def unlock_code(state: Path, account_id: str | None) -> str:
    out = compose(state, "run", "--pull", "never", "-T", "--rm", "--no-deps", "host-admin", "node",
                  "dist/administration/offline-host-unlock-main.js",
                  *(["--user-account-id", account_id] if account_id else ["--bootstrap"]))
    match = re.search(r": ([A-Za-z0-9_-]{30,})\s*$", out, re.M)
    if not match:
        raise RuntimeError("The host did not issue an unlock code")
    return match.group(1)


class HostPage:
    """Server-side client of the loopback host service; keeps its session in memory only."""

    def __init__(self, state: Path):
        port = install.read_dotenv(state / "compose.env")["MK8DX_OFFLINE_HOST_PORT"]
        self.base = f"http://127.0.0.1:{port}"
        self.cookie = None

    def call(self, method, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        headers = {"Accept": "application/json", "Host": self.base[7:]}
        if method != "GET":
            headers.update({"Origin": self.base, "Content-Type": "application/json"})
        if self.cookie:
            headers["Cookie"] = self.cookie
        req = urlrequest.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urlrequest.urlopen(req, timeout=20) as response:
                status, raw, cookie = response.status, response.read(), response.headers.get("Set-Cookie")
        except urlerror.HTTPError as error:
            status, raw, cookie = error.code, error.read(), error.headers.get("Set-Cookie")
        if cookie:
            value = cookie.split(";", 1)[0]
            self.cookie = None if value.endswith("=") else value
        payload = json.loads(raw) if raw else {}
        return status, payload

    def unlock(self, code):
        status, _ = self.call("POST", "/api/unlock", {"code": code})
        if status != 200:
            raise RuntimeError("The host page did not accept the unlock")


class Job:
    def __init__(self):
        self.lock = threading.Lock()
        self.lines, self.phase, self.done, self.error = [], "idle", False, None
        self.restored = False

    def log(self, text):
        with self.lock:
            self.lines.append(text)
            del self.lines[:-200]

    def snapshot(self):
        with self.lock:
            return {"phase": self.phase, "done": self.done, "error": self.error, "lines": self.lines[-40:],
                    "restored": self.restored}


class Wizard:
    def __init__(self, state: Path, qa_candidate: bool):
        self.state = state
        self.qa_candidate = qa_candidate
        self.job = Job()
        self.host: HostPage | None = None
        self.restored = False  # this launch restored a backup (a retry then only starts it)
        self.lock = threading.Lock()

    # ---------- facts -------------------------------------------------------
    def installed(self) -> bool:
        profile = self.state / install.PROFILE
        return profile.is_file() and json.loads(profile.read_text(encoding="utf-8")).get("route") == "A2_OFFLINE"

    def status(self):
        info = {"installed": self.installed(), "qaCandidate": self.qa_candidate, "stateDir": str(self.state),
                "platform": "windows" if sys.platform == "win32" else "macos" if sys.platform == "darwin" else "linux"}
        if info["installed"]:
            info["addresses"] = install.offline_addresses(self.state)
            info["administrator"] = self.host is not None
            # A new router or another network gives this computer a new address: offer the move.
            bound = json.loads((self.state / install.PROFILE).read_text(encoding="utf-8"))["bindAddress"]
            try:
                active = [row["ip"] for row in self.addresses()]
            except (OSError, ValueError, subprocess.SubprocessError):
                active = None
            info["addressActive"] = active is None or bound in active
            info["boundAddress"] = bound
            # A newer package opened on an existing installation offers to take it over.
            try:
                info["update"] = install.update_offer(self.state)
            except (OSError, ValueError, KeyError):
                info["update"] = {"available": False}
        return info

    def checks(self):
        result = []
        docker = shutil.which("docker")
        engine = docker is not None and subprocess.run(["docker", "info"], capture_output=True,
                                                         timeout=60, check=False).returncode == 0
        result.append({"id": "docker", "ok": engine})
        free = shutil.disk_usage(self.state.anchor or str(Path.home())).free
        result.append({"id": "disk", "ok": free >= 6 * 1024 ** 3, "freeGb": round(free / 1024 ** 3, 1)})
        result.append({"id": "platform", "ok": sys.platform == "win32" or sys.platform.startswith("linux") or sys.platform == "darwin"})
        return result

    def addresses(self):
        if sys.platform != "win32":
            from tooling import host_platform
            found = host_platform.local_addresses()
            preferred = default_route_address()
            found.sort(key=lambda r: (r["ip"] != preferred, not r["ip"].startswith("192.168."), r["ip"]))
            return found
        rows = install._powershell(
            "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike 'vEthernet*' -and "
            "$_.InterfaceAlias -notlike 'Loopback*' -and $_.AddressState -eq 'Preferred' } | ForEach-Object { "
            "$c = (Get-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue).NetworkCategory;"
            "[pscustomobject]@{ip=$_.IPAddress; alias=$_.InterfaceAlias; category=[string]$c} } | ConvertTo-Json -Compress",
            timeout=60).stdout
        parsed = json.loads(rows or "[]")
        parsed = [parsed] if isinstance(parsed, dict) else parsed
        found = [r for r in parsed if ipaddress.ip_address(r["ip"]).is_private
                 and not ipaddress.ip_address(r["ip"]).is_link_local]
        preferred = default_route_address()
        found.sort(key=lambda r: (r["ip"] != preferred, not r["ip"].startswith("192.168."), r["ip"]))
        return found

    # ---------- install job -------------------------------------------------
    def run_cli(self, *args):
        command = [sys.executable, str(ROOT / "tooling" / "install.py"), *args, "--state-dir", str(self.state)]
        process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   text=True, env={**os.environ, "PYTHONUNBUFFERED": "1"})
        for line in process.stdout:
            line = line.rstrip()
            if line and not re.search(r"[A-Za-z0-9_-]{40,}", line):
                self.job.log(line)
        if process.wait() != 0:
            raise RuntimeError("Installation step failed; see the log above")

    def start_install(self, ip: str):
        if not self.qa_candidate:
            raise ValueError("This package is not the A2 offline candidate")
        ipaddress.ip_address(ip)

        def work():
            job = self.job
            try:
                if not self.installed():
                    job.phase = "prepare"
                    self.run_cli("init", "--mode", "offline-lan", "--lan-bind-address", ip)
                job.phase = "network"
                job.log("Allowing phones and PCs on this home network (Windows asks for permission once)")
                job.log(f"Network: {install.prepare_offline_network(self.state)}")
                job.phase = "install"
                self.run_cli("start" if self.restored else "setup", "--qa-offline-candidate")
                job.phase = "verify"
                job.log("Website and setup page are reachable")
                install.record_package(self.state)
                job.phase = "done"
                job.done = True
            except Exception as error:  # surfaced in the page, never a stack trace
                job.error = str(error)
        self.job = Job()
        threading.Thread(target=work, daemon=True).start()

    def start_update(self):
        """This newer package takes over the installation: verified backup first, then the switch."""
        if not self.qa_candidate:
            raise ValueError("This package is not the A2 offline candidate")
        if not self.installed():
            raise ValueError("MK8DX is not installed on this computer")
        offer = install.update_offer(self.state)
        if not offer.get("available"):
            raise ValueError("This package is not newer than the installation")

        def work():
            job = self.job
            try:
                from tooling import auto_backup
                from lifecycle import verify_backup
                job.phase = "backup"
                root = auto_backup.default_backup_root()
                root.mkdir(parents=True, exist_ok=True)
                output = root / (time.strftime("%Y%m%d-%H%M%S") + "-before-update")
                job.log("Making an encrypted backup with your recovery code")
                auto_backup.backup_with_stored_code(self.state, output)
                verify_backup(output)
                job.log(f"Backup checked: {output}")
                job.phase = "update"
                self.run_cli("update-package", "--backup-output", str(output), "--qa-offline-candidate")
                self.host = None
                job.phase = "verify"
                job.log("Website and setup page are reachable")
                job.phase = "done"
                job.done = True
            except Exception as error:  # surfaced in the page, never a stack trace
                job.error = str(error)
        self.job = Job()
        threading.Thread(target=work, daemon=True).start()

    def start_move(self, ip: str):
        """Move an installed A2 offline to this computer's new address (same root CA)."""
        if not self.qa_candidate:
            raise ValueError("This package is not the A2 offline candidate")
        if not self.installed():
            raise ValueError("MK8DX is not installed on this computer")
        ipaddress.ip_address(ip)

        def work():
            job = self.job
            try:
                job.phase = "move"
                job.log(f"Moving MK8DX to https://{ip} (Windows asks once to allow the network)")
                self.run_cli("change-lan-address", "--lan-bind-address", ip, "--qa-offline-candidate")
                self.host = None
                job.phase = "done"
                job.done = True
            except Exception as error:  # surfaced in the page, never a stack trace
                job.error = str(error)
        self.job = Job()
        threading.Thread(target=work, daemon=True).start()

    # ---------- restore a backup (a new computer) ---------------------------
    def backups(self, folder: str | None = None):
        """Sealed A2 backups in the default folder (or one the person names, e.g. a USB stick)."""
        from tooling import auto_backup
        root = Path(folder).expanduser() if folder else auto_backup.default_backup_root()
        found = []
        if root.is_dir():
            for item in root.iterdir():
                manifest = item / "manifest.json"
                if not (item.is_dir() and manifest.is_file()):
                    continue
                try:
                    data = json.loads(manifest.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    continue
                if data.get("route") == "A2_OFFLINE" and data.get("schemaVersion") == "mk8dx.install-backup.v3":
                    found.append({"name": item.name, "createdUtc": data.get("createdUtc")})
        found.sort(key=lambda b: b.get("createdUtc") or "", reverse=True)
        return {"folder": str(root), "backups": found}

    def start_restore(self, folder: str, name: str, code: str, ip: str):
        from tooling import auto_backup
        if not self.qa_candidate:
            raise ValueError("This package is not the A2 offline candidate")
        if self.installed() or self.state.exists():
            raise ValueError("MK8DX is already installed on this computer; restore needs a computer without it")
        ipaddress.ip_address(ip)
        root = Path(folder).expanduser() if folder else auto_backup.default_backup_root()
        if not name or Path(name).name != name or not (root / name / "manifest.json").is_file():
            raise ValueError("Choose one of the listed backups")
        # The wizard's code is five groups of four; accept it typed with spaces, without dashes or in
        # lower case, and rebuild the exact form it was sealed with.
        letters = re.sub(r"[^A-Za-z0-9]", "", code).upper()
        code = "-".join(letters[i:i + 4] for i in range(0, 20, 4)) if len(letters) == 20 else code.strip()
        if len(code) < 16:
            raise ValueError("Enter the whole recovery code")

        def work():
            import tempfile
            from tooling import lifecycle
            job = self.job
            created = False
            try:
                job.phase = "restore"
                job.log(f"Opening backup {name} with the recovery code")
                with tempfile.TemporaryDirectory(prefix="mk8dx-code-") as secret:
                    phrase = Path(secret) / "code.txt"
                    phrase.write_text(code, encoding="utf-8")
                    created = True
                    lifecycle.restore_new(root / name, self.state, phrase, ip)
                # Nightly backups keep using the same code, so the paper copy stays valid.
                auto_backup.store_recovery_code(self.state, code)
                # From here a retry only needs the network and start steps (the normal install job).
                job.restored = self.restored = True
                job.log("Database and settings restored")
                job.phase = "network"
                job.log("Allowing phones and PCs on this home network (Windows asks for permission once)")
                job.log(f"Network: {install.prepare_offline_network(self.state)}")
                job.phase = "install"
                # The database came from the backup: start it, never the fresh-database setup.
                self.run_cli("start", "--qa-offline-candidate")
                job.phase = "verify"
                job.log("Website and setup page are reachable")
                job.phase = "done"
                job.done = True
            except Exception as error:  # surfaced in the page, never a stack trace
                message = str(error)
                if "recovery code does not open" in message or "passphrase or envelope" in message:
                    message = "wrong-recovery-code"
                if created and not job.restored and self.state.exists():
                    self.set_aside_failed_restore()
                job.error = message
        self.job = Job()
        threading.Thread(target=work, daemon=True).start()

    def set_aside_failed_restore(self):
        """A half-made restore must not block a retry: stop its containers, keep its files aside."""
        try:
            compose(self.state, "down", timeout=300)
        except (RuntimeError, OSError, ValueError, subprocess.SubprocessError):
            pass
        aside = self.state.with_name(self.state.name + ".failed-" + time.strftime("%Y%m%d-%H%M%S"))
        try:
            self.state.rename(aside)
            self.job.log(f"The unfinished restore was set aside in {aside}")
        except OSError:
            self.job.log(f"Remove or rename {self.state} before trying again")

    # ---------- people ------------------------------------------------------
    def host_call(self, method, path, body=None):
        """One host-page call that survives an expired session: the host page ends an idle session after
        15 minutes (groep3: back to the cards after a while showed "Setup information unavailable").
        An empty 401/403 means "no session"; a refusal with a code is a real answer and is returned."""
        status, payload = self.ensure_host().call(method, path, body)
        if status in (401, 403) and not payload.get("code"):
            self.host = None
            status, payload = self.ensure_host().call(method, path, body)
        return status, payload

    def ensure_host(self):
        if self.host is None:
            admin = administrator_id(self.state)
            if admin is None:
                raise ValueError("No administrator yet")
            host = HostPage(self.state)
            host.unlock(unlock_code(self.state, admin))
            self.host = host
        return self.host

    def create_administrator(self, name: str):
        name = name.strip()
        if not 1 <= len(name) <= 80:
            raise ValueError("Enter a name of 1 to 80 characters")
        if administrator_id(self.state) is None:
            bootstrap = HostPage(self.state)
            bootstrap.unlock(unlock_code(self.state, None))
            status, _ = bootstrap.call("POST", "/api/accounts", {"displayLabel": name, "role": "administrator"})
            if status != 200:
                raise RuntimeError("The administrator could not be created")
        self.host = None
        self.ensure_host()
        return self.people()

    def people(self):
        status, payload = self.host_call("GET", "/api/accounts")
        return [{"accountKey": a["accountKey"], "name": a["displayLabel"], "role": a["role"]}
                for a in payload.get("accounts", [])]

    def add_people(self, names):
        for name in names:
            name = str(name).strip()
            if 1 <= len(name) <= 80:
                status, _ = self.host_call("POST", "/api/accounts", {"displayLabel": name, "role": "account"})
                if status != 200:
                    raise RuntimeError(f"Could not add {name}")
        return self.people()

    def card(self, account_key: str, role: str):
        status, payload = self.host_call("POST", "/api/invitations", {"accountKey": account_key,
                                                                              "role": role})
        if status != 200:
            raise RuntimeError("No sign-in card could be made for this person")
        return {"qr": payload["qrDataUrl"], "url": payload["invitationUrl"], "expiresAtMs": payload["expiresAtMs"],
                "invitationId": payload["invitationId"]}

    def revoke_card(self, invitation_id: str):
        """A lost or replaced card stops working at once (it would otherwise stay valid 15 minutes)."""
        status, _ = self.host_call("POST", "/api/invitations/revoke", {"invitationId": invitation_id})
        if status != 200:
            raise RuntimeError("This card could not be revoked; it may already be used or expired")
        return {"revoked": True}

    def sign_out(self, account_key: str):
        """End every session of another person (lost phone, card given to the wrong person)."""
        status, payload = self.host_call("POST", "/api/accounts/sign-out", {"accountKey": account_key})
        if status == 403:
            raise ValueError("own-account")
        if status != 200:
            raise RuntimeError("This person could not be signed out")
        return {"sessions": int(payload.get("sessions", 0)), "invitations": int(payload.get("invitations", 0))}

    # ---------- this computer trusts its own installation ----------------
    def root_certificate(self) -> Path:
        return self.state / "offline-ca" / "setup" / "root.crt"

    def host_trust(self):
        """Whether this computer's own browser trusts MK8DX (Windows: the root in the user's or the computer's
        Trusted Root store). Elsewhere the browser setup page is the route, so the answer is "manual"."""
        import hashlib
        der = self.root_certificate().read_bytes()
        thumbprint = hashlib.sha1(der).hexdigest().upper()  # what Windows shows in its own warning
        if sys.platform != "win32":
            return {"platform": "manual", "trusted": None, "thumbprint": thumbprint}
        found = install._powershell(
            f"if ((Test-Path 'Cert:\\CurrentUser\\Root\\{thumbprint}') -or "
            f"(Test-Path 'Cert:\\LocalMachine\\Root\\{thumbprint}')) {{ 'yes' }} else {{ 'no' }}", timeout=60)
        return {"platform": "windows", "trusted": found.stdout.strip() == "yes", "thumbprint": thumbprint}

    def trust_this_computer(self):
        """Add the MK8DX root to this Windows user's Trusted Root store. Windows itself asks the person to
        confirm (with the thumbprint); nothing is clicked for them and no administrator rights are used."""
        if sys.platform != "win32":
            raise ValueError("On this system, open the New device address in the browser and follow its steps")
        if not self.installed():
            raise ValueError("MK8DX is not installed on this computer")
        path = self.root_certificate()
        subprocess.run(["certutil", "-user", "-addstore", "Root", str(path)], capture_output=True, timeout=600,
                       check=False)
        return self.host_trust()

    def setup_info(self):
        status, payload = self.host_call("GET", "/api/setup")
        if status != 200:
            raise RuntimeError("Setup information unavailable")
        return {"setupUrl": payload["setupUrl"], "qr": payload["qrDataUrl"], "origin": payload["origin"],
                "fingerprint": payload["rootCertificateSha256"]}

    def finish(self, shortcut: bool, autostart: bool = True, backups: bool = True):
        from tooling import auto_backup
        result = {"autostart": auto_backup.ensure_docker_autostart() if autostart else "off"}
        if backups and self.installed():
            result.update(auto_backup.enable(self.state, sys.executable))
        if self.installed():
            # Certificate renewal is not optional: without it the LAN HTTPS signer expires in a week.
            result["certificateRenewal"] = auto_backup.register_ca_renewal(self.state, sys.executable)
        made = None
        if shortcut and sys.platform != "win32":
            from tooling import host_platform
            made = host_platform.desktop_shortcut(ROOT / "tooling" / "start-mk8dx.sh")
        elif shortcut:
            target = ROOT / "Start-MK8DX-LAN.cmd"
            script = ("$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+"
                      "'\\MK8DX beheer.lnk');"
                      f"$s.TargetPath='{target}';$s.WorkingDirectory='{ROOT}';$s.Save()")
            made = install._powershell(script, timeout=60).returncode == 0
        return {**result, "shortcut": made}


# The illustrated guide (tooling/build_guide_html.py); the plain manual below is the fallback.
GUIDE = ROOT / "docs" / "install" / "guide"
GUIDE_FILE = re.compile(r"(nl|en)\.html|guide\.(css|js)|img/[a-z0-9-]+\.png")

MANUALS = {"nl": ROOT / "docs" / "install" / "A2_THUIS_HANDLEIDING_NL.md",
           "en": ROOT / "docs" / "install" / "A2_HOME_GUIDE_EN.md"}


def manual_html(lang: str) -> bytes:
    """The bundled manual as a small, fully escaped HTML page (works offline)."""
    import html
    source = MANUALS.get(lang, MANUALS["en"]).read_text(encoding="utf-8")
    parts, in_list = [], None

    def inline(text):
        text = html.escape(text)
        text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
        text = re.sub(r"\*(.+?)\*", r"<em>\1</em>", text)
        return re.sub(r"`(.+?)`", r"<code>\1</code>", text)

    for line in source.splitlines():
        kind = "ol" if re.match(r"\d+\. ", line) else "ul" if line.startswith("- ") else None
        if in_list and kind != in_list:
            parts.append(f"</{in_list}>")
            in_list = None
        if kind and not in_list:
            parts.append(f"<{kind} class=\"manual-list\">")
            in_list = kind
        if kind:
            parts.append(f"<li>{inline(re.sub(r'^(\d+\. |- )', '', line))}</li>")
        elif line.startswith("## "):
            parts.append(f"<h2>{inline(line[3:])}</h2>")
        elif line.startswith("# "):
            parts.append(f"<h1>{inline(line[2:])}</h1>")
        elif line.strip():
            parts.append(f"<p>{inline(line)}</p>")
    if in_list:
        parts.append(f"</{in_list}>")
    page = ("<!doctype html><html lang=\"" + ("nl" if lang == "nl" else "en") + "\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>MK8DX</title>"
            "<link rel=\"stylesheet\" href=\"/wizard.css\"></head><body><div class=\"frame\"><main class=\"card manual\">"
            + "".join(parts) + "</main></div></body></html>")
    return page.encode("utf-8")


def make_handler(wizard: Wizard, token: str, host_header: str):
    page = (STATIC / "index.html").read_text(encoding="utf-8").replace("__WIZARD_TOKEN__", token)

    class Handler(BaseHTTPRequestHandler):
        server_version = "MK8DX-Setup/1"
        sys_version = ""

        def log_message(self, *_):
            pass

        def send(self, status, body, kind="application/json; charset=utf-8"):
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Security-Policy",
                             "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'")
            self.send_header("X-Frame-Options", "DENY")
            self.end_headers()
            self.wfile.write(data)

        def allowed(self, api):
            if self.headers.get("Host") != host_header:
                return False
            return not api or self.headers.get("X-MK8DX-Wizard") == token

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if not self.allowed(path.startswith("/api/")):
                return self.send(403, {"error": "forbidden"})
            try:
                if path == "/":
                    return self.send(200, page.encode(), TYPES[".html"])
                if path == "/help":
                    lang = "nl" if "lang=nl" in self.path else "en"
                    if (GUIDE / f"{lang}.html").is_file():
                        self.send_response(302)
                        self.send_header("Location", f"/guide/{lang}.html")
                        self.send_header("Content-Length", "0")
                        self.end_headers()
                        return None
                    return self.send(200, manual_html(lang), TYPES[".html"])
                if path.startswith("/guide/") and GUIDE_FILE.fullmatch(path[len("/guide/"):]):
                    file = GUIDE / path[len("/guide/"):]
                    if file.is_file():
                        return self.send(200, file.read_bytes(), TYPES[file.suffix])
                if path in ("/wizard.js", "/wizard.css", "/logo.svg"):
                    file = STATIC / path[1:]
                    return self.send(200, file.read_bytes(), TYPES[file.suffix])
                routes = {"/api/status": wizard.status, "/api/checks": wizard.checks,
                          "/api/network": wizard.addresses, "/api/job": wizard.job.snapshot,
                          "/api/people": wizard.people, "/api/setup": wizard.setup_info,
                          "/api/host-trust": wizard.host_trust}
                if path in routes:
                    return self.send(200, routes[path]())
                if path == "/api/backups":
                    from urllib.parse import parse_qs, urlsplit
                    folder = (parse_qs(urlsplit(self.path).query).get("folder") or [""])[0]
                    return self.send(200, wizard.backups(folder or None))
                return self.send(404, {"error": "not found"})
            except Exception as error:
                return self.send(409, {"error": str(error)})

        def do_POST(self):
            path = self.path
            if not self.allowed(True) or self.headers.get("Origin") != f"http://{host_header}":
                return self.send(403, {"error": "forbidden"})
            try:
                length = int(self.headers.get("Content-Length") or 0)
                if length > 64 * 1024:
                    return self.send(413, {"error": "too large"})
                body = json.loads(self.rfile.read(length) or b"{}")
                if path == "/api/install":
                    wizard.start_install(str(body.get("ip", "")))
                    return self.send(200, {"started": True})
                if path == "/api/host-trust":
                    return self.send(200, wizard.trust_this_computer())
                if path == "/api/update":
                    wizard.start_update()
                    return self.send(200, {"started": True})
                if path == "/api/move":
                    wizard.start_move(str(body.get("ip", "")))
                    return self.send(200, {"started": True})
                if path == "/api/restore":
                    wizard.start_restore(str(body.get("folder", "")), str(body.get("name", "")),
                                         str(body.get("code", "")), str(body.get("ip", "")))
                    return self.send(200, {"started": True})
                if path == "/api/administrator":
                    return self.send(200, {"people": wizard.create_administrator(str(body.get("name", "")))})
                if path == "/api/people":
                    names = body.get("names") or []
                    return self.send(200, {"people": wizard.add_people(names[:50] if isinstance(names, list) else [])})
                if path == "/api/card":
                    return self.send(200, wizard.card(str(body.get("accountKey", "")), str(body.get("role", "account"))))
                if path == "/api/people/sign-out":
                    return self.send(200, wizard.sign_out(str(body.get("accountKey", ""))))
                if path == "/api/card/revoke":
                    return self.send(200, wizard.revoke_card(str(body.get("invitationId", ""))))
                if path == "/api/close":
                    threading.Timer(0.5, self.server.shutdown).start()
                    return self.send(200, {"closing": True})
                if path == "/api/finish":
                    result = wizard.finish(bool(body.get("shortcut", True)), bool(body.get("autostart", True)),
                                           bool(body.get("backups", True)))
                    # Keep serving briefly so the page can show the one-time recovery code.
                    threading.Timer(600.0, self.server.shutdown).start()
                    return self.send(200, result)
                return self.send(404, {"error": "not found"})
            except (ValueError, RuntimeError, KeyError, subprocess.SubprocessError) as error:
                return self.send(409, {"error": str(error)})

    return Handler


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--qa-offline-candidate", action="store_true")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args(argv)
    images = ROOT / "images" / "images.json"
    qa = args.qa_offline_candidate or (images.is_file() and
                                       json.loads(images.read_text(encoding="utf-8")).get("qaOfflineCandidate") is True)
    wizard = Wizard(args.state_dir.resolve(), qa)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), None)
    host_header = f"127.0.0.1:{server.server_port}"
    token = secrets.token_urlsafe(24)
    server.RequestHandlerClass = make_handler(wizard, token, host_header)
    url = f"http://{host_header}/"
    print(f"MK8DX setup is open in your browser: {url}", flush=True)
    print("Keep this window open until you click Finish.", flush=True)
    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
