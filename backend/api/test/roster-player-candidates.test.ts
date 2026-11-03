import { describe, expect, it, vi } from "vitest";

import { rosterCandidatesFor, type RosterCandidateContext } from "../src/tournaments/roster-player-candidates.js";
import {
  TournamentOperationService,
  type PlayerRecord,
  type TournamentRecord,
} from "../src/tournaments/tournament-operation-service.js";

// ADR-0218: a name is never an identity. These tests pin what the picker is
// told, never that anything links.

const player = (internalId: number, displayName: string, username: string): PlayerRecord => ({
  internalId, playerId: `player.${username.replace(/-/gu, "_")}`, username, displayName, visibility: "public", active: true,
});
const context = (record: PlayerRecord, extra: Partial<RosterCandidateContext> = {}): RosterCandidateContext => ({
  player: record, aliases: [], claimed: false, nights: 0, nightsWithDirector: 0, knownToDirector: false,
  lastNightName: null, lastNightDate: null, directorNames: [], characterKey: null, characterLabel: null,
  inTournament: false, ...extra,
});

const malA = context(player(1, "Mal", "mal"), {
  claimed: true, nights: 12, nightsWithDirector: 3, knownToDirector: true,
  lastNightName: "TN13", lastNightDate: "2026-10-04", directorNames: ["Ben"],
  characterKey: "character.yoshi", characterLabel: "Yoshi",
});
const malB = context(player(2, "Mal", "mal-2"), { nights: 2, directorNames: ["Evan"] });
const malie = context(player(3, "Malella", "malella"), {
  aliases: [{ text: "Malie", directorScoped: true }],
});
const sadler = context(player(4, "Sadler", "sadler"), {
  aliases: [{ text: "Soudler", directorScoped: false }], inTournament: true,
});

describe("roster candidates (ADR-0218)", () => {
  it("offers every Player a name may mean, with context, this Director's first", () => {
    const [entry] = rosterCandidatesFor(["mal"], [malB, malA, malie, sadler]);
    expect(entry!.sameNameInOwnNights).toBe(true);
    expect(entry!.candidates.map((candidate) => candidate.username)).toEqual(["mal", "mal-2"]);
    expect(entry!.candidates[0]).toEqual({
      playerId: "player.mal", username: "mal", displayName: "Mal", matchedBy: "display_name",
      claimed: true, inTournament: false, nights: 12, nightsWithDirector: 3,
      lastNightName: "TN13", lastNightDate: "2026-10-04", directorNames: ["Ben"],
      characterKey: "character.yoshi", characterLabel: "Yoshi",
    });
  });

  it("says a name is new to this Director when only another Director's Mal carries it", () => {
    const [entry] = rosterCandidatesFor(["Mal"], [malB]);
    expect(entry!.sameNameInOwnNights).toBe(false);
    expect(entry!.candidates).toHaveLength(1);
  });

  it("finds aliases (this Director's and installation-wide) and usernames, and says which name matched", () => {
    const [malieEntry, soudlerEntry, usernameEntry] = rosterCandidatesFor(["Malie", "Soudler", "mal-2"], [malA, malB, malie, sadler]);
    expect(malieEntry!.candidates).toEqual([expect.objectContaining({
      username: "malella", matchedBy: "alias", aliasText: "Malie", aliasScope: "director",
    })]);
    expect(soudlerEntry!.candidates).toEqual([expect.objectContaining({
      username: "sadler", matchedBy: "alias", aliasScope: "installation", inTournament: true,
    })]);
    expect(usernameEntry!.candidates).toEqual([expect.objectContaining({ username: "mal-2", matchedBy: "username" })]);
  });

  it("adds names that only contain what was typed when asked to, after the exact ones", () => {
    const [entry] = rosterCandidatesFor(["mal"], [malA, malB, malie, sadler], { partial: true });
    expect(entry!.candidates.map((candidate) => [candidate.username, candidate.matchedBy])).toEqual([
      ["mal", "display_name"], ["mal-2", "display_name"], ["malella", "partial"],
    ]);
    const [none] = rosterCandidatesFor(["Nobody"], [malA, malB], { partial: true });
    expect(none).toEqual({ name: "Nobody", sameNameInOwnNights: false, candidates: [] });
  });
});

