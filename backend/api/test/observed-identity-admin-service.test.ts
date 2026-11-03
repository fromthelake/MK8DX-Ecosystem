import { describe, expect, it } from "vitest";

import type { ActorContext } from "../src/identity/types.js";
import {
  ObservedIdentityAdminError,
  ObservedIdentityAdminService,
  type ObservedIdentityLink,
  type ObservedIdentityRepository,
} from "../src/tournament-history/observed-identity-admin-service.js";

const administrator: ActorContext = {
  role: "administrator", userAccountId: "user_account.ben",
};
const account: ActorContext = {
  role: "account", userAccountId: "user_account.someone",
};
const anonymous: ActorContext = { role: "anonymous" };

const link: ObservedIdentityLink = {
  linkId: "12", tournamentNumber: 7, sectionId: "3",
  sectionName: "Talent", legacySectionLabel: "TN7: 2e Divisie",
  observedName: "Wanda", playerId: "player.tobias", playerName: "Tobias",
  decisionSource: "derived", orderAgreement: 1, videoPoints: 242,
  historyPoints: 242, note: null, placements: 27,
};

function repository(
  overrides: Partial<ObservedIdentityRepository> = {},
): ObservedIdentityRepository & { assigned: unknown[] } {
  const assigned: unknown[] = [];
  return {
    assigned,
    async listLinks() { return [link]; },
    async listLinkablePlayers() {
      return [{
        playerId: "player.tobias", displayName: "Tobias", tournamentRaces: 92,
      }];
    },
    async assign(command) { assigned.push(command); return true; },
    async restoreDerived() { return true; },
    ...overrides,
  };
}

describe("ObservedIdentityAdminService", () => {
  it("is closed to anyone who is not an administrator", async () => {
    const service = new ObservedIdentityAdminService(repository());
    for (const actor of [anonymous, account]) {
      await expect(service.overview(actor))
        .rejects.toThrow(ObservedIdentityAdminError);
      await expect(service.assign(actor, {
        linkId: "12", playerId: "player.tobias",
      })).rejects.toThrow(ObservedIdentityAdminError);
      await expect(service.restoreDerived(actor, "12"))
        .rejects.toThrow(ObservedIdentityAdminError);
    }
  });

  it("hands back the links with the evidence behind them", async () => {
    const service = new ObservedIdentityAdminService(repository());
    const overview = await service.overview(administrator);
    expect(overview.links[0]!.observedName).toBe("Wanda");
    // The name on screen and the person behind it disagree, and a reviewer
    // needs to see the points that decided it.
    expect(overview.links[0]!.playerName).toBe("Tobias");
    expect(overview.links[0]!.videoPoints).toBe(242);
    expect(overview.players).toHaveLength(1);
  });

  it("records who decided and when", async () => {
    const store = repository();
    const service = new ObservedIdentityAdminService(store, () => 1_700_000);
    await service.assign(administrator, {
      linkId: "12", playerId: "player.wanda", note: "  it was Wanda after all ",
    });
    expect(store.assigned).toEqual([{
      linkId: "12", playerId: "player.wanda",
      note: "it was Wanda after all",
      decidedByUserAccountId: "user_account.ben",
      decidedAtMs: 1_700_000,
    }]);
  });

  it("stores no note rather than an empty one", async () => {
    const store = repository();
    const service = new ObservedIdentityAdminService(store, () => 1);
    await service.assign(administrator, {
      linkId: "12", playerId: "player.wanda", note: "   ",
    });
    expect((store.assigned[0] as { note: unknown }).note).toBeNull();
  });

  it("refuses a reference that is not a reference", async () => {
    const service = new ObservedIdentityAdminService(repository());
    await expect(service.assign(administrator, {
      linkId: "12; DROP TABLE players", playerId: "player.wanda",
    })).rejects.toThrow(/link reference is invalid/);
    await expect(service.assign(administrator, {
      linkId: "12", playerId: "../../players",
    })).rejects.toThrow(/Player reference is invalid/);
  });

  it("refuses a note longer than the column can hold", async () => {
    const service = new ObservedIdentityAdminService(repository());
    await expect(service.assign(administrator, {
      linkId: "12", playerId: "player.wanda", note: "x".repeat(241),
    })).rejects.toThrow(/at most 240/);
  });

  it("says so when the seat no longer exists", async () => {
    const service = new ObservedIdentityAdminService(
      repository({ async assign() { return false; } }));
    await expect(service.assign(administrator, {
      linkId: "999", playerId: "player.wanda",
    })).rejects.toMatchObject({ code: "not_found" });
  });

  it("can hand a seat back to the binder", async () => {
    let restored: string | null = null;
    const service = new ObservedIdentityAdminService(repository({
      async restoreDerived(linkId) { restored = linkId; return true; },
    }));
    await service.restoreDerived(administrator, "12");
    expect(restored).toBe("12");
  });
});
