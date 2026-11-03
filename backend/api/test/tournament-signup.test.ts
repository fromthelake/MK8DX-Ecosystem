// ADR-0222: open sign-up, the waiting list and the status line, against an in-memory repository
// (the MariaDB lifecycle is tournament-signup.integration.test.ts).

import type { FastifyInstance, FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ActorContext, IdentityReadRepository } from "../src/identity/types.js";
import {
  SIGNUP_DRAW_ALGORITHM,
  signupDrawOrder,
} from "../src/tournaments/tournament-signup-draw.js";
import {
  TournamentSignupService,
  type SignupAttendance,
  type SignupEntryStatus,
  type SignupNotice,
  type SignupSettingsRecord,
  type SignupTournament,
  type TournamentSignupRepository,
  type TournamentSignupTransaction,
} from "../src/tournaments/tournament-signup-service.js";

const TOURNAMENT = "tournament.signup-friday";
const DIRECTOR = "user_account.director";
const OTHER_DIRECTOR = "user_account.other-director";
const ADMIN = "user_account.admin";
const SEED = "0123456789abcdef".repeat(4);

type RosterState = { attendance: SignupAttendance; hasSwitch1: boolean; hasSwitch2: boolean };
type EntryState = {
  accountInternalId: number; status: SignupEntryStatus; queuePosition: number | null; signedUpAtMs: number;
};
type State = {
  tournament: SignupTournament;
  settings: SignupSettingsRecord | null;
  roster: Map<number, RosterState>;
  entries: Map<number, EntryState>;
  revision: number;
  lifecycle: string[];
};

type Person = { account: string; accountInternalId: number; player?: { internalId: number; playerId: string; displayName: string } };

const people: Record<string, Person> = {
  ada: { account: "user_account.ada", accountInternalId: 11, player: { internalId: 101, playerId: "player.ada", displayName: "Ada" } },
  bo: { account: "user_account.bo", accountInternalId: 12, player: { internalId: 102, playerId: "player.bo", displayName: "Bo" } },
  cy: { account: "user_account.cy", accountInternalId: 13, player: { internalId: 103, playerId: "player.cy", displayName: "Cy" } },
  di: { account: "user_account.di", accountInternalId: 14, player: { internalId: 104, playerId: "player.di", displayName: "Di" } },
  nobody: { account: "user_account.nobody", accountInternalId: 15 },
};
const players = new Map(Object.values(people).flatMap((person) => person.player === undefined ? [] : [[person.player.internalId, person.player] as const]));

