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


def register_daily_task(state: Path, python: str, when: str = "03:00") -> bool:
    """Daily task for the signed-in user (runs while the user is signed in; no admin needed)."""
    if sys.platform != "win32":
        return False
    action = f'"{python}" "{ROOT / "tooling" / "auto_backup.py"}" run --state-dir "{state}"'
    run = subprocess.run(["schtasks", "/Create", "/F", "/SC", "DAILY", "/ST", when, "/TN", TASK_NAME,
                          "/TR", action], capture_output=True, text=True, check=False)
    return run.returncode == 0


CA_TASK_NAME = "MK8DX certificate renewal"


def register_ca_renewal(state: Path, python: str, when: str = "03:30") -> bool:
    """Daily `maintain-ca` for the signed-in user.

    Docker Desktop itself only runs inside the signed-in user's session, so this user's task is
    the identity that can reach it; `maintain-ca` does nothing until the signer is due and then
    renews it and the served certificate with HTTPS verification (ADR-0223)."""
    if sys.platform != "win32":
        return False
    action = (f'"{python}" "{ROOT / "tooling" / "install.py"}" maintain-ca --state-dir "{state}"')
    run = subprocess.run(["schtasks", "/Create", "/F", "/SC", "DAILY", "/ST", when, "/TN", CA_TASK_NAME,
                          "/TR", action], capture_output=True, text=True, check=False)
    return run.returncode == 0


def ensure_docker_autostart() -> str:
    """Start Docker Desktop at sign-in (per user, no admin); MK8DX containers restart with it."""
    if sys.platform != "win32":
        return "skipped"
    import winreg
    key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_READ | winreg.KEY_SET_VALUE) as key:
        try:
            # Docker Desktop's own "start at sign-in" already does it, wherever it is installed.
            winreg.QueryValueEx(key, "Docker Desktop")
            return "present"
        except FileNotFoundError:
            pass
        # Machine-wide install, or the per-user Docker Desktop install.
        candidates = [
            Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Docker" / "Docker" / "Docker Desktop.exe",
            Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "DockerDesktop" / "Docker Desktop.exe",
        ]
        exe = next((c for c in candidates if c.is_file()), None)
        if exe is None:
            return "docker-desktop-not-found"
        winreg.SetValueEx(key, "Docker Desktop", 0, winreg.REG_SZ, f'"{exe}"')
        return "enabled"


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
