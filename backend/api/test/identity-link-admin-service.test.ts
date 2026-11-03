import { describe, expect, it } from "vitest";

import {
  IdentityLinkAdminError, IdentityLinkAdminService,
  type IdentityLinkClaimPort, type IdentityLinkReadRepository,
} from "../src/identity/identity-link-admin-service.js";

const administrator = { role: "administrator" as const, userAccountId: "user_account.owner" };
const account = { role: "account" as const, userAccountId: "user_account.someone" };

function repository(overrides: Partial<IdentityLinkReadRepository> = {}): IdentityLinkReadRepository {
  return {
    async listAccounts() {
      return [{
        userAccountId: "user_account.one", email: "someone@example.test",
        accountStatus: "active", screenName: null, linkedPlayerId: null,
        linkedPlayerName: null, playerClaimId: null, lastSeenAtMs: null,
      }];
    },
    async listPlayers() {
      return [{
        playerId: "player.one", displayName: "One", username: "one",
        timeTrials: 12, tournamentRaces: 40, linkedAccountId: null,
      }];
    },
    async findClaimIdForAccount() { return "player_claim.one"; },
    ...overrides,
  };
}

function claims(calls: unknown[] = []): IdentityLinkClaimPort {
  return {
    async administratorLink(_actor, command) {
      calls.push({ kind: "link", ...command });
      return { playerClaimId: "player_claim.new" };
    },
    async administratorAction(_actor, command) {
      calls.push({ kind: "action", ...command });
      return {};
    },
  };
}

describe("the administrator identity link surface", () => {
  it("shows an address next to the Player it resolves to, with both histories", async () => {
    const service = new IdentityLinkAdminService(repository(), claims());
    const overview = await service.overview(administrator);
    expect(overview.accounts[0]?.email).toBe("someone@example.test");
    // Both counts are shown so a link is an informed decision rather than a
    // guess at a name.
    expect(overview.players[0]?.timeTrials).toBe(12);
    expect(overview.players[0]?.tournamentRaces).toBe(40);
  });

  it("is closed to an ordinary signed-in account", async () => {
    const service = new IdentityLinkAdminService(repository(), claims());
    await expect(service.overview(account)).rejects.toBeInstanceOf(IdentityLinkAdminError);
    await expect(service.link(account, {
      userAccountId: "user_account.one", playerId: "player.one",
    })).rejects.toMatchObject({ code: "not_authorized" });
    await expect(service.unlink(account, { userAccountId: "user_account.one" }))
      .rejects.toMatchObject({ code: "not_authorized" });
  });

  it("records a reason with every link, so the decision is not anonymous", async () => {
    const calls: unknown[] = [];
    const service = new IdentityLinkAdminService(repository(), claims(calls));
    await service.link(administrator, {
      userAccountId: "user_account.one", playerId: "player.one",
    });
    expect(calls[0]).toMatchObject({
      kind: "link", userAccountId: "user_account.one",
      playerId: "player.one", reasonCode: "administrator_link",
    });
  });

  it("refuses identifiers that are not an account and a Player", async () => {
    const service = new IdentityLinkAdminService(repository(), claims());
    for (const command of [
      { userAccountId: "nonsense", playerId: "player.one" },
      { userAccountId: "user_account.one", playerId: "nonsense" },
      { userAccountId: "user_account.one", playerId: "player.one", reasonCode: "NOT VALID" },
    ]) {
      await expect(service.link(administrator, command))
        .rejects.toMatchObject({ code: "invalid_input" });
    }
  });

  it("revokes the existing claim when unlinking", async () => {
    const calls: unknown[] = [];
    const service = new IdentityLinkAdminService(repository(), claims(calls));
    const result = await service.unlink(administrator, { userAccountId: "user_account.one" });
    expect(result.unlinked).toBe(true);
    expect(calls[0]).toMatchObject({
      kind: "action", playerClaimId: "player_claim.one", action: "revoke",
    });
  });

  it("treats unlinking an already unlinked account as done, not as a failure", async () => {
    const calls: unknown[] = [];
    const service = new IdentityLinkAdminService(
      repository({ async findClaimIdForAccount() { return null; } }), claims(calls));
    const result = await service.unlink(administrator, { userAccountId: "user_account.one" });
    expect(result.unlinked).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
