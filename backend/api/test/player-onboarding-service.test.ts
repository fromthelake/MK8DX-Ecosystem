import { describe, expect, it } from "vitest";

import {
  PlayerOnboardingError,
  PlayerOnboardingService,
  SELF_SERVICE_PLAYER_CREATION_REASON,
  type PlayerOnboardingTransaction,
} from "../src/identity/player-onboarding-service.js";
import type { ActorContext } from "../src/identity/types.js";

const account: ActorContext = {
  role: "account",
  userAccountId: "user_account.owner",
};
const administrator: ActorContext = {
  role: "administrator",
  userAccountId: "user_account.admin",
};

type Store = {
  accountStatus: string | null;
  linked: boolean;
  usernameTaken: boolean;
  displayNameTaken: boolean;
  createdPlayers: unknown[];
  createdClaims: unknown[];
  transactionCount: number;
};

function service(overrides: Partial<Store> = {}) {
  const store: Store = {
    accountStatus: "active",
    linked: false,
    usernameTaken: false,
    displayNameTaken: false,
    createdPlayers: [],
    createdClaims: [],
    transactionCount: 0,
    ...overrides,
  };
  const transaction: PlayerOnboardingTransaction = {
    async findUserAccountStatus() { return store.accountStatus; },
    async hasVerifiedClaimForUserAccount() { return store.linked; },
    async createPlayerWithUsername(input) {
      if (store.usernameTaken) { return "username_taken"; }
      store.createdPlayers.push(input);
      return "created";
    },
    async createVerifiedClaim(input) { store.createdClaims.push(input); },
  };
  const onboarding = new PlayerOnboardingService(
    {
      async transaction(work) {
        store.transactionCount += 1;
        return work(transaction);
      },
    },
    {
      newPlayerId: () => "player.new",
      newPlayerClaimId: () => "player_claim.new",
    },
    { nowMs: () => 1_000 },
  );
  return { onboarding, store };
}

describe("self-service Player creation", () => {
  it("creates a Player with a verified claim for an account actor", async () => {
    const { onboarding, store } = service();
    const created = await onboarding.createOwnPlayer(account, {
      username: "racer_1",
      displayName: " Racer One ",
    });
    expect(created).toEqual({
      playerId: "player.new",
      username: "racer_1",
      displayName: "Racer One",
      playerClaimId: "player_claim.new",
    });
    expect(store.createdPlayers).toEqual([{
      playerId: "player.new",
      username: "racer_1",
      displayName: "Racer One",
      nowMs: 1_000,
    }]);
    expect(store.createdClaims).toEqual([{
      playerClaimId: "player_claim.new",
      playerId: "player.new",
      userAccountId: "user_account.owner",
      reasonCode: SELF_SERVICE_PLAYER_CREATION_REASON,
      nowMs: 1_000,
    }]);
  });

  it("defaults the display name to the username and allows administrators", async () => {
    const { onboarding } = service();
    const created = await onboarding.createOwnPlayer(administrator, {
      username: "adm-racer",
    });
    expect(created.displayName).toBe("adm-racer");
    expect(created.username).toBe("adm-racer");
  });

  it.each<ActorContext>([
    { role: "anonymous" },
    { role: "migration_operator" },
  ])("rejects non-account actor $role", async (actor) => {
    const { onboarding, store } = service();
    await expect(onboarding.createOwnPlayer(actor, { username: "abc" }))
      .rejects.toMatchObject({ code: "forbidden" });
    expect(store.transactionCount).toBe(0);
  });

  it.each(["ab", "A_bc", "with space", "aaaaaaaaaaaaaaaaa", "émoji", ""])(
    "rejects invalid username %j",
    async (username) => {
      const { onboarding, store } = service();
      await expect(onboarding.createOwnPlayer(account, { username }))
        .rejects.toMatchObject({ code: "invalid_command" });
      expect(store.transactionCount).toBe(0);
    },
  );

  it("rejects control characters and blank display names", async () => {
    const { onboarding } = service();
    await expect(onboarding.createOwnPlayer(account, {
      username: "abc",
      displayName: "bad\u0000name",
    })).rejects.toMatchObject({ code: "invalid_command" });
    await expect(onboarding.createOwnPlayer(account, {
      username: "abc",
      displayName: "   ",
    })).rejects.toMatchObject({ code: "invalid_command" });
  });

  it("fails closed when the account is missing or inactive", async () => {
    for (const accountStatus of [null, "suspended"]) {
      const { onboarding } = service({ accountStatus });
      await expect(onboarding.createOwnPlayer(account, { username: "abc" }))
        .rejects.toMatchObject({ code: "conflict" });
    }
  });

  it("refuses a second Player for an already linked account", async () => {
    const { onboarding, store } = service({ linked: true });
    await expect(onboarding.createOwnPlayer(account, { username: "abc" }))
      .rejects.toMatchObject({ code: "already_linked" });
    expect(store.createdPlayers).toEqual([]);
  });

  it("surfaces username collisions without creating a claim", async () => {
    const { onboarding, store } = service({ usernameTaken: true });
    await expect(onboarding.createOwnPlayer(account, { username: "abc" }))
      .rejects.toMatchObject({ code: "username_taken" });
    expect(store.createdClaims).toEqual([]);
  });

  it("lets a display name repeat (ADR-0218): the username tells the two apart", async () => {
    const { onboarding, store } = service({});
    await expect(onboarding.createPlayerForAdministrator(administrator, {
      username: "ben_2",
      displayName: "Ben",
    })).resolves.toMatchObject({ username: "ben_2", displayName: "Ben" });
    expect(store.createdPlayers).toHaveLength(1);
    expect(store.createdClaims).toEqual([]);
  });

  it("exposes typed errors", () => {
    const error = new PlayerOnboardingError("username_taken", "taken");
    expect(error.name).toBe("PlayerOnboardingError");
    expect(error.code).toBe("username_taken");
  });
});