const tournament: TournamentRecord = {
  internalId: 44, directorInternalId: 9, tournamentId: "tournament.synthetic_picker", name: "TN14",
  seriesLabel: "TN", editionNumber: 14, eventDate: "2026-11-08", startAtMs: 1_900_000_000_000,
  timezone: "Europe/Amsterdam", stage: "setup", ownerSeatingMode: "owner_strict", qualifierTieBreakMode: "sp",
  finalTieBreakMode: "sp", workflowStep: 2, qualifierRounds: true, maxParticipants: null, revision: 2,
  seedOrder: "ranked", placementStrategy: "balanced", publicResults: false, affectsRating: false,
  publicationId: null, publicationVisibility: null, finalizedAtMs: null,
  createdAtMs: 1_900_000_000_000, updatedAtMs: 1_900_000_000_000,
};

function serviceWith(operator: { internalId: number; isAdministrator: boolean }) {
  const transaction = {
    findTournamentOperatorAccount: vi.fn(async () => operator),
    findTournament: vi.fn(async () => tournament),
    listRosterCandidateContext: vi.fn(async () => [malA, malB]),
    resolvePlayers: vi.fn(async (ids: readonly string[]) => new Map(
      [malA.player, sadler.player].filter((entry) => ids.includes(entry.playerId)).map((entry) => [entry.playerId, entry] as const),
    )),
    insertDirectorAlias: vi.fn(async (input: { aliasText: string }) => input.aliasText === "Soudler" ? "exists" as const : "created" as const),
  };
  const service = new TournamentOperationService({
    repository: { transaction: async (work: (value: typeof transaction) => unknown) => work(transaction) } as never,
    raceResults: {} as never,
    publications: {} as never,
    rating: {} as never,
    ids: { newTournamentId: () => "unused", newGroupId: () => "unused" },
    clock: { nowMs: () => 1_900_000_001_000 },
  });
  return { service, transaction };
}

describe("roster picking in the operation service (ADR-0218)", () => {
  it("reads candidates from the Tournament's Director, so an administrator acting for Evan sees Evan's nights", async () => {
    const { service, transaction } = serviceWith({ internalId: 1, isAdministrator: true });
    const entries = await service.rosterPlayerCandidates(
      { role: "administrator", userAccountId: "user_account.ben" },
      { names: ["Mal"], tournamentId: tournament.tournamentId },
    );
    expect(transaction.listRosterCandidateContext).toHaveBeenCalledWith(9, 44);
    expect(entries[0]!.candidates).toHaveLength(2);
  });

  it("refuses another Director's Tournament for a delegated Director", async () => {
    const { service } = serviceWith({ internalId: 7, isAdministrator: false });
    await expect(service.rosterPlayerCandidates(
      { role: "account", userAccountId: "user_account.evan" },
      { names: ["Mal"], tournamentId: tournament.tournamentId },
    )).rejects.toMatchObject({ code: "forbidden" });
  });

  it("keeps a chosen spelling as the Director's own alias, never the Player's own names", async () => {
    const { service, transaction } = serviceWith({ internalId: 9, isAdministrator: false });
    const outcome = await service.rememberRosterAliases(
      { role: "account", userAccountId: "user_account.director" },
      tournament.tournamentId,
      { aliases: [
        { playerId: "player.mal", name: " Malie " },
        { playerId: "player.mal", name: "MAL" },
        { playerId: "player.sadler", name: "Soudler" },
      ] },
    );
    expect(outcome).toEqual({ created: [{ playerId: "player.mal", aliasText: "Malie" }], existing: 2 });
    expect(transaction.insertDirectorAlias).toHaveBeenCalledTimes(2);
    expect(transaction.insertDirectorAlias).toHaveBeenCalledWith(expect.objectContaining({
      playerInternalId: 1, directorInternalId: 9, actorInternalId: 9, aliasText: "Malie",
    }));
  });
});
