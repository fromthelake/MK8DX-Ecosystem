"""Automatic daily, verified, restorable backups for A1, A2 (online LAN), B1, A3 and B2.

A2 offline keeps its own nightly sealed backup (tooling/auto_backup.py). Every other route gets the
same safety net here, on the route's natural scheduler, without administrator rights:

* Windows (A1, A3): a Task Scheduler task for the signed-in user (auto_backup's task settings:
  catches up after a missed night, runs on battery, no stored password).
* Linux/macOS desktop (A1): a systemd user timer or a launchd agent (tooling/host_platform.py).
* B1 VPS and B2 shared hosting: one marked line in the user's own crontab; every other line stays.

One run (`install.py backup-run`) makes the route's existing backup (tooling/lifecycle.py for Docker,
tooling/native_install.py without Docker: the same logical dump options and private settings their
restore commands need), verifies it with the same checks restore uses, renames it from a hidden
`.partial-` folder to its final name only after it verified, applies retention, optionally copies it
to a second folder (another drive or a NAS) and records the result in `auto-backup-status.json`. A
failed or unverified run leaves every older backup in place and exits with a non-zero code:

  0 ok   1 backup failed   2 verification failed   3 backup ok, copy failed   4 another run busy
  5 not enough free disk space   6 not scheduled for this route (A2 offline uses auto_backup.py)

Retention: the newest backup of each of the last 14 days that have one, plus the newest of each of the
4 weeks before that, bounded by a total size (10 GiB, B2 1 GiB). The newest verified backup is never
deleted, even when it alone is larger than the bound.

Optional encryption (`--encrypt-backups`) seals each backup with a recovery code in the A2 format
(AES-256-GCM, scrypt): shown once to write down, kept on this host DPAPI-protected (Windows) or with
systemd-creds/owner-only permissions (Linux). `install.py backup-open` unseals one for restore. On
shared hosting the code can only be stored next to the backups, so there it protects copies taken off
the host, not the host itself; owner-only permissions outside public_html are the protection there.
"""
from __future__ import annotations

import base64
import contextlib
import errno
import hashlib
import io
import json
import os
import re
import shlex
import shutil
import stat
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for _path in (str(ROOT), str(ROOT / "tooling")):
    if _path not in sys.path:
        sys.path.insert(0, _path)

from tooling.launcher_text import t  # noqa: E402

SETTINGS = "auto-backup.json"
STATUS = "auto-backup-status.json"
LOCK = "auto-backup.lock"
CODE_FILE = "auto-backup-code.protected"
SETTINGS_SCHEMA = "mk8dx.auto-backup-settings.v1"
STATUS_SCHEMA = "mk8dx.auto-backup-status.v1"
SEALED_SCHEMA = "mk8dx.auto-backup-sealed.v1"
SEALED_FILE = "backup.sealed"
SEALED_AAD = b"mk8dx-auto-backup-sealed-v1"
DOCKER_ROUTES = ("A1", "A2", "B1")
NATIVE_ROUTES = ("A3", "B2")
ROUTES = DOCKER_ROUTES + NATIVE_ROUTES
CRON_MARKER = "# mk8dx-auto-backup:"
LOCK_STALE_S = 6 * 3600
MIN_FREE_BYTES = 64 * 1024 * 1024

EXIT_OK, EXIT_FAILED, EXIT_VERIFY, EXIT_COPY, EXIT_BUSY, EXIT_NO_SPACE, EXIT_NOT_APPLICABLE = range(7)
RESULTS = {EXIT_OK: "ok", EXIT_FAILED: "failed", EXIT_VERIFY: "verification-failed", EXIT_COPY: "copy-failed",
           EXIT_BUSY: "busy", EXIT_NO_SPACE: "no-space", EXIT_NOT_APPLICABLE: "not-applicable"}


class BackupError(RuntimeError):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code


# ---------- installation, settings and status ---------------------------------------------------
def profile_of(state: Path) -> dict:
    return json.loads((Path(state) / "operator-profile.json").read_text(encoding="utf-8"))


def route_of(state: Path) -> str:
    route = profile_of(state).get("route")
    if route == "A2_OFFLINE":
        raise BackupError(EXIT_NOT_APPLICABLE, "A2 offline keeps its own nightly sealed backup (MK8DX beheer)")
    if route not in ROUTES:
        raise BackupError(EXIT_NOT_APPLICABLE, "Unknown installation route")
    return route


def default_backup_root(route: str, *, platform: str | None = None) -> Path:
    platform = platform or sys.platform
    if platform == "win32":
        return Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Documents" / "MK8DX-backups" / "automatic"
    return Path(os.environ.get("HOME") or Path.home()) / "mk8dx-backups" / "automatic"


def default_settings(route: str) -> dict:
    return {"schemaVersion": SETTINGS_SCHEMA, "enabled": True, "time": "03:15",
            "backupRoot": str(default_backup_root(route)), "copyTo": None,
            "keepDaily": 14, "keepWeekly": 4, "maxTotalMb": 1024 if route == "B2" else 10240,
            "encrypt": False, "scheduler": None}


