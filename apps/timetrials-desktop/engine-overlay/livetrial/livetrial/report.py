"""Report writing: report.json (machine) + report.txt (human)."""

from __future__ import annotations

import json
from pathlib import Path

from .engine import fmt_t


def _public(value):
    """Copy report data while dropping private runtime scratch fields."""
    if isinstance(value, dict):
        return {k: _public(v) for k, v in value.items() if not str(k).startswith("_")}
    if isinstance(value, list):
        return [_public(v) for v in value]
    return value


def _ghost_line(g: dict | None) -> str:
    if not g:
        return "(ghost not read)"
    laps = " ".join(g.get("lapTimes") or [])
    parts = " / ".join(str((g.get(k) or {}).get("id", "?")).split(".")[-1]
                       for k in ("body", "tire", "glider") if g.get(k))
    who = " ".join(str(x) for x in (
        g.get("name"), (g.get("character") or {}).get("id"), (g.get("flag") or {}).get("id")) if x)
    return (f"{who}  {g.get('total')}  [{g.get('state')}]"
            + (f"  laps [{laps}]" if laps else "") + (f"  {parts}" if parts else ""))


def write_ghosts(out: Path, document: dict) -> None:
    """ghosts.json: every ghost this session saw, one record each (ADR-0210).
    Beside report.json, whose envelope the desktop product validates key-for-key."""
    out.mkdir(parents=True, exist_ok=True)
    tmp = out / "ghosts.json.part"
    tmp.write_text(json.dumps(_public(document), indent=1, ensure_ascii=False), encoding="utf-8")
    tmp.replace(out / "ghosts.json")


def write_ghost_replays(out: Path, replays: list) -> None:
    """ghost_replays.json: each ghost's first replay loop watched to the line,
    whole, for the run history's ghost entries (ADR-0210 rule 11). Never a run:
    report.json and submissions.json do not carry them."""
    out.mkdir(parents=True, exist_ok=True)
    tmp = out / "ghost_replays.json.part"
    tmp.write_text(json.dumps({"format": "mk8dx.livetrial-ghost-replays.v1", "replays": _public(replays)},
                              indent=1, ensure_ascii=False), encoding="utf-8")
    tmp.replace(out / "ghost_replays.json")


def write_reports(out: Path, source: str, fps: float, frames_analyzed: int, runs: list,
                  ghost_log: list | None = None, ghosts: dict | None = None,
                  ghost_replays: list | None = None) -> None:
    out.mkdir(parents=True, exist_ok=True)
    public_runs = _public(runs)
    report = {"video": source, "fps": fps, "framesAnalyzed": frames_analyzed, "runs": public_runs}
    (out / "report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    # The ghost-menu timeline gets its own file: report.json's envelope is a
    # contract the desktop product validates key-for-key (livetrial_report.py).
    if ghost_log is not None:
        (out / "ghost_menu.json").write_text(
            json.dumps({"video": source, "events": _public(ghost_log)}, indent=1, ensure_ascii=False),
            encoding="utf-8")
    if ghosts is not None:
        write_ghosts(out, ghosts)
    if ghost_replays:
        write_ghost_replays(out, ghost_replays)

    from .export import run_to_submission
    # a ghost replay is the ghost's run, never the player's
    subs = [s for s in (run_to_submission(r, source=source) for r in public_runs
                        if r.get("kind") != "replay") if s]
    (out / "submissions.json").write_text(json.dumps(subs, indent=1), encoding="utf-8")

    lines = [f"Time-trial analysis: {source}", ""]
    for r in public_runs:
        ctx = r["context"]
        track = ctx.get("trackName", {}).get("trackId") if isinstance(ctx.get("trackName"), dict) else "(zie ocr crops)"
        when = f" [{r['closedAtStr']}]" if r.get("closedAtStr") else ""
        what = "RUN"
        if r.get("kind") == "replay":
            what = f"REPLAY (loop {r.get('replayLoop', 1)}" + \
                   (", complete)" if r.get("replayCompleted") else ")")
        lines.append(f"{what} {r['run']}:{when} cc={ctx.get('cc')} mode={ctx.get('mode')} "
                     f"laps={r['lapCount']} track={track}")
        if r.get("kind") == "replay":
            lines.append(f"  ghost: {_ghost_line(r.get('replayOf'))}")
        elif r.get("ghostPanel"):
            lines.append(f"  against ghost: {_ghost_line(r.get('ghostPanel'))}")
        lines.append(f"  armed {fmt_t(r['armedAtMs'])}  GO {fmt_t(r['goAtMs']) if r['goAtMs'] else '-'}"
                     f"  end {fmt_t(r['endMs'])}  {'ABORTED: ' + r.get('abortReason', '') if r['aborted'] else 'FINISHED'}")
        res = r.get("results")
        if res:
            for owner in ("player", "ghost"):
                o = res.get(owner)
                if not o:
                    continue
                laps = " ".join(fmt_t(v) if v is not None else "?" for v in o["lapTimesMs"])
                total = fmt_t(o["totalMs"]) if o["totalMs"] is not None else "?"
                mark = "lap-som OK" if o["lapSumOk"] else "lap-som NIET sluitend"
                lines.append(f"  {owner}: total {total}  laps [{laps}]  ({mark})")
        for owner, ident in (r.get("identity") or {}).items():
            parts = "  ".join(f"{k}={ident[k]['id']}({ident[k]['score']:.2f})"
                              for k in ("character", "kart", "wheel", "glider", "flag") if ident.get(k))
            nm = f" \"{ident['name']}\"" if ident.get("name") else ""
            lines.append(f"  {owner} loadout{nm}: {parts}")
        for e in r["events"]:
            extra = {k: v for k, v in e.items() if k not in ("t", "type")}
            lines.append(f"    +{fmt_t(e['t'])}  {e['type']}  {extra if extra else ''}")
        lines.append("")
    for g in (ghosts or {}).get("ghosts", []):
        marks = " ".join(m for m, on in (("STAFF", g.get("staffGhost")), ("WR", g.get("worldRecord"))) if on)
        rp = g.get("replay") or {}
        lines.append(f"GHOST {g.get('key')}: {g.get('name')} {g.get('total')} {g.get('cc')}cc "
                     f"{g.get('trackId')} [{g.get('state')}] {marks}".rstrip())
        if g.get("lapTimes"):
            lines.append(f"  laps {' '.join(g['lapTimes'])}  "
                         f"{g.get('bodyId')} / {g.get('tireId')} / {g.get('gliderId')}")
        if rp:
            lines.append(f"  replay: coins/lap {rp['coinCountsPerLap']}  mushrooms/lap {rp['mushroomsPerLap']}")
        lines.append(f"  seen {g.get('sightings')}x, replay loops {[r['loop'] for r in g.get('replays', [])]}")
    if ghosts and ghosts.get("ghosts"):
        lines.append("")
    if ghost_log:
        lines.append("GHOST MENU")
        for e in _public(ghost_log):
            extra = {k: v for k, v in e.items() if k not in ("ms", "type") and v is not None}
            lines.append(f"  {fmt_t(e['ms'])}  {e['type']}  {extra if extra else ''}")
        lines.append("")
    (out / "report.txt").write_text("\n".join(lines), encoding="utf-8")