function fixture(options: Partial<Pick<SignupTournament, "workflowStep" | "groupCount" | "maxParticipants">> = {}) {
  let now = 1_900_000_000_000;
  const state: State = {
    tournament: {
      internalId: 1, tournamentId: TOURNAMENT, name: "Friday", directorInternalId: 1, stage: "setup",
      workflowStep: options.workflowStep ?? 2, maxParticipants: options.maxParticipants ?? null,
      startAtMs: now + 7 * 86_400_000, timezone: "Europe/Amsterdam", groupCount: options.groupCount ?? 0,
    },
    settings: null,
    // The Director's default roster: earlier nights' Players prefilled Absent (ADR-0177).
    roster: new Map([[104, { attendance: "absent", hasSwitch1: false, hasSwitch2: false }]]),
    entries: new Map(),
    revision: 1,
    lifecycle: [],
  };
  const transaction: TournamentSignupTransaction = {
    async findTournament(id) { return id === TOURNAMENT ? state.tournament : null; },
    async loadSettings() { return state.settings; },
    async saveSettings(input) { state.settings = input.settings; },
    async loadRoster() {
      return [...state.roster.entries()].map(([internalId, row]) => ({
        playerInternalId: internalId, playerId: players.get(internalId)!.playerId,
        displayName: players.get(internalId)!.displayName, publicIdentity: internalId !== 103, ...row,
      }));
    },
    async loadEntries() {
      return [...state.entries.entries()].map(([internalId, entry]) => ({
        playerInternalId: internalId, playerId: players.get(internalId)!.playerId,
        displayName: players.get(internalId)!.displayName, publicIdentity: internalId !== 103, ...entry,
      }));
    },
    async saveEntry(input) {
      if (input.status === "waiting" && (input.queuePosition === null || input.queuePosition < 1)) {
        throw new Error("ck_tournament_signups_queue");
      }
      state.entries.set(input.playerInternalId, {
        accountInternalId: input.accountInternalId, status: input.status,
        queuePosition: input.status === "waiting" ? input.queuePosition : null, signedUpAtMs: input.signedUpAtMs,
      });
    },
    async writeRoster(input) {
      const row = state.roster.get(input.playerInternalId) ?? { attendance: "absent", hasSwitch1: false, hasSwitch2: false };
      state.roster.set(input.playerInternalId, {
        attendance: input.attendance ?? row.attendance,
        hasSwitch1: input.hasSwitch1 ?? row.hasSwitch1,
        hasSwitch2: input.hasSwitch2 ?? row.hasSwitch2,
      });
    },
    async touchTournament() { state.revision += 1; },
    async appendLifecycle(input) { state.lifecycle.push(`${input.eventType}:${input.detail ?? ""}`); },
    async viewerAccount(account) {
      const person = Object.values(people).find((candidate) => candidate.account === account);
      if (person === undefined) { return null; }
      return { internalId: person.accountInternalId, players: person.player === undefined ? [] : [person.player] };
    },
    async operatorAccount(account) {
      if (account === DIRECTOR) { return { internalId: 1, isAdministrator: false }; }
      if (account === OTHER_DIRECTOR) { return { internalId: 2, isAdministrator: false }; }
      if (account === ADMIN) { return { internalId: 3, isAdministrator: true }; }
      return null;
    },
    async listDueTournamentIds(nowMs) {
      return state.settings?.mode === "open" && state.settings.status === "open" && state.settings.closesAtMs <= nowMs
        ? [TOURNAMENT] : [];
    },
  };
  const repository: TournamentSignupRepository = {
    async transaction(work) {
      // All or nothing, like the database: a refused operation leaves the state as it was.
      const saved = structuredClone(state);
      try {
        return await work(transaction);
      } catch (error) {
        Object.assign(state, saved);
        throw error;
      }
    },
  };
  const notices: SignupNotice[] = [];
  const service = new TournamentSignupService({
    repository,
    clock: { nowMs: () => now },
    notifier: { async signupChanged(notice) { notices.push(notice); } },
    newSeed: () => SEED,
  });
  return {
    state, service, notices,
    advance(ms: number) { now += ms; },
    now: () => now,
  };
}

const as = (person: Person): ActorContext => ({ role: "account", userAccountId: person.account });
const director: ActorContext = { role: "account", userAccountId: DIRECTOR };

describe("the open sign-up draw (ADR-0222)", () => {
  it("is reproducible from the published seed, whatever order the entrants come in", () => {
    const ids = ["player.signup-c", "player.signup-a", "player.signup-h", "player.signup-e",
      "player.signup-b", "player.signup-g", "player.signup-d", "player.signup-f"];
    // Cross-checked against an independent Python implementation of the documented algorithm.
    expect(signupDrawOrder(SEED, ids)).toEqual([
      "player.signup-h", "player.signup-c", "player.signup-a", "player.signup-f",
      "player.signup-g", "player.signup-d", "player.signup-b", "player.signup-e",
    ]);
    expect(signupDrawOrder(SEED, [...ids].reverse())).toEqual(signupDrawOrder(SEED, ids));
    expect(signupDrawOrder("f".repeat(64), ["player.one", "player.two", "player.three"]))
      .toEqual(["player.three", "player.one", "player.two"]);
    expect(signupDrawOrder(SEED, [])).toEqual([]);
    expect(() => signupDrawOrder("not-a-seed", ids)).toThrow(RangeError);
    expect(SIGNUP_DRAW_ALGORITHM).toBe("mk8dx-signup-draw-sha256-fisher-yates-v1");
  });
});