def _write_private_json(path: Path, payload: dict) -> None:
    """Atomic replace with owner-only permissions (a reader never sees half a file)."""
    staging = path.with_name(path.name + ".next")
    with contextlib.suppress(FileNotFoundError):
        staging.unlink()
    fd = os.open(staging, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    os.replace(staging, path)
    os.chmod(path, 0o600)


def load_settings(state: Path) -> dict | None:
    path = Path(state) / SETTINGS
    if not path.is_file():
        return None
    settings = json.loads(path.read_text(encoding="utf-8"))
    if settings.get("schemaVersion") != SETTINGS_SCHEMA:
        raise BackupError(EXIT_FAILED, "Automatic backup settings have an unknown format")
    return settings


def save_settings(state: Path, settings: dict) -> None:
    _write_private_json(Path(state) / SETTINGS, settings)


def settings_for(state: Path) -> dict:
    route = route_of(state)
    return {**default_settings(route), **(load_settings(state) or {})}


def record_choice(state: Path, enabled: bool) -> None:
    """The answer of the setup question; `setup` and `upgrade` follow it later."""
    settings = settings_for(state)
    settings["enabled"] = bool(enabled)
    save_settings(state, settings)


def load_status(state: Path) -> dict | None:
    path = Path(state) / STATUS
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def summary(state: Path, now: datetime | None = None) -> dict:
    """For `install.py status`: whether it is on, and the age and result of the last run. Never raises."""
    try:
        settings = settings_for(state)
    except BackupError as error:
        return {"enabled": False, "note": str(error)}
    except (OSError, ValueError, KeyError):
        return {"enabled": False, "note": "settings unreadable"}
    found = load_status(state) or {}
    now = now or datetime.now(timezone.utc)
    shown = {"enabled": bool(settings.get("enabled")) and bool(settings.get("scheduler")),
             "scheduler": settings.get("scheduler"), "time": settings.get("time"),
             "backupRoot": settings.get("backupRoot"), "copyTo": settings.get("copyTo"),
             "encrypted": bool(settings.get("encrypt")),
             "lastResult": found.get("lastResult", "never"), "lastAttemptUtc": found.get("lastAttemptUtc"),
             "lastSuccessUtc": found.get("lastSuccessUtc"), "latestBackup": found.get("latestBackup")}
    if found.get("lastMessage") and found.get("lastResult") != "ok":
        shown["lastMessage"] = found["lastMessage"]
    if found.get("lastSuccessUtc"):
        age = now - datetime.fromisoformat(found["lastSuccessUtc"])
        shown["lastSuccessAgeHours"] = round(age.total_seconds() / 3600, 1)
        shown["stale"] = age.total_seconds() > 36 * 3600
    return shown


# ---------- paths ----------------------------------------------------------------------------------
def _is_link(part: Path) -> bool:
    import lifecycle
    return part.exists() and (part.is_symlink() or getattr(part.lstat(), "st_file_attributes", 0) &
                              getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)) and not lifecycle.system_link(part)


def safe_root(value, state: Path) -> Path:
    """A backup folder outside the package, the installation folder and any public web folder, without links."""
    path = Path(os.path.abspath(value))
    if "%" in str(path) or "\n" in str(path) or "\r" in str(path):
        raise BackupError(EXIT_FAILED, "Choose a backup folder without % or line breaks")
    for part in (*reversed(path.parents), path):
        if _is_link(part):
            raise BackupError(EXIT_FAILED, "Backup folder path contains a link or junction")
    if path.is_relative_to(ROOT):
        raise BackupError(EXIT_FAILED, "Keep backups outside the software package")
    if path.is_relative_to(Path(os.path.abspath(state))):
        raise BackupError(EXIT_FAILED, "Keep backups outside the private installation folder")
    if any(part.lower() in ("public_html", "htdocs", "www", "httpdocs", "private_html") for part in path.parts):
        raise BackupError(EXIT_FAILED, "Backups must stay outside public web folders")
    return path


def owner_only(path: Path, *, directory: bool) -> None:
    os.chmod(path, 0o700 if directory else 0o600)
    if sys.platform == "win32" and directory:
        # The folder and everything in it: this user, SYSTEM and Administrators only (as A2's state).
        sid = subprocess.run(["whoami", "/user", "/fo", "csv", "/nh"], capture_output=True, text=True, check=False)
        found = re.search(r'"(S-1-[0-9-]+)"', sid.stdout or "")
        if found:
            subprocess.run(["icacls", str(path), "/inheritance:r", "/grant:r", f"*{found.group(1)}:(OI)(CI)F",
                            "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"],
                           capture_output=True, text=True, check=False)


def _restrict_tree(folder: Path) -> None:
    for item in folder.rglob("*"):
        if item.is_file() and not item.is_symlink():
            os.chmod(item, 0o600)
        elif item.is_dir() and not item.is_symlink():
            os.chmod(item, 0o700)
    owner_only(folder, directory=True)


def _tree_bytes(folder: Path) -> int:
    return sum(item.stat().st_size for item in folder.rglob("*") if item.is_file() and not item.is_symlink())


def _digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def backup_name(project: str, when: datetime) -> str:
    return f"{project}-{when.strftime('%Y%m%d-%H%M%S')}"


