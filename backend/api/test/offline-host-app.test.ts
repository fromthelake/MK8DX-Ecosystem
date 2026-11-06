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
  const app = createOfflineHostApp({ origin, unlocks, sessions });
  return { app, issued, forbid: () => { allowed = false; } };
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

  it("labels the first unbound session only as bootstrap", async () => {
    const { app, issued } = await fixture(null);
    try {
      const unlocked = await app.inject({ method: "POST", url: "/api/unlock",
        headers: { host, origin, "content-type": "application/json" }, payload: { code: issued.code } });
      const cookie = String(unlocked.headers["set-cookie"]).split(";")[0]!;
      const session = await app.inject({ method: "GET", url: "/api/session", headers: { host, cookie } });
      expect(session.json()).toEqual({ active: true, role: "bootstrap" });
    } finally { await app.close(); }
  });
});
