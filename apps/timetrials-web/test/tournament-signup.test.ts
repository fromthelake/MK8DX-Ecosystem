// ADR-0222 on the website: the client's key-for-key parsing, the status line in each state (English
// and Dutch), the night page's sign-up block, the Director's Step 2 panel and the inbox entries.

import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeDocument, descendants, texts } from "./dom-double.js";
import { notificationLink, notificationMessage } from "../src/notification-section.js";
import {
  createTournamentSignupClient,
  type SignupBoard,
  type TournamentSignup,
  type TournamentSignupClient,
} from "../src/tournament-signup-client.js";
import { mountTournamentSignup, signupStatusLine } from "../src/tournament-signup-section.js";
import { mountTournamentSignupBoard, signupConsoleWarning } from "../src/tournament-signup-board-section.js";

const TOURNAMENT = "tournament.signup-friday";
// Friday 6 November 2026, 20:00 in Amsterdam.
const CLOSES = Date.UTC(2026, 10, 6, 19, 0);
const NOW = Date.UTC(2026, 10, 3, 12, 0);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const viewer = (overrides: Partial<TournamentSignup["viewer"]> = {}): TournamentSignup["viewer"] => ({
  state: "not_signed_up", playerId: "player.ada", hasSwitch1: false, hasSwitch2: false, waitingPosition: null,
  canSignUp: true, canWithdraw: false, canChangeConsoles: false, ...overrides,
});
const signup = (overrides: Partial<TournamentSignup> = {}): TournamentSignup => ({
  tournamentId: TOURNAMENT, mode: "open", selection: "draw", status: "open", closesAtMs: CLOSES,
  timezone: "Europe/Amsterdam", capacity: 36, taken: 24, closedAtMs: null, drawSeed: null, drawAlgorithm: null,
  active: [], waiting: [], viewer: viewer(), ...overrides,
});
const wire = (value: TournamentSignup) => ({ schemaVersion: "mk8dx.tournament-signup.v1", ...value });

function setProductLanguage(language: "en" | "nl"): void {
  vi.stubGlobal("localStorage", { getItem: () => language, setItem: () => undefined });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("the sign-up client", () => {
  it("parses the document key for key and refuses an unknown key", async () => {
    const client = createTournamentSignupClient(async () => json(wire(signup())));
    expect(await client.load(TOURNAMENT)).toEqual(signup());
    const drifted = createTournamentSignupClient(async () => json({ ...wire(signup()), extra: true }));
    await expect(drifted.load(TOURNAMENT)).rejects.toMatchObject({ code: "invalid_response" });
    const viewerDrift = createTournamentSignupClient(async () => json(wire({ ...signup(), viewer: { ...viewer(), extra: 1 } as never })));
    await expect(viewerDrift.load(TOURNAMENT)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("signs up with the consoles and the CSRF proof", async () => {
    const calls: { path: string; init: RequestInit }[] = [];
    const client = createTournamentSignupClient(async (path, init) => {
      calls.push({ path, init });
      if (path === "/v1/session/csrf") {
        return json({ schemaVersion: "mk8dx.web-csrf.v1", headerName: "x-mk8dx-csrf", value: "synthetic-proof" });
      }
      return json(wire(signup({ viewer: viewer({ state: "pending", canSignUp: false, canWithdraw: true, canChangeConsoles: true }) })));
    });
    const result = await client.signUp(TOURNAMENT, { hasSwitch1: true, hasSwitch2: false });
    expect(result.viewer.state).toBe("pending");
    expect(calls[1]!.path).toBe(`/v1/tournaments/${TOURNAMENT}/signup`);
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ hasSwitch1: true, hasSwitch2: false });
    expect((calls[1]!.init.headers as Record<string, string>)["x-mk8dx-csrf"]).toBe("synthetic-proof");
    const refused = createTournamentSignupClient(async (path) => path === "/v1/session/csrf"
      ? json({ schemaVersion: "mk8dx.web-csrf.v1", headerName: "x-mk8dx-csrf", value: "synthetic-proof" })
      : json({ code: "tournament_signup_closed", message: "closed" }, 409));
    await expect(refused.withdraw(TOURNAMENT)).rejects.toMatchObject({ code: "conflict", serverCode: "tournament_signup_closed" });
  });
});

describe("the status line", () => {
  it("says the owner's lines in English and Dutch", () => {
    setProductLanguage("en");
    expect(signupStatusLine(signup(), NOW)?.text).toBe("Sign-up closes Fri 20:00 · 24 of 36 places");
    expect(signupStatusLine(signup({ viewer: viewer({ state: "pending" }) }), NOW)?.text)
      .toBe("You're signed up · the draw is on Fri 20:00");
    expect(signupStatusLine(signup({ viewer: viewer({ state: "selected" }) }), NOW)?.text).toBe("You're in");
    expect(signupStatusLine(signup({ viewer: viewer({ state: "waiting", waitingPosition: 3 }) }), NOW)?.text)
      .toBe("Waiting list · number 3");
    expect(signupStatusLine(signup({ viewer: viewer({ state: "withdrawn" }) }), NOW)?.text).toBe("You withdrew");
    expect(signupStatusLine(signup({ status: "closed", viewer: viewer({ state: "closed" }) }), NOW)?.text).toBe("Sign-up is closed");
    expect(signupStatusLine(signup({ mode: "director", status: "director", viewer: viewer({ state: "director_roster" }) }), NOW)?.text)
      .toBe("The Director puts the list together");
    expect(signupStatusLine(signup({ mode: "director", status: "director", viewer: viewer({ state: "signed_out" }) }), NOW)).toBeNull();
    setProductLanguage("nl");
    expect(signupStatusLine(signup(), NOW)?.text).toBe("Aanmelden sluit vr 20:00 · 24 van 36 plaatsen");
    expect(signupStatusLine(signup({ viewer: viewer({ state: "pending" }) }), NOW)?.text)
      .toBe("Je bent aangemeld · er wordt geloot op vr 20:00");
    expect(signupStatusLine(signup({ viewer: viewer({ state: "selected" }) }), NOW)?.text).toBe("Je doet mee");
    expect(signupStatusLine(signup({ viewer: viewer({ state: "waiting", waitingPosition: 3 }) }), NOW)?.text)
      .toBe("Wachtlijst · nummer 3");
    expect(signupStatusLine(signup({ mode: "director", status: "director", viewer: viewer({ state: "director_roster" }) }), NOW)?.text)
      .toBe("De Directeur stelt de lijst samen");
  });
});

async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) { await new Promise((resolve) => setTimeout(resolve, 0)); }
}

