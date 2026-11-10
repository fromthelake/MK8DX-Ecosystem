import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createOfflineHostApp } from "../src/administration/offline-host-app.js";
import { OfflineHostSessions } from "../src/administration/offline-host-session.js";
import { OfflineHostUnlockStore } from "../src/administration/offline-host-unlock.js";

const origin = "http://127.0.0.1:19090";
const host = "127.0.0.1:19090";
const administrator = "user_account.12345678-1234-1234-1234-123456789abc";
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture(accountId: string | null) {
  const directory = await mkdtemp(join(tmpdir(), "mk8dx-host-app-"));
  directories.push(directory);
  const unlocks = new OfflineHostUnlockStore(join(directory, "unlock.json"), () => 1000);
  const issued = await unlocks.issue(accountId);
  let allowed = true;
  const sessions = new OfflineHostSessions(async () => allowed, () => 1000);
  const created: { accountKey: string; userAccountId: string; displayLabel: string;
    role: "account" | "administrator"; active: true }[] = [];
  const revoked: string[] = [];
  const accounts = {
    async create(_actor: string | null, displayLabel: string, role: "account" | "administrator") {
      const account = { accountKey: "offline_account.12345678-1234-1234-1234-123456789abc",
        userAccountId: administrator, displayLabel, role, active: true as const };
      created.push(account);
      return account;
    },
    async list() { return created; },
  };
  const tickets = {
    async issue() { return { invitationId: "offline_invitation.12345678-1234-1234-1234-123456789abc",
      token: "A".repeat(43), expiresAtMs: 901_000 }; },
    async revoke(_actor: unknown, invitationId: string) { revoked.push(invitationId); },
  };
  const app = await createOfflineHostApp({ origin, unlocks, sessions, accounts, tickets,
    publicOrigin: "https://192.168.50.20",
    rootCertificateSha256: "a".repeat(64), rootSpkiSha256: "b".repeat(64) });
  return { app, issued, unlocks, sessions, created, revoked, forbid: () => { allowed = false; } };
}

