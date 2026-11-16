import { afterAll, beforeAll, describe, expect, it } from "vitest";

import Fastify from "fastify";

import { MK8DX_TOURNAMENT_DESKTOP_CLIENT_ID } from "../src/authentication/embedded-passwordless-auth.js";
import {
  createPasswordlessHostedRuntime,
  type PasswordlessHostedRuntime,
  type PasswordlessHostedRuntimeConfig,
} from "../src/composition/hosted-runtime.js";
import {
  isMutatingMethod,
  mutationBackstopCovers,
  recordRegisteredRoutes,
  registeredRoutes,
  type RegisteredRoute,
} from "../src/security/request-budget-coverage.js";
import { STEP_UP_ROUTES, stepUpPolicyFor } from "../src/security/step-up-policy.js";

// Every mutating route (and every step-up protected read) of the real hosted composition must be
// covered by a durable request budget, or be named below with its reason. This replaces CodeQL's
// js/missing-rate-limiting heuristic (excluded in .github/codeql/codeql-config.yml), which cannot see
// the database-backed limiter. The reasons match docs/architecture/MUTATING_ROUTES.md.
//
// Covered means one of:
// - the general signed-in backstop of app.ts: every POST/PUT/PATCH/DELETE under /v1/ for a signed-in
//   caller (`mutationBackstopCovers`, the predicate the backstop hook itself uses);
// - a budget the route declares next to the code that spends it (`config.requestBudget`): "pre-auth"
//   for routes reachable before sign-in (client-address slots, security/pre-auth-budget.ts), "route"
//   for a durable budget of its own.
// The backstop counts only signed-in callers, so it never covers a route in BEFORE_SIGN_IN: those must
// declare a budget or be allowlisted. A route outside /v1/ is never counted by the backstop.

type AllowlistEntry = Readonly<{ method: string; url: string; reason: string }>;

/** Mutating /v1 routes that answer a caller without a session (MUTATING_ROUTES.md, Session and sign-in). */
const BEFORE_SIGN_IN: readonly string[] = [
  "POST /v1/native/device-authorization/email",
  "POST /v1/native/device-authorization/email/link",
  "POST /v1/native/device-authorization/email/verify",
  "POST /v1/session/account-switch",
  "POST /v1/session/native-account-switch",
  "POST /v1/session/native-forget",
  "POST /v1/session/native-invitation-preview",
  "POST /v1/session/native-invitation-redeem",
  "POST /v1/session/native-remember",
  "POST /v1/session/step-up/link",
];

const ALLOWLIST: readonly AllowlistEntry[] = [
  {
    method: "POST", url: "/api/auth/*",
    reason: "Better Auth: its own per-address limiter, and before any mail or device code the auth-email "
      + "budgets (per address slot, per recipient, installation) - MUTATING_ROUTES.md, Session and sign-in",
  },
  {
    method: "POST", url: "/v1/native/device-authorization/email/link",
    reason: "anyone with the link: a single-use, server-generated link token of a pending device code "
      + "whose mail was budgeted when it was sent - MUTATING_ROUTES.md, Session and sign-in",
  },
  {
    method: "GET", url: "/v1/administrator/identity-links",
    reason: "step-up protected read: administrator only, reads are never counted (MUTATING_ROUTES.md, "
      + "Open items); a refusal for want of a confirmation is audited with its own bound",
  },
  {
    method: "GET", url: "/v1/native/administrator/identity-links",
    reason: "step-up protected read (app): administrator only, reads are never counted - MUTATING_ROUTES.md, "
      + "Fresh confirmation",
  },
];

const key = (route: Readonly<{ method: string; url: string }>): string => `${route.method} ${route.url}`;

/** Routes that need a budget: mutating methods and the step-up protected reads (HEAD follows GET). */
function needsBudget(route: RegisteredRoute): boolean {
  if (route.method === "HEAD") { return false; }
  return isMutatingMethod(route.method) || stepUpPolicyFor(route.method, route.url) !== null;
}

function covered(route: RegisteredRoute, beforeSignIn: readonly string[] = BEFORE_SIGN_IN): boolean {
  if (route.requestBudget !== null) { return true; }
  return !beforeSignIn.includes(key(route)) && mutationBackstopCovers(route.method, route.url);
}

