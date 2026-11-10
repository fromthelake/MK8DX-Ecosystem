import Fastify from "fastify";
import { memoryAdapter, type MemoryDB } from "better-auth/adapters/memory";
import { fromNodeHeaders } from "better-auth/node";
import { describe, expect, it } from "vitest";

import {
  AccountSwitchPinHasher,
  AccountSwitchPins,
  deriveAccountSwitchKeys,
  type AccountSwitchPinStore,
  type AccountSwitchStore,
  type AccountSwitchTarget,
  type RememberedAccountRow,
  type StoredSwitchPin,
} from "../src/authentication/account-switch.js";
import { KEEP_REMEMBERED_HEADER } from "../src/authentication/account-switch-auth-plugin.js";
import {
  registerAccountSwitchRoutes,
  type AccountSwitchAuthApi,
} from "../src/authentication/account-switch-routes.js";
import {
  MK8DX_ANDROID_CLIENT_ID,
  createEmbeddedPasswordlessAuth,
  registerEmbeddedAuthRoutes,
  type EmbeddedAuthAuditEvent,
  type PasswordlessMagicLink,
} from "../src/authentication/embedded-passwordless-auth.js";
import type { ActorContext } from "../src/identity/types.js";
import {
  MutationRateLimitExceeded,
  type MutationRateLimiter,
} from "../src/security/mysql-mutation-rate-limiter.js";

const baseUrl = "https://mk8dx.example.test";
const secrets = [
  { version: 2, value: "n1DLRIGl7jpbMj99RFVrBcMeOrBAvccvREek3FWYjzk=" },
  { version: 1, value: "dCuH+LADr9EwzTFgybShWjgxzm5geZtQjmUNuu8ydqY=" },
];

class MemoryAccountSwitchStore implements AccountSwitchStore {
  public rows: Array<{ entryId: string; device: string; authUserId: string; lastUsedAtMs: number }> = [];
  public switchSessions = new Set<string>();
  public async remember(device: Buffer, authUserId: string, entryId: string, nowMs: number, maximum: number) {
    const key = device.toString("hex");
    const existing = this.rows.find((row) => row.device === key && row.authUserId === authUserId);
    if (existing === undefined) {
      this.rows.push({ entryId, device: key, authUserId, lastUsedAtMs: nowMs });
    } else { existing.lastUsedAtMs = Math.max(existing.lastUsedAtMs, nowMs); }
    const mine = this.rows.filter((row) => row.device === key).sort((a, b) => b.lastUsedAtMs - a.lastUsedAtMs);
    const drop = new Set(mine.slice(maximum).map((row) => row.entryId));
    this.rows = this.rows.filter((row) => !drop.has(row.entryId));
  }
  public async list(device: Buffer, notBeforeMs: number): Promise<readonly RememberedAccountRow[]> {
    const key = device.toString("hex");
    return this.rows.filter((row) => row.device === key && row.lastUsedAtMs >= notBeforeMs)
      .sort((a, b) => b.lastUsedAtMs - a.lastUsedAtMs)
      .map(({ entryId, authUserId, lastUsedAtMs }) => ({ entryId, authUserId, lastUsedAtMs }));
  }
  public async touch(device: Buffer, entryId: string, nowMs: number) {
    const row = this.rows.find((candidate) => candidate.entryId === entryId && candidate.device === device.toString("hex"));
    if (row !== undefined) { row.lastUsedAtMs = Math.max(row.lastUsedAtMs, nowMs); }
  }
  public async forget(device: Buffer, authUserId: string) {
    this.rows = this.rows.filter((row) => !(row.device === device.toString("hex") && row.authUserId === authUserId));
  }
  public async forgetEverywhere(authUserId: string) {
    this.rows = this.rows.filter((row) => row.authUserId !== authUserId);
  }
  public async forgetElsewhere(authUserId: string, keep: Buffer | null) {
    this.rows = this.rows.filter((row) => row.authUserId !== authUserId ||
      (keep !== null && row.device === keep.toString("hex")));
  }
  public async recordSwitchSession(sessionId: string) { this.switchSessions.add(sessionId); }
  public async isSwitchSession(sessionId: string) { return this.switchSessions.has(sessionId); }
}

