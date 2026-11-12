"""Linux and macOS counterparts of the Windows-only host steps of an A2 offline installation.

Windows keeps its existing implementation (DPAPI, PowerShell, Task Scheduler) in the modules that
call this one; everything here is for `sys.platform` "linux" and "darwin" (ADR-0223 amendment,
docs/install/A2_HOME_GUIDE_EN.md). Every function is plain-subprocess and per user: nothing here
asks for administrator rights. Where a step genuinely needs them (a Linux firewall, Docker Engine
at boot) the function reports what to run instead of running it.
"""
from __future__ import annotations

import base64
import ipaddress
import json
import os
from pathlib import Path
import plistlib
import re
import secrets
import shutil
import subprocess
import sys

# A stored secret on Linux/macOS starts with one of these lines; a Windows DPAPI blob never does.
FILE_MARKER = b"MK8DX-FILE-V1\n"
SYSTEMD_MARKER = b"MK8DX-SYSTEMD-CREDS-V1\n"
KEYCHAIN_MARKER = b"MK8DX-KEYCHAIN-V1\n"
KEYCHAIN_SERVICE = "nl.mariokart8.mk8dx"


def _run(command, *, input_bytes=None, timeout=60):
    return subprocess.run(command, input=input_bytes, capture_output=True, timeout=timeout, check=False)


# ---------- secret protection -------------------------------------------------------------------
def _systemd_creds() -> str | None:
    """`systemd-creds` with per-user encryption (systemd 256+), else None."""
    tool = shutil.which("systemd-creds")
    if tool is None:
        return None
    probe = _run([tool, "--user", "encrypt", "--name=mk8dx-probe", "-", "-"], input_bytes=b"probe")
    return tool if probe.returncode == 0 and probe.stdout else None


def protect(data: bytes, *, platform: str | None = None) -> bytes:
    """Protect a secret for this user on this host; the result is what the state file stores.

    macOS: the user's login Keychain holds the secret, the file only names it. Linux: encrypted
    with `systemd-creds --user` (bound to this host and user) where available, otherwise the
    file itself relies on 0600 permissions in a 0700 folder. Either way a backup copied off the
    host stays sealed with the recovery code (lifecycle.py)."""
    platform = platform or sys.platform
    if platform == "darwin":
        account = "secret-" + secrets.token_hex(12)
        encoded = base64.b64encode(data).decode("ascii")
        added = _run(["security", "add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", account,
                      "-w", encoded])
        if added.returncode != 0:
            raise RuntimeError("The macOS Keychain refused to store the MK8DX secret")
        return KEYCHAIN_MARKER + account.encode("ascii")
    if platform.startswith("linux"):
        tool = _systemd_creds()
        if tool is not None:
            sealed = _run([tool, "--user", "encrypt", "--name=mk8dx", "-", "-"], input_bytes=data)
            if sealed.returncode == 0 and sealed.stdout:
                return SYSTEMD_MARKER + sealed.stdout
        return FILE_MARKER + data
    raise RuntimeError("Use the Windows DPAPI path on Windows")