def listed(folder: Path, project: str) -> list[tuple[Path, datetime]]:
    """This installation's finished backups in `folder`, newest first (hidden .partial- folders excluded)."""
    pattern = re.compile(rf"^{re.escape(project)}-(\d{{8}}-\d{{6}})$")
    found = []
    if folder.is_dir():
        for item in folder.iterdir():
            match = pattern.match(item.name)
            if match and item.is_dir() and not item.is_symlink():
                found.append((item, datetime.strptime(match.group(1), "%Y%m%d-%H%M%S").replace(tzinfo=timezone.utc)))
    return sorted(found, key=lambda entry: entry[1], reverse=True)


# ---------- retention ----------------------------------------------------------------------------
def select_keep(entries: list[tuple[str, datetime, int]], keep_daily: int, keep_weekly: int,
                max_bytes: int) -> set[str]:
    """Names to keep from (name, created, bytes): newest per day for `keep_daily` days, newest per ISO week
    for `keep_weekly` weeks before those, then drop the oldest kept until the total fits `max_bytes`.
    The newest entry always stays."""
    ordered = sorted(entries, key=lambda entry: entry[1], reverse=True)
    if not ordered:
        return set()
    kept: list[tuple[str, datetime, int]] = []
    days: list = []
    for entry in ordered:
        day = entry[1].date()
        if day not in days and len(days) < max(1, keep_daily):
            days.append(day)
            kept.append(entry)
    oldest_day = days[-1]
    weeks: list = []
    for entry in ordered:
        if entry[1].date() >= oldest_day:
            continue
        week = entry[1].isocalendar()[:2]
        if week not in weeks and len(weeks) < keep_weekly:
            weeks.append(week)
            kept.append(entry)
    kept.sort(key=lambda entry: entry[1], reverse=True)
    while len(kept) > 1 and sum(entry[2] for entry in kept) > max_bytes:
        kept.pop()
    return {entry[0] for entry in kept}


def prune(folder: Path, project: str, settings: dict) -> dict:
    entries = [(path.name, created, _tree_bytes(path)) for path, created in listed(folder, project)]
    keep = select_keep(entries, int(settings["keepDaily"]), int(settings["keepWeekly"]),
                       int(settings["maxTotalMb"]) * 1024 * 1024)
    for name, _created, _size in entries:
        if name not in keep:
            shutil.rmtree(folder / name, ignore_errors=True)
    return {"kept": len(keep), "keptBytes": sum(size for name, _c, size in entries if name in keep)}


def _clear_partials(folder: Path, project: str) -> None:
    pattern = re.compile(rf"^\.partial-(plain-)?{re.escape(project)}-\d{{8}}-\d{{6}}$")
    if folder.is_dir():
        for item in folder.iterdir():
            if pattern.match(item.name) and item.is_dir() and not item.is_symlink():
                shutil.rmtree(item, ignore_errors=True)


# ---------- making and verifying one backup ------------------------------------------------------
def _quiet(enabled: bool):
    return contextlib.redirect_stdout(io.StringIO()) if enabled else contextlib.nullcontext()


def _docker_database_running(state: Path) -> bool:
    import lifecycle
    command = lifecycle.compose(state) + ["ps", "--status", "running", "--services"]
    clean_env = {k: v for k, v in os.environ.items() if not k.startswith(("COMPOSE_", "MK8DX_"))}
    result = subprocess.run(command, cwd=ROOT, env=clean_env, capture_output=True, text=True, check=False)
    return result.returncode == 0 and "mysql" in result.stdout.split()


def _wait_for_docker(timeout_s: float) -> bool:
    deadline = time.monotonic() + timeout_s
    while True:
        if subprocess.run(["docker", "info"], capture_output=True, check=False).returncode == 0:
            return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(10)


def make_backup(state: Path, route: str, output: Path) -> None:
    """The route's existing backup into `output` (which must not exist yet)."""
    if route in DOCKER_ROUTES:
        import lifecycle
        if sys.platform in ("win32", "darwin") and not _wait_for_docker(900):
            raise BackupError(EXIT_FAILED, "Docker is not running; the backup runs again at the next scheduled time")
        if not _docker_database_running(state):
            raise BackupError(EXIT_FAILED, "The MK8DX database is not running (start MK8DX); older backups are kept")
        lifecycle.backup(state, output)
        return
    import native_install
    if route == "A3":
        import socket
        with socket.socket() as probe:
            running = probe.connect_ex(("127.0.0.1", 18306)) == 0
        if not running:
            # Only this installation's own MariaDB, for the backup, and stopped again afterwards.
            _state, profile, runtime = native_install.loaded(state)
            database = native_install.start_local_database(state, profile, runtime)
            try:
                native_install.backup(state, output)
            finally:
                native_install.stop_local_database(state, database)
            return
    native_install.backup(state, output)


def verify_folder(folder: Path, route: str) -> str:
    """The same checks restore uses (checksums of every file, a readable dump); returns the manifest digest."""
    manifest = folder / "manifest.json"
    if manifest.is_file() and json.loads(manifest.read_text(encoding="utf-8")).get("schemaVersion") == SEALED_SCHEMA:
        verify_sealed(folder)
        return _digest(manifest)
    if route in NATIVE_ROUTES:
        import native_install
        native_install.verify_backup(folder)
        return _digest(folder / "BACKUP_MANIFEST.json")
    import gzip
    import lifecycle
    lifecycle.verify_backup(folder)
    with gzip.open(folder / "database.sql.gz", "rb") as stream:  # the whole dump decompresses
        while stream.read(1024 * 1024):
            pass
    return _digest(manifest)


