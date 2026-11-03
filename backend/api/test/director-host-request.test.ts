// ADR-0220 "Request to host": the rules of the service, the browser/native/administrator routes and
// the two inbox entries, against fakes. The lifecycle on a real database is in
// director-host-request.integration.test.ts.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ActorContext, IdentityReadRepository } from "../src/identity/types.js";
import { MysqlNotificationRepository } from "../src/notifications/mysql-notification-repository.js";
import {
  cleanHostRequestText,
  DirectorHostRequestError,
  DirectorHostRequestService,
  type DirectorHostRequestRepository,
  type HostRequestDecision,
  type HostRequestQueueItem,
  type HostRequestView,
} from "../src/tournaments/director-host-request-service.js";

const person = "user_account.synthetic_host_asker";
const director = "user_account.synthetic_host_director";
const administrator = "user_account.synthetic_host_admin";
const now = 1_900_000_000_000;

class Repository implements DirectorHostRequestRepository {
  public requests: (HostRequestView & { userAccountId: string })[] = [];
  public decisions: string[] = [];
  async latestForAccount(userAccountId: string) {
    const own = this.requests.filter((request) => request.userAccountId === userAccountId);
    const latest = own.at(-1);
    if (latest === undefined) { return null; }
    const { userAccountId: _ignored, ...view } = latest;
    return view;
  }
  async insert(input: Readonly<{ requestId: string; userAccountId: string; note: string | null; nowMs: number }>) {
    if (this.requests.some((request) => request.userAccountId === input.userAccountId && request.status === "open")) {
      return "open_exists" as const;
    }
    this.requests.push({
      requestId: input.requestId, userAccountId: input.userAccountId, status: "open", note: input.note,
      requestedAtMs: input.nowMs, decidedAtMs: null, declineReason: null,
    });
    return "created" as const;
  }
  async listOpen(): Promise<readonly HostRequestQueueItem[]> {
    return this.requests.filter((request) => request.status === "open").map((request) => ({
      requestId: request.requestId,
      userAccountId: request.userAccountId,
      accountCreatedAtMs: now - 1000,
      players: [{ playerId: "player.synthetic_mal", username: "mal", displayName: "Mal" }],
      note: request.note,
      requestedAtMs: request.requestedAtMs,
    }));
  }
  private decide(requestId: string, status: "approved" | "declined", nowMs: number, reason: string | null):
    HostRequestDecision | "not_found" | "not_open" {
    const index = this.requests.findIndex((request) => request.requestId === requestId);
    const found = this.requests[index];
    if (found === undefined) { return "not_found"; }
    if (found.status !== "open") { return "not_open"; }
    this.requests[index] = { ...found, status, decidedAtMs: nowMs, declineReason: reason };
    this.decisions.push(`${status}:${requestId}`);
    return { requestId, userAccountId: found.userAccountId, status, decidedAtMs: nowMs };
  }
  async approve(input: Readonly<{ requestId: string; nowMs: number; reasonCode: string }>) {
    this.decisions.push(`reason:${input.reasonCode}`);
    return this.decide(input.requestId, "approved", input.nowMs, null);
  }
  async decline(input: Readonly<{ requestId: string; reason: string | null; nowMs: number }>) {
    return this.decide(input.requestId, "declined", input.nowMs, input.reason);
  }
}

function fixture() {
  const repository = new Repository();
  const notices: string[] = [];
  let sequence = 0;
  const directors = new Set([director]);
  const service = new DirectorHostRequestService({
    repository,
    hasTournamentOperation: async (account) => directors.has(account),
    ids: {
      newRequestId: () => `director_host_request.synthetic-${(sequence += 1)}`,
      newGrantId: () => `account_capability_grant.synthetic-${(sequence += 1)}`,
    },
    clock: { nowMs: () => now },
    notifier: {
      hostRequested: async (requestId) => { notices.push(`requested:${requestId}`); },
      hostRequestDecided: async (requestId, account, decision) => {
        notices.push(`${decision}:${requestId}:${account}`);
        if (decision === "approved") { directors.add(account); }
      },
    },
  });
  return { repository, service, notices };
}

