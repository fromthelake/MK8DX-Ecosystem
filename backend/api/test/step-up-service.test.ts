import { describe, expect, it } from "vitest";

import type { MutationRateLimiter } from "../src/security/mysql-mutation-rate-limiter.js";
import { MutationRateLimitExceeded } from "../src/security/mysql-mutation-rate-limiter.js";
import { STEP_UP_ROUTES, stepUpPolicyFor, stepUpRequiredBody } from "../src/security/step-up-policy.js";
import {
  StepUpRateLimited,
  StepUpService,
  StepUpUnavailable,
  type StepUpAuditEvent,
  type StepUpEmail,
  type StepUpStore,
} from "../src/security/step-up-service.js";

// Unit level (an in-memory store and limiter); the real routes, sessions and MySQL store are covered by
// administrator-step-up.integration.test.ts.
function harness(limit = Number.POSITIVE_INFINITY) {
  let now = 1_900_000_000_000;
  const rows: Array<{ session: string; user: string; link: string; linkExpires: number; grantExpires: number | null }> = [];
  const audit: StepUpAuditEvent[] = [];
  const mails: StepUpEmail[] = [];
  const counts = new Map<string, number>();
  const store: StepUpStore = {
    async createChallenge(c) {
      for (const row of rows) {
        if (row.session === c.sessionDigest.toString("hex") && row.grantExpires === null) { row.linkExpires = c.nowMs; }
      }
      rows.push({ session: c.sessionDigest.toString("hex"), user: c.authUserId, link: c.linkDigest.toString("hex"),
        linkExpires: c.linkExpiresAtMs, grantExpires: null });
    },
    async findPendingLink(digest, at) {
      const row = rows.find((r) => r.link === digest.toString("hex") && r.grantExpires === null && r.linkExpires > at);
      return row === undefined ? null : { clientKind: "web", requestedAtMs: at, linkExpiresAtMs: row.linkExpires };
    },
    async confirmLink(digest, at, grant) {
      const row = rows.find((r) => r.link === digest.toString("hex") && r.grantExpires === null && r.linkExpires > at);
      if (row === undefined) { return null; }
      row.grantExpires = grant;
      return { authUserId: row.user, sessionDigest: Buffer.from(row.session, "hex"), clientKind: "web" };
    },
    async activeGrant(session, user, at) {
      const row = rows.find((r) => r.session === session.toString("hex") && r.user === user &&
        r.grantExpires !== null && r.grantExpires > at);
      return row === undefined ? null : { expiresAtMs: row.grantExpires! };
    },
    async hasPendingLink(session, user, at) {
      return rows.some((r) => r.session === session.toString("hex") && r.user === user &&
        r.grantExpires === null && r.linkExpires > at);
    },
    async record(event) { audit.push(event); },
    async purge() { return 0; },
  };
  const limiter: MutationRateLimiter = {
    async consume(subject, scope) {
      const key = `${scope}|${subject}`;
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      if (scope.startsWith("step-up-email") && next > limit) { throw new MutationRateLimitExceeded(60); }
    },
  };
  let tokenIndex = 0;
  const service = new StepUpService(store, { async sendStepUp(mail) { mails.push(mail); } }, limiter, {
    linkOrigin: "https://club.example", nowMs: () => now,
    newLinkToken: () => `${String(tokenIndex++).padStart(2, "0")}${"t".repeat(41)}`,
  });
  return { service, mails, audit, advance(ms: number) { now += ms; } };
}

const session = { sessionId: "session-a", authUserId: "userA", email: "a@example.test", emailVerified: true };
const tokenOf = (mail: StepUpEmail | undefined) => new URL(mail?.url ?? "https://x.invalid/").searchParams.get("step-up");

describe("step-up policy", () => {
  it("lists each dangerous route once and matches only exact patterns and methods", () => {
    const keys = STEP_UP_ROUTES.map((route) => `${route.method} ${route.url}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(stepUpPolicyFor("post", "/v1/administrator-grants")?.audience).toBe("administrator");
    expect(stepUpPolicyFor("GET", "/v1/administrator-grants")).toBeNull();
    expect(stepUpPolicyFor("POST", "/v1/native/tournaments/:tournamentId/actions/delete")?.audience).toBe("account");
    expect(stepUpPolicyFor("POST", "/v1/native/tournaments/:tournamentId/actions/enter-race")).toBeNull();
    expect(stepUpPolicyFor("POST", undefined)).toBeNull();
    expect(stepUpRequiredBody(600)).toMatchObject({ statusCode: 403, code: "step_up_required" });
  });
});

describe("step-up service", () => {
  it("sends the link to the own address and confirms once, for the asking session only", async () => {
    const { service, mails, advance } = harness();
    await service.request(session, "web");
    expect(mails[0]).toMatchObject({ email: "a@example.test", clientKind: "web", expiresInMinutes: 10 });
    expect(new URL(mails[0]!.url).origin).toBe("https://club.example");
    const token = tokenOf(mails[0]);
    expect(await service.status(session)).toMatchObject({ active: false, pending: true });
    expect(await service.inspectLink(token)).not.toBeNull();
    expect(await service.confirmLink(token)).not.toBeNull();
    expect(await service.confirmLink(token)).toBeNull();
    expect(await service.authorize(session, "/v1/administrator-grants")).toBe(true);
    expect(await service.authorize({ ...session, sessionId: "session-b" }, "/v1/administrator-grants")).toBe(false);
    expect(await service.authorize({ ...session, authUserId: "userB" }, "/v1/administrator-grants")).toBe(false);
    advance(600_001);
    expect(await service.authorize(session, "/v1/administrator-grants")).toBe(false);
  });

  it("refuses an expired or superseded link and an unverified address", async () => {
    const { service, mails, advance } = harness();
    await service.request(session, "web");
    await service.request(session, "web");
    expect(await service.confirmLink(tokenOf(mails[0]))).toBeNull();
    advance(600_001);
    expect(await service.confirmLink(tokenOf(mails[1]))).toBeNull();
    expect(await service.confirmLink("x")).toBeNull();
    await expect(service.request({ ...session, emailVerified: false }, "web")).rejects.toBeInstanceOf(StepUpUnavailable);
  });

  it("reports the rate limit and audits it", async () => {
    const { service, audit } = harness(1);
    await service.request(session, "native");
    await expect(service.request(session, "native")).rejects.toBeInstanceOf(StepUpRateLimited);
    expect(audit.map((event) => event.kind)).toContain("step_up_rate_limited");
  });

  it("accepts only a window between one minute and one hour", () => {
    const { service } = harness();
    expect(service.windowSeconds).toBe(600);
    const store = {} as StepUpStore;
    const limiter = { consume: async () => undefined };
    for (const windowSeconds of [59, 3_601, 1.5]) {
      expect(() => new StepUpService(store, { sendStepUp: async () => undefined }, limiter,
        { linkOrigin: "https://club.example", windowSeconds })).toThrow();
    }
  });
});