# ---------- optional sealing (A2's format: AES-256-GCM with a scrypt key from the recovery code) -------
def _code_path(state: Path) -> Path:
    return Path(state) / CODE_FILE


def create_recovery_code(state: Path) -> str | None:
    """A new recovery code, stored protected on this host; None when one exists already."""
    from tooling.auto_backup import new_recovery_code
    target = _code_path(state)
    if target.exists():
        return None
    code = new_recovery_code()
    if sys.platform == "win32":
        from tooling.offline_lan_ca import protect_root
        blob = protect_root(code.encode("utf-8"))
    else:
        from tooling import host_platform
        blob = host_platform.protect(code.encode("utf-8"))
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(blob)
    return code


def _protect(data: bytes) -> bytes:
    if sys.platform == "win32":
        from tooling.offline_lan_ca import protect_root
        return protect_root(data)
    from tooling import host_platform
    return host_platform.protect(data)


def rotate_recovery_code(state: Path) -> str:
    """A new recovery code for the encrypted automatic backups, in place of the stored one.

    Backups made from now on are sealed with it; backups made before keep the old code (they are not
    re-encrypted), so that paper stays with them. Returns the new code, to be shown once. A2 offline keeps
    its code in auto_backup (`backup_new_code` picks the right one)."""
    from tooling import host_platform
    from tooling.auto_backup import new_recovery_code
    target = _code_path(state)
    if not target.is_file():
        raise BackupError(EXIT_FAILED, "This installation has no backup recovery code: its automatic backups "
                                       "are not encrypted (switch that on with backup-schedule --encrypt-backups)")
    code = new_recovery_code()
    host_platform.replace_secret_file(target, code.encode("utf-8"), protect_with=_protect)
    if read_recovery_code(state) != code:
        raise BackupError(EXIT_FAILED, "The new recovery code could not be read back")
    return code


def backup_new_code(state: Path) -> str:
    """The route's own recovery code store: A2 offline (MK8DX beheer) or the encrypted automatic backups."""
    if profile_of(state).get("route") == "A2_OFFLINE":
        from tooling import auto_backup
        try:
            return auto_backup.rotate_recovery_code(state)
        except ValueError as error:
            raise BackupError(EXIT_FAILED, str(error)) from None
    return rotate_recovery_code(state)


def read_recovery_code(state: Path) -> str:
    blob = _code_path(state).read_bytes()
    if sys.platform == "win32":
        from tooling.offline_lan_ca import unprotect_root
        return unprotect_root(blob).decode("utf-8")
    from tooling import host_platform
    return host_platform.unprotect(blob).decode("utf-8")


def seal(plain: Path, sealed: Path, phrase: str, route: str, project: str) -> None:
    import zipfile
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from tooling.offline_lan_ca_lifecycle import KDF_N, KDF_P, KDF_R, _derive
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_STORED) as bundle:
        for item in sorted(plain.iterdir()):
            if not item.is_file() or item.is_symlink():
                raise BackupError(EXIT_FAILED, "Unexpected item in the backup")
            bundle.write(item, item.name)
    content = archive.getvalue()
    salt, nonce = os.urandom(16), os.urandom(12)
    ciphertext = AESGCM(_derive(phrase, salt)).encrypt(nonce, content, SEALED_AAD)
    sealed.mkdir(mode=0o700)
    with open(sealed / SEALED_FILE, "xb") as stream:
        stream.write(ciphertext)
    os.chmod(sealed / SEALED_FILE, 0o600)
    _write_private_json(sealed / "manifest.json", {
        "schemaVersion": SEALED_SCHEMA, "createdUtc": datetime.now(timezone.utc).isoformat(),
        "route": route, "project": project, "contentSha256": hashlib.sha256(content).hexdigest(),
        "kdf": {"name": "scrypt", "n": KDF_N, "r": KDF_R, "p": KDF_P, "salt": base64.b64encode(salt).decode()},
        "cipher": {"name": "AES-256-GCM", "nonce": base64.b64encode(nonce).decode()},
        "files": {SEALED_FILE: _digest(sealed / SEALED_FILE)}})


def verify_sealed(folder: Path) -> dict:
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != SEALED_SCHEMA or set(manifest.get("files", {})) != {SEALED_FILE}:
        raise BackupError(EXIT_VERIFY, "Sealed backup manifest is invalid")
    path = folder / SEALED_FILE
    if path.is_symlink() or not path.is_file() or _digest(path) != manifest["files"][SEALED_FILE]:
        raise BackupError(EXIT_VERIFY, "Backup checksum mismatch")
    return manifest


def _unseal(folder: Path, phrase: str) -> bytes:
    from cryptography.exceptions import InvalidTag
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from tooling.offline_lan_ca_lifecycle import KDF_N, KDF_P, KDF_R, _derive
    manifest = verify_sealed(folder)
    kdf, cipher = manifest["kdf"], manifest["cipher"]
    if {k: kdf.get(k) for k in ("name", "n", "r", "p")} != {"name": "scrypt", "n": KDF_N, "r": KDF_R, "p": KDF_P} \
            or cipher.get("name") != "AES-256-GCM":
        raise BackupError(EXIT_VERIFY, "Sealed backup uses an unknown protection")
    try:
        content = AESGCM(_derive(phrase, base64.b64decode(kdf["salt"], validate=True))).decrypt(
            base64.b64decode(cipher["nonce"], validate=True), (folder / SEALED_FILE).read_bytes(), SEALED_AAD)
    except InvalidTag:
        raise BackupError(EXIT_VERIFY, "The recovery code does not open this backup") from None
    if hashlib.sha256(content).hexdigest() != manifest["contentSha256"]:
        raise BackupError(EXIT_VERIFY, "Sealed backup content differs from its manifest")
    return content