describe("isolated offline host listener", () => {
  it("refuses foreign Host, Origin, and query; unlocks only by POST body", async () => {
    const { app, issued } = await fixture(administrator);
    try {
      const foreignHost = await app.inject({ method: "GET", url: "/", headers: { host: "192.168.1.2:19090" } });
      expect(foreignHost.statusCode).toBe(404);
      const foreignOrigin = await app.inject({ method: "POST", url: "/api/unlock",
        headers: { host, origin: "http://evil.invalid", "content-type": "application/json" },
        payload: { code: issued.code } });
      expect(foreignOrigin.statusCode).toBe(403);
      const query = await app.inject({ method: "POST", url: `/api/unlock?code=${issued.code}`,
        headers: { host, origin, "content-type": "application/json" }, payload: { code: issued.code } });
      expect(query.statusCode).toBe(404);
      const unlocked = await app.inject({ method: "POST", url: "/api/unlock",
        headers: { host, origin, "content-type": "application/json" }, payload: { code: issued.code } });
      expect(unlocked.statusCode).toBe(200);
      expect(unlocked.headers["set-cookie"]).toMatch(/HttpOnly; SameSite=Strict; Path=\//);
      expect(unlocked.headers["cache-control"]).toBe("no-store");
      expect(unlocked.headers["referrer-policy"]).toBe("no-referrer");
      expect(unlocked.body).not.toContain(issued.code);
      const again = await app.inject({ method: "POST", url: "/api/unlock",
        headers: { host, origin, "content-type": "application/json" }, payload: { code: issued.code } });
      expect(again.statusCode).toBe(401);
      const cookie = String(unlocked.headers["set-cookie"]).split(";")[0]!;
      const session = await app.inject({ method: "GET", url: "/api/session", headers: { host, cookie } });
      expect(session.json()).toEqual({ active: true, role: "administrator" });
    } finally { await app.close(); }
  });

  it("rechecks authorization and loses access when the grant disappears", async () => {
    const { app, issued, forbid } = await fixture(administrator);
    try {
      const unlocked = await app.inject({ method: "POST", url: "/api/unlock",
        headers: { host, origin, "content-type": "application/json" }, payload: { code: issued.code } });
      const cookie = String(unlocked.headers["set-cookie"]).split(";")[0]!;
      forbid();
      const session = await app.inject({ method: "GET", url: "/api/session", headers: { host, cookie } });
      expect(session.statusCode).toBe(401);
    } finally { await app.close(); }
  });

  it("rate-limits repeated host unlock attempts", async () => {
    const { app } = await fixture(administrator);
    try {
      const attempts = [];
      for (let index = 0; index < 6; index++) {
        attempts.push(await app.inject({ method: "POST", url: "/api/unlock",
          headers: { host, origin, "content-type": "application/json" },
          payload: { code: "A".repeat(43) } }));
      }
      expect(attempts.slice(0, 5).map((attempt) => attempt.statusCode)).toEqual([401, 401, 401, 401, 401]);
      expect(attempts[5]!.statusCode).toBe(429);
    } finally { await app.close(); }
  });

  it("labels the first unbound session only as bootstrap", async () => {
    const { app, issued, unlocks, sessions } = await fixture(null);
    try {
      const unlocked = await app.inject({ method: "POST", url: "/api/unlock",
        headers: { host, origin, "content-type": "application/json" }, payload: { code: issued.code } });
      const cookie = String(unlocked.headers["set-cookie"]).split(";")[0]!;
      const session = await app.inject({ method: "GET", url: "/api/session", headers: { host, cookie } });
      expect(session.json()).toEqual({ active: true, role: "bootstrap" });
      expect(await sessions.bootstrapCode(cookie.split("=")[1])).toBe(issued.code);
      // The bootstrap form will spend this capability only after its account
      // transaction commits, so opening the form does not lose it on failure.
      await expect(unlocks.verify(issued.code)).resolves.toBeNull();
      const created = await app.inject({ method: "POST", url: "/api/accounts",
        headers: { host, origin, cookie, "content-type": "application/json" },
        payload: { displayLabel: "Host owner", role: "administrator" } });
      expect(created.statusCode).toBe(200);
      await expect(unlocks.verify(issued.code)).rejects.toMatchObject({ code: "unavailable" });
    } finally { await app.close(); }
  });

  it("keeps setup and invitation QR actions behind an administrator session", async () => {
    const { app, issued, revoked } = await fixture(administrator);
    try {
      const anonymous = await app.inject({ method: "GET", url: "/api/setup", headers: { host } });
      expect(anonymous.statusCode).toBe(401);
      const unlocked = await app.inject({ method: "POST", url: "/api/unlock",
        headers: { host, origin, "content-type": "application/json" }, payload: { code: issued.code } });
      const cookie = String(unlocked.headers["set-cookie"]).split(";")[0]!;
      const setup = await app.inject({ method: "GET", url: "/api/setup", headers: { host, cookie } });
      expect(setup.json()).toMatchObject({ setupUrl: "http://192.168.50.20/setup",
        pairingUrl: `http://192.168.50.20/setup#mk8dx-pair=1&origin=https%3A%2F%2F192.168.50.20&spki=${"b".repeat(64)}`,
        rootCertificateSha256: "a".repeat(64) });
      expect(setup.json().qrDataUrl).toMatch(/^data:image\/png;base64,/);
      const account = await app.inject({ method: "POST", url: "/api/accounts",
        headers: { host, origin, cookie, "content-type": "application/json" },
        payload: { displayLabel: "Player", role: "account" } });
      expect(account.statusCode).toBe(200);
      const invitation = await app.inject({ method: "POST", url: "/api/invitations",
        headers: { host, origin, cookie, "content-type": "application/json" },
        payload: { accountKey: account.json().account.accountKey, role: "account" } });
      expect(invitation.statusCode).toBe(200);
      expect(invitation.json().invitationUrl).toMatch(/^https:\/\/192\.168\.50\.20\/offline-invite#token=/);
      expect(invitation.headers["cache-control"]).toBe("no-store");
      const revoke = await app.inject({ method: "POST", url: "/api/invitations/revoke",
        headers: { host, origin, cookie, "content-type": "application/json" },
        payload: { invitationId: invitation.json().invitationId } });
      expect(revoke.statusCode).toBe(200);
      expect(revoked).toHaveLength(1);
    } finally { await app.close(); }
  });
});
