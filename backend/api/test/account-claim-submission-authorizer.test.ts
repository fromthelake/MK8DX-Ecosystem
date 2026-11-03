import { describe, expect, it } from "vitest";

import { AccountClaimTimeTrialSubmissionAuthorizer } from
  "../src/timetrials/account-claim-submission-authorizer.js";
import { isAccountClaimNativeTimeTrialSource } from
  "../src/timetrials/account-claim-submission-authorizer.js";
import type { TimeTrialSubmissionAuthorizationContext } from
  "../src/timetrials/submission-routes.js";

const allowed: TimeTrialSubmissionAuthorizationContext = {
  actor: { role: "account", userAccountId: "user_account.synthetic_01" },
  sourceKind: "android_manual",
  playerReferenceNamespace: "player",
  centralPlayerId: "player.synthetic_01",
  revision: 1,
};

describe("account-claim native Time Trial submission authorization", () => {
  it("classifies only the four native V1 producers", () => {
    for (const sourceKind of [
      "android_manual",
      "android_scan",
      "livetrial_capture",
      "livetrial_recorded_video",
    ]) {
      expect(isAccountClaimNativeTimeTrialSource(sourceKind)).toBe(true);
    }
    for (const sourceKind of ["web_manual", "firebase_legacy", "unknown"]) {
      expect(isAccountClaimNativeTimeTrialSource(sourceKind)).toBe(false);
    }
  });

  it("allows every native producer only for the account's verified Player", async () => {
    const authorizer = new AccountClaimTimeTrialSubmissionAuthorizer({
      async findVerifiedPlayerForAccount() {
        return { playerId: "player.synthetic_01", username: "synthetic01", displayName: "Synthetic 01" };
      },
    });
    for (const sourceKind of [
      "android_manual",
      "android_scan",
      "livetrial_capture",
      "livetrial_recorded_video",
    ] as const) {
      await expect(authorizer.authorize({ ...allowed, sourceKind })).resolves.toBe(true);
    }
  });

  it("denies web, anonymous, migration, unresolved, missing, or another Player", async () => {
    const authorizer = new AccountClaimTimeTrialSubmissionAuthorizer({
      async findVerifiedPlayerForAccount() {
        return { playerId: "player.synthetic_01", username: "synthetic01", displayName: "Synthetic 01" };
      },
    });
    for (const candidate of [
      { ...allowed, sourceKind: "web_manual" as const },
      { ...allowed, actor: { role: "anonymous" as const } },
      { ...allowed, actor: {
        role: "migration_operator" as const,
      } },
      {
        ...allowed,
        playerReferenceNamespace: "unresolved_observation" as const,
        centralPlayerId: null,
      },
      { ...allowed, centralPlayerId: "player.other" },
    ]) {
      await expect(authorizer.authorize(candidate)).resolves.toBe(false);
    }
    const missing = new AccountClaimTimeTrialSubmissionAuthorizer({
      async findVerifiedPlayerForAccount() { return null; },
    });
    await expect(missing.authorize(allowed)).resolves.toBe(false);
  });
});
