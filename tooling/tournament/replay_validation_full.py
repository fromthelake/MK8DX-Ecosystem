"""Durable, sequential full TN13 source replay; never runs six feeds together.

Run/report/stop/resume use only this controller's private manifest and owned
child. A completed phase is retained. An interrupted phase requires explicit
--retry-incomplete and starts a NEW attempt from frame zero (not mid-tournament).
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

import psutil

from replay_validation import ROOT, sha256

STAGES = {"qualification": ["TN13_kwalificatie_groep-1.mkv", "TN13_kwalificatie_groep-2.mkv", "TN13_kwalificatie_groep-3.mkv"],
          "final": ["TN13_finale_kampioen.mkv", "TN13_finale_talent.mkv", "TN13_finale_wild.mkv"]}


def write(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, default=str) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def process_identity(pid):
    process = psutil.Process(pid)
    return {"pid": pid, "createdAt": process.create_time()}


def alive(identity):
    try:
        process = psutil.Process(identity["pid"])
        return process.is_running() and abs(process.create_time() - identity["createdAt"]) < 0.01
    except (psutil.NoSuchProcess, KeyError):
        return False


def validate_root(output, protected):
    output = Path(output).resolve()
    for item in protected:
        item = Path(item).resolve()
        if output == item or output.is_relative_to(item) or item.is_relative_to(output):
            raise ValueError("Controller root overlaps repository, original input or runtime assets")
    return output


def resource_check(output):
    free_memory = psutil.virtual_memory().available
    free_disk = psutil.disk_usage(str(output)).free
    result = {"at": time.time(), "freeMemoryBytes": free_memory, "freeDiskBytes": free_disk,
              "minimumMemoryBytes": 16 * 1024**3, "minimumDiskBytes": 20 * 1024**3}
    result["ready"] = free_memory >= result["minimumMemoryBytes"] and free_disk >= result["minimumDiskBytes"]
    return result


def child_command(plan, stage, output):
    command = [plan["python"], "-B", str(ROOT / "tooling/tournament/replay_validation.py"),
        "--output", str(output), "--baseline-root", plan["baselineRoot"], "--assets-root", plan["assetsRoot"],
        "--reference-root", plan["referenceRoot"], "stream", "--stage", stage,
        "--start-seconds", "0", "--duration-seconds", "14400", "--speed", "1",
        "--max-wall-seconds", "16000", "--hash-sources"]
    for video in plan["stages"][stage]:
        command += ["--video", video]
    return command


def lock_controller(output):
    path = output / "controller.lock"
    if path.exists():
        owner = read(path)
        if alive(owner):
            return False
        path.replace(output / ("controller.previous-" + uuid.uuid4().hex + ".json"))
    with path.open("x", encoding="utf-8") as handle:
        json.dump(process_identity(os.getpid()), handle)
    return True


def request_stop(output):
    # Idempotent durable stop request. It does not kill or change arbitrary PIDs.
    if not (output / "plan.json").is_file():
        raise ValueError("Not a full replay controller root")
    request = output / "stop.json"
    if not request.exists():
        with request.open("x", encoding="utf-8") as handle:
            json.dump({"requestedAt": time.time(), "action": "cooperative_stop"}, handle)
    return read(request)


def run_controller(output, *, retry_incomplete=False):
    monitor_started = time.monotonic()
    plan = read(output / "plan.json")
    state_path = output / "controller.json"
    state = read(state_path) if state_path.exists() else {"schema": "mk8dx.full-source-replay.v1", "runId": output.name, "phases": {}}
    if state.get("status") == "completed_unreviewed":
        return state
    if not lock_controller(output):
        return {"status": "already_running", "controller": read(output / "controller.lock")}
    state.update(controller=process_identity(os.getpid()), executingControllerSha256=sha256(__file__), status="running", scoreCorrectness="unreviewed", physicalCapture="not_executed", apiDelivery="not_executed")
    if retry_incomplete and (output / "stop.json").exists():
        (output / "stop.json").replace(output / ("stop.previous-" + uuid.uuid4().hex + ".json"))
    for stage in STAGES:
        phase = state["phases"].setdefault(stage, {"attempts": []})
        if phase.get("status") == "completed_unreviewed":
            continue
        if (output / "stop.json").exists():
            state["status"] = "stopped_incomplete"
            break
        attempt = phase["attempts"][-1] if phase["attempts"] else None
        process = None
        if attempt and alive(attempt.get("process", {})):
            # Resume monitoring exactly the previously owned process, never a
            # PID guessed from a process name or a new worker alongside it.
            expected = child_command(plan, stage, Path(attempt["output"]))
            if psutil.Process(attempt["process"]["pid"]).cmdline() != expected:
                raise RuntimeError("Live child command no longer matches the saved run plan")
        elif attempt and (Path(attempt["output"]) / "stream-replay.json").is_file():
            result = read(Path(attempt["output"]) / "stream-replay.json")
            if result["status"] == "completed_unreviewed" and result["sourceInterval"] == "full_available_recordings":
                phase.update(status="completed_unreviewed", result=result)
                write(state_path, state)
                continue
            if not retry_incomplete:
                state["status"] = "incomplete_requires_explicit_retry"
                break
            attempt = None
        elif attempt:
            if not retry_incomplete:
                state["status"] = "interrupted_requires_explicit_retry"
                break
            attempt = None
        if attempt is None:
            resources = resource_check(output)
            if not resources["ready"]:
                state.update(status="waiting_for_resources", resourceCheck=resources)
                break
            child_output = output / f"{stage}-attempt-{len(phase['attempts'])+1:03d}"
            command = child_command(plan, stage, child_output)
            log_path = output / f"{child_output.name}.log"
            with log_path.open("xb") as log:
                process = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            attempt = {"output": str(child_output), "log": str(log_path), "process": process_identity(process.pid),
                       "startedAt": time.time(), "command": command, "resourceCheck": resources}
            phase["attempts"].append(attempt)
            print(json.dumps({"stage": stage, "status": "started", "process": attempt["process"], "output": str(child_output)}), flush=True)
        phase["status"] = "running"
        write(state_path, state)
        while alive(attempt["process"]):
            if process is not None and process.poll() is not None:
                break
            state["heartbeatAt"] = time.time()
            state["monitorUptimeSeconds"] = round(time.monotonic() - monitor_started, 3)
            heartbeat_path = Path(attempt["output"]) / "heartbeat.json"
            try:
                phase["sourceHeartbeat"] = read(heartbeat_path) if heartbeat_path.is_file() else None
            except (OSError, json.JSONDecodeError):
                # A prior harness may not have written atomically. Retain the last
                # trustworthy checkpoint; never kill/restart a healthy owned run.
                phase["heartbeatReadDeferredAt"] = time.time()
            if (output / "stop.json").exists() and Path(attempt["output"]).is_dir():
                child_stop = Path(attempt["output"]) / "stop.json"
                if not child_stop.exists():
                    write(child_stop, read(output / "stop.json"))
                phase["status"] = "stopping_and_draining"
            write(state_path, state)
            time.sleep(5)
        result_path = Path(attempt["output"]) / "stream-replay.json"
        result = read(result_path) if result_path.is_file() else {"status": "no_terminal_report"}
        attempt.update(finishedAt=time.time(), result=result)
        if result.get("status") != "completed_unreviewed" or result.get("sourceInterval") != "full_available_recordings":
            state["status"] = "incomplete_requires_explicit_retry"
            phase["status"] = "incomplete"
            break
        phase.update(status="completed_unreviewed", result=result)
        write(state_path, state)
    else:
        state["status"] = "completed_unreviewed"
        state["finishedAt"] = time.time()
    write(state_path, state)
    return state


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["run", "report", "stop", "resume"])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--python", type=Path)
    parser.add_argument("--baseline-root", type=Path)
    parser.add_argument("--assets-root", type=Path)
    parser.add_argument("--reference-root", type=Path)
    parser.add_argument("--video-root", type=Path)
    parser.add_argument("--retry-incomplete", action="store_true")
    args = parser.parse_args()
    output = args.output.resolve()
    if args.command == "run":
        required = [args.python, args.baseline_root, args.assets_root, args.reference_root, args.video_root]
        if any(value is None or not value.exists() for value in required):
            parser.error("run requires existing --python, --baseline-root, --assets-root, --reference-root, --video-root")
        output = validate_root(output, [ROOT, args.baseline_root, args.assets_root, args.reference_root, args.video_root])
        stages = {stage: [str((args.video_root / name).resolve()) for name in names] for stage, names in STAGES.items()}
        if not all(Path(video).is_file() for videos in stages.values() for video in videos):
            raise ValueError("All six explicit TN13 source videos are required")
        output.mkdir(parents=True, exist_ok=False)
        write(output / "plan.json", {"schema": "mk8dx.full-source-replay-plan.v1", "runId": output.name,
            "python": str(args.python.resolve()), "baselineRoot": str(args.baseline_root.resolve()),
            "assetsRoot": str(args.assets_root.resolve()), "referenceRoot": str(args.reference_root.resolve()),
            "stages": stages, "createdAt": time.time(), "estimatedSeconds": 10200,
            "controllerSha256": sha256(__file__), "harnessSha256": sha256(ROOT / "tooling/tournament/replay_validation.py")})
    if args.command == "report":
        result = read(output / "controller.json")
    elif args.command == "stop":
        result = request_stop(output)
    else:
        result = run_controller(output, retry_incomplete=args.retry_incomplete)
    print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