describe("open sign-up (ADR-0222)", () => {
  it("keeps the Director's roster as the default and explains it", async () => {
    const { service } = fixture();
    const status = await service.status(as(people.ada!), TOURNAMENT);
    expect(status).toMatchObject({ mode: "director", status: "director", active: [], waiting: [] });
    expect(status.viewer).toMatchObject({ state: "director_roster", canSignUp: false });
    await expect(service.signUp(as(people.ada!), TOURNAMENT, { hasSwitch1: true, hasSwitch2: false }))
      .rejects.toMatchObject({ code: "closed" });
    expect((await service.status({ role: "anonymous" }, TOURNAMENT)).viewer.state).toBe("signed_out");
  });

  it("asks for a verified Player", async () => {
    const { service, now } = fixture();
    await service.configure(director, TOURNAMENT, { mode: "open", selection: "draw", closesAtMs: now() + 3_600_000, capacity: 2 });
    expect((await service.status(as(people.nobody!), TOURNAMENT)).viewer.state).toBe("no_player");
    await expect(service.signUp(as(people.nobody!), TOURNAMENT, { hasSwitch1: false, hasSwitch2: false }))
      .rejects.toMatchObject({ code: "no_verified_player" });
    await expect(service.signUp({ role: "anonymous" }, TOURNAMENT, { hasSwitch1: false, hasSwitch2: false }))
      .rejects.toMatchObject({ code: "not_authenticated" });
  });

  it("draws at closing, puts everyone else on the waiting list in order and moves the next one up", async () => {
    const { service, state, notices, advance, now } = fixture();
    const closesAtMs = now() + 3_600_000;
    const board = await service.configure(director, TOURNAMENT, { mode: "open", selection: "draw", closesAtMs, capacity: 2 });
    expect(board.settings).toMatchObject({ mode: "open", selection: "draw", status: "open", capacity: 2 });

    const open = await service.status(as(people.ada!), TOURNAMENT);
    expect(open).toMatchObject({ status: "open", closesAtMs, capacity: 2, taken: 0, timezone: "Europe/Amsterdam" });
    expect(open.viewer).toMatchObject({ state: "not_signed_up", canSignUp: true });

    for (const [person, ns1, ns2] of [[people.ada!, true, false], [people.bo!, false, false], [people.cy!, false, false]] as const) {
      const signed = await service.signUp(as(person), TOURNAMENT, { hasSwitch1: ns1, hasSwitch2: ns2 });
      expect(signed.viewer).toMatchObject({ state: "pending", canWithdraw: true, canChangeConsoles: true, canSignUp: false });
    }
    // Sign-up writes the existing roster rows; nobody is on the list before the draw.
    expect(state.roster.get(101)).toEqual({ attendance: "absent", hasSwitch1: true, hasSwitch2: false });
    expect(state.roster.get(103)).toEqual({ attendance: "absent", hasSwitch1: false, hasSwitch2: false });
    // Two players expected, one console coming: enough. Bo changes nothing, Cy brings none.
    let warned = await service.board(director, TOURNAMENT);
    expect(warned.consoles).toEqual({ players: 2, coming: 1, needed: 1, warning: false });
    await service.signUp(as(people.ada!), TOURNAMENT, { hasSwitch1: false, hasSwitch2: false });
    warned = await service.board(director, TOURNAMENT);
    expect(warned.consoles).toEqual({ players: 2, coming: 0, needed: 1, warning: true });
    await service.signUp(as(people.ada!), TOURNAMENT, { hasSwitch1: true, hasSwitch2: true });

    advance(3_600_000);
    // The first read after the closing time runs the draw, once.
    const closed = await service.status(as(people.ada!), TOURNAMENT);
    const drawn = signupDrawOrder(SEED, ["player.ada", "player.bo", "player.cy"]);
    expect(closed).toMatchObject({ status: "closed", drawSeed: SEED, drawAlgorithm: SIGNUP_DRAW_ALGORITHM, taken: 2 });
    expect(closed.waiting.map((entry) => entry.displayName)).toEqual([drawn[2] === "player.cy" ? "Cy" : drawn[2] === "player.bo" ? "Bo" : "Ada"]);
    expect(state.settings?.status).toBe("closed");
    expect(notices.map((notice) => notice.detail).sort()).toEqual(["selected", "selected", "waiting"]);
    const selected = drawn.slice(0, 2);
    const waitingId = drawn[2]!;
    const internal = (playerId: string) => [...players.values()].find((player) => player.playerId === playerId)!.internalId;
    for (const playerId of selected) { expect(state.roster.get(internal(playerId))?.attendance).toBe("present"); }
    expect(state.roster.get(internal(waitingId))?.attendance).toBe("waiting");
    // A private Player's name is listed without the link to their profile.
    for (const entry of [...closed.active, ...closed.waiting]) {
      expect(entry.playerId === null).toBe(entry.displayName === "Cy");
    }
    // Consoles are fixed after closing.
    const firstSelected = Object.values(people).find((person) => person.player?.playerId === selected[0])!;
    await expect(service.signUp(as(firstSelected), TOURNAMENT, { hasSwitch1: true, hasSwitch2: false }))
      .rejects.toMatchObject({ code: "closed" });
    expect((await service.status(as(firstSelected), TOURNAMENT)).viewer).toMatchObject({
      state: "selected", canWithdraw: true, canChangeConsoles: false,
    });
    const waitingPerson = Object.values(people).find((person) => person.player?.playerId === waitingId)!;
    expect((await service.status(as(waitingPerson), TOURNAMENT)).viewer).toMatchObject({ state: "waiting", waitingPosition: 1 });

    // A withdrawal before the night moves the first of the waiting list up and tells them.
    notices.length = 0;
    const withdrawn = await service.withdraw(as(firstSelected), TOURNAMENT);
    expect(withdrawn.viewer).toMatchObject({ state: "withdrawn", canSignUp: false });
    expect(state.roster.get(internal(selected[0]!))?.attendance).toBe("absent");
    expect(state.roster.get(internal(waitingId))?.attendance).toBe("present");
    expect(notices).toEqual([{
      kind: "tournament_signup_moved_up", tournamentInternalId: 1,
      recipientInternalId: waitingPerson.accountInternalId, detail: "moved_up",
    }]);
    expect((await service.status(as(waitingPerson), TOURNAMENT)).viewer.state).toBe("selected");
    // The draw ran once: later reads keep the same seed.
    expect(state.lifecycle.filter((line) => line.startsWith("signup_closed")).length).toBe(1);
  });

  it("serves first come, first served at once, with a waiting list behind the maximum", async () => {
    const { service, state, notices, now } = fixture();
    await service.configure(director, TOURNAMENT, { mode: "open", selection: "first_come", closesAtMs: now() + 60_000, capacity: 2 });
    expect((await service.signUp(as(people.ada!), TOURNAMENT, { hasSwitch1: true, hasSwitch2: false })).viewer.state).toBe("selected");
    expect((await service.signUp(as(people.bo!), TOURNAMENT, { hasSwitch1: false, hasSwitch2: false })).viewer.state).toBe("selected");
    const third = await service.signUp(as(people.di!), TOURNAMENT, { hasSwitch1: false, hasSwitch2: true });
    expect(third.viewer).toMatchObject({ state: "waiting", waitingPosition: 1 });
    expect(third).toMatchObject({ taken: 2, capacity: 2 });
    // Di was on the Director's prefilled roster: the same row now waits.
    expect(state.roster.get(104)).toEqual({ attendance: "waiting", hasSwitch1: false, hasSwitch2: true });
    expect(notices).toEqual([]);
    // A larger maximum moves the waiting list up immediately.
    await service.configure(director, TOURNAMENT, { mode: "open", capacity: 3 });
    expect(state.roster.get(104)?.attendance).toBe("present");
    expect(notices.map((notice) => notice.kind)).toEqual(["tournament_signup_moved_up"]);
    // The selection cannot change once people signed up.
    await expect(service.configure(director, TOURNAMENT, { mode: "open", selection: "draw" }))
      .rejects.toMatchObject({ code: "conflict" });
  });

  it("lets the Director move people by hand and tells who moved up or was removed", async () => {
    const { service, state, notices, now } = fixture();
    await service.configure(director, TOURNAMENT, { mode: "open", selection: "first_come", closesAtMs: now() + 60_000, capacity: 1 });
    await service.signUp(as(people.ada!), TOURNAMENT, { hasSwitch1: true, hasSwitch2: false });
    await service.signUp(as(people.bo!), TOURNAMENT, { hasSwitch1: false, hasSwitch2: false });
    await service.signUp(as(people.cy!), TOURNAMENT, { hasSwitch1: false, hasSwitch2: false });
    let board = await service.board(director, TOURNAMENT);
    expect(board.entries.map((entry) => [entry.playerId, entry.status, entry.position]))
      .toEqual([["player.ada", "selected", null], ["player.bo", "waiting", 1], ["player.cy", "waiting", 2]]);
    // Cy to the front of the waiting list.
    board = await service.move(director, TOURNAMENT, { playerId: "player.cy", to: "waiting", position: 1 });
    expect(board.entries.filter((entry) => entry.status === "waiting").map((entry) => [entry.playerId, entry.position]))
      .toEqual([["player.cy", 1], ["player.bo", 2]]);
    // Bo onto the list, over the sign-up maximum: the Director decides.
    board = await service.move(director, TOURNAMENT, { playerId: "player.bo", to: "selected" });
    expect(state.roster.get(102)?.attendance).toBe("present");
    expect(notices.at(-1)).toMatchObject({ kind: "tournament_signup_moved_up", recipientInternalId: 12 });
    // Ada off the list: told, and not able to sign up again.
    board = await service.move(director, TOURNAMENT, { playerId: "player.ada", to: "removed" });
    expect(notices.at(-1)).toMatchObject({ kind: "tournament_signup_removed", recipientInternalId: 11, detail: "removed" });
    expect(state.roster.get(101)?.attendance).toBe("absent");
    expect((await service.status(as(people.ada!), TOURNAMENT)).viewer.state).toBe("removed");
    await expect(service.signUp(as(people.ada!), TOURNAMENT, { hasSwitch1: false, hasSwitch2: false }))
      .rejects.toMatchObject({ code: "forbidden" });
    // Another Director may not touch this night; an administrator may.
    await expect(service.move({ role: "account", userAccountId: OTHER_DIRECTOR }, TOURNAMENT, { playerId: "player.cy", to: "removed" }))
      .rejects.toMatchObject({ code: "forbidden" });
    await expect(service.board(as(people.bo!), TOURNAMENT)).rejects.toMatchObject({ code: "forbidden" });
    await service.move({ role: "administrator", userAccountId: ADMIN }, TOURNAMENT, { playerId: "player.cy", to: "selected" });
    expect(state.roster.get(103)?.attendance).toBe("present");
  });

  it("closes early on the Director's word and refuses changes once the night has started", async () => {
    const started = fixture({ workflowStep: 3, groupCount: 2 });
    await expect(started.service.configure(director, TOURNAMENT, {
      mode: "open", selection: "draw", closesAtMs: started.now() + 60_000, capacity: 4,
    })).rejects.toMatchObject({ code: "closed" });

    const { service, state, now } = fixture();
    await expect(service.configure(director, TOURNAMENT, { mode: "open", selection: "draw", closesAtMs: now() - 1, capacity: 4 }))
      .rejects.toMatchObject({ code: "invalid_input" });
    await expect(service.configure(director, TOURNAMENT, { mode: "open", selection: "draw", closesAtMs: now() + 1, capacity: 61 }))
      .rejects.toMatchObject({ code: "invalid_input" });
    await service.configure(director, TOURNAMENT, { mode: "open", selection: "draw", closesAtMs: now() + 60_000, capacity: 4 });
    await service.signUp(as(people.ada!), TOURNAMENT, { hasSwitch1: false, hasSwitch2: false });
    const closed = await service.closeNow(director, TOURNAMENT);
    expect(closed.settings).toMatchObject({ status: "closed", drawSeed: SEED });
    expect(state.roster.get(101)?.attendance).toBe("present");
    await expect(service.configure(director, TOURNAMENT, { mode: "open", capacity: 5 })).rejects.toMatchObject({ code: "closed" });
    expect((await service.status(as(people.bo!), TOURNAMENT)).viewer.state).toBe("closed");
  });

  it("sweeps nights whose time has passed", async () => {
    const { service, advance, now, state } = fixture();
    await service.configure(director, TOURNAMENT, { mode: "open", selection: "draw", closesAtMs: now() + 1_000, capacity: 4 });
    expect(await service.closeDue()).toBe(0);
    advance(1_000);
    expect(await service.closeDue()).toBe(1);
    expect(state.settings?.status).toBe("closed");
    expect(await service.closeDue()).toBe(0);
  });
});