def open_sealed(folder: Path, phrase: str, output: Path) -> Path:
    """Unseal into a new private folder that the route's restore command takes as --backup(-input)."""
    import zipfile
    content = _unseal(folder, phrase)
    route = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))["route"]
    if output.exists():
        raise BackupError(EXIT_FAILED, "Choose a new folder for the opened backup")
    output.mkdir(mode=0o700, parents=True)
    with zipfile.ZipFile(io.BytesIO(content)) as bundle:
        for name in bundle.namelist():
            if "/" in name or "\\" in name or name in ("", ".", "..") or ":" in name:
                raise BackupError(EXIT_VERIFY, "Sealed backup contains an unsafe name")
            fd = os.open(output / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(bundle.read(name))
    owner_only(output, directory=True)
    verify_folder(output, route)
    return output


# ---------- one scheduled run --------------------------------------------------------------------
@contextlib.contextmanager
def _locked(state: Path):
    path = Path(state) / LOCK
    try:
        if path.exists() and time.time() - path.stat().st_mtime > LOCK_STALE_S:
            path.unlink()
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise BackupError(EXIT_BUSY, "Another backup or update of this installation is running") from None
    try:
        os.write(fd, f"{os.getpid()}\n".encode("ascii"))
        os.close(fd)
        yield
    finally:
        with contextlib.suppress(FileNotFoundError):
            path.unlink()


def _short(error: BaseException) -> str:
    text = " ".join(str(error).split())
    return (text[:300] + "...") if len(text) > 300 else text


def _record(state: Path, code: int, message: str, now: datetime, extra: dict | None = None) -> dict:
    previous = load_status(state) or {}
    status = {"schemaVersion": STATUS_SCHEMA, "lastAttemptUtc": now.isoformat(), "lastResult": RESULTS[code],
              "exitCode": code, "lastMessage": message,
              **{k: previous[k] for k in ("lastSuccessUtc", "latestBackup", "latestBackupSha256",
                                          "latestBackupBytes", "kept", "keptBytes") if k in previous},
              **(extra or {})}
    with contextlib.suppress(OSError):
        _write_private_json(Path(state) / STATUS, status)
    return status


def _copy(final: Path, target_root: Path, route: str, project: str, settings: dict) -> dict:
    target_root.mkdir(parents=True, exist_ok=True)
    _clear_partials(target_root, project)
    staging = target_root / (".partial-" + final.name)
    shutil.copytree(final, staging)
    try:
        verify_folder(staging, route)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    _restrict_tree(staging)
    os.replace(staging, target_root / final.name)
    return prune(target_root, project, settings)


def run(state: Path, *, quiet: bool = False, now: datetime | None = None) -> tuple[int, dict]:
    """One automatic backup. Returns (exit code, recorded status); never deletes a verified backup on failure."""
    state = Path(os.path.abspath(state))
    now = now or datetime.now(timezone.utc)
    try:
        route = route_of(state)
        settings = settings_for(state)
        project = profile_of(state)["project"]
        root = safe_root(settings["backupRoot"], state)
        copy_root = safe_root(settings["copyTo"], state) if settings.get("copyTo") else None
    except BackupError as error:
        return error.code, {"lastResult": RESULTS[error.code], "lastMessage": str(error)}
    except (OSError, ValueError, KeyError) as error:
        return EXIT_FAILED, {"lastResult": "failed", "lastMessage": _short(error)}
    try:
        with _locked(state):
            root.mkdir(parents=True, exist_ok=True)
            owner_only(root, directory=True)
            _clear_partials(root, project)
            newest = listed(root, project)
            needed = max(MIN_FREE_BYTES, 2 * (_tree_bytes(newest[0][0]) if newest else 0))
            if shutil.disk_usage(root).free < needed:
                raise BackupError(EXIT_NO_SPACE, f"Not enough free disk space for a new backup (needs about "
                                                 f"{needed // (1024 * 1024)} MB); older backups are kept")
            name = backup_name(project, now)
            partial = root / (".partial-" + name)
            plain = root / (".partial-plain-" + name) if settings.get("encrypt") else partial
            try:
                with _quiet(quiet):
                    try:
                        make_backup(state, route, plain)
                    except BackupError:
                        raise
                    except OSError as error:
                        if error.errno in (errno.ENOSPC, getattr(errno, "EDQUOT", -1)):
                            raise BackupError(EXIT_NO_SPACE, "The disk or hosting quota is full; older backups "
                                                             "are kept") from error
                        raise BackupError(EXIT_FAILED, _short(error)) from error
                    except Exception as error:  # dump tool, Docker, database: one clear failure
                        raise BackupError(EXIT_FAILED, _short(error)) from error
                    try:
                        verify_folder(plain, route)
                    except Exception as error:
                        raise BackupError(EXIT_VERIFY, "The new backup did not verify (" + _short(error) +
                                          "); it was removed and older backups are kept") from error
                    if settings.get("encrypt"):
                        phrase = read_recovery_code(state)
                        seal(plain, partial, phrase, route, project)
                        _unseal(partial, phrase)  # opens with the stored code: restorable
                        shutil.rmtree(plain)
                _restrict_tree(partial)
                final = root / name
                os.replace(partial, final)
            except BaseException:
                for leftover in {partial, plain}:
                    shutil.rmtree(leftover, ignore_errors=True)
                raise
            manifest_digest = _digest(final / ("BACKUP_MANIFEST.json" if route in NATIVE_ROUTES and
                                               not settings.get("encrypt") else "manifest.json"))
            kept = prune(root, project, settings)
            success = {"lastSuccessUtc": now.isoformat(), "latestBackup": str(final),
                       "latestBackupSha256": manifest_digest, "latestBackupBytes": _tree_bytes(final), **kept}
            if copy_root is not None:
                try:
                    copied = _copy(final, copy_root, route, project, settings)
                except Exception as error:
                    status = _record(state, EXIT_COPY, "Backup made and verified, but the copy to the second folder "
                                     "failed: " + _short(error), now, {**success, "copyResult": "failed"})
                    return EXIT_COPY, status
                success.update({"copyResult": "ok", "copyKept": copied["kept"]})
            return EXIT_OK, _record(state, EXIT_OK, "Backup made and verified", now, success)
    except BackupError as error:
        return error.code, _record(state, error.code, str(error), now)
    except OSError as error:
        code = EXIT_NO_SPACE if error.errno in (errno.ENOSPC, getattr(errno, "EDQUOT", -1)) else EXIT_FAILED
        return code, _record(state, code, _short(error), now)


def latest(state: Path) -> Path:
    """The newest backup of this installation that verifies now (the local folder, else the copy folder)."""
    route = route_of(state)
    settings = settings_for(state)
    project = profile_of(state)["project"]
    for folder in [settings["backupRoot"], settings.get("copyTo")]:
        if not folder:
            continue
        for path, _created in listed(safe_root(folder, state), project):
            try:
                with _quiet(True):
                    verify_folder(path, route)
                return path
            except Exception:
                continue
    raise BackupError(EXIT_FAILED, "No verified automatic backup found yet")


# ---------- schedulers ---------------------------------------------------------------------------
def task_name(project: str) -> str:
    return f"MK8DX automatic backup {project}"


def cron_id(state: Path) -> str:
    return hashlib.sha256(str(Path(os.path.abspath(state))).encode("utf-8")).hexdigest()[:12]


def _cron_safe(value: str) -> str:
    if "%" in value or "\n" in value or "\r" in value:
        raise BackupError(EXIT_FAILED, "Paths for the crontab may not contain % or line breaks")
    return shlex.quote(value)


# cron refuses a line of 1000 characters or more ("command too long"); stay clearly below it.
CRON_LINE_MAX = 990
_WSL_DRIVE = re.compile(r"^/mnt/[A-Za-z](/|$)")


def cron_path(path_env: str) -> str:
    """The PATH for the cron job: absolute entries, each once. WSL appends every Windows PATH entry under
    /mnt/<drive>/; a Linux cron job never needs those, and with them the line exceeds cron's limit."""
    kept: list[str] = []
    for entry in path_env.split(":"):
        if entry.startswith("/") and not _WSL_DRIVE.match(entry) and entry not in kept:
            kept.append(entry)
    return ":".join(kept) or "/usr/bin:/bin"


def cron_line(state: Path, when: str, python: str, path_env: str) -> str:
    hour, minute = (int(part) for part in when.split(":"))
    line = (f"{minute} {hour} * * * cd {_cron_safe(str(ROOT))} && PATH={_cron_safe(cron_path(path_env))} "
            f"{_cron_safe(python)} tooling/install.py backup-run --state-dir {_cron_safe(str(state))} --quiet "
            f">/dev/null {CRON_MARKER}{cron_id(state)}")
    if len(line) > CRON_LINE_MAX:
        raise BackupError(EXIT_FAILED, f"The crontab line would be {len(line)} characters, more than cron accepts; "
                                       "shorten PATH or the package and installation folder names")
    return line


_DIRECTADMIN_NOISE = (re.compile(r"^Backup of .* previous crontab saved"), re.compile(r"^[0-9a-fA-F]{64}$"))


def crontab_lines(listing: str) -> list[str]:
    """`crontab -l` output as the crontab's own lines. DirectAdmin-style hosts print a 'Backup of <user>'s
    previous crontab saved ...' notice and a 64-hex hash there; neither is a valid crontab line, so both go."""
    return [line for line in listing.splitlines()
            if not any(pattern.match(line.strip()) for pattern in _DIRECTADMIN_NOISE)]


def with_marked_line(lines: list[str], marker: str, line: str | None) -> list[str]:
    """Every other line unchanged, in order; the marked line removed, or replaced by exactly one `line`."""
    kept = [existing for existing in lines if not existing.rstrip().endswith(marker)]
    return kept + ([line] if line is not None else [])


def _run(command, **kwargs):
    return subprocess.run(command, capture_output=True, text=True, check=False, **kwargs)


def read_crontab(runner=_run) -> list[str]:
    result = runner(["crontab", "-l"])
    if result.returncode != 0:
        if "no crontab" in (result.stderr or "").lower():
            return []
        raise BackupError(EXIT_FAILED, "crontab -l failed: " + _short(result.stderr or result.returncode))
    return crontab_lines(result.stdout or "")


def set_cron(state: Path, line: str | None, runner=_run) -> None:
    marker = CRON_MARKER + cron_id(state)
    before = read_crontab(runner)
    wanted = with_marked_line(before, marker, line)
    if wanted == before:
        return
    text = "".join(entry + "\n" for entry in wanted)
    written = runner(["crontab", "-"], input=text)
    if written.returncode != 0:
        raise BackupError(EXIT_FAILED, "crontab refused the new table: " + _short(written.stderr or written.returncode))
    after = read_crontab(runner)
    if after != wanted:
        raise BackupError(EXIT_FAILED, "The crontab differs from what was written; check it with crontab -l")


def _powershell(script: str):
    return _run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script])