function fakeClient(initial: TournamentSignup, board?: SignupBoard) {
  const calls: string[] = [];
  let current = initial;
  let currentBoard = board;
  const client: TournamentSignupClient = {
    async load() { return current; },
    async signUp(_id, consoles) {
      calls.push(`signUp:${consoles.hasSwitch1}:${consoles.hasSwitch2}`);
      current = { ...current, viewer: viewer({ state: "pending", canSignUp: false, canWithdraw: true, canChangeConsoles: true, ...consoles }) };
      return current;
    },
    async withdraw() {
      calls.push("withdraw");
      current = { ...current, viewer: viewer({ state: "withdrawn" }) };
      return current;
    },
    async board() { return currentBoard!; },
    async configure(_id, settings) { calls.push(`configure:${JSON.stringify(settings)}`); return currentBoard!; },
    async close() { calls.push("close"); return currentBoard!; },
    async move(_id, move) {
      calls.push(`move:${move.playerId}:${move.to}:${move.position ?? ""}`);
      currentBoard = { ...currentBoard!, entries: currentBoard!.entries.map((entry) => entry.playerId === move.playerId ? { ...entry, status: "removed", position: null } : entry) };
      return currentBoard;
    },
  };
  return { client, calls };
}

describe("the night page's sign-up block", () => {
  it("signs up with the chosen consoles, then offers to withdraw", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const { client, calls } = fakeClient(signup({
      active: [{ position: 1, playerId: "player.bo", displayName: "Bo" }, { position: 2, playerId: null, displayName: "Cy" }],
    }));
    const mounted = mountTournamentSignup(root as unknown as HTMLElement, TOURNAMENT, client);
    await mounted.ready;
    expect(root.children[0]!.hidden).toBe(false);
    const all = texts(root).join("\n");
    expect(all).toContain("24 of 36 places");
    expect(all).toContain("On the list (2)");
    const ns1 = descendants(root).find((node) => node.attributes.get("id") === `signup-ns1-${TOURNAMENT}`)! as unknown as { checked: boolean };
    ns1.checked = true;
    descendants(root).find((node) => node.tagName === "button" && node.textContent === "Sign up")!.click();
    await settle();
    expect(calls).toEqual(["signUp:true:false"]);
    expect(texts(root).join("\n")).toContain("You're signed up");
    descendants(root).find((node) => node.tagName === "button" && node.textContent === "Withdraw")!.click();
    await settle();
    expect(calls).toEqual(["signUp:true:false", "withdraw"]);
    expect(texts(root).join("\n")).toContain("You withdrew");
  });

  it("explains how to link a Player and shows the seed after a draw", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const { client } = fakeClient(signup({ viewer: viewer({ state: "no_player", playerId: null, canSignUp: false }) }));
    await mountTournamentSignup(root as unknown as HTMLElement, TOURNAMENT, client).ready;
    expect(descendants(root).some((node) => node.attributes.get("href") === "/?welcome=1")).toBe(true);
    const closedRoot = document.createElement("div");
    const seed = "ab".repeat(32);
    const { client: closed } = fakeClient(signup({
      status: "closed", drawSeed: seed, drawAlgorithm: "mk8dx-signup-draw-sha256-fisher-yates-v1",
      waiting: [{ position: 1, playerId: "player.di", displayName: "Di" }],
      viewer: viewer({ state: "waiting", waitingPosition: 1, canSignUp: false, canWithdraw: true }),
    }));
    await mountTournamentSignup(closedRoot as unknown as HTMLElement, TOURNAMENT, closed).ready;
    const shown = texts(closedRoot).join("\n");
    expect(shown).toContain("Waiting list · number 1");
    expect(shown).toContain(`Drawn with seed ${seed}`);
  });
});

