// A short leaderboard address (ADR-0199, owner 2026-09-29): a YouTube description shows a link as its
// full text and cuts a long one off, so a LiveTrial upload links `?lb=8&mode=150` instead of
// `?leaderboard=track.sunshine_airport&mode=150`. It is an alias only: the router turns it into the
// canonical address before anything else reads it, and Android parses it the same way
// (AndroidDeepLink.kt). The number is the schema-9 catalog index, which the Web, Android and
// LiveTrial catalogs share. (A profile is already short: `?player=<username>`.)
// A shared run (`&run=`) is a short code: the first 8 letters/digits of the result id after its fixed
// parts (`user_submission.time.`, and `firebase_` / `LIVETRIAL`), found among the results of the
// leaderboard the link opens. A full id, or one without the prefix, is still read.

import { schema9WebTrackCatalog } from "./schema9-track-catalog.js";

export const RESULT_ID_PREFIX = "user_submission.time.";

/** A result id without the prefix every result id has. */
export function shortRunId(resultId: string): string {
  return resultId.startsWith(RESULT_ID_PREFIX) ? resultId.slice(RESULT_ID_PREFIX.length) : resultId;
}

/** The 8-character code a Share run link carries (`firebase_41c260da...` -> `41c260da`). */
export function runCode(resultId: string): string {
  return shortRunId(resultId).replace(/^(?:firebase_|livetrial)/i, "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
}

/** The one result a link's `run` names among `resultIds`, or `undefined` (none, or more than one). */
export function findRun(resultIds: readonly string[], run: string): string | undefined {
  const exact = resultIds.find((id) => id === run || shortRunId(id) === run);
  if (exact !== undefined) { return exact; }
  const code = run.toLowerCase();
  if (!/^[a-z0-9]{6,32}$/.test(code)) { return undefined; }
  const matches = resultIds.filter((id) => runCode(id) === code.slice(0, 8) && runCode(id).length === code.slice(0, 8).length);
  return matches.length === 1 ? matches[0] : undefined;
}

/** The canonical search for a short address, or `null` when `search` is not one. */
export function expandShortLink(search: string): string | null {
  const query = new URLSearchParams(search);
  const leaderboard = query.get("lb");
  if (leaderboard !== null) {
    const track = /^\d{1,3}$/.test(leaderboard)
      ? schema9WebTrackCatalog.find((entry) => entry.index === Number(leaderboard))
      : undefined;
    if (track === undefined) { return "?cups=1"; }
    const expanded = new URLSearchParams({ leaderboard: track.id });
    const mode = query.get("mode");
    if (mode === "150" || mode === "200") { expanded.set("mode", mode); }
    const run = query.get("run");
    if (run !== null && run !== "") { expanded.set("run", run); }
    return `?${expanded.toString()}`;
  }
  return null;
}