def choose_scheduler(route: str, *, platform: str | None = None) -> str:
    platform = platform or sys.platform
    if platform == "win32":
        return "windows-task"
    if platform == "darwin":
        return "launchd"
    if route in ("B1", "B2") or not shutil.which("systemctl"):
        return "crontab"
    return "systemd-user"


def schedule(state: Path, settings: dict, *, python: str | None = None) -> str:
    from tooling import auto_backup, host_platform
    python = python or sys.executable
    project = profile_of(state)["project"]
    scheduler = choose_scheduler(route_of(state))
    name = task_name(project)
    if scheduler == "windows-task":
        ok = auto_backup._register_task(
            name, python, f'"{ROOT / "tooling" / "install.py"}" backup-run --state-dir "{state}" --quiet',
            auto_backup._daily(settings["time"]))
    elif scheduler in ("systemd-user", "launchd"):
        ok = host_platform.schedule(name, [python, str(ROOT / "tooling" / "install.py"), "backup-run",
                                           "--state-dir", str(state), "--quiet"], daily=settings["time"])
        if not ok and scheduler == "systemd-user" and shutil.which("crontab"):
            scheduler, ok = "crontab", True
            set_cron(state, cron_line(state, settings["time"], python, os.environ.get("PATH", "/usr/bin:/bin")))
    else:
        if not shutil.which("crontab"):
            raise BackupError(EXIT_FAILED, "No crontab command on this host; ask your provider for cron access")
        set_cron(state, cron_line(state, settings["time"], python, os.environ.get("PATH", "/usr/bin:/bin")))
        ok = True
    if not ok:
        raise BackupError(EXIT_FAILED, f"The {scheduler} scheduler refused the daily backup")
    return scheduler