describe("the Director's sign-up panel", () => {
  const board: SignupBoard = {
    tournamentId: TOURNAMENT,
    editable: true,
    settings: {
      mode: "open", selection: "first_come", status: "open", closesAtMs: CLOSES, capacity: 2,
      closedAtMs: null, drawSeed: null, drawAlgorithm: null,
    },
    entries: [
      { playerId: "player.ada", displayName: "Ada", status: "selected", position: null, signedUpAtMs: NOW, attendance: "present", hasSwitch1: false, hasSwitch2: false },
      { playerId: "player.bo", displayName: "Bo", status: "waiting", position: 1, signedUpAtMs: NOW + 1, attendance: "waiting", hasSwitch1: false, hasSwitch2: false },
    ],
    consoles: { players: 1, coming: 0, needed: 1, warning: true },
  };

  it("shows the sign-ups in order with the console warning and moves people by hand", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const { client, calls } = fakeClient(signup(), board);
    let reloads = 0;
    await mountTournamentSignupBoard(root as unknown as HTMLElement, TOURNAMENT, { client, onRosterChanged: () => { reloads += 1; } }).ready;
    const shown = texts(root).join("\n");
    expect(shown).toContain("Too few consoles: 0 coming for 1 players, 1 needed.");
    expect(shown).toContain("Waiting list 1");
    const row = descendants(root).filter((node) => node.attributes.get("data-signup-status") === "selected")[0]!;
    descendants(row).find((node) => node.tagName === "button" && node.textContent === "Take off")!.click();
    await settle();
    expect(calls).toEqual(["move:player.ada:removed:"]);
    expect(reloads).toBe(1);
    expect(signupConsoleWarning({ ...board, consoles: { players: 4, coming: 2, needed: 2, warning: false } })).toBeNull();
  });
});

describe("the inbox entries", () => {
  const base = { notificationId: "1", count: 1, lastEventAtMs: NOW, read: false, tournamentId: TOURNAMENT, tournamentName: "Friday" } as const;
  it("names the night and opens its page", () => {
    setProductLanguage("en");
    expect(notificationMessage({ ...base, kind: "tournament_signup_selected", detail: "selected" })).toBe("You're in for Friday");
    expect(notificationMessage({ ...base, kind: "tournament_signup_selected", detail: "waiting" })).toBe("You're on the waiting list for Friday");
    expect(notificationMessage({ ...base, kind: "tournament_signup_moved_up", detail: "moved_up" }))
      .toBe("You moved up from the waiting list: you're in for Friday");
    expect(notificationMessage({ ...base, kind: "tournament_signup_removed", detail: "removed" }))
      .toBe("The Director took you off the list for Friday");
    expect(notificationLink({ ...base, kind: "tournament_signup_removed", detail: "removed" }, null)).toBe(`/?tournaments=${TOURNAMENT}`);
    setProductLanguage("nl");
    expect(notificationMessage({ ...base, kind: "tournament_signup_moved_up", detail: "moved_up" }))
      .toBe("Je bent van de wachtlijst doorgeschoven: je doet mee aan Friday");
  });
});