const account = (userAccountId: string): ActorContext => ({ role: "account", userAccountId });
const admin: ActorContext = { role: "administrator", userAccountId: administrator };

describe("Request to host: the rules (ADR-0220)", () => {
  it("cleans the note: trimmed, empty is none, at most 300 characters, no control characters", () => {
    expect(cleanHostRequestText(undefined)).toBeNull();
    expect(cleanHostRequestText("   ")).toBeNull();
    expect(cleanHostRequestText("  I run the Friday nights\nin Utrecht ")).toBe("I run the Friday nights\nin Utrecht");
    expect(cleanHostRequestText("é".repeat(300))).toHaveLength(300);
    expect(() => cleanHostRequestText("x".repeat(301))).toThrow(DirectorHostRequestError);
    expect(() => cleanHostRequestText("bell\u0007")).toThrow(DirectorHostRequestError);
    expect(() => cleanHostRequestText(42)).toThrow(DirectorHostRequestError);
  });

  it("lets a signed-in non-Director ask once, tells the administrators, and refuses a second open request", async () => {
    const { service, notices } = fixture();
    const before = await service.standing(account(person));
    expect(before).toEqual({ administrator: false, director: false, request: null });
    const after = await service.submit(account(person), "  Friday nights  ");
    expect(after.request).toMatchObject({ status: "open", note: "Friday nights", requestedAtMs: now });
    expect(notices).toEqual([`requested:${after.request!.requestId}`]);
    await expect(service.submit(account(person), undefined)).rejects.toMatchObject({ code: "already_open" });
  });

  it("never lets an administrator or a Director ask, and never lets an anonymous visitor in", async () => {
    const { service } = fixture();
    await expect(service.submit(admin, undefined)).rejects.toMatchObject({ code: "forbidden" });
    await expect(service.submit(account(director), undefined)).rejects.toMatchObject({ code: "already_director" });
    await expect(service.standing({ role: "anonymous" })).rejects.toMatchObject({ code: "not_authenticated" });
    expect(await service.standing(account(director))).toMatchObject({ director: true });
    expect(await service.standing(admin)).toMatchObject({ administrator: true });
  });

  it("approves through the audited grant path and tells the person", async () => {
    const { service, repository, notices } = fixture();
    const asked = await service.submit(account(person), undefined);
    const requestId = asked.request!.requestId;
    await expect(service.queue(account(person))).rejects.toMatchObject({ code: "forbidden" });
    expect((await service.queue(admin)).map((item) => item.requestId)).toEqual([requestId]);
    await expect(service.approve(account(director), requestId)).rejects.toMatchObject({ code: "forbidden" });
    const decision = await service.approve(admin, requestId);
    expect(decision).toEqual({ requestId, userAccountId: person, status: "approved", decidedAtMs: now });
    expect(repository.decisions).toContain("reason:director_host_request_approved");
    expect(notices.at(-1)).toBe(`approved:${requestId}:${person}`);
    expect(await service.standing(account(person))).toMatchObject({ director: true, request: { status: "approved" } });
    await expect(service.approve(admin, requestId)).rejects.toMatchObject({ code: "conflict" });
    await expect(service.approve(admin, "not-a-request")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(service.approve(admin, "director_host_request.unknown")).rejects.toMatchObject({ code: "not_found" });
  });

  it("declines with an optional reason, after which the person may ask again", async () => {
    const { service, notices } = fixture();
    const first = (await service.submit(account(person), "please")).request!.requestId;
    await service.decline(admin, first, "  Not before your first night as a player  ");
    expect(notices.at(-1)).toBe(`declined:${first}:${person}`);
    expect((await service.standing(account(person))).request).toMatchObject({
      status: "declined", declineReason: "Not before your first night as a player", decidedAtMs: now,
    });
    const second = await service.submit(account(person), undefined);
    expect(second.request).toMatchObject({ status: "open", note: null });
    await service.decline(admin, second.request!.requestId, undefined);
    expect((await service.standing(account(person))).request).toMatchObject({ status: "declined", declineReason: null });
  });
});

const identityRepository: IdentityReadRepository = {
  async findPublicPlayerById() { return null; },
  async findUserAccountSummaryById() { return null; },
  async findPlayerClaimSummaryById() { return null; },
};
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

async function appFor(service: DirectorHostRequestService): Promise<FastifyInstance> {
  const app = await buildApp({
    identityRepository,
    resolveActor: async (request: FastifyRequest): Promise<ActorContext> => {
      const who = request.headers["x-test-actor"];
      if (who === "admin") { return admin; }
      if (typeof who === "string") { return account(who); }
      return { role: "anonymous" };
    },
    directorHostRequests: {
      service,
      csrfVerifier: { verify: (_actor, token) => token === "synthetic-csrf-proof-0001" },
    },
  });
  apps.push(app);
  return app;
}

describe("Request to host: the routes (ADR-0220)", () => {
  it("serves the standing, refuses a browser write without the CSRF proof and accepts one with it", async () => {
    const { service } = fixture();
    const app = await appFor(service);
    const anonymous = await app.inject({ method: "GET", url: "/v1/me/director-host-request" });
    expect(anonymous.statusCode).toBe(401);
    const empty = await app.inject({ method: "GET", url: "/v1/me/director-host-request", headers: { "x-test-actor": person } });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({
      schemaVersion: "mk8dx.director-host-request.v1", administrator: false, director: false, request: null,
    });
    const refused = await app.inject({
      method: "POST", url: "/v1/me/director-host-request", headers: { "x-test-actor": person }, payload: { note: "hi" },
    });
    expect(refused.statusCode).toBe(403);
    const created = await app.inject({
      method: "POST", url: "/v1/me/director-host-request",
      headers: { "x-test-actor": person, "x-mk8dx-csrf": "synthetic-csrf-proof-0001" }, payload: { note: "hi" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().request).toMatchObject({ status: "open", note: "hi", decidedAtMs: null, declineReason: null });
    const twice = await app.inject({
      method: "POST", url: "/v1/me/director-host-request",
      headers: { "x-test-actor": person, "x-mk8dx-csrf": "synthetic-csrf-proof-0001" }, payload: {},
    });
    expect(twice.statusCode).toBe(409);
    expect(twice.json().code).toBe("director_host_request_already_open");
    const tooLong = await app.inject({
      method: "POST", url: "/v1/me/director-host-request",
      headers: { "x-test-actor": "user_account.synthetic_other", "x-mk8dx-csrf": "synthetic-csrf-proof-0001" },
      payload: { note: "x".repeat(301) },
    });
    expect(tooLong.statusCode).toBe(400);
  });

  it("lets the native twin ask with a bearer token and no CSRF proof", async () => {
    const { service } = fixture();
    const app = await appFor(service);
    const withoutBearer = await app.inject({
      method: "POST", url: "/v1/native/director-host-request", headers: { "x-test-actor": person }, payload: {},
    });
    expect(withoutBearer.statusCode).toBe(401);
    const bearer = { "x-test-actor": person, authorization: "Bearer synthetic-native-bearer-token-0001" };
    const created = await app.inject({ method: "POST", url: "/v1/native/director-host-request", headers: bearer, payload: {} });
    expect(created.statusCode).toBe(201);
    const read = await app.inject({ method: "GET", url: "/v1/native/director-host-request", headers: bearer });
    expect(read.json().request.status).toBe("open");
  });

  it("gives administrators the queue, Approve and Decline, and nobody else", async () => {
    const { service } = fixture();
    const app = await appFor(service);
    const asked = await service.submit(account(person), "Friday nights");
    const requestId = asked.request!.requestId;
    const forbidden = await app.inject({
      method: "GET", url: "/v1/administrator/director-host-requests", headers: { "x-test-actor": person },
    });
    expect(forbidden.statusCode).toBe(403);
    const queue = await app.inject({
      method: "GET", url: "/v1/administrator/director-host-requests", headers: { "x-test-actor": "admin" },
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json()).toMatchObject({
      schemaVersion: "mk8dx.director-host-request-queue.v1",
      requests: [{ requestId, userAccountId: person, note: "Friday nights", players: [{ username: "mal" }] }],
    });
    const noProof = await app.inject({
      method: "POST", url: `/v1/administrator/director-host-requests/${requestId}/actions/approve`,
      headers: { "x-test-actor": "admin" }, payload: {},
    });
    expect(noProof.statusCode).toBe(403);
    const approved = await app.inject({
      method: "POST", url: `/v1/administrator/director-host-requests/${requestId}/actions/approve`,
      headers: { "x-test-actor": "admin", "x-mk8dx-csrf": "synthetic-csrf-proof-0001" }, payload: {},
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toEqual({
      schemaVersion: "mk8dx.director-host-request-decision.v1", requestId, userAccountId: person,
      status: "approved", decidedAtMs: now,
    });
    const again = await app.inject({
      method: "POST", url: `/v1/administrator/director-host-requests/${requestId}/actions/decline`,
      headers: { "x-test-actor": "admin", "x-mk8dx-csrf": "synthetic-csrf-proof-0001" }, payload: { reason: "late" },
    });
    expect(again.statusCode).toBe(409);
  });
});

type Response = readonly [unknown, unknown];

class NotificationExecutor {
  public readonly writes: (readonly unknown[])[] = [];
  public readonly reads: string[] = [];
  public constructor(
    private readonly request: readonly Record<string, unknown>[],
    private readonly administrators: readonly Record<string, unknown>[],
  ) {}
  public async execute(sql: string, parameters: readonly unknown[] = []): Promise<Response> {
    this.reads.push(sql);
    if (sql.includes("INSERT INTO notifications")) {
      this.writes.push(parameters);
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes("FROM director_host_requests AS request")) { return [this.request, []]; }
    if (sql.includes("FROM administrator_grants AS grant_record")) { return [this.administrators, []]; }
    if (sql.includes("FROM user_accounts WHERE public_id = ?")) { return [[{ accountInternalId: 9 }], []]; }
    throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
  }
}

describe("Request to host: the inbox entries (ADR-0220)", () => {
  it("tells every other active administrator once per request, naming the asker's Player", async () => {
    const executor = new NotificationExecutor(
      [{ accountInternalId: 9, actorInternalId: 64 }],
      [{ accountInternalId: 1 }, { accountInternalId: 5 }, { accountInternalId: "junk" }],
    );
    await new MysqlNotificationRepository(executor as never)
      .produceHostRequested("director_host_request.synthetic-1", now);
    expect(executor.writes).toHaveLength(2);
    for (const [index, recipient] of [1, 5].entries()) {
      const values = executor.writes[index]!;
      expect(values.slice(0, 4)).toEqual([recipient, "host_requested", "host_requested|director_host_request.synthetic-1", 64]);
      expect(values[6]).toBe("requested");
    }
    // The person asking never hears their own request, even when they are (later) an administrator.
    expect(executor.reads.join(" ")).toContain("grant_record.user_account_id <> ?");
  });

  it("names nobody when the asker has no verified Player, and sends the outcome to the asker only", async () => {
    const executor = new NotificationExecutor([{ accountInternalId: 9, actorInternalId: null }], [{ accountInternalId: 1 }]);
    const repository = new MysqlNotificationRepository(executor as never);
    await repository.produceHostRequested("director_host_request.synthetic-2", now);
    expect(executor.writes[0]![3]).toBeNull();
    await repository.produceHostRequestDecided("director_host_request.synthetic-2", person, "declined", now);
    expect(executor.writes[1]!.slice(0, 3)).toEqual([9, "host_request_decided", "host_request_decided|director_host_request.synthetic-2"]);
    expect(executor.writes[1]![6]).toBe("declined");
  });
});