def unschedule(state: Path, scheduler: str | None) -> None:
    from tooling import host_platform
    project = profile_of(state)["project"]
    name = task_name(project)
    if scheduler == "windows-task":
        quoted = "'" + name.replace("'", "''") + "'"
        _powershell(f"Unregister-ScheduledTask -TaskName {quoted} -Confirm:$false -ErrorAction SilentlyContinue")
    elif scheduler == "systemd-user":
        unit = host_platform._unit_name(name)
        _run(["systemctl", "--user", "disable", "--now", f"{unit}.timer"])
        folder = host_platform._home() / ".config" / "systemd" / "user"
        for suffix in (".timer", ".service"):
            with contextlib.suppress(FileNotFoundError):
                (folder / f"{unit}{suffix}").unlink()
        _run(["systemctl", "--user", "daemon-reload"])
    elif scheduler == "launchd":
        label = "nl.mariokart8." + host_platform._unit_name(name)
        target = host_platform._home() / "Library" / "LaunchAgents" / f"{label}.plist"
        _run(["launchctl", "bootout", f"gui/{os.getuid()}", str(target)])
        with contextlib.suppress(FileNotFoundError):
            target.unlink()
    elif scheduler == "crontab":
        set_cron(state, None)


def enable(state: Path, *, backup_root=None, copy_to=None, when=None, keep_daily=None, keep_weekly=None,
           max_total_mb=None, encrypt=None, python=None) -> dict:
    """Switch on (or re-point after an update) the daily backup. Returns the settings and a new recovery code."""
    state = Path(os.path.abspath(state))
    settings = settings_for(state)
    for key, value in (("backupRoot", backup_root), ("copyTo", copy_to), ("time", when), ("keepDaily", keep_daily),
                       ("keepWeekly", keep_weekly), ("maxTotalMb", max_total_mb), ("encrypt", encrypt)):
        if value is not None:
            settings[key] = str(value) if key in ("backupRoot", "copyTo") else value
    if settings.get("copyTo") == "":
        settings["copyTo"] = None
    if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", str(settings["time"])):
        raise BackupError(EXIT_FAILED, "Use HH:MM for the backup time")
    if not (1 <= int(settings["keepDaily"]) <= 366 and 0 <= int(settings["keepWeekly"]) <= 260
            and 1 <= int(settings["maxTotalMb"]) <= 10_000_000):
        raise BackupError(EXIT_FAILED, "Retention values are out of range")
    settings["backupRoot"] = str(safe_root(settings["backupRoot"], state))
    if settings.get("copyTo"):
        settings["copyTo"] = str(safe_root(settings["copyTo"], state))
    code = None
    if settings.get("encrypt"):
        try:
            import cryptography  # noqa: F401
        except ImportError:
            raise BackupError(EXIT_FAILED, "Encrypted backups need the Python package 'cryptography'") from None
        code = create_recovery_code(state)
    previous = settings.get("scheduler")
    scheduler = schedule(state, settings, python=python)
    if previous and previous != scheduler:
        with contextlib.suppress(Exception):
            unschedule(state, previous)
    settings.update({"enabled": True, "scheduler": scheduler})
    save_settings(state, settings)
    return {"settings": settings, "recoveryCode": code}