def unprotect(blob: bytes) -> bytes:
    if blob.startswith(FILE_MARKER):
        return blob[len(FILE_MARKER):]
    if blob.startswith(SYSTEMD_MARKER):
        tool = shutil.which("systemd-creds")
        if tool is None:
            raise RuntimeError("systemd-creds is no longer available to open the MK8DX secret")
        opened = _run([tool, "--user", "decrypt", "--name=mk8dx", "-", "-"], input_bytes=blob[len(SYSTEMD_MARKER):])
        if opened.returncode != 0:
            raise RuntimeError("systemd-creds could not open the MK8DX secret on this host")
        return opened.stdout
    if blob.startswith(KEYCHAIN_MARKER):
        account = blob[len(KEYCHAIN_MARKER):].decode("ascii")
        if not re.fullmatch(r"secret-[0-9a-f]{24}", account):
            raise RuntimeError("Unexpected MK8DX Keychain reference")
        found = _run(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"])
        if found.returncode != 0:
            raise RuntimeError("The macOS Keychain did not return the MK8DX secret")
        return base64.b64decode(found.stdout.strip(), validate=True)
    raise RuntimeError("Unknown MK8DX secret format on this platform")


def protection_kind(blob: bytes) -> str:
    """For status screens: how a stored secret is protected (never its content)."""
    for marker, kind in ((FILE_MARKER, "file-permissions"), (SYSTEMD_MARKER, "systemd-creds"),
                         (KEYCHAIN_MARKER, "keychain")):
        if blob.startswith(marker):
            return kind
    return "dpapi"


# ---------- network ------------------------------------------------------------------------------
def _usable(ip: str) -> bool:
    address = ipaddress.ip_address(ip)
    return address.version == 4 and address.is_private and not address.is_loopback and not address.is_link_local


def local_addresses(*, platform: str | None = None) -> list[dict]:
    """This computer's private IPv4 addresses as {ip, alias, category} (category unknown here)."""
    platform = platform or sys.platform
    rows: list[dict] = []
    if platform.startswith("linux"):
        listed = _run(["ip", "-j", "-4", "addr", "show", "up"])
        if listed.returncode == 0:
            for interface in json.loads(listed.stdout or b"[]"):
                name = str(interface.get("ifname", ""))
                if name == "lo" or name.startswith(("docker", "br-", "veth", "virbr")):
                    continue
                for info in interface.get("addr_info", []):
                    if info.get("family") == "inet" and _usable(str(info.get("local", ""))):
                        rows.append({"ip": info["local"], "alias": name, "category": ""})
    elif platform == "darwin":
        listed = _run(["ifconfig"])
        name = ""
        for line in listed.stdout.decode("utf-8", "replace").splitlines():
            header = re.match(r"^([a-z0-9]+):", line)
            if header:
                name = header.group(1)
                continue
            found = re.match(r"\s+inet (\d+\.\d+\.\d+\.\d+)", line)
            if found and not name.startswith(("lo", "bridge", "utun")) and _usable(found.group(1)):
                rows.append({"ip": found.group(1), "alias": name, "category": ""})
    return rows


def lan_firewall(ip: str, *, platform: str | None = None) -> str:
    """Whether TCP 80/443 on `ip` is reachable from the home network, without asking for root.

    macOS: Docker Desktop publishes the ports itself; the application firewall asks once when
    needed. Linux: when ufw or firewalld is active the command to allow MK8DX is returned for the
    person (or their IT person) to run with sudo; otherwise nothing blocks the ports."""
    platform = platform or sys.platform
    if platform == "darwin":
        return "not-needed (Docker Desktop publishes the ports)"
    subnet = str(ipaddress.ip_network(f"{ip}/24", strict=False))
    if shutil.which("ufw") and _run(["systemctl", "is-active", "--quiet", "ufw"]).returncode == 0:
        return f"manual: sudo ufw allow from {subnet} to {ip} port 80,443 proto tcp"
    if shutil.which("firewall-cmd") and _run(["systemctl", "is-active", "--quiet", "firewalld"]).returncode == 0:
        return ("manual: sudo firewall-cmd --permanent --add-service=http --add-service=https "
                "&& sudo firewall-cmd --reload")
    return "not-needed (no active firewall found)"


# ---------- scheduling and start at sign-in ------------------------------------------------------
def _home() -> Path:
    return Path(os.environ.get("HOME") or Path.home())


def _unit_name(name: str) -> str:
    return "mk8dx-" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _systemd_quote(value: str) -> str:
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'


def _linux_units(name: str, argv: list[str], *, daily: str | None, at_login: bool) -> dict[str, str]:
    unit = _unit_name(name)
    service = ("[Unit]\nDescription=" + name + "\n\n[Service]\nType=oneshot\nExecStart=" +
               " ".join(_systemd_quote(part) for part in argv) + "\n")
    files = {f"{unit}.service": service + ("\n[Install]\nWantedBy=default.target\n" if at_login else "")}
    if daily is not None:
        files[f"{unit}.timer"] = (f"[Unit]\nDescription={name}\n\n[Timer]\nOnCalendar=*-*-* {daily}:00\n"
                                  "Persistent=true\n\n[Install]\nWantedBy=timers.target\n")
    return files


def _launch_agent(name: str, argv: list[str], *, daily: str | None, at_login: bool) -> tuple[str, bytes]:
    label = "nl.mariokart8." + _unit_name(name)
    document: dict = {"Label": label, "ProgramArguments": list(argv)}
    if daily is not None:
        hour, minute = (int(part) for part in daily.split(":"))
        # launchd runs a calendar job that was missed while asleep as soon as the Mac wakes.
        document["StartCalendarInterval"] = {"Hour": hour, "Minute": minute}
    if at_login:
        document["RunAtLoad"] = True
    return label, plistlib.dumps(document)


def schedule(name: str, argv: list[str], *, daily: str | None = None, at_login: bool = False,
             platform: str | None = None) -> bool:
    """A per-user job: daily at HH:MM (catching up after a missed run) and/or at sign-in."""
    platform = platform or sys.platform
    if daily is not None and not re.fullmatch(r"[0-2]\d:[0-5]\d", daily):
        raise ValueError("Use HH:MM for a daily job")
    if platform.startswith("linux"):
        folder = _home() / ".config" / "systemd" / "user"
        folder.mkdir(parents=True, exist_ok=True)
        files = _linux_units(name, argv, daily=daily, at_login=at_login)
        for file_name, content in files.items():
            (folder / file_name).write_text(content, encoding="utf-8")
        if _run(["systemctl", "--user", "daemon-reload"]).returncode != 0:
            return False
        unit = _unit_name(name)
        targets = [f"{unit}.timer"] if daily is not None else []
        if at_login:
            targets.append(f"{unit}.service")
        return _run(["systemctl", "--user", "enable", *targets]).returncode == 0 and (
            daily is None or _run(["systemctl", "--user", "start", f"{unit}.timer"]).returncode == 0)
    if platform == "darwin":
        label, content = _launch_agent(name, argv, daily=daily, at_login=at_login)
        folder = _home() / "Library" / "LaunchAgents"
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / f"{label}.plist"
        target.write_bytes(content)
        domain = f"gui/{os.getuid()}"
        _run(["launchctl", "bootout", domain, str(target)])
        return _run(["launchctl", "bootstrap", domain, str(target)]).returncode == 0
    return False


def docker_autostart(*, platform: str | None = None) -> str:
    """Docker at sign-in/boot. macOS: a sign-in job opens Docker Desktop. Linux: Docker Engine is
    a system service; when it is not enabled at boot the command to do so is returned."""
    platform = platform or sys.platform
    if platform == "darwin":
        app = Path("/Applications/Docker.app")
        if not app.exists():
            return "docker-desktop-not-found"
        return "enabled" if schedule("MK8DX start", ["/usr/bin/open", "-g", "-a", "Docker"], at_login=True,
                                     platform=platform) else "failed"
    if platform.startswith("linux"):
        if _run(["systemctl", "is-enabled", "--quiet", "docker"]).returncode == 0:
            return "present"
        return "manual: sudo systemctl enable --now docker"
    return "skipped"


def desktop_shortcut(launcher: Path, *, platform: str | None = None) -> bool:
    """A "MK8DX beheer" icon that opens the administration (the package's own launcher)."""
    platform = platform or sys.platform
    desktop = _home() / "Desktop"
    if platform.startswith("linux"):
        entry = ("[Desktop Entry]\nType=Application\nName=MK8DX beheer\nTerminal=true\n"
                 f"Exec={_systemd_quote(launcher.as_posix())}\nPath={_systemd_quote(launcher.parent.parent.as_posix())}\n")
        applications = _home() / ".local" / "share" / "applications"
        applications.mkdir(parents=True, exist_ok=True)
        (applications / "mk8dx-beheer.desktop").write_text(entry, encoding="utf-8")
        if desktop.is_dir():
            target = desktop / "mk8dx-beheer.desktop"
            target.write_text(entry, encoding="utf-8")
            target.chmod(0o755)
        return True
    if platform == "darwin":
        if not desktop.is_dir():
            return False
        target = desktop / "MK8DX beheer.command"
        target.write_text(f"#!/bin/sh\nexec {_systemd_quote(launcher.as_posix())}\n", encoding="utf-8")
        target.chmod(0o755)
        return True
    return False
