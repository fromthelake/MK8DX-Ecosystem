import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { budgetRecipient } from "../src/authentication/auth-email-budgets.js";
import {
  registerEmbeddedAuthRoutes,
  type EmbeddedPasswordlessAuth,
} from "../src/authentication/embedded-passwordless-auth.js";
import {
  ABUSE_BUDGET_DEFINITIONS,
  AbuseBudgetConfigurationError,
  AbuseBudgets,
  defaultAbuseBudgetSettings,
  readAbuseBudgetSettings,
  recipientSubject,
  targetSubject,
} from "../src/security/abuse-budgets.js";
import { MutationRateLimitExceeded } from "../src/security/mysql-mutation-rate-limiter.js";

describe("H1 budget settings", () => {
  it("has a finite default for every budget and reads overrides", () => {
    const defaults = defaultAbuseBudgetSettings();
    for (const [name, definition] of Object.entries(ABUSE_BUDGET_DEFINITIONS)) {
      expect(definition.env.startsWith("MK8DX_HOSTED_BUDGET_")).toBe(true);
      expect(defaults[name as keyof typeof defaults].maximum).toBe(definition.fallback);
      expect(definition.fallback).toBeGreaterThan(0);
    }
    const read = readAbuseBudgetSettings({ MK8DX_HOSTED_BUDGET_CLAIM_REQUESTS_PER_HOUR: "42" });
    expect(read.claimRequestsPerHour).toEqual({ windowSeconds: 3_600, maximum: 42 });
  });

  it("refuses unknown names, zero, negative, huge and non-numeric values (no 'unlimited')", () => {
    for (const value of ["0", "-1", "1000001", "lots", "1e3", " 5"]) {
      expect(() => readAbuseBudgetSettings({ MK8DX_HOSTED_BUDGET_MUTATIONS_PER_MINUTE: value }))
        .toThrow(AbuseBudgetConfigurationError);
    }
    expect(() => readAbuseBudgetSettings({ MK8DX_HOSTED_BUDGET_TYPO_PER_HOUR: "5" }))
      .toThrow(/not a known budget setting/);
  });

  it("never uses a target id or an address as the limiter subject", () => {
    const subject = targetSubject("player", "player.someone_with_a_long_name");
    expect(subject).toMatch(/^target\.[0-9a-f]{40}$/);
    expect(subject).not.toContain("someone");
    const key = Buffer.alloc(32, 7);
    expect(recipientSubject(key, "a@example.org")).toMatch(/^recipient\.[0-9a-f]{40}$/);
    expect(recipientSubject(key, "a@example.org")).not.toBe(recipientSubject(Buffer.alloc(32, 8), "a@example.org"));
    expect(budgetRecipient(" A@Example.ORG ")).toBe("a@example.org");
    expect(budgetRecipient("no-at-sign")).toBeNull();
  });

  it("gives administrators a higher, still finite backstop and ignores anonymous callers", async () => {
    const calls: string[] = [];
    const budgets = new AbuseBudgets({
      async consume(subject, scope, _window, maximum) { calls.push(`${subject}|${scope}|${String(maximum)}`); },
    });
    await budgets.mutation({ role: "anonymous" });
    await budgets.mutation({ role: "account", userAccountId: "user_account.a" });
    await budgets.mutation({ role: "administrator", userAccountId: "user_account.b" });
    expect(calls).toEqual([
      "user_account.a|api-mutations.account.10m|600",
      "user_account.a|api-mutations.account.day|10000",
      "installation|api-mutations.installation.minute|6000",
      "user_account.b|api-mutations.administrator.10m|3000",
      "user_account.b|api-mutations.administrator.day|30000",
      "installation|api-mutations.installation.minute|6000",
    ]);
  });
});

describe("H1 sign-in mail budget at the auth bridge", () => {
  async function bridge(refuse: "email" | "device" | null) {
    const seen: string[] = [];
    let forwarded = 0;
    const auth = {
      clientAddress: { headerNames: ["x-real-ip"], async resolve() { return "198.51.100.4"; } },
      async handler() { forwarded += 1; return new Response("{}", { status: 200, headers: { "content-type": "application/json" } }); },
    } as unknown as EmbeddedPasswordlessAuth;
    const app = Fastify();
    await registerEmbeddedAuthRoutes(app, auth, "https://mk8dx.example", false, {
      async email(_request: unknown, recipient: string | null) {
        seen.push(`email:${String(recipient)}`);
        if (refuse === "email") { throw new MutationRateLimitExceeded(321); }
      },
      async deviceCode() {
        seen.push("device");
        if (refuse === "device") { throw new MutationRateLimitExceeded(12); }
      },
    } as never);
    return { app, seen, forwarded: () => forwarded };
  }

  it("counts sign-in, change-of-address and verification mail with the normalized recipient", async () => {
    const { app, seen, forwarded } = await bridge(null);
    await app.inject({ method: "POST", url: "/api/auth/sign-in/magic-link", payload: { email: " New@Example.org" } });
    await app.inject({ method: "POST", url: "/api/auth/change-email", payload: { newEmail: "b@example.org" } });
    await app.inject({ method: "POST", url: "/api/auth/send-verification-email", payload: { email: "c@example.org" } });
    await app.inject({ method: "POST", url: "/api/auth/device/code", payload: { client_id: "x" } });
    await app.inject({ method: "POST", url: "/api/auth/sign-out", payload: {} });
    await app.inject({ method: "GET", url: "/api/auth/get-session" });
    expect(seen).toEqual(["email:new@example.org", "email:b@example.org", "email:c@example.org", "device"]);
    expect(forwarded()).toBe(6);
  });

  it("answers 429 with Retry-After and never reaches Better Auth when a budget is spent", async () => {
    const mail = await bridge("email");
    const refused = await mail.app.inject({ method: "POST", url: "/api/auth/sign-in/magic-link", payload: { email: "v@example.org" } });
    expect(refused.statusCode).toBe(429);
    expect(refused.headers["retry-after"]).toBe("321");
    expect(refused.json()).toMatchObject({ code: "auth_rate_limited" });
    expect(mail.forwarded()).toBe(0);
    const device = await bridge("device");
    const code = await device.app.inject({ method: "POST", url: "/api/auth/device/code", payload: {} });
    expect(code.statusCode).toBe(429);
    expect(code.headers["retry-after"]).toBe("12");
    expect(device.forwarded()).toBe(0);
  });
});
