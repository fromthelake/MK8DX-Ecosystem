/** Short-lived host-only unlock code. The code itself is never written to disk. */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";

export const OFFLINE_HOST_UNLOCK_LIFETIME_MS = 5 * 60_000;
const codePattern = /^[A-Za-z0-9_-]{43}$/;
const accountPattern = /^user_account\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type UnlockRecord = Readonly<{
  schemaVersion: "mk8dx.offline-host-unlock.v1";
  digest: string;
  expiresAtMs: number;
  accountId: string | null;
}>;

export class OfflineHostUnlockError extends Error {
  public constructor(public readonly code: "invalid" | "unavailable") {
    super(`offline host unlock ${code}`);
    this.name = "OfflineHostUnlockError";
  }
}

function digest(code: string): Buffer {
  return createHash("sha256").update(code, "ascii").digest();
}

function record(value: unknown): UnlockRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OfflineHostUnlockError("unavailable");
  }
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== 4 ||
      candidate["schemaVersion"] !== "mk8dx.offline-host-unlock.v1" ||
      typeof candidate["digest"] !== "string" ||
      !/^[0-9a-f]{64}$/.test(candidate["digest"]) ||
      !Number.isSafeInteger(candidate["expiresAtMs"]) ||
      typeof candidate["expiresAtMs"] !== "number" ||
      (candidate["accountId"] !== null &&
       (typeof candidate["accountId"] !== "string" ||
        !accountPattern.test(candidate["accountId"])))) {
    throw new OfflineHostUnlockError("unavailable");
  }
  return candidate as UnlockRecord;
}

/** One state path shared only by the local operator command and host listener. */
export class OfflineHostUnlockStore {
  public constructor(private readonly path: string,
                     private readonly nowMs: () => number = Date.now) {
    if (!isAbsolute(path) || basename(path) !== "unlock.json") {
      throw new OfflineHostUnlockError("invalid");
    }
  }

  public async issue(accountId: string | null): Promise<Readonly<{
    code: string; expiresAtMs: number;
  }>> {
    if (accountId !== null && !accountPattern.test(accountId)) {
      throw new OfflineHostUnlockError("invalid");
    }
    const now = this.clock();
    const expiresAtMs = now + OFFLINE_HOST_UNLOCK_LIFETIME_MS;
    if (!Number.isSafeInteger(expiresAtMs)) { throw new OfflineHostUnlockError("invalid"); }
    const code = randomBytes(32).toString("base64url");
    const value: UnlockRecord = {
      schemaVersion: "mk8dx.offline-host-unlock.v1",
      digest: digest(code).toString("hex"), expiresAtMs, accountId,
    };
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const temporary = join(directory, `.unlock-${randomBytes(12).toString("hex")}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600, flag: "wx" });
      await chmod(temporary, 0o600);
      await rename(temporary, this.path);
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") { throw error; }
      });
    }
    return { code, expiresAtMs };
  }

  public async consume(code: string): Promise<string | null> {
    if (!codePattern.test(code)) { throw new OfflineHostUnlockError("invalid"); }
    const now = this.clock();
    const expected = digest(code);
    let current: UnlockRecord;
    try { current = record(JSON.parse(await readFile(this.path, "utf8"))); }
    catch { throw new OfflineHostUnlockError("unavailable"); }
    if (now >= current.expiresAtMs ||
        !timingSafeEqual(expected, Buffer.from(current.digest, "hex"))) {
      throw new OfflineHostUnlockError("unavailable");
    }
    // Claim the file atomically. Recheck after the rename because an issue
    // command may have replaced it between the first read and this claim.
    const claimed = join(dirname(this.path), `.unlock-claimed-${randomBytes(12).toString("hex")}`);
    try {
      await rename(this.path, claimed);
      const consumed = record(JSON.parse(await readFile(claimed, "utf8")));
      if (now >= consumed.expiresAtMs ||
          !timingSafeEqual(expected, Buffer.from(consumed.digest, "hex"))) {
        throw new OfflineHostUnlockError("unavailable");
      }
      return consumed.accountId;
    } catch {
      throw new OfflineHostUnlockError("unavailable");
    } finally {
      await unlink(claimed).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") { throw error; }
      });
    }
  }

  private clock(): number {
    const now = this.nowMs();
    if (!Number.isSafeInteger(now) || now < 0) { throw new OfflineHostUnlockError("invalid"); }
    return now;
  }
}
