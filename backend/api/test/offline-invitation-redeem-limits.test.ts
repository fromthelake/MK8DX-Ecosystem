import { randomBytes } from "node:crypto";

import Fastify from "fastify";
import { memoryAdapter, type MemoryDB } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";

import {
  createEmbeddedPasswordlessAuth,
  MK8DX_ANDROID_CLIENT_ID,
  registerEmbeddedAuthRoutes,
} from "../src/authentication/embedded-passwordless-auth.js";
import { OFFLINE_INVITATION_REDEEM_LIMITS } from "../src/authentication/offline-invitation-auth-plugin.js";
import type { OfflineInvitationTicketService } from "../src/authentication/offline-invitation-ticket.js";
import {
  MutationRateLimitExceeded,
  type MutationRateLimiter,
} from "../src/security/mysql-mutation-rate-limiter.js";

const origin = "https://lan.example.test";

/** Fixed-window limiter on a frozen clock, so window boundaries cannot make the test flaky. */
class MemoryLimiter implements MutationRateLimiter {
  public readonly counts = new Map<string, number>();
  public async consume(subject: string, scope: string, windowSeconds: number, maximum: number) {
    const key = `${scope}|${subject}`;
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    if (count > maximum) { throw new MutationRateLimitExceeded(windowSeconds); }
  }
}

const newToken = () => randomBytes(32).toString("base64url");

async function harness() {
  const database: MemoryDB = {
    mk8dx_auth_user: [], mk8dx_auth_session: [], mk8dx_auth_account: [],
    mk8dx_auth_verification: [], mk8dx_auth_rate_limit: [], mk8dx_auth_device_code: [],
  };
  const cards = new Set<string>();
  const tickets = {
    async redeem(token: string) {
      if (!cards.delete(token)) { throw new Error("unavailable"); }
      return { accountKey: "offline_account.dee", userAccountId: "user_account.dee",
        authEmail: "dee@accounts.mk8dx.invalid", role: "account" as const, active: true };
    },
  } as unknown as OfflineInvitationTicketService;
  const limiter = new MemoryLimiter();
  const auth = createEmbeddedPasswordlessAuth(
    memoryAdapter(database),
    {
      baseUrl: origin, production: true, trustedOrigins: [origin],
      secrets: [{ version: 1, value: randomBytes(32).toString("base64") }],
      nativeClientIds: [MK8DX_ANDROID_CLIENT_ID], clientIpHeaders: ["x-real-ip"],
      trustedProxyAddresses: ["127.0.0.1"],
    },
    { async sendMagicLink() { throw new Error("offline mail forbidden"); } },
    { async record() {} },
    undefined,
    { origin, tickets, async bindAccount() {}, attempts: { limiter, tokenKey: Buffer.alloc(32, 9) } },
  );
  const app = Fastify({ logger: false });
  await registerEmbeddedAuthRoutes(app, auth, origin, true);
  await app.ready();
  // Every request arrives through the trusted gateway; the client address is
  // what Caddy forwards (on Docker Desktop: the same address for everybody).
  const redeem = (token: string, client = "172.27.0.1") => app.inject({
    method: "POST", url: "/api/auth/offline-invitation/redeem", remoteAddress: "127.0.0.1",
    headers: { origin, "content-type": "application/json", "x-real-ip": client },
    payload: { token },
  });
  const issue = () => { const token = newToken(); cards.add(token); return token; };
  return { app, database, limiter, redeem, issue };
}

describe("offline invitation redemption limits", () => {
  it("lets 20 different cards in within a minute from one shared address", async () => {
    const h = await harness();
    try {
      for (let card = 0; card < 20; card += 1) {
        const response = await h.redeem(h.issue());
        expect(response.statusCode).toBe(200);
      }
    } finally { await h.app.close(); }
  });

  it("answers 429 when one card is hammered, without affecting other cards", async () => {
    const h = await harness();
    try {
      const card = h.issue();
      expect((await h.redeem(card)).statusCode).toBe(200);
      for (let attempt = 1; attempt < OFFLINE_INVITATION_REDEEM_LIMITS.perToken.maximum; attempt += 1) {
        expect((await h.redeem(card)).statusCode).toBe(401);
      }
      const limited = await h.redeem(card);
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toMatchObject({ code: "offline_invitation_rate_limited" });
      expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
      expect((await h.redeem(h.issue())).statusCode).toBe(200);
      // Only keyed hashes are stored as bucket subjects, never the token itself.
      for (const key of h.limiter.counts.keys()) { expect(key).not.toContain(card); }
    } finally { await h.app.close(); }
  });

  it("throttles invalid tokens: a repeated one by its hash, random ones per address", async () => {
    const h = await harness();
    try {
      const unknown = newToken();
      for (let attempt = 0; attempt < OFFLINE_INVITATION_REDEEM_LIMITS.perToken.maximum; attempt += 1) {
        expect((await h.redeem(unknown, "192.168.0.50")).statusCode).toBe(401);
      }
      expect((await h.redeem(unknown, "192.168.0.50")).statusCode).toBe(429);
      expect((await h.redeem("not-even-a-token", "192.168.0.51")).statusCode).toBe(401);
      let limited = 0;
      for (let attempt = 0; attempt < OFFLINE_INVITATION_REDEEM_LIMITS.perAddress.max + 2; attempt += 1) {
        if ((await h.redeem(newToken(), "192.168.0.52")).statusCode === 429) { limited += 1; }
      }
      expect(limited).toBeGreaterThan(0);
    } finally { await h.app.close(); }
  });

  it("caps redemption attempts across all clients", async () => {
    const h = await harness();
    try {
      const { maximum } = OFFLINE_INVITATION_REDEEM_LIMITS.global;
      for (let attempt = 0; attempt < maximum; attempt += 1) {
        // Spread over many addresses so no per-address bucket is the one that trips.
        const response = await h.redeem(newToken(), `10.0.${Math.floor(attempt / 10)}.${attempt % 10 + 1}`);
        expect(response.statusCode).toBe(401);
      }
      const capped = await h.redeem(h.issue(), "10.9.9.9");
      expect(capped.statusCode).toBe(429);
      expect(capped.json()).toMatchObject({ code: "offline_invitation_rate_limited" });
    } finally { await h.app.close(); }
  });
});