def disable(state: Path) -> dict:
    state = Path(os.path.abspath(state))
    settings = settings_for(state)
    unschedule(state, settings.get("scheduler") or choose_scheduler(route_of(state)))
    settings.update({"enabled": False, "scheduler": None})
    save_settings(state, settings)
    return settings


def _turn_off_command(state: Path) -> str:
    return f'python tooling/install.py backup-unschedule --state-dir "{state}"'


def _announce(result: dict, state: Path) -> None:
    print(t("Nightly automatic backup is on: {0}. Turn it off with: {1}",
            result["settings"]["backupRoot"], _turn_off_command(state)))
    if result.get("recoveryCode"):
        print(t("Write down this backup recovery code and keep it away from this computer: {0}",
                result["recoveryCode"]))


def ask_choice() -> bool:
    """The B2 setup question (A1, A3 and B1 have it on without asking); Enter means yes (the default)."""
    print(t("MK8DX can make its own checked backup of the database and the site's keys every night: about 3 MB a "
            "day compressed, 14 days and 4 weeks are kept, at most 1 GB, outside public_html."))
    print(t("Does your host already make daily account backups (for example DirectAdmin or JetBackup)? Then you may "
            "say no. An own backup still lets you restore yesterday yourself, including the site's keys, without "
            "waiting for support."))
    try:
        answer = input(t("Make and check a backup automatically every night? [Y/n]: ")).strip().lower()
    except EOFError:
        return True
    return not (answer[:1] == "n" or answer[:1] == "н" or answer in ("いいえ", "아니요", "아니오", "否", "不"))


def after_setup(state: Path) -> None:
    """Called after a successful first setup: switch on unless the person said no. Never fails the setup."""
    try:
        settings = load_settings(state)
        if settings is not None and not settings.get("enabled"):
            return
        _announce(enable(state), Path(os.path.abspath(state)))
    except Exception as error:  # the installation itself is fine
        print(t("Nightly automatic backup could not be switched on: {0}. Your installation is fine; see the "
                "backup chapter of the guide.", _short(error)))


def after_upgrade(state: Path) -> None:
    """An update runs from a new package folder: point the existing schedule at it (only when it is on)."""
    try:
        settings = load_settings(state)
        if settings is None or not settings.get("enabled") or not settings.get("scheduler"):
            return
        _announce(enable(state), Path(os.path.abspath(state)))
    except Exception as error:
        print(t("Nightly automatic backup could not be switched on: {0}. Your installation is fine; see the "
                "backup chapter of the guide.", _short(error)))


# ---------- command line (called from install.py) -------------------------------------------------
def command(action: str, args) -> int:
    state = Path(os.path.abspath(args.state_dir))
    try:
        if action == "backup-run":
            code, status = run(state, quiet=args.quiet)
            if code != EXIT_OK:
                print(f"MK8DX automatic backup: {status.get('lastResult')}: {status.get('lastMessage')}",
                      file=sys.stderr)
            elif not args.quiet:
                print(f"Backup made and verified: {status.get('latestBackup')}")
            return code
        if action == "backup-schedule":
            result = enable(state, backup_root=args.backup_root, copy_to=args.copy_to, when=args.backup_time,
                            keep_daily=args.keep_daily, keep_weekly=args.keep_weekly,
                            max_total_mb=args.max_backup_mb,
                            encrypt=True if args.encrypt_backups else None)
            _announce(result, state)
            return EXIT_OK
        if action == "backup-new-code":
            code = backup_new_code(state)
            print(t("New backup recovery code (shown only once; write it down and keep it away from this "
                    "computer): {0}", code))
            print(t("Backups made from now on need this new code. Backups made before still open only with "
                    "the old code: keep that paper with them."))
            return EXIT_OK
        if action == "backup-unschedule":
            disable(state)
            print("Nightly automatic backup is off; existing backups are kept")
            return EXIT_OK
        if action == "backup-status":
            print(json.dumps(summary(state), indent=2))
            return EXIT_OK
        if action == "backup-latest":
            path = latest(state)
            print(str(path) if args.print_path else f"Newest verified backup: {path}")
            return EXIT_OK
        if action == "backup-open":
            if not (args.backup_input and args.recovery_phrase_file and args.backup_output):
                raise BackupError(EXIT_FAILED, "backup-open needs --backup-input, --recovery-phrase-file and "
                                               "--backup-output")
            phrase = Path(args.recovery_phrase_file).read_text(encoding="utf-8").strip()
            opened = open_sealed(Path(os.path.abspath(args.backup_input)), phrase,
                                 safe_root(args.backup_output, state))
            print(f"Backup opened and verified: {opened}")
            return EXIT_OK
    except BackupError as error:
        print(f"MK8DX automatic backup: {error}", file=sys.stderr)
        return error.code
    raise ValueError("Unknown backup action")
