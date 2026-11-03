import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import {
  NativeTimeTrialSessionError,
  NativeTimeTrialSessionService,
} from "../src/timetrials/native-session-service.js";
import type { IdentityReadRepository } from "../src/identity/types.js";

const emptyIdentity: IdentityReadRepository = {
  async findPublicPlayerById() { return null; },
  async findUserAccountSummaryById() { return null; },
  async findPlayerClaimSummaryById() { return null; },
};

describe("native Time Trial session", () => {
  it("returns only the separately verified claimed Player", async () => {
    const service = new NativeTimeTrialSessionService({
      async findVerifiedPlayerForAccount(userAccountId) {
        expect(userAccountId).toBe("user_account.synthetic_01");
        return { playerId: "player.synthetic_01", username: "synthetic01", displayName: "Synthetic 01" };
      },
    });
    await expect(service.bootstrap({
      role: "account",
      userAccountId: "user_account.synthetic_01",
    })).resolves.toEqual({
      schemaVersion: "mk8dx.native-time-trial-bootstrap.v1",
      playerId: "player.synthetic_01",
    });
  });

  it("names the Player only on the v2 bootstrap; v1 stays identifier-only", async () => {
    const service = new NativeTimeTrialSessionService({
      async findVerifiedPlayerForAccount() {
        return {
          playerId: "player.synthetic_01",
          username: "synthetic01",
          displayName: "Synthetic 01",
        };
      },
    });
    await expect(service.bootstrapV2({
      role: "account",
      userAccountId: "user_account.synthetic_01",
    })).resolves.toEqual({
      schemaVersion: "mk8dx.native-time-trial-bootstrap.v2",
      playerId: "player.synthetic_01",
      username: "synthetic01",
      displayName: "Synthetic 01",
    });
    const app = await buildApp({
      identityRepository: emptyIdentity,
      resolveActor: async () => ({
        role: "account",
        userAccountId: "user_account.synthetic_01",
      }),
      nativeTimeTrialSession: { service },
    });
    try {
      const v1 = await app.inject({
        method: "GET",
        url: "/v1/time-trial-submissions/native-bootstrap",
      });
      // Installed v1 parsers reject unknown keys, so v1 must never grow.
      expect(Object.keys(v1.json()).sort()).toEqual(["playerId", "schemaVersion"]);
      const v2 = await app.inject({
        method: "GET",
        url: "/v1/time-trial-submissions/native-bootstrap-v2",
      });
      expect(v2.statusCode).toBe(200);
      expect(v2.headers["cache-control"]).toBe("no-store");
      expect(v2.json()).toEqual({
        schemaVersion: "mk8dx.native-time-trial-bootstrap.v2",
        playerId: "player.synthetic_01",
        username: "synthetic01",
        displayName: "Synthetic 01",
      });
    } finally {
      await app.close();
    }
  });

  it("fails anonymous, unclaimed, migration, invalid, and repository states closed", async () => {
    const candidates = [
      new NativeTimeTrialSessionService({
        async findVerifiedPlayerForAccount() { return null; },
      }).bootstrap({ role: "account", userAccountId: "user_account.synthetic_01" }),
      new NativeTimeTrialSessionService({
        async findVerifiedPlayerForAccount() { return { playerId: "bad-player", username: "synthetic01", displayName: "Synthetic 01" }; },
      }).bootstrap({ role: "account", userAccountId: "user_account.synthetic_01" }),
      new NativeTimeTrialSessionService({
        async findVerifiedPlayerForAccount() { throw new Error("private detail"); },
      }).bootstrap({ role: "account", userAccountId: "user_account.synthetic_01" }),
      new NativeTimeTrialSessionService({
        async findVerifiedPlayerForAccount() { throw new Error("must not run"); },
      }).bootstrap({ role: "anonymous" }),
      new NativeTimeTrialSessionService({
        async findVerifiedPlayerForAccount() { throw new Error("must not run"); },
      }).bootstrap({ role: "migration_operator" }),
    ];
    for (const candidate of candidates) {
      await expect(candidate).rejects.toBeInstanceOf(NativeTimeTrialSessionError);
    }
  });

  it("maps route authentication and claim failures without private detail", async () => {
    for (const [error, status, code] of [
      [new NativeTimeTrialSessionError("not_authenticated"), 401,
        "native_time_trial_authentication_required"],
      [new NativeTimeTrialSessionError("not_authorized"), 403,
        "native_time_trial_player_required"],
      [new Error("private repository detail"), 500,
        "native_time_trial_session_failed"],
    ] as const) {
      const app = await buildApp({
        identityRepository: emptyIdentity,
        nativeTimeTrialSession: {
          service: {
            async bootstrap() { throw error; },
            async bootstrapV2() { throw error; },
          },
        },
      });
      try {
        const response = await app.inject({
          method: "GET",
          url: "/v1/time-trial-submissions/native-bootstrap",
        });
        expect(response.statusCode).toBe(status);
        expect(response.json()).toMatchObject({ code });
        expect(response.body).not.toContain("private repository detail");
      } finally {
        await app.close();
      }
    }
  });

  it("marks a successful bootstrap private and non-cacheable", async () => {
    const app = await buildApp({
      identityRepository: emptyIdentity,
      nativeTimeTrialSession: {
        service: {
          async bootstrap() {
            return {
              schemaVersion: "mk8dx.native-time-trial-bootstrap.v1" as const,
              playerId: "player.synthetic_01",
            };
          },
          async bootstrapV2() {
            return {
              schemaVersion: "mk8dx.native-time-trial-bootstrap.v2" as const,
              playerId: "player.synthetic_01",
              username: "synthetic01",
              displayName: "Synthetic 01",
            };
          },
        },
      },
    });
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/time-trial-submissions/native-bootstrap",
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
    } finally {
      await app.close();
    }
  });
});
