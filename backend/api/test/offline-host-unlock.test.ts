import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";

import {
  OFFLINE_HOST_UNLOCK_LIFETIME_MS,
  OfflineHostUnlockStore,
} from "../src/administration/offline-host-unlock.js";

const directories: string[] = [];
const administrator = "user_account.12345678-1234-1234-1234-123456789abc";

async function state(nowMs: () => number): Promise<OfflineHostUnlockStore> {
  const directory = await mkdtemp(join(tmpdir(), "mk8dx-host-unlock-"));
  directories.push(directory);
  return new OfflineHostUnlockStore(join(directory, "unlock.json"), nowMs);
}

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("offline host unlock", () => {
  it("stores only a digest and consumes a bootstrap code exactly once", async () => {
    const store = await state(() => 1000);
    const issued = await store.issue(null);
    expect(issued.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const path = (store as unknown as { path: string }).path;
    const saved = await readFile(path, "utf8");
    expect(saved).not.toContain(issued.code);
    expect(JSON.parse(saved)).toMatchObject({ accountId: null, expiresAtMs: 1000 + OFFLINE_HOST_UNLOCK_LIFETIME_MS });
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
    await expect(store.consume(issued.code)).resolves.toBeNull();
    await expect(store.consume(issued.code)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("rejects wrong and expired codes without granting a session", async () => {
    let now = 1000;
    const store = await state(() => now);
    const issued = await store.issue(administrator);
    await expect(store.consume("A".repeat(43))).rejects.toMatchObject({ code: "unavailable" });
    now += OFFLINE_HOST_UNLOCK_LIFETIME_MS;
    await expect(store.consume(issued.code)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("invalidates an earlier code when the operator issues a new one", async () => {
    const store = await state(() => 1000);
    const first = await store.issue(administrator);
    const second = await store.issue(administrator);
    await expect(store.consume(first.code)).rejects.toMatchObject({ code: "unavailable" });
    await expect(store.consume(second.code)).resolves.toBe(administrator);
  });
});