class MemoryPinStore implements AccountSwitchPinStore {
  public pins = new Map<string, StoredSwitchPin>();
  public async get(id: string) { return this.pins.get(id) ?? null; }
  public async set(id: string, pin: StoredSwitchPin) { this.pins.set(id, pin); }
  public async clear(id: string) { this.pins.delete(id); }
}

class MemoryLimiter implements MutationRateLimiter {
  public counts = new Map<string, number>();
  public constructor(private readonly nowMs: () => number) {}
  public async consume(subject: string, scope: string, windowSeconds: number, maximum: number) {
    const started = Math.floor(this.nowMs() / (windowSeconds * 1_000));
    const key = `${scope}|${subject}|${String(started)}`;
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    if (count > maximum) { throw new MutationRateLimitExceeded(windowSeconds); }
  }
}

/** account -> who it is in the fake identity layer, keyed by e-mail. */
const people: Record<string, AccountSwitchTarget> = {
  "ann@example.test": { userAccountId: "user_account.ann", administrator: false, label: "Ann" },
  "bob@example.test": { userAccountId: "user_account.bob", administrator: false, label: "Bob" },
  "cy@example.test": { userAccountId: "user_account.cy", administrator: false, label: null },
  "dee@accounts.mk8dx.invalid": { userAccountId: "user_account.dee", administrator: false, label: "Dee" },
  "root@example.test": { userAccountId: "user_account.root", administrator: true, label: "Root" },
};

type Jar = Map<string, string>;

function absorb(jar: Jar, raw: unknown): void {
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  for (const line of list as string[]) {
    const [pair] = line.split(";", 1);
    const separator = pair!.indexOf("=");
    const name = pair!.slice(0, separator);
    const value = pair!.slice(separator + 1);
    if (/max-age=0/i.test(line) || value === "") { jar.delete(name); } else { jar.set(name, value); }
  }
}
const header = (jar: Jar): string => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

async function harness(offline = false) {
  let now = Date.now();
  const nowMs = () => now;
  const database: MemoryDB = {
    mk8dx_auth_user: [], mk8dx_auth_session: [], mk8dx_auth_account: [],
    mk8dx_auth_verification: [], mk8dx_auth_rate_limit: [], mk8dx_auth_device_code: [],
  };
  const links: PasswordlessMagicLink[] = [];
  const audit: EmbeddedAuthAuditEvent[] = [];
  const store = new MemoryAccountSwitchStore();
  const pinStore = new MemoryPinStore();
  const limiter = new MemoryLimiter(nowMs);
  const keys = deriveAccountSwitchKeys(secrets);
  const pins = new AccountSwitchPins(pinStore, new AccountSwitchPinHasher(keys), limiter);
  const emailOf = (authUserId: string): string | undefined =>
    (database["mk8dx_auth_user"] as Array<{ id: string; email: string }>)
      .find((user) => user.id === authUserId)?.email;
  const directory = {
    async resolve(authUserId: string) {
      const email = emailOf(authUserId);
      return email === undefined ? null : people[email] ?? null;
    },
  };
  const auth = createEmbeddedPasswordlessAuth(
    memoryAdapter(database),
    {
      baseUrl, production: true, trustedOrigins: [baseUrl], secrets,
      nativeClientIds: [MK8DX_ANDROID_CLIENT_ID], clientIpHeaders: ["x-real-ip"],
      trustedProxyAddresses: ["127.0.0.1"],
    },
    { async sendMagicLink(message) { links.push(message); } },
    { async record(event) { audit.push(event); } },
    undefined,
    offline ? {
      origin: baseUrl,
      // Only redeem() is used by the plugin; every ticket here is Dee's offline account.
      tickets: { async redeem() {
        return { accountKey: "offline_account.dee", userAccountId: "user_account.dee",
          authEmail: "dee@accounts.mk8dx.invalid", role: "account" as const, active: true };
      } } as never,
      attempts: { limiter, tokenKey: Buffer.alloc(32, 7) },
      async bindAccount() { /* the binding service is exercised by its own tests */ },
    } : undefined,
    { keys, store, directory, pins, nowMs },
  );
  const app = Fastify({ logger: false });
  await registerEmbeddedAuthRoutes(app, auth, baseUrl);
  const api = auth.api as unknown as AccountSwitchAuthApi;
  const resolveActor = async (request: import("fastify").FastifyRequest): Promise<ActorContext> => {
    const session = await api.getSession({ headers: fromNodeHeaders(request.headers) });
    const email = session === null ? undefined : emailOf(session.user.id);
    const person = email === undefined ? undefined : people[email];
    return person === undefined ? { role: "anonymous" }
      : { role: person.administrator ? "administrator" : "account", userAccountId: person.userAccountId };
  };
  await registerAccountSwitchRoutes(app, {
    api, resolveActor, pins, store, rateLimiter: limiter, trustedOrigins: [baseUrl], nowMs,
    csrfVerifier: { verify: (_actor, proof) => proof === "good-proof" },
  });
  await app.ready();
  return {
    app, auth, database, links, audit, store, pinStore, limiter, pins,
    advance(ms: number) { now += ms; },
  };
}
type Harness = Awaited<ReturnType<typeof harness>>;