/** Routes that need a budget and have neither a budget nor an allowlist entry. */
function unbudgetedRoutes(routes: readonly RegisteredRoute[],
                          allowlist: readonly AllowlistEntry[] = ALLOWLIST,
                          beforeSignIn: readonly string[] = BEFORE_SIGN_IN): string[] {
  const allowed = new Set(allowlist.map(key));
  return routes.filter((route) => needsBudget(route) && !covered(route, beforeSignIn) && !allowed.has(key(route)))
    .map(key).sort();
}

/** Listed routes (allowlist or before-sign-in list) that name no route of the given compositions. */
function staleEntries(routes: readonly RegisteredRoute[], listed: readonly string[]): string[] {
  const registered = new Set(routes.map(key));
  return listed.filter((entry) => !registered.has(entry)).sort();
}

const baseUrl = "https://club.example.test";
const catalogPath = new URL("../../../packages/assets/schema9-asset-catalog-v1.json", import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, "$1");

// Composing the runtime opens no database connection (local-runtime.ts); nothing here sends a request.
function hostedConfig(offlineLan: boolean): PasswordlessHostedRuntimeConfig {
  return {
    core: {
      mysql: { host: "127.0.0.1", port: 9, user: "unused", password: "unused", database: "unused_test",
        connectionLimit: 1 },
      schema9CatalogPath: catalogPath,
      authenticationKeys: { lookupHmacKey: Buffer.alloc(32, 41), lookupKeyVersion: "coverage-auth-v1" },
      timeTrialKeys: {
        encryptionKey: Buffer.alloc(32, 42), encryptionKeyVersion: "coverage-tt-enc-v1",
        lookupHmacKey: Buffer.alloc(32, 43), lookupKeyVersion: "coverage-tt-lookup-v1",
      },
      timeTrialDecryptionKeys: { "coverage-tt-enc-v1": Buffer.alloc(32, 42) },
      tournamentKeys: {
        encryptionKey: Buffer.alloc(32, 44), encryptionKeyVersion: "coverage-tournament-enc-v1",
        lookupHmacKey: Buffer.alloc(32, 45), lookupKeyVersion: "coverage-tournament-lookup-v1",
      },
      tournamentDecryptionKeys: { "coverage-tournament-enc-v1": Buffer.alloc(32, 44) },
    },
    authentication: {
      baseUrl,
      production: false,
      trustedOrigins: [baseUrl],
      secrets: [{ version: 1, value: "n1DLRIGl7jpbMj99RFVrBcMeOrBAvccvREek3FWYjzk=" }],
      nativeClientIds: [MK8DX_TOURNAMENT_DESKTOP_CLIENT_ID],
      clientIpHeaders: ["x-real-ip"],
      trustedProxyAddresses: [],
    },
    ...(offlineLan
      ? { offlineLan: true }
      : {
          smtp: {
            host: "smtp.example.test", port: 465, secure: true, username: "synthetic-user",
            password: "synthetic-password", fromAddress: "auth@example.test", allowedLinkOrigin: baseUrl,
          },
        }),
    webManual: {
      producerVersion: "request-budget-coverage",
      csrfKeys: { activeKeyVersion: "coverage-csrf-v1", keys: { "coverage-csrf-v1": Buffer.alloc(32, 46) } },
    },
  };
}

async function compose(offlineLan: boolean): Promise<PasswordlessHostedRuntime> {
  return createPasswordlessHostedRuntime(hostedConfig(offlineLan), () => ({
    async verify() {},
    async sendMagicLink() {},
    async sendStepUp() {},
    async sendNativeSignIn() {},
    close() {},
  }));
}

