import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Ajv } from "ajv";

import { buildApp } from "../src/app.js";
import {
  DEVICE_INVITATION_HOURLY_LIMIT,
  DEVICE_INVITATION_PATH,
  deviceInvitationResponseSchema,
  qrMatrix,
} from "../src/authentication/device-invitation-routes.js";
import type { ActorContext, IdentityReadRepository } from "../src/identity/types.js";
import {
  MutationRateLimitExceeded,
  type MutationRateLimiter,
} from "../src/security/mysql-mutation-rate-limiter.js";
import { OfflineInvitationTicketError } from "../src/authentication/offline-invitation-ticket.js";

class NullIdentityReads implements IdentityReadRepository {
  async findPublicPlayerById(): Promise<null> { return null; }
  async findUserAccountSummaryById(): Promise<null> { return null; }
  async findPlayerClaimSummaryById(): Promise<null> { return null; }
}

const origin = "https://192.168.1.20";
const player = { role: "account" as const, userAccountId: "user_account.player_01" };
const token = "A".repeat(43);
const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

class CountingLimiter implements MutationRateLimiter {
  public readonly calls: string[] = [];
  public constructor(private readonly maximum = Number.POSITIVE_INFINITY) {}
  async consume(subject: string, scope: string, windowSeconds: number, maximum: number): Promise<void> {
    this.calls.push(`${scope}|${subject}|${String(windowSeconds)}|${String(maximum)}`);
    if (this.calls.length > this.maximum) { throw new MutationRateLimitExceeded(42); }
  }
}

async function app(options: Readonly<{
  actor: ActorContext;
  offline?: boolean;
  issueOwn?: (actor: ActorContext) => Promise<{ invitationId: string; token: string; expiresAtMs: number }>;
  limiter?: MutationRateLimiter;
  csrf?: boolean;
}>): Promise<{ instance: FastifyInstance; issued: ActorContext[] }> {
  const issued: ActorContext[] = [];
  const instance = await buildApp({
    identityRepository: new NullIdentityReads(),
    resolveActor: async () => options.actor,
    ...(options.offline === false ? {} : {
      deviceInvitations: {
        origin,
        rateLimiter: options.limiter ?? new CountingLimiter(),
        tickets: {
          async issueOwn(actor: ActorContext) {
            issued.push(actor);
            return options.issueOwn === undefined
              ? { invitationId: "offline_invitation.x", token, expiresAtMs: 1_900_000_900_000 }
              : await options.issueOwn(actor);
          },
        },
        ...(options.csrf === undefined ? {} : {
          csrfVerifier: { verify: (_actor: ActorContext, proof: string) => options.csrf === true && proof === "proof" },
        }),
      },
    }),
  });
  openApps.push(instance);
  return { instance, issued };
}

