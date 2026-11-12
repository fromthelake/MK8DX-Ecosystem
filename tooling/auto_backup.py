"""Automatic daily backups and start-with-Windows for an A2 offline installation.

Plug-and-play by design (docs/install/A2_HOME_GUIDE_EN.md): the setup wizard creates a
recovery code once (shown to the person to write down or print), keeps it on this host
protected with Windows DPAPI for the scheduled backup, and registers a daily task for the
current user (no elevation). Backups are encrypted with that code, so a copied backup is
useless without it. The newest seven backups are kept.
"""
from __future__ import annotations

import argparse
import os
import re
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tooling"))

PHRASE_FILE = "backup-recovery-code.dpapi"
TASK_NAME = "MK8DX backup"
KEEP = 7


def default_backup_root() -> Path:
    return Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Documents" / "MK8DX-backups"


def new_recovery_code() -> str:
    """Five groups of four unambiguous characters (100 bits), easy to write down."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "-".join("".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(5))


def has_recovery_code(state: Path) -> bool:
    return (state / PHRASE_FILE).is_file()


def store_recovery_code(state: Path, code: str) -> None:
    from tooling.offline_lan_ca import _restrict, protect_root
    target = state / PHRASE_FILE
    if target.exists():
        raise FileExistsError("A recovery code already exists for this installation")
    target.write_bytes(protect_root(code.encode("utf-8")))
    _restrict(target, directory=False)


def read_recovery_code(state: Path) -> str:
    from tooling.offline_lan_ca import unprotect_root
    return unprotect_root((state / PHRASE_FILE).read_bytes()).decode("utf-8")


def _quote(value: str) -> str:
    """A PowerShell single-quoted literal."""
    return "'" + str(value).replace("'", "''") + "'"


def _register_task(name: str, execute: str, arguments: str, trigger: str) -> bool:
    """A task for the signed-in user (no stored password, no elevation).

    Docker Desktop only runs in that user's session, so the user's own interactive task is the
    identity that can reach it. A run missed while the computer was off, asleep or nobody was
    signed in starts as soon as possible afterwards, and laptops on battery still run it."""
    if sys.platform != "win32":
        return False
    script = (
        "$ErrorActionPreference='Stop';"
        "$who=\"$env:USERDOMAIN\\$env:USERNAME\";"
        f"$a=New-ScheduledTaskAction -Execute {_quote(execute)} -Argument {_quote(arguments)};"
        f"$t={trigger};"
        "$s=New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries "
        "-DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2);"
        "$p=New-ScheduledTaskPrincipal -UserId $who -LogonType Interactive -RunLevel Limited;"
        f"Register-ScheduledTask -TaskName {_quote(name)} -Action $a -Trigger $t -Settings $s "
        "-Principal $p -Force | Out-Null")
    run = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
                         capture_output=True, text=True, check=False)
    return run.returncode == 0


def _daily(when: str) -> str:
    if not re.fullmatch(r"[0-2]\d:[0-5]\d", when):
        raise ValueError("Use HH:MM for a daily task")
    return f"New-ScheduledTaskTrigger -Daily -At {_quote(when)}"


def register_daily_task(state: Path, python: str, when: str = "03:00") -> bool:
    """The nightly encrypted backup (catches up after a missed night)."""
    if sys.platform != "win32":
        from tooling import host_platform
        return host_platform.schedule(TASK_NAME, [python, str(ROOT / "tooling" / "auto_backup.py"), "run",
                                                  "--state-dir", str(state)], daily=when)
    return _register_task(TASK_NAME, python,
                          f'"{ROOT / "tooling" / "auto_backup.py"}" run --state-dir "{state}"', _daily(when))


CA_TASK_NAME = "MK8DX certificate renewal"


def register_ca_renewal(state: Path, python: str, when: str = "03:30") -> bool:
    """Daily `maintain-ca`: does nothing until the signer is due, then renews it and the served
    certificate with HTTPS verification (ADR-0223)."""
    if sys.platform != "win32":
        from tooling import host_platform
        return host_platform.schedule(CA_TASK_NAME, [python, str(ROOT / "tooling" / "install.py"), "maintain-ca",
                                                     "--qa-offline-candidate", "--state-dir", str(state)], daily=when)
    return _register_task(CA_TASK_NAME, python,
                          f'"{ROOT / "tooling" / "install.py"}" maintain-ca --state-dir "{state}"', _daily(when))


START_TASK_NAME = "MK8DX start"


def docker_desktop_executable() -> Path | None:
    candidates = [
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Docker" / "Docker" / "Docker Desktop.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "DockerDesktop" / "Docker Desktop.exe",
    ]
    return next((c for c in candidates if c.is_file()), None)


def ensure_docker_autostart() -> str:
    """Start Docker Desktop at sign-in (per user, no admin); MK8DX's containers restart with it.

    MK8DX keeps its own sign-in task instead of relying on Docker Desktop's "start when you sign
    in" entry: that entry can be switched off in Docker's settings or in Windows' startup apps
    (a host restarted by Windows Update then stayed offline, 2026-11-11). The task starts Docker
    Desktop only when it is not already running. Linux/macOS: host_platform.docker_autostart."""
    if sys.platform != "win32":
        from tooling import host_platform
        return host_platform.docker_autostart()
    exe = docker_desktop_executable()
    if exe is None:
        return "docker-desktop-not-found"
    starter = (f"if (-not (Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue)) "
               f"{{ Start-Process -FilePath {_quote(str(exe))} }}")
    registered = _register_task(START_TASK_NAME, "powershell.exe",
                                f'-NoProfile -NonInteractive -WindowStyle Hidden -Command "{starter}"',
                                "New-ScheduledTaskTrigger -AtLogOn -User $who")
    return "enabled" if registered else "failed"


def wait_for_docker(timeout_s: float = 900.0, poll_s: float = 10.0) -> bool:
    """At sign-in Docker Desktop needs a few minutes; a caught-up backup waits instead of failing."""
    deadline = time.monotonic() + timeout_s
    while True:
        ready = subprocess.run(["docker", "info"], capture_output=True, check=False).returncode == 0
        if ready or time.monotonic() >= deadline:
            return ready
        time.sleep(poll_s)


def enable(state: Path, python: str) -> dict:
    """Create the recovery code (only once) and the daily task. Returns the code only when new."""
    code = None
    if not has_recovery_code(state):
        code = new_recovery_code()
        store_recovery_code(state, code)
    return {"recoveryCode": code, "task": register_daily_task(state, python), "folder": str(default_backup_root())}


def backup_with_stored_code(state: Path, output: Path) -> Path:
    """One encrypted backup into `output`, using the recovery code the wizard stored."""
    from lifecycle import backup
    if not has_recovery_code(state):
        raise RuntimeError("No stored recovery code: finish the setup wizard (or run lifecycle.py backup "
                           "with --recovery-phrase-file) before backing up or updating")
    secret = state / ("backup-code-" + secrets.token_hex(6) + ".tmp")
    try:
        secret.write_text(read_recovery_code(state), encoding="utf-8")
        from tooling.offline_lan_ca import _restrict
        _restrict(secret, directory=False)
        backup(state, output, secret)
    finally:
        secret.unlink(missing_ok=True)
    return output


def run(state: Path, root: Path | None = None) -> Path:
    root = root or default_backup_root()
    root.mkdir(parents=True, exist_ok=True)
    if not wait_for_docker():
        raise RuntimeError("Docker is not running; the backup runs again at the next scheduled time")
    output = backup_with_stored_code(state, root / time.strftime("%Y%m%d-%H%M%S"))
    backups = sorted((p for p in root.iterdir() if p.is_dir() and p.name[:8].isdigit()), key=lambda p: p.name)
    for old in backups[:-KEEP]:
        shutil.rmtree(old, ignore_errors=True)
    return output


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["run"])
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--backup-root", type=Path)
    args = parser.parse_args(argv)
    print(f"Backup written: {run(args.state_dir.resolve(), args.backup_root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
