"""Quiet Windows logon and maintenance tasks for Docker-backed MK8DX installs.

The scheduled action is pythonw.exe, so a cold login cannot leave an unnamed
console on the desktop. Only a failed server start opens the branded explanation.
No Docker output or installation secrets are written to the status files.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
CREATE_NEW_CONSOLE = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
POLL_SECONDS = 10
START_TIMEOUT_SECONDS = 600
MAINTENANCE_TIMEOUT_SECONDS = 900
EXPECTED = {"A1": {"mysql", "mailpit", "api", "web"},
            "A2_OFFLINE": {"mysql", "api", "web", "host-admin"}}


def _command(argv: list[str], *, timeout: int = 20):
    try:
        return subprocess.run(argv, capture_output=True, text=True, check=False, timeout=timeout,
                              creationflags=CREATE_NO_WINDOW)
    except (OSError, subprocess.TimeoutExpired):
        return subprocess.CompletedProcess(argv, 1, "", "")


def _docker_exe() -> str | None:
    """Scheduled tasks can have an older PATH than the signed-in desktop."""
    found = shutil.which("docker")
    if found:
        return found
    for base, relative in (("LOCALAPPDATA", "Programs/DockerDesktop/resources/bin/docker.exe"),
                           ("ProgramFiles", "Docker/Docker/resources/bin/docker.exe")):
        if os.environ.get(base):
            candidate = Path(os.environ[base]) / relative
            if candidate.is_file():
                return str(candidate)
    return None


def _engine() -> str:
    result = _command([_docker_exe() or "docker", "info", "--format", "{{.OSType}}"])
    return result.stdout.strip().lower() if result.returncode == 0 else ""


def ensure_docker(*, launch: bool, timeout_s: int) -> tuple[bool, str]:
    """A running Desktop process is not enough: only a Linux Docker engine is ready."""
    docker = _docker_exe()
    if docker is None:
        return False, "docker-cli-missing"
    kind = _engine()
    if kind == "linux":
        return True, "already-running"
    if kind == "windows":
        return False, "linux-containers-required"
    deadline = time.monotonic() + timeout_s
    if launch:
        # This CLI is supported by Docker Desktop; an already-starting Desktop
        # can return a nonzero code, so the engine probe below remains decisive.
        _command([docker, "desktop", "start", "--detach"], timeout=30)
    while time.monotonic() < deadline:
        time.sleep(min(POLL_SECONDS, max(0, deadline - time.monotonic())))
        kind = _engine()
        if kind == "linux":
            return True, "started" if launch else "ready"
        if kind == "windows":
            return False, "linux-containers-required"
    return False, "docker-timeout"


def _profile(state: Path) -> tuple[str, str]:
    profile = json.loads((state / "operator-profile.json").read_text(encoding="utf-8"))
    route, project = profile.get("route"), profile.get("project")
    if route not in (*EXPECTED, "A3") or not isinstance(project, str) or not project:
        raise ValueError("unsupported or incomplete Docker installation")
    return route, project


def _services(project: str) -> dict[str, tuple[str, str]]:
    result = _command([_docker_exe() or "docker", "ps", "-a", "--filter", f"label=com.docker.compose.project={project}",
                       "--format", '{{.Label "com.docker.compose.service"}}|{{.State}}|{{.Status}}'])
    if result.returncode != 0:
        return {}
    found: dict[str, tuple[str, str]] = {}
    for line in result.stdout.splitlines():
        parts = line.split("|", 2)
        if len(parts) == 3:
            found[parts[0]] = (parts[1].lower(), parts[2].lower())
    return found


def wait_for_services(route: str, project: str, *, timeout_s: int) -> str:
    expected = EXPECTED[route]
    deadline = time.monotonic() + timeout_s
    while True:
        found = _services(project)
        if expected <= found.keys():
            states = [found[name][0] for name in expected]
            if all(state == "exited" for state in states):
                # Compose stop is an intentional offline choice. The installer
                # must not turn it back on merely because Windows logged in.
                return "stopped"
            if all(found[name][0] == "running" and "(unhealthy)" not in found[name][1]
                   and ("(healthy)" in found[name][1] or "(health:" not in found[name][1])
                   for name in expected):
                return "ready"
        if time.monotonic() >= deadline:
            return "services-timeout"
        time.sleep(min(POLL_SECONDS, max(0, deadline - time.monotonic())))


def _status(state: Path, action: str, result: str, reason: str) -> None:
    path = state / ("startup-status.json" if action == "start" else f"scheduled-{action}-status.json")
    data = {"schemaVersion": "mk8dx.windows-task-status.v1", "action": action,
            "result": result, "reason": reason, "at": datetime.now(timezone.utc).isoformat()}
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def _alert(reason: str, route: str) -> None:
    subprocess.Popen(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                      str(ROOT / "tooling" / "windows-startup-alert.ps1"), "-Reason", reason,
                      "-Route", route], cwd=ROOT, creationflags=CREATE_NEW_CONSOLE,
                     close_fds=True)


@contextmanager
def _maintenance_lock(state: Path):
    if sys.platform != "win32":
        yield
        return
    import msvcrt
    with (state / "scheduled-maintenance.lock").open("a+b") as stream:
        if stream.tell() == 0:
            stream.write(b"0")
            stream.flush()
        deadline = time.monotonic() + MAINTENANCE_TIMEOUT_SECONDS
        while True:
            try:
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise TimeoutError("another maintenance task is still running")
                time.sleep(POLL_SECONDS)
        try:
            yield
        finally:
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)


def run(action: str, state: Path | None, python: str | None = None) -> int:
    if action == "ensure-docker":
        ready, reason = ensure_docker(launch=True, timeout_s=START_TIMEOUT_SECONDS)
        print(reason)
        return 0 if ready else 1
    assert state is not None
    route = "A2_OFFLINE"
    try:
        state = state.resolve(strict=True)
        route, project = _profile(state)
        if action == "start":
            if route not in EXPECTED:
                raise ValueError("automatic Docker start is only supported for A1/A2")
            deadline = time.monotonic() + START_TIMEOUT_SECONDS
            ready, reason = ensure_docker(launch=True, timeout_s=START_TIMEOUT_SECONDS)
            if not ready:
                _status(state, action, "failed", reason)
                _alert(reason, route)
                return 1
            services = wait_for_services(route, project, timeout_s=max(0, int(deadline - time.monotonic())))
            result = "ready" if services == "ready" else "failed"
            _status(state, action, result, services)
            if result == "failed":
                _alert(services, route)
            return 0 if result != "failed" else 1
        if python is None:
            raise ValueError("scheduled maintenance needs its original Python interpreter")
        if route in EXPECTED:
            ready, reason = ensure_docker(launch=False, timeout_s=MAINTENANCE_TIMEOUT_SECONDS)
            if not ready:
                _status(state, action, "failed", reason)
                return 1
        with _maintenance_lock(state):
            if action == "backup":
                command = [python, str(ROOT / "tooling" / "auto_backup.py"), "run", "--state-dir", str(state)]
            elif action == "ca":
                command = [python, str(ROOT / "tooling" / "install.py"), "maintain-ca", "--state-dir", str(state)]
            elif action == "other-backup":
                command = [python, str(ROOT / "tooling" / "install.py"), "backup-run", "--state-dir", str(state), "--quiet"]
            else:
                raise ValueError("unknown maintenance action")
            completed = _command(command, timeout=3600)
        _status(state, action, "ok" if completed.returncode == 0 else "failed",
                "complete" if completed.returncode == 0 else "maintenance-failed")
        return 0 if completed.returncode == 0 else 1
    except Exception:
        # The task writes only a category, never an exception that could include
        # private settings, a URL or a command's stderr.
        try:
            _status(state, action, "failed", "internal-error")
        except OSError:
            pass
        if action == "start":
            try:
                _alert("internal-error", route)
            except OSError:
                pass
        return 1


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("ensure-docker", "start", "backup", "ca", "other-backup"))
    parser.add_argument("--state-dir", type=Path)
    parser.add_argument("--python")
    args = parser.parse_args(argv)
    if args.action != "ensure-docker" and args.state_dir is None:
        parser.error("--state-dir is required")
    return run(args.action, args.state_dir, args.python)


if __name__ == "__main__":
    raise SystemExit(main())