describe("add another device (ADR-0224 phase 1)", () => {
  it("issues a card for the session's own account with a bounded, closed response", async () => {
    const limiter = new CountingLimiter();
    const { instance, issued } = await app({ actor: player, limiter });
    const response = await instance.inject({ method: "POST", url: DEVICE_INVITATION_PATH, payload: {} });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const document = response.json() as Record<string, unknown>;
    expect(Object.keys(document).sort()).toEqual(["expiresAtMs", "invitationUrl", "qr", "schemaVersion"]);
    expect(document).toMatchObject({
      schemaVersion: "mk8dx.device-invitation.v1",
      invitationUrl: `${origin}/offline-invite#token=${token}`,
      expiresAtMs: 1_900_000_900_000,
    });
    const qr = document["qr"] as { size: number; modules: string };
    expect(qr.modules).toHaveLength(qr.size * qr.size);
    expect(qr).toEqual(qrMatrix(`${origin}/offline-invite#token=${token}`));
    expect(new Ajv({ strict: false }).validate(deviceInvitationResponseSchema, document)).toBe(true);
    expect(issued).toEqual([player]);
    expect(limiter.calls).toEqual([
      `device-invitations-hour|${player.userAccountId}|3600|${String(DEVICE_INVITATION_HOURLY_LIMIT)}`,
    ]);
    expect(response.body).not.toMatch(/user_account|offline_account|offline_invitation\.|email/);
  });

  it("takes no target: any body field is refused before anything is issued", async () => {
    const { instance, issued } = await app({ actor: player });
    for (const payload of [{ accountKey: "offline_account.x" }, { role: "administrator" }, [1]]) {
      const response = await instance.inject({ method: "POST", url: DEVICE_INVITATION_PATH, payload });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: "device_invitation_invalid" });
    }
    expect(issued).toEqual([]);
  });

  it("refuses visitors with 401 and administrators with 403", async () => {
    const visitor = await app({ actor: { role: "anonymous" } });
    const anonymous = await visitor.instance.inject({ method: "POST", url: DEVICE_INVITATION_PATH });
    expect(anonymous.statusCode).toBe(401);
    expect(visitor.issued).toEqual([]);
    const administrator = await app({
      actor: { role: "administrator", userAccountId: "user_account.admin_01" },
    });
    const refused = await administrator.instance.inject({ method: "POST", url: DEVICE_INVITATION_PATH });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: "device_invitation_forbidden" });
    expect(administrator.issued).toEqual([]);
  });

  it("is not offered at all in an email-link installation", async () => {
    const { instance } = await app({ actor: player, offline: false });
    const response = await instance.inject({ method: "POST", url: DEVICE_INVITATION_PATH, payload: {} });
    expect(response.statusCode).toBe(404);
  });

  it("requires the CSRF proof when the installation has one", async () => {
    const { instance, issued } = await app({ actor: player, csrf: true });
    const missing = await instance.inject({ method: "POST", url: DEVICE_INVITATION_PATH, payload: {} });
    expect(missing.statusCode).toBe(403);
    expect(missing.json()).toMatchObject({ code: "device_invitation_csrf_invalid" });
    const wrong = await instance.inject({ method: "POST", url: DEVICE_INVITATION_PATH, payload: {},
      headers: { "x-mk8dx-csrf": "nope" } });
    expect(wrong.statusCode).toBe(403);
    expect(issued).toEqual([]);
    const good = await instance.inject({ method: "POST", url: DEVICE_INVITATION_PATH, payload: {},
      headers: { "x-mk8dx-csrf": "proof" } });
    expect(good.statusCode).toBe(200);
  });

  it("is rate-limited like other account writes", async () => {
    const { instance, issued } = await app({ actor: player, limiter: new CountingLimiter(1) });
    expect((await instance.inject({ method: "POST", url: DEVICE_INVITATION_PATH })).statusCode).toBe(200);
    const limited = await instance.inject({ method: "POST", url: DEVICE_INVITATION_PATH });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("42");
    expect(limited.json()).toMatchObject({ code: "device_invitation_rate_limited" });
    expect(issued).toHaveLength(1);
  });

  it("maps a refused or unavailable account without detail", async () => {
    const cases = [
      [new OfflineInvitationTicketError("forbidden"), 403],
      [new OfflineInvitationTicketError("unavailable"), 404],
      [new Error("pool"), 503],
    ] as const;
    for (const [error, status] of cases) {
      const { instance } = await app({ actor: player, issueOwn: async () => { throw error; } });
      const response = await instance.inject({ method: "POST", url: DEVICE_INVITATION_PATH });
      expect(response.statusCode).toBe(status);
      expect(response.body).not.toMatch(/pool/);
    }
  });

  it("refuses a non-HTTPS origin at startup", async () => {
    await expect(buildApp({
      identityRepository: new NullIdentityReads(),
      resolveActor: async () => player,
      deviceInvitations: {
        origin: "http://192.168.1.20", rateLimiter: new CountingLimiter(),
        tickets: { issueOwn: async () => ({ invitationId: "x", token, expiresAtMs: 1 }) },
      },
    })).rejects.toThrow(/HTTPS/);
  });
});
