// Two ways to avoid asking the server something it already told us.
//
// One request answers the ten the Home page used to make.
//
// `/v1/home/bootstrap` returns exactly the documents the individual
// endpoints return, each under its own key and with its own schemaVersion.
// Rather than rewrite ten parsers to read from a new shape, the sections
// are handed to the existing clients as the responses they already expect:
// the first request for a covered path is answered from the bootstrap, and
// every request after that goes to the network as usual.
//
// This is deliberately a prefetch cache and not a general one. Each entry
// is served exactly once, nothing is retained across navigations, and a
// path with no section falls straight through.

import { applyWorldRecordMasteryBaseline } from "./mastery-thresholds.js";

type Sections = Readonly<Record<string, unknown>>;

const PATHS: ReadonlyArray<readonly [string, string]> = [
  ["/v1/notifications", "notifications"],
  ["/v1/me/player-claims", "claims"],
  ["/v1/home/comeback", "comeback"],
  ["/v1/home/focus", "focus"],
  ["/v1/account/follows", "follows"],
  ["/v1/account/rivals", "rivals"],
  ["/v1/public/activity-stories", "stories"],
  ["/v1/public/track-bests", "trackBests"],
  ["/v1/public/time-trial-reactions", "reactions"],
];

const pending = new Map<string, unknown>();
// The Player set the queued track-bests section answers; any other set goes to the network (R2).
let trackBestsPlayers: string | null = null;
let installed = false;

function pathOf(input: unknown): string {
  const raw = typeof input === "string"
    ? input
    : (input as Readonly<{ url?: string }>)?.url ?? "";
  const withoutOrigin = raw.replace(/^https?:\/\/[^/]+/, "");
  return withoutOrigin.split("?")[0] ?? "";
}

function answersDifferentPlayers(path: string, input: unknown): boolean {
  if (path !== "/v1/public/track-bests") { return false; }
  const raw = typeof input === "string" ? input : (input as Readonly<{ url?: string }>)?.url ?? "";
  const query = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : "";
  const requested = (new URLSearchParams(query).get("players") ?? "").split(",").filter((id) => id !== "").sort().join(",");
  return requested !== trackBestsPlayers;
}

export function installResponseCache(): void {
  install();
}

function install(): void {
  if (installed) { return; }
  installed = true;
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: unknown, init?: unknown) => {
    const path = pathOf(input);
    if (pending.has(path) && !answersDifferentPlayers(path, input)) {
      const document = pending.get(path);
      pending.delete(path);
      const body = JSON.stringify(document);
      const key = typeof input === "string"
        ? input
        : (input as Readonly<{ url?: string }>)?.url ?? path;
      if (cacheable(path)) {
        remembered.set(key, {
          body, type: "application/json", atMs: nowMs(),
        });
      }
      return Promise.resolve(new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    }
    const method = ((init as Readonly<{ method?: string }>)?.method ??
      (input as Readonly<{ method?: string }>)?.method ?? "GET")
      .toUpperCase();
    if (method !== "GET") {
      forgetRemembered();
      return original(input as RequestInfo, init as RequestInit | undefined);
    }
    const key = typeof input === "string"
      ? input
      : (input as Readonly<{ url?: string }>)?.url ?? path;
    const held = remembered.get(key);
    if (held !== undefined &&
        nowMs() - held.atMs < REMEMBER_MS) {
      return Promise.resolve(new Response(held.body, {
        status: 200,
        headers: { "content-type": held.type },
      }));
    }
    const result = original(
      input as RequestInfo,
      init as RequestInit | undefined,
    );
    if (!cacheable(path)) { return result; }
    return result.then(async (response) => {
      if (response.status !== 200) { return response; }
      const copy = response.clone();
      try {
        remembered.set(key, {
          body: await copy.text(),
          type: response.headers.get("content-type") ?? "application/json",
          atMs: nowMs(),
        });
      } catch {
        // A body that cannot be read is simply not remembered.
      }
      return response;
    });
  }) as typeof fetch;
}

// The player document has no wrapper of its own, so it is returned rather
// than queued: its consumer asks for a specific player by id.
export type BootstrapExtras = Readonly<{
  authenticated: boolean;
  player?: unknown;
}>;

// Sections the server filters by the account's Time Trial preference (ADR-0172: passive Home relevance).
// Only the Home surface may consume them; every other route asks for exact data (R2).
const HOME_ONLY_SECTIONS = new Set(["trackBests", "stories"]);

export type BootstrapSurface = "home" | "chrome";