const browser = { origin: baseUrl, "content-type": "application/json", "x-real-ip": "203.0.113.7" };

/** A full browser magic-link sign-in into `jar`. */
async function signIn(h: Harness, jar: Jar, email: string): Promise<void> {
  h.advance(1_000);
  const requested = await h.app.inject({
    method: "POST", url: "/api/auth/sign-in/magic-link", headers: browser,
    payload: { email, callbackURL: "/" },
  });
  expect(requested.statusCode).toBe(200);
  const link = new URL(h.links.at(-1)!.url);
  const verified = await h.app.inject({
    method: "GET", url: `${link.pathname}${link.search}`,
    headers: { "x-real-ip": "203.0.113.7", ...(jar.size === 0 ? {} : { cookie: header(jar) }) },
  });
  expect(verified.statusCode).toBe(302);
  absorb(jar, verified.headers["set-cookie"]);
}

async function list(h: Harness, jar: Jar) {
  const response = await h.app.inject({
    method: "GET", url: "/v1/session/remembered-accounts",
    headers: { "x-real-ip": "203.0.113.7", cookie: header(jar) },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ schemaVersion: string; accounts: Array<{ entryId: string; label?: string; pinRequired: boolean; current: boolean }> }>();
}

async function switchTo(h: Harness, jar: Jar, entryId: string, pin?: string, headers: Record<string, string> = {}) {
  const response = await h.app.inject({
    method: "POST", url: "/v1/session/account-switch",
    headers: { ...browser, cookie: header(jar), ...headers },
    payload: { entryId, ...(pin === undefined ? {} : { pin }) },
  });
  if (response.statusCode === 200) { absorb(jar, response.headers["set-cookie"]); }
  return response;
}

async function whoAmI(h: Harness, jar: Jar): Promise<string | null> {
  const session = await (h.auth.api as unknown as AccountSwitchAuthApi)
    .getSession({ headers: new Headers({ cookie: header(jar) }) });
  if (session === null) { return null; }
  return (h.database["mk8dx_auth_user"] as Array<{ id: string; email: string }>)
    .find((user) => user.id === session.user.id)?.email ?? null;
}

const deviceCookieName = "__Secure-mk8dx.account_device";
const sessionCookieName = "__Secure-mk8dx.session_token";

describe("account switching (ADR-0224 phase 2)", () => {
  it("remembers browser sign-ins under a Strict HttpOnly device cookie and lists labels only", async () => {
    const h = await harness();
    try {
      const jar: Jar = new Map();
      await signIn(h, jar, "ann@example.test");
      const verifiedCookies = [...jar.keys()];
      expect(verifiedCookies).toContain(deviceCookieName);
      await signIn(h, jar, "bob@example.test");
      await signIn(h, jar, "cy@example.test");
      const document = await list(h, jar);
      expect(document.schemaVersion).toBe("mk8dx.remembered-accounts.v1");
      expect(document.accounts.map((account) => [account.label ?? null, account.current, account.pinRequired]))
        .toEqual([[null, true, false], ["Bob", false, false], ["Ann", false, false]]);
      for (const account of document.accounts) {
        expect(Object.keys(account).sort()).toEqual(
          (account.label === undefined ? ["current", "entryId", "pinRequired"]
            : ["current", "entryId", "label", "pinRequired"]));
      }
      // No session token travels to the page.
      const tokens = (h.database["mk8dx_auth_session"] as Array<{ token: string }>).map((row) => row.token);
      const body = JSON.stringify(document);
      for (const token of tokens) { expect(body).not.toContain(token); }
      // The device cookie is Strict and HttpOnly.
      const signedIn = await h.app.inject({
        method: "POST", url: "/api/auth/sign-in/magic-link", headers: browser,
        payload: { email: "ann@example.test", callbackURL: "/" },
      });
      expect(signedIn.statusCode).toBe(200);
      const link = new URL(h.links.at(-1)!.url);
      const verified = await h.app.inject({ method: "GET", url: `${link.pathname}${link.search}` });
      const raw = ([] as string[]).concat(verified.headers["set-cookie"] as string[]);
      const device = raw.find((line) => line.startsWith(`${deviceCookieName}=`))!;
      expect(device).toMatch(/HttpOnly/);
      expect(device).toMatch(/SameSite=Strict/);
      expect(device).toMatch(/Secure/);
    } finally { await h.app.close(); }
  });

  it("switches with one tap, ends only this device's previous session and keeps it remembered", async () => {
    const h = await harness();
    try {
      const jar: Jar = new Map();
      await signIn(h, jar, "ann@example.test");
      await signIn(h, jar, "bob@example.test");
      const elsewhere: Jar = new Map();
      await signIn(h, elsewhere, "bob@example.test");
      const ann = (await list(h, jar)).accounts.find((account) => account.label === "Ann")!;
      const sessionsBefore = (h.database["mk8dx_auth_session"] as unknown[]).length;
      const switched = await switchTo(h, jar, ann.entryId);
      expect(switched.statusCode).toBe(200);
      expect(switched.json()).toEqual({ schemaVersion: "mk8dx.account-switch.v1", switched: true });
      expect(await whoAmI(h, jar)).toBe("ann@example.test");
      // Bob's session on this device ended (audited); Bob elsewhere is untouched.
      expect(await whoAmI(h, elsewhere)).toBe("bob@example.test");
      expect((h.database["mk8dx_auth_session"] as unknown[]).length).toBe(sessionsBefore);
      expect(h.audit.filter((event) => event.kind === "auth_session_revoked")).toHaveLength(1);
      expect(h.audit.at(-1)?.kind).toBe("auth_session_created");
      const after = await list(h, jar);
      expect(after.accounts.map((account) => [account.label, account.current]))
        .toEqual([["Ann", true], ["Bob", false]]);
      // And back again.
      const bob = after.accounts.find((account) => account.label === "Bob")!;
      expect((await switchTo(h, jar, bob.entryId)).statusCode).toBe(200);
      expect(await whoAmI(h, jar)).toBe("bob@example.test");
    } finally { await h.app.close(); }
  });

  it("keeps the switch endpoints off the HTTP router and refuses foreign or bearer callers", async () => {
    const h = await harness();
    try {
      const jar: Jar = new Map();
      await signIn(h, jar, "ann@example.test");
      await signIn(h, jar, "bob@example.test");
      const ann = (await list(h, jar)).accounts.find((account) => account.label === "Ann")!;
      for (const url of ["/api/auth/switch-remembered-account", "/api/auth/list-remembered-accounts",
        "/api/auth/multi-session/set-active", "/api/auth/multi-session/list-device-sessions"]) {
        const direct = await h.app.inject({
          method: url.includes("list") ? "GET" : "POST", url,
          headers: { ...browser, cookie: header(jar) },
          ...(url.includes("list") ? {} : { payload: { entryId: ann.entryId } }),
        });
        expect(direct.statusCode, url).toBe(404);
      }
      expect((await switchTo(h, jar, ann.entryId, undefined, { origin: "https://evil.example" })).statusCode).toBe(403);
      expect((await switchTo(h, jar, ann.entryId, undefined, { authorization: "Bearer x" })).statusCode).toBe(403);
      const noOrigin = await h.app.inject({
        method: "POST", url: "/v1/session/account-switch",
        headers: { "content-type": "application/json", cookie: header(jar) }, payload: { entryId: ann.entryId },
      });
      expect(noOrigin.statusCode).toBe(403);
      // Without this browser's device cookie the entry means nothing (a session cookie alone is not enough).
      const sessionOnly: Jar = new Map([[sessionCookieName, jar.get(sessionCookieName)!]]);
      expect((await switchTo(h, sessionOnly, ann.entryId)).statusCode).toBe(404);
      const tampered: Jar = new Map(jar);
      tampered.set(deviceCookieName, "A".repeat(43));
      expect((await switchTo(h, tampered, ann.entryId)).statusCode).toBe(404);
      const bearerList = await h.app.inject({
        method: "GET", url: "/v1/session/remembered-accounts",
        headers: { cookie: header(jar), authorization: "Bearer x" },
      });
      expect(bearerList.json()).toEqual({ schemaVersion: "mk8dx.remembered-accounts.v1", accounts: [] });
      const invalid = await switchTo(h, jar, "not-an-entry");
      expect(invalid.statusCode).toBe(400);
      expect(await whoAmI(h, jar)).toBe("bob@example.test");
    } finally { await h.app.close(); }
  });

  it("never remembers or switches to an administrator", async () => {
    const h = await harness();
    try {
      const jar: Jar = new Map();
      await signIn(h, jar, "ann@example.test");
      await signIn(h, jar, "root@example.test");
      const document = await list(h, jar);
      expect(document.accounts.map((account) => account.label)).toEqual(["Ann"]);
      expect(h.store.rows).toHaveLength(1);
      // A grant that appears after remembering: hidden, refused and forgotten.
      people["bob@example.test"] = { ...people["bob@example.test"]!, administrator: true };
      try {
        await signIn(h, jar, "ann@example.test");
        const bobJar: Jar = new Map([[deviceCookieName, jar.get(deviceCookieName)!]]);
        people["bob@example.test"] = { ...people["bob@example.test"]!, administrator: false };
        await signIn(h, bobJar, "bob@example.test");
        const bob = (await list(h, jar)).accounts.find((account) => account.label === "Bob")!;
        people["bob@example.test"] = { ...people["bob@example.test"]!, administrator: true };
        const refused = await switchTo(h, jar, bob.entryId);
        expect(refused.statusCode).toBe(403);
        expect(refused.json<{ code: string }>().code).toBe("account_switch_forbidden");
        expect((await list(h, jar)).accounts.map((account) => account.label)).toEqual(["Ann"]);
      } finally {
        people["bob@example.test"] = { ...people["bob@example.test"]!, administrator: false };
      }
    } finally { await h.app.close(); }
  });

  it("requires the server-checked PIN with a durable attempt limit", async () => {
    const h = await harness();
    try {
      const jar: Jar = new Map();
      await signIn(h, jar, "ann@example.test");
      await signIn(h, jar, "bob@example.test");
      await h.pins.set("user_account.ann", "4821", Date.now());
      const stored = h.pinStore.pins.get("user_account.ann")!;
      expect(stored.digest.toString("hex")).not.toContain("4821");
      const ann = (await list(h, jar)).accounts.find((account) => account.label === "Ann")!;
      expect(ann.pinRequired).toBe(true);
      const missing = await switchTo(h, jar, ann.entryId);
      expect(missing.statusCode).toBe(403);
      expect(missing.json<{ code: string }>().code).toBe("account_switch_pin_required");
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const wrong = await switchTo(h, jar, ann.entryId, "0000");
        expect(wrong.statusCode).toBe(403);
        expect(wrong.json<{ code: string }>().code).toBe("account_switch_pin_invalid");
      }
      const limited = await switchTo(h, jar, ann.entryId, "4821");
      expect(limited.statusCode).toBe(429);
      expect(limited.headers["retry-after"]).toBeDefined();
      expect(await whoAmI(h, jar)).toBe("bob@example.test");
      h.advance(15 * 60 * 1_000);
      const right = await switchTo(h, jar, ann.entryId, "4821");
      expect(right.statusCode).toBe(200);
      expect(await whoAmI(h, jar)).toBe("ann@example.test");
    } finally { await h.app.close(); }
  });

  it("forgets on sign-out unless switching, and everywhere on sign out on all devices", async () => {
    const h = await harness();
    try {
      const jar: Jar = new Map();
      await signIn(h, jar, "ann@example.test");
      await signIn(h, jar, "bob@example.test");
      const kept = await h.app.inject({
        method: "POST", url: "/api/auth/sign-out",
        headers: { ...browser, cookie: header(jar), [KEEP_REMEMBERED_HEADER]: "1" }, payload: {},
      });
      expect(kept.statusCode).toBe(200);
      absorb(jar, kept.headers["set-cookie"]);
      expect((await list(h, jar)).accounts.map((account) => [account.label, account.current]))
        .toEqual([["Bob", false], ["Ann", false]]);
      // Signed out, the device still offers its accounts; a tap signs one in.
      const bob = (await list(h, jar)).accounts.find((account) => account.label === "Bob")!;
      expect((await switchTo(h, jar, bob.entryId)).statusCode).toBe(200);
      const left = await h.app.inject({
        method: "POST", url: "/api/auth/sign-out", headers: { ...browser, cookie: header(jar) }, payload: {},
      });
      expect(left.statusCode).toBe(200);
      absorb(jar, left.headers["set-cookie"]);
      expect((await list(h, jar)).accounts.map((account) => account.label)).toEqual(["Ann"]);

      const other: Jar = new Map();
      await signIn(h, other, "ann@example.test");
      const everywhere = await h.app.inject({
        method: "POST", url: "/api/auth/revoke-sessions", headers: { ...browser, cookie: header(other) }, payload: {},
      });
      expect(everywhere.statusCode).toBe(200);
      expect((await list(h, jar)).accounts).toEqual([]);
      expect((await list(h, other)).accounts).toEqual([]);
    } finally { await h.app.close(); }
  });

  it("lets a Player account manage its PIN with CSRF proof; changing needs the PIN unless freshly signed in", async () => {
    const h = await harness();
    try {
      const jar: Jar = new Map();
      await signIn(h, jar, "ann@example.test");
      const call = (method: "GET" | "PUT" | "POST", url: string, payload?: unknown, proof = "good-proof", who = jar) =>
        h.app.inject({
          method, url, headers: { ...browser, cookie: header(who), "x-mk8dx-csrf": proof },
          ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
        });
      expect((await call("GET", "/v1/account/switch-pin")).json())
        .toEqual({ schemaVersion: "mk8dx.account-switch-pin.v1", enabled: false, currentPinRequired: false });
      expect((await call("PUT", "/v1/account/switch-pin", { pin: "1234" }, "bad")).statusCode).toBe(403);
      expect((await call("PUT", "/v1/account/switch-pin", { pin: "12a4" })).statusCode).toBe(400);
      const set = await call("PUT", "/v1/account/switch-pin", { pin: "1234" });
      expect(set.statusCode).toBe(200);
      // Fresh real sign-in: no current PIN needed yet.
      expect(set.json()).toEqual({ schemaVersion: "mk8dx.account-switch-pin.v1", enabled: true, currentPinRequired: false });
      h.advance(16 * 60 * 1_000);
      expect((await call("GET", "/v1/account/switch-pin")).json<{ currentPinRequired: boolean }>().currentPinRequired).toBe(true);
      expect((await call("PUT", "/v1/account/switch-pin", { pin: "5678" })).json<{ code: string }>().code)
        .toBe("account_switch_pin_current_required");
      expect((await call("PUT", "/v1/account/switch-pin", { pin: "5678", currentPin: "9999" })).statusCode).toBe(403);
      expect((await call("PUT", "/v1/account/switch-pin", { pin: "5678", currentPin: "1234" })).statusCode).toBe(200);

      // A session made by switching is never "fresh": the current PIN is needed to remove it.
      await signIn(h, jar, "bob@example.test");
      const ann = (await list(h, jar)).accounts.find((account) => account.label === "Ann")!;
      expect((await switchTo(h, jar, ann.entryId, "5678")).statusCode).toBe(200);
      expect((await call("GET", "/v1/account/switch-pin")).json<{ currentPinRequired: boolean }>().currentPinRequired).toBe(true);
      expect((await call("POST", "/v1/account/switch-pin/clear", {})).statusCode).toBe(403);
      const cleared = await call("POST", "/v1/account/switch-pin/clear", { currentPin: "5678" });
      expect(cleared.json()).toEqual({ schemaVersion: "mk8dx.account-switch-pin.v1", enabled: false, currentPinRequired: false });

      const admin: Jar = new Map();
      await signIn(h, admin, "root@example.test");
      expect((await call("GET", "/v1/account/switch-pin", undefined, "good-proof", admin)).statusCode).toBe(403);
      const anonymous = await h.app.inject({ method: "GET", url: "/v1/account/switch-pin" });
      expect(anonymous.statusCode).toBe(401);
    } finally { await h.app.close(); }
  });

  it("remembers a session created by the offline invitation plugin", async () => {
    const h = await harness(true);
    try {
      const jar: Jar = new Map();
      await signIn(h, jar, "ann@example.test");
      h.advance(1_000);
      const redeemed = await h.app.inject({
        method: "POST", url: "/api/auth/offline-invitation/redeem",
        headers: { ...browser, cookie: header(jar) }, payload: { token: "t".repeat(43) },
      });
      expect(redeemed.statusCode, redeemed.body).toBe(200);
      absorb(jar, redeemed.headers["set-cookie"]);
      expect(await whoAmI(h, jar)).toBe("dee@accounts.mk8dx.invalid");
      expect((await list(h, jar)).accounts.map((account) => [account.label, account.current]))
        .toEqual([["Dee", true], ["Ann", false]]);
      expect(h.audit.filter((event) => event.kind === "auth_session_created")).toHaveLength(2);
    } finally { await h.app.close(); }
  });

  it("never remembers a native bearer sign-in", async () => {
    const h = await harness();
    try {
      const jar: Jar = new Map();
      await signIn(h, jar, "ann@example.test");
      const code = (await h.app.inject({
        method: "POST", url: "/api/auth/device/code", headers: browser, payload: { client_id: MK8DX_ANDROID_CLIENT_ID },
      })).json<{ device_code: string; user_code: string }>();
      await h.app.inject({
        method: "GET", url: `/api/auth/device?user_code=${encodeURIComponent(code.user_code)}`,
        headers: { cookie: header(jar), "x-real-ip": "203.0.113.7" },
      });
      const approved = await h.app.inject({
        method: "POST", url: "/api/auth/device/approve", headers: { ...browser, cookie: header(jar) },
        payload: { userCode: code.user_code },
      });
      expect(approved.statusCode, approved.body).toBe(200);
      const token = await h.app.inject({
        method: "POST", url: "/api/auth/device/token", headers: browser,
        payload: { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: code.device_code,
          client_id: MK8DX_ANDROID_CLIENT_ID },
      });
      expect(token.statusCode, token.body).toBe(200);
      const raw = ([] as string[]).concat((token.headers["set-cookie"] ?? []) as string[]);
      expect(raw.some((line) => line.startsWith(`${deviceCookieName}=`))).toBe(false);
      expect(h.store.rows).toHaveLength(1);
    } finally { await h.app.close(); }
  });
});

describe("PIN hashing", () => {
  it("peppers and salts, and refuses a PIN from a retired secret", async () => {
    const hasher = new AccountSwitchPinHasher(deriveAccountSwitchKeys(secrets));
    const first = await hasher.hash("0420");
    const second = await hasher.hash("0420");
    expect(first.pepperVersion).toBe(2);
    expect(first.digest.equals(second.digest)).toBe(false);
    expect(await hasher.verify("0420", first)).toBe(true);
    expect(await hasher.verify("0421", first)).toBe(false);
    expect(await hasher.verify("42", first)).toBe(false);
    const rotated = new AccountSwitchPinHasher(deriveAccountSwitchKeys([
      { version: 3, value: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" },
    ]));
    expect(await rotated.verify("0420", first)).toBe(false);
  });
});
