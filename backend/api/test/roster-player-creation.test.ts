import { describe, expect, it, vi } from "vitest";

import {
  PlayerOnboardingService,
  RosterPlayerCreationRejected,
  rosterUsernameFor,
  rosterUsernameWithSuffix,
} from "../src/identity/player-onboarding-service.js";

// ADR-0177 decisions 9 and 10 on top of ADR-0151's seeding rule, revised by
// ADR-0218: display names may repeat, usernames take the next free suffix and
// a name already in the Director's own nights needs an explicit confirmation.

const administrator = { role: "administrator", userAccountId: "user_account.ben" } as never;
const outsider = { role: "account", userAccountId: "user_account.outsider" } as never;

function serviceFor(options: Readonly<{
  outcomes?: Record<string, "created" | "username_taken">;
  takenUsernames?: readonly string[];
  ownNightNames?: readonly string[];
}> = {}) {
  const created: Array<{ username: string; displayName: string }> = [];
  const taken = new Set(options.takenUsernames ?? []);
  const createPlayerWithUsername = vi.fn(async (input: {
    playerId: string; username: string; displayName: string;
  }) => {
    const outcome = options.outcomes?.[input.displayName] ?? "created";
    if (outcome === "created") {
      created.push({ username: input.username, displayName: input.displayName });
      taken.add(input.username);
    }
    return outcome;
  });
  const displayNamesInDirectorNights = vi.fn(async (input: { displayNames: readonly string[]; tournamentId: string | null }) =>
    new Set(input.displayNames.map((name) => name.trim().toLowerCase())
      .filter((name) => (options.ownNightNames ?? []).map((own) => own.toLowerCase()).includes(name))));
  const transaction = {
    findUserAccountStatus: vi.fn(async () => "active"),
    hasVerifiedClaimForUserAccount: vi.fn(async () => false),
    createPlayerWithUsername,
    usernameTaken: vi.fn(async (username: string) => taken.has(username)),
    displayNamesInDirectorNights,
    createVerifiedClaim: vi.fn(async () => undefined),
  };
  let sequence = 0;
  const service = new PlayerOnboardingService(
    { transaction: async (work: (t: unknown) => unknown) => work(transaction) } as never,
    {
      newPlayerId: () => `player.synthetic_${(sequence += 1)}`,
      newPlayerClaimId: () => "player_claim.synthetic",
    },
    { nowMs: () => 1_900_000_000_000 },
  );
  return { service, created, createPlayerWithUsername, displayNamesInDirectorNights };
}

const rows = (...names: string[]) =>
  names.map((displayName, index) => ({ row: index + 2, displayName }));

describe("roster Player creation", () => {
  it("derives ADR-0151 usernames from display names", () => {
    expect(rosterUsernameFor("Moss HM")).toBe("moss_hm");
    expect(rosterUsernameFor("Damon D")).toBe("damon_d");
    expect(rosterUsernameFor("BertvandeGoei")).toBe("bertvandegoei");
    expect(rosterUsernameFor("José")).toBe("jose");
    expect(rosterUsernameFor("!!")).toBeNull();
  });

  it("suffixes a username so it keeps to 16 characters (ADR-0218)", () => {
    expect(rosterUsernameWithSuffix("mal", 1)).toBe("mal");
    expect(rosterUsernameWithSuffix("mal", 2)).toBe("mal-2");
    expect(rosterUsernameWithSuffix("bertvandegoei123", 2)).toBe("bertvandegoei1-2");
    expect(rosterUsernameWithSuffix("abcdefghijklm_op", 12)).toBe("abcdefghijklm-12");
  });

  it("creates every named Player for a Tournament operator", async () => {
    const { service, created } = serviceFor();
    const result = await service.createRosterPlayers(administrator, rows("Anselm", "Damon D"));
    expect(result.map((entry) => entry.username)).toEqual(["anselm", "damon_d"]);
    expect(created).toHaveLength(2);
  });

  it("refuses an account that is not a Tournament operator", async () => {
    const { service } = serviceFor();
    await expect(service.createRosterPlayers(outsider, rows("Anselm"))).rejects.toThrow();
  });

  it("rejects the whole file when one display name repeats in it, naming the row", async () => {
    const { service, createPlayerWithUsername } = serviceFor();
    const failure = await service.createRosterPlayers(
      administrator, rows("Anselm", "Ben", "anselm"),
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RosterPlayerCreationRejected);
    expect((failure as RosterPlayerCreationRejected).rejections).toEqual([
      { row: 4, displayName: "anselm", reason: "duplicate_display_name_in_file" },
    ]);
    // Nothing may be written when the file is rejected.
    expect(createPlayerWithUsername).not.toHaveBeenCalled();
  });

  it("gives two names that derive the same username the next free suffix", async () => {
    const { service } = serviceFor();
    const result = await service.createRosterPlayers(administrator, rows("Damon D", "damon-d"));
    expect(result.map((entry) => entry.username)).toEqual(["damon_d", "damon_d-2"]);
  });

  it("creates a second Mal elsewhere as mal-2 without a question", async () => {
    const { service, displayNamesInDirectorNights } = serviceFor({ takenUsernames: ["mal"] });
    const result = await service.createRosterPlayers(
      administrator, rows("Mal"), undefined, { tournamentId: "tournament.synthetic_night" },
    );
    expect(result).toEqual([{ playerId: "player.synthetic_1", username: "mal-2", displayName: "Mal" }]);
    expect(displayNamesInDirectorNights).toHaveBeenCalledWith(expect.objectContaining({
      tournamentId: "tournament.synthetic_night", displayNames: ["Mal"],
    }));
  });

  it("asks before a name that already exists in this Director's own nights", async () => {
    const { service, createPlayerWithUsername } = serviceFor({ takenUsernames: ["mal"], ownNightNames: ["Mal"] });
    const failure = await service.createRosterPlayers(administrator, rows("Anselm", "Mal"))
      .catch((error: unknown) => error);
    expect((failure as RosterPlayerCreationRejected).rejections).toEqual([
      { row: 3, displayName: "Mal", reason: "display_name_taken" },
    ]);
    expect(createPlayerWithUsername).not.toHaveBeenCalled();

    const confirmed = await service.createRosterPlayers(administrator, [
      { row: 2, displayName: "Mal", confirmSameName: true },
    ]);
    expect(confirmed.map((entry) => entry.username)).toEqual(["mal-2"]);
  });

  it("rejects the whole file when a username is taken at the last moment, naming the row", async () => {
    const { service } = serviceFor({ outcomes: { Ben: "username_taken" } });
    const failure = await service.createRosterPlayers(
      administrator, rows("Anselm", "Ben"),
    ).catch((error: unknown) => error);
    expect((failure as RosterPlayerCreationRejected).rejections).toEqual([
      { row: 3, displayName: "Ben", reason: "username_taken" },
    ]);
  });

  it("rejects a display name that cannot produce a valid username", async () => {
    const { service } = serviceFor();
    const failure = await service.createRosterPlayers(administrator, rows("!!")).catch(
      (error: unknown) => error,
    );
    expect((failure as RosterPlayerCreationRejected).rejections[0]?.reason)
      .toBe("invalid_display_name");
  });
});