export async function primeFromBootstrap(
  viewedPlayerId?: string,
  signal?: AbortSignal,
  surface: BootstrapSurface = "chrome",
): Promise<BootstrapExtras | null> {
  let response: Response;
  try {
    response = await fetch(viewedPlayerId === undefined
      ? "/v1/bootstrap"
      : `/v1/bootstrap?player=${encodeURIComponent(viewedPlayerId)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      referrerPolicy: "same-origin",
      cache: "no-store",
      ...(signal === undefined ? {} : { signal }),
    });
  } catch {
    return null;
  }
  if (response.status !== 200) { return null; }
  let body: Sections;
  try {
    body = await response.json() as Sections;
  } catch {
    return null;
  }
  if (body["schemaVersion"] !== "mk8dx.home-bootstrap.v1") { return null; }

  install();
  pending.clear();
  trackBestsPlayers = null;
  // The Mastery baseline travels with every page (owner 2026-09-26): labels on this page and every
  // later one follow the current World Records, without a request of their own.
  const baseline = body["worldRecordTimes"] as Readonly<{ schemaVersion?: unknown; records?: unknown }> | undefined;
  if (baseline?.schemaVersion === "mk8dx.world-record-times.v1" && Array.isArray(baseline.records)) {
    applyWorldRecordMasteryBaseline(baseline.records);
  }
  for (const [path, key] of PATHS) {
    const section = body[key];
    if (section === undefined || section === null) { continue; }
    if (HOME_ONLY_SECTIONS.has(key) && surface !== "home") { continue; }
    pending.set(path, section);
    if (key === "trackBests") {
      const players = (section as Readonly<{ players?: ReadonlyArray<Readonly<{ playerId?: unknown }>> }>).players ?? [];
      trackBestsPlayers = players.map((player) => String(player.playerId)).sort().join(",");
    }
  }
  // Documents fetched by id are queued under the path their own id
  // produces rather than under a fixed one.
  const player = body["player"] as Readonly<{ playerId?: string }> | undefined;
  if (player?.playerId !== undefined) {
    pending.set(`/v1/players/${player.playerId}`, player);
  }
  const profile = body["profile"] as
    Readonly<{ playerId?: string }> | undefined;
  if (profile?.playerId !== undefined) {
    pending.set(`/v1/players/${profile.playerId}`, profile);
  }
  if (viewedPlayerId !== undefined) {
    for (const [suffix, key] of [
      ["rating-history", "ratingHistory"],
      ["tournament-opponents", "opponents"],
      ["career", "career"],
    ] as const) {
      const value = body[key];
      if (value !== undefined && value !== null) {
        pending.set(`/v1/public/players/${viewedPlayerId}/${suffix}`, value);
      }
    }
    const aliases = body["aliases"];
    if (aliases !== undefined && aliases !== null) {
      pending.set(`/v1/players/${viewedPlayerId}/aliases`, aliases);
    }
  }
  for (const [key, path] of [
    ["ratingLeaderboard", "/v1/public/rating-leaderboard"],
    ["tournamentStandings", "/v1/public/tournament-standings"],
  ] as const) {
    const value = body[key];
    if (value !== undefined && value !== null) { pending.set(path, value); }
  }
  return {
    authenticated: body["authenticated"] === true,
    ...(player === undefined ? {} : { player }),
  };
}

// Anything left unclaimed is dropped, so a later navigation can never be
// answered with a document prepared for an earlier one.
export function discardPreloaded(): void {
  pending.clear();
}

// ---------------------------------------------------------------------
// A short memory for answers that do not change while someone browses.
//
// Moving between pages re-mounted the same shared parts - the notification
// badge, the signed-in Player, the rating ladder - and each re-asked the
// server. These answers change when something is published or read, not
// while a visitor clicks around, so they are remembered briefly and any
// write at all forgets everything.

const CACHEABLE: readonly string[] = [
  "/v1/notifications",
  "/v1/me/player-claims",
  "/v1/players/",
  "/v1/public/players/",
  "/v1/public/rating-leaderboard",
  "/v1/public/record-book",
  "/v1/public/tournament-standings",
  "/v1/public/community",
];

const REMEMBER_MS = 60_000;
const nowMs = (): number => new Date().getTime();

type Remembered = Readonly<{ body: string; type: string; atMs: number }>;
const remembered = new Map<string, Remembered>();

function cacheable(path: string): boolean {
  return CACHEABLE.some((prefix) => path === prefix || path.startsWith(prefix));
}

// A write can change anything, so it invalidates everything rather than
// guessing which answers it touched.
export function forgetRemembered(): void {
  remembered.clear();
}
