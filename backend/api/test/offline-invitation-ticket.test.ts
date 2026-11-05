import { describe, expect, it } from "vitest";

import {
  OFFLINE_INVITATION_LIFETIME_MS,
  OfflineInvitationTicketError,
  OfflineInvitationTicketService,
  type OfflineInvitationRecord,
  type OfflineInvitationTarget,
  type OfflineInvitationTicketRepository,
} from "../src/authentication/offline-invitation-ticket.js";

const accountKey = "offline_account.11111111-1111-4111-8111-111111111111";
const admin = { role: "administrator" as const,
  userAccountId: "user_account.22222222-2222-4222-8222-222222222222" };
const ordinary = { role: "account" as const,
  userAccountId: "user_account.33333333-3333-4333-8333-333333333333" };

class Repository implements OfflineInvitationTicketRepository {
  public targetState: OfflineInvitationTarget = { accountKey,
    userAccountId: ordinary.userAccountId,
    authEmail: "synthetic@accounts.mk8dx.invalid", role: "account", active: true };
  public readonly records = new Map<string, OfflineInvitationRecord & {
    consumedAtMs?: number; revokedAtMs?: number;
  }>();

  public async target(key: string): Promise<OfflineInvitationTarget | null> {
    return key === this.targetState.accountKey ? this.targetState : null;
  }

  public async create(record: OfflineInvitationRecord): Promise<void> {
    this.records.set(record.invitationId, record);
  }

  public async consume(digest: Uint8Array, nowMs: number): Promise<OfflineInvitationTarget | null> {
    const record = [...this.records.values()].find((candidate) =>
      Buffer.from(candidate.tokenDigest).equals(Buffer.from(digest)));
    if (record === undefined || record.consumedAtMs !== undefined ||
        record.revokedAtMs !== undefined || nowMs >= record.expiresAtMs ||
        !this.targetState.active || record.accountKey !== this.targetState.accountKey ||
        record.role !== this.targetState.role) { return null; }
    this.records.set(record.invitationId, { ...record, consumedAtMs: nowMs });
    return this.targetState;
  }

  public async revoke(id: string, nowMs: number, _actorAccountId: string): Promise<boolean> {
    const record = this.records.get(id);
    if (record === undefined || record.consumedAtMs !== undefined ||
        record.revokedAtMs !== undefined) { return false; }
    this.records.set(id, { ...record, revokedAtMs: nowMs });
    return true;
  }
}

describe("offline invitation ticket boundary", () => {
  it("binds a random one-use ticket to the selected account and role", async () => {
    const repository = new Repository();
    let now = 1_000_000;
    const tickets = new OfflineInvitationTicketService(repository, Buffer.alloc(32, 7), () => now);
    await expect(tickets.issue(ordinary, accountKey, "account"))
      .rejects.toMatchObject({ code: "forbidden" });
    await expect(tickets.issue(admin, accountKey, "administrator"))
      .rejects.toMatchObject({ code: "unavailable" });
    const issued = await tickets.issue(admin, accountKey, "account");
    expect(issued.expiresAtMs - now).toBe(OFFLINE_INVITATION_LIFETIME_MS);
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = repository.records.get(issued.invitationId)!;
    expect(Buffer.from(stored.tokenDigest).toString("utf8")).not.toContain(issued.token);
    expect(stored.accountKey).toBe(accountKey);
    expect(stored.role).toBe("account");
    expect(await tickets.redeem(issued.token)).toEqual(repository.targetState);
    await expect(tickets.redeem(issued.token)).rejects.toMatchObject({ code: "unavailable" });
    now += 1;
    expect(repository.records.get(issued.invitationId)?.consumedAtMs).toBeLessThan(now);
  });

  it("rejects expired, revoked, changed-role and malformed tickets", async () => {
    const repository = new Repository();
    let now = 5_000;
    const tickets = new OfflineInvitationTicketService(repository, Buffer.alloc(32, 9), () => now);
    const expiring = await tickets.issue(admin, accountKey, "account");
    now += OFFLINE_INVITATION_LIFETIME_MS;
    await expect(tickets.redeem(expiring.token)).rejects.toMatchObject({ code: "unavailable" });
    const revoked = await tickets.issue(admin, accountKey, "account");
    await tickets.revoke(admin, revoked.invitationId);
    await expect(tickets.redeem(revoked.token)).rejects.toMatchObject({ code: "unavailable" });
    const changed = await tickets.issue(admin, accountKey, "account");
    repository.targetState = { ...repository.targetState, role: "administrator" };
    await expect(tickets.redeem(changed.token)).rejects.toMatchObject({ code: "unavailable" });
    await expect(tickets.redeem("bad-token")).rejects.toMatchObject({ code: "invalid" });
    await expect(tickets.revoke(ordinary, changed.invitationId))
      .rejects.toMatchObject({ code: "forbidden" });
    expect(OfflineInvitationTicketError.name).toBe("OfflineInvitationTicketError");
  });

  it("allows only one redemption when two callers race", async () => {
    const repository = new Repository();
    const tickets = new OfflineInvitationTicketService(repository, Buffer.alloc(32, 11), () => 500);
    const issued = await tickets.issue(admin, accountKey, "account");
    const attempts = await Promise.allSettled([
      tickets.redeem(issued.token), tickets.redeem(issued.token),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
  });
});