const identityRepository: IdentityReadRepository = {
  async findPublicPlayerById() { return null; },
  async findUserAccountSummaryById() { return null; },
  async findPlayerClaimSummaryById() { return null; },
};
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

async function appFor(service: TournamentSignupService): Promise<FastifyInstance> {
  const app = await buildApp({
    identityRepository,
    resolveActor: async (request: FastifyRequest): Promise<ActorContext> => {
      const who = request.headers["x-test-actor"];
      return typeof who === "string" ? { role: "account", userAccountId: who } : { role: "anonymous" };
    },
    tournamentSignups: {
      service,
      csrfVerifier: { verify: (_actor, token) => token === "synthetic-csrf-proof-0001" },
    },
  });
  apps.push(app);
  return app;
}

describe("open sign-up: the routes (ADR-0222)", () => {
  it("serves the document to anyone and writes only with the CSRF proof or a bearer", async () => {
    const { service, now } = fixture();
    await service.configure(director, TOURNAMENT, { mode: "open", selection: "draw", closesAtMs: now() + 60_000, capacity: 2 });
    const app = await appFor(service);
    const anonymous = await app.inject({ method: "GET", url: `/v1/tournaments/${TOURNAMENT}/signup` });
    expect(anonymous.statusCode).toBe(200);
    expect(Object.keys(anonymous.json()).sort()).toEqual([
      "active", "capacity", "closedAtMs", "closesAtMs", "drawAlgorithm", "drawSeed", "mode", "schemaVersion",
      "selection", "status", "taken", "timezone", "tournamentId", "viewer", "waiting",
    ]);
    expect(anonymous.json()).toMatchObject({ schemaVersion: "mk8dx.tournament-signup.v1", viewer: { state: "signed_out" } });
    const ada = { "x-test-actor": people.ada!.account };
    const refused = await app.inject({
      method: "POST", url: `/v1/tournaments/${TOURNAMENT}/signup`, headers: ada, payload: { hasSwitch1: true, hasSwitch2: false },
    });
    expect(refused.statusCode).toBe(403);
    const signed = await app.inject({
      method: "POST", url: `/v1/tournaments/${TOURNAMENT}/signup`,
      headers: { ...ada, "x-mk8dx-csrf": "synthetic-csrf-proof-0001" }, payload: { hasSwitch1: true, hasSwitch2: false },
    });
    expect(signed.statusCode).toBe(200);
    expect(signed.json().viewer).toMatchObject({ state: "pending", hasSwitch1: true, playerId: "player.ada" });
    const nativeWithout = await app.inject({
      method: "POST", url: `/v1/native/tournaments/${TOURNAMENT}/signup/actions/withdraw`, headers: ada, payload: {},
    });
    expect(nativeWithout.statusCode).toBe(401);
    const nativeWithdraw = await app.inject({
      method: "POST", url: `/v1/native/tournaments/${TOURNAMENT}/signup/actions/withdraw`,
      headers: { ...ada, authorization: "Bearer synthetic-native-bearer-token-0001" }, payload: {},
    });
    expect(nativeWithdraw.statusCode).toBe(200);
    expect(nativeWithdraw.json().viewer.state).toBe("withdrawn");
    const noPlayer = await app.inject({
      method: "POST", url: `/v1/tournaments/${TOURNAMENT}/signup`,
      headers: { "x-test-actor": people.nobody!.account, "x-mk8dx-csrf": "synthetic-csrf-proof-0001" },
      payload: { hasSwitch1: false, hasSwitch2: false },
    });
    expect(noPlayer.statusCode).toBe(403);
    expect(noPlayer.json().code).toBe("tournament_signup_no_verified_player");
    const missing = await app.inject({ method: "GET", url: "/v1/tournaments/tournament.nobody-here/signup" });
    expect(missing.statusCode).toBe(404);
  });

  it("serves the Director's board and settings", async () => {
    const { service, now } = fixture();
    const app = await appFor(service);
    const proof = { "x-test-actor": DIRECTOR, "x-mk8dx-csrf": "synthetic-csrf-proof-0001" };
    const configured = await app.inject({
      method: "POST", url: `/v1/tournaments/${TOURNAMENT}/signup-settings`, headers: proof,
      payload: { mode: "open", selection: "first_come", closesAtMs: now() + 60_000, capacity: 12 },
    });
    expect(configured.statusCode).toBe(200);
    expect(configured.json()).toMatchObject({
      schemaVersion: "mk8dx.tournament-signup-board.v1", editable: true,
      settings: { mode: "open", selection: "first_come", status: "open", capacity: 12 },
      consoles: { players: 0, coming: 0, needed: 0, warning: false },
    });
    const board = await app.inject({ method: "GET", url: `/v1/tournaments/${TOURNAMENT}/signups`, headers: { "x-test-actor": DIRECTOR } });
    expect(board.statusCode).toBe(200);
    const stranger = await app.inject({ method: "GET", url: `/v1/tournaments/${TOURNAMENT}/signups`, headers: { "x-test-actor": people.bo!.account } });
    expect(stranger.statusCode).toBe(403);
    const invalid = await app.inject({
      method: "POST", url: `/v1/tournaments/${TOURNAMENT}/signups/actions/move`, headers: proof,
      payload: { playerId: "player.ada", to: "elsewhere" },
    });
    expect(invalid.statusCode).toBe(400);
  });
});
