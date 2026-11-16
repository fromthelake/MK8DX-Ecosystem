import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { APIError } from "better-auth/api";

import { buildApp } from "../src/app.js";
import {
  NATIVE_INVITATION_PREVIEW_PATH,
  NATIVE_INVITATION_REDEEM_PATH,
  type NativeInvitationAuthApi,
} from "../src/authentication/native-invitation-routes.js";
import type { IdentityReadRepository } from "../src/identity/types.js";
import {
  MutationRateLimitExceeded,
  type MutationRateLimiter,
} from "../src/security/mysql-mutation-rate-limiter.js";
import { PreAuthBudget } from "../src/security/pre-auth-budget.js";

class NullIdentityReads implements IdentityReadRepository {
  async findPublicPlayerById(): Promise<null> { return null; }
  async findUserAccountSummaryById(): Promise<null> { return null; }
  async findPlayerClaimSummaryById(): Promise<null> { return null; }
}

const origin = "https://192.168.1.20";
const token = "A".repeat(43);
const device = "D".repeat(43);
const now = 1_900_000_000_000;
const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

class CountingLimiter implements MutationRateLimiter {
  public readonly calls: string[] = [];
  public constructor(private readonly maximum = Number.POSITIVE_INFINITY) {}
  async consume(_subject: string, scope: string, windowSeconds: number, maximum: number): Promise<void> {
    this.calls.push(`${scope}|${String(windowSeconds)}|${String(maximum)}`);
    if (this.calls.length > this.maximum) { throw new MutationRateLimitExceeded(42); }
  }
}

async function app(api: Partial<NativeInvitationAuthApi>, limiter: MutationRateLimiter = new CountingLimiter(),
                   registered = true) {
  const presented: string[] = [];
  const instance = await buildApp({
    identityRepository: new NullIdentityReads(),
    ...(registered ? {
      nativeInvitations: {
        origin,
        nowMs: () => now,
        preAuthBudget: new PreAuthBudget(limiter, Buffer.alloc(32, 7)),
        api: {
          async previewOfflineInvitationNative(input) {
            presented.push(input.body.token);
            if (api.previewOfflineInvitationNative) { return api.previewOfflineInvitationNative(input); }
            return { displayLabel: "Oma" };
          },
          async redeemOfflineInvitationNative(input) {
            presented.push(input.body.token);
            if (api.redeemOfflineInvitationNative) { return api.redeemOfflineInvitationNative(input); }
            return { token: "S".repeat(32), expiresAtMs: now + 7 * 86_400_000 };
          },
        },
      },
    } : {}),
  });
  openApps.push(instance);
  return { instance, presented };
}

const nativeHeaders = { "content-type": "application/json", "x-mk8dx-account-device": device };

describe("native sign-in card routes", () => {
  it("redeems a card for the app and answers a bearer session, never a cookie", async () => {
    const { instance, presented } = await app({});
    const response = await instance.inject({ method: "POST", url: NATIVE_INVITATION_REDEEM_PATH,
      headers: nativeHeaders, payload: { token, origin } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ schemaVersion: "mk8dx.native-invitation-session.v1",
      token: "S".repeat(32), expiresIn: 7 * 86_400 });
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(presented).toEqual([token]);
  });

  it("previews who the card signs in as", async () => {
    const { instance } = await app({});
    const response = await instance.inject({ method: "POST", url: NATIVE_INVITATION_PREVIEW_PATH,
      headers: nativeHeaders, payload: { token, origin } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ schemaVersion: "mk8dx.native-invitation-preview.v1", displayLabel: "Oma" });
  });

  it("refuses browsers, cookies, signed-in callers and requests without the app device header", async () => {
    const { instance, presented } = await app({});
    for (const headers of [
      { ...nativeHeaders, origin },
      { ...nativeHeaders, origin: "https://evil.example" },
      { ...nativeHeaders, cookie: "mk8dx.session_token=x" },
      { ...nativeHeaders, authorization: `Bearer ${"B".repeat(32)}` },
      { "content-type": "application/json" },
      { ...nativeHeaders, "x-mk8dx-account-device": "short" },
    ]) {
      const response = await instance.inject({ method: "POST", url: NATIVE_INVITATION_REDEEM_PATH,
        headers, payload: { token, origin } });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: "native_invitation_forbidden" });
    }
    expect(presented).toEqual([]);
  });

  it("refuses a card printed for another installation before it is presented", async () => {
    const { instance, presented } = await app({});
    for (const other of ["https://192.168.1.21", "http://192.168.1.20", "https://192.168.1.20:8443", `${origin}/`]) {
      const response = await instance.inject({ method: "POST", url: NATIVE_INVITATION_REDEEM_PATH,
        headers: nativeHeaders, payload: { token, origin: other } });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: "native_invitation_origin_invalid" });
    }
    expect(presented).toEqual([]);
  });

  it("rejects malformed bodies without echoing the token", async () => {
    const { instance, presented } = await app({});
    const secret = "Z".repeat(42);
    for (const payload of [{ token: secret, origin }, { token, origin, extra: 1 }, { token }]) {
      const response = await instance.inject({ method: "POST", url: NATIVE_INVITATION_REDEEM_PATH,
        headers: nativeHeaders, payload });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain(secret);
    }
    expect(presented).toEqual([]);
  });

  it("answers a used, expired or unknown card the same way", async () => {
    const { instance } = await app({
      async redeemOfflineInvitationNative() {
        throw new APIError("UNAUTHORIZED", { code: "offline_invitation_unavailable" });
      },
    });
    const response = await instance.inject({ method: "POST", url: NATIVE_INVITATION_REDEEM_PATH,
      headers: nativeHeaders, payload: { token, origin } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "native_invitation_unavailable" });
    expect(response.body).not.toContain(token);
  });

  it("passes the card's own limits through as 429 with Retry-After", async () => {
    const { instance } = await app({
      async redeemOfflineInvitationNative() {
        throw new APIError("TOO_MANY_REQUESTS", { code: "offline_invitation_rate_limited" }, { "Retry-After": "77" });
      },
    });
    const response = await instance.inject({ method: "POST", url: NATIVE_INVITATION_REDEEM_PATH,
      headers: nativeHeaders, payload: { token, origin } });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ code: "native_invitation_rate_limited" });
    expect(response.headers["retry-after"]).toBe("77");
  });

  it("spends the per-address budget before anything else", async () => {
    const limiter = new CountingLimiter(1);
    const { instance, presented } = await app({}, limiter);
    const first = await instance.inject({ method: "POST", url: NATIVE_INVITATION_REDEEM_PATH,
      headers: nativeHeaders, payload: { token, origin } });
    expect(first.statusCode).toBe(200);
    const second = await instance.inject({ method: "POST", url: NATIVE_INVITATION_REDEEM_PATH,
      headers: nativeHeaders, payload: { token, origin: "https://192.168.1.21" } });
    expect(second.statusCode).toBe(429);
    expect(second.headers["retry-after"]).toBe("42");
    expect(limiter.calls).toEqual(["native-invitation-preauth|60|60", "native-invitation-preauth|60|60"]);
    expect(presented).toEqual([token]);
  });

  it("is absent where the installation has no offline invitations", async () => {
    const { instance } = await app({}, new CountingLimiter(), false);
    const response = await instance.inject({ method: "POST", url: NATIVE_INVITATION_REDEEM_PATH,
      headers: nativeHeaders, payload: { token, origin } });
    expect(response.statusCode).toBe(404);
  });
});
