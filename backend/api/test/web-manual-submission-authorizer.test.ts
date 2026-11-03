import { describe, expect, it, vi } from "vitest";

import { WebManualSubmissionAuthorizer } from
  "../src/timetrials/web-manual-submission-authorizer.js";
import type { TimeTrialSubmissionAuthorizationContext } from
  "../src/timetrials/submission-routes.js";


const allowed: TimeTrialSubmissionAuthorizationContext = {
  actor: {
    role: "account",
    userAccountId: "user_account.web_manual_owner_01",
  },
  sourceKind: "web_manual",
  playerReferenceNamespace: "player",
  centralPlayerId: "player.web_manual_owner_01",
  revision: 1,
};

function harness(playerId: string | null = "player.web_manual_owner_01") {
  const findVerifiedPlayerForAccount = vi.fn(async () =>
    playerId === null
      ? null
      : { playerId, username: "web_manual_01", displayName: "Web Manual 01" });
  return {
    findVerifiedPlayerForAccount,
    authorizer: new WebManualSubmissionAuthorizer({
      findVerifiedPlayerForAccount,
    }),
  };
}

describe("verified-claim web manual submission authorization", () => {
  it("allows only the claimed central Player for the authenticated account", async () => {
    const test = harness();
    await expect(test.authorizer.authorize(allowed)).resolves.toBe(true);
    expect(test.findVerifiedPlayerForAccount).toHaveBeenCalledWith(
      "user_account.web_manual_owner_01",
    );
  });

  it("denies missing or different verified claims", async () => {
    await expect(harness(null).authorizer.authorize(allowed)).resolves.toBe(false);
    await expect(harness("player.someone_else").authorizer.authorize(allowed))
      .resolves.toBe(false);
  });

  it("denies wrong source, revision, namespace, identity, and actor before lookup", async () => {
    const invalid: TimeTrialSubmissionAuthorizationContext[] = [
      { ...allowed, sourceKind: "android_manual" },
      { ...allowed, revision: 2 },
      {
        ...allowed,
        playerReferenceNamespace: "producer_local_profile",
        centralPlayerId: null,
      },
      { ...allowed, centralPlayerId: null },
      { ...allowed, actor: { role: "anonymous" } },
      { ...allowed, actor: { role: "migration_operator" } },
    ];
    for (const context of invalid) {
      const test = harness();
      await expect(test.authorizer.authorize(context)).resolves.toBe(false);
      expect(test.findVerifiedPlayerForAccount).not.toHaveBeenCalled();
    }
  });

  it("propagates repository failure to the route's bounded 500 boundary", async () => {
    const repository = {
      findVerifiedPlayerForAccount: vi.fn(async () => {
        throw new Error("private claim SQL detail");
      }),
    };
    await expect(new WebManualSubmissionAuthorizer(repository).authorize(allowed))
      .rejects.toThrow("private claim SQL detail");
  });
});