describe("request budget on every mutating route (real hosted composition)", () => {
  const runtimes: PasswordlessHostedRuntime[] = [];
  let routes: RegisteredRoute[] = [];

  beforeAll(async () => {
    // The e-mail installation and the offline LAN installation register different routes.
    for (const offlineLan of [false, true]) {
      const runtime = await compose(offlineLan);
      runtimes.push(runtime);
      await runtime.app.ready();
      routes.push(...registeredRoutes(runtime.app));
    }
    routes = [...new Map(routes.map((route) => [key(route), route])).values()];
  });

  afterAll(async () => {
    // The pool never connected; ending it may still report the refused address.
    for (const runtime of runtimes) { await runtime.close().catch(() => undefined); }
  });

  it("records the whole composition", () => {
    expect(routes.filter(needsBudget).length).toBeGreaterThan(150);
    expect(routes.map(key)).toEqual(expect.arrayContaining([
      "POST /v1/time-trial-submissions",
      "POST /v1/session/native-remember",
      "POST /v1/session/device-invitations",
      "POST /v1/native/device-authorization/email",
    ]));
    for (const policy of STEP_UP_ROUTES) { expect(routes.map(key)).toContain(key(policy)); }
  });

  it("covers every mutating route and step-up protected read with a budget or a reasoned allowlist entry", () => {
    expect(unbudgetedRoutes(routes)).toEqual([]);
  });

  it("declares a budget on every route reachable before sign-in", () => {
    const preAuth = routes.filter((route) => route.requestBudget === "pre-auth").map(key);
    // A route that spends the pre-sign-in budget is by definition reachable before sign-in.
    expect(preAuth.filter((entry) => !BEFORE_SIGN_IN.includes(entry))).toEqual([]);
    expect(preAuth.length).toBeGreaterThanOrEqual(6);
  });

  it("has no stale or redundant list entries", () => {
    expect(staleEntries(routes, ALLOWLIST.map(key))).toEqual([]);
    expect(staleEntries(routes, BEFORE_SIGN_IN)).toEqual([]);
    const redundant = ALLOWLIST.filter((entry) => {
      const route = routes.find((candidate) => key(candidate) === key(entry));
      return route !== undefined && (covered(route) || !needsBudget(route));
    }).map(key);
    expect(redundant).toEqual([]);
    for (const entry of ALLOWLIST) { expect(entry.reason).toContain("MUTATING_ROUTES.md"); }
  });
});

describe("request budget coverage check (self-test)", () => {
  it("fails for a new mutating route without a budget and accepts one that declares it", async () => {
    // A bare instance with the same recorder buildApp installs (buildApp's own instance has booted).
    const app = Fastify();
    recordRegisteredRoutes(app);
    try {
      app.post("/unbudgeted/dummy", async () => ({ ok: true }));
      app.delete("/unbudgeted/dummy/:id", async () => ({ ok: true }));
      app.post("/budgeted/dummy", { config: { requestBudget: "route" } }, async () => ({ ok: true }));
      app.post("/v1/dummy-signed-in-write", async () => ({ ok: true }));
      app.post("/v1/dummy-before-sign-in", async () => ({ ok: true }));
      app.post("/v1/dummy-before-sign-in-budgeted", { config: { requestBudget: "pre-auth" } },
        async () => ({ ok: true }));
      app.get("/unbudgeted/read", async () => ({ ok: true }));
      app.get("/v1/administrator/identity-links", async () => ({ ok: true }));
      await app.ready();
      const recorded = registeredRoutes(app);
      const beforeSignIn = ["POST /v1/dummy-before-sign-in", "POST /v1/dummy-before-sign-in-budgeted"];
      expect(unbudgetedRoutes(recorded, [], beforeSignIn)).toEqual([
        "DELETE /unbudgeted/dummy/:id",
        "GET /v1/administrator/identity-links",
        "POST /unbudgeted/dummy",
        "POST /v1/dummy-before-sign-in",
      ]);
      expect(unbudgetedRoutes(recorded, [
        { method: "POST", url: "/unbudgeted/dummy", reason: "test" },
      ], beforeSignIn)).not.toContain("POST /unbudgeted/dummy");
      expect(staleEntries(recorded, ["POST /v1/route-that-was-removed", "POST /budgeted/dummy"]))
        .toEqual(["POST /v1/route-that-was-removed"]);
    } finally {
      await app.close();
    }
  });

  it("uses the same predicate as the signed-in backstop", () => {
    expect(mutationBackstopCovers("POST", "/v1/aliases")).toBe(true);
    expect(mutationBackstopCovers("delete", "/v1/account/rivals")).toBe(true);
    expect(mutationBackstopCovers("GET", "/v1/aliases")).toBe(false);
    expect(mutationBackstopCovers("POST", "/api/auth/sign-in/magic-link")).toBe(false);
    expect(mutationBackstopCovers("POST", "/v1")).toBe(false);
  });
});
