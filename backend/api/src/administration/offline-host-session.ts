import { createHash, randomBytes } from "node:crypto";

export type OfflineHostSession = Readonly<{
  accountId: string | null;
  createdAtMs: number;
  lastUsedAtMs: number;
}>;

export const OFFLINE_HOST_IDLE_MS = 15 * 60_000;
export const OFFLINE_HOST_ABSOLUTE_MS = 60 * 60_000;

function key(token: string): string {
  return createHash("sha256").update(token, "ascii").digest("hex");
}

export class OfflineHostSessions {
  private readonly sessions = new Map<string, OfflineHostSession>();
  private readonly bootstrapCodes = new Map<string, string>();

  public constructor(private readonly permitted: (accountId: string | null) => Promise<boolean>,
                     private readonly nowMs: () => number = Date.now) {}

  public async create(accountId: string | null, bootstrapCode?: string): Promise<string | null> {
    if ((accountId === null && (bootstrapCode === undefined ||
         !/^[A-Za-z0-9_-]{43}$/.test(bootstrapCode))) ||
        (accountId !== null && bootstrapCode !== undefined)) { return null; }
    if (!await this.permitted(accountId)) { return null; }
    const now = this.nowMs();
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(key(token), { accountId, createdAtMs: now, lastUsedAtMs: now });
    if (bootstrapCode !== undefined) { this.bootstrapCodes.set(key(token), bootstrapCode); }
    return token;
  }

  public async read(token: string | undefined): Promise<OfflineHostSession | null> {
    if (token === undefined || !/^[A-Za-z0-9_-]{43}$/.test(token)) { return null; }
    const digest = key(token);
    const session = this.sessions.get(digest);
    if (session === undefined) { return null; }
    const now = this.nowMs();
    if (now >= session.createdAtMs + OFFLINE_HOST_ABSOLUTE_MS ||
        now >= session.lastUsedAtMs + OFFLINE_HOST_IDLE_MS ||
        !await this.permitted(session.accountId)) {
      this.sessions.delete(digest);
      this.bootstrapCodes.delete(digest);
      return null;
    }
    const updated = { ...session, lastUsedAtMs: now };
    this.sessions.set(digest, updated);
    return updated;
  }

  public revoke(token: string | undefined): void {
    if (token !== undefined && /^[A-Za-z0-9_-]{43}$/.test(token)) {
      this.sessions.delete(key(token));
      this.bootstrapCodes.delete(key(token));
    }
  }

  public async bootstrapCode(token: string | undefined): Promise<string | null> {
    const session = await this.read(token);
    if (session === null || session.accountId !== null || token === undefined) { return null; }
    return this.bootstrapCodes.get(key(token)) ?? null;
  }
}
