import { describe, expect, it } from "vitest";

import {
  TournamentOperationService,
  type TournamentOperationDependencies,
  type TournamentOperationTransaction,
} from "../src/tournaments/tournament-operation-service.js";

// A night that is coming or being raced is public reading: whoever finds the
// site should see that there is a tournament on Friday without an account.
// Running one is a different door. These pin the two halves of that rule, and
// the one thing a visitor is still not told: the name of an account.

const anonymous = { role: "anonymous" as const };
const account = { role: "account" as const, userAccountId: "user_account.reader" };

type Stage = "setup" | "qualifiers" | "finals" | "finalized";

function record(id: string, stage: Stage, publicResults: boolean) {
  return {
    tournamentId: id, internalId: 1, name: id, editionNumber: null, eventDate: null,
    startAtMs: null, timezone: null, stage, workflowStep: stage === "setup" ? 2 : 5,
    qualifierRounds: 1, revision: 1, publicResults, publicationVisibility: "public",
    publicationId: null, finalizedAtMs: null, directorInternalId: 7, updatedAtMs: 10,
  };
}

/** Only what these two reads touch; every other path is a different test. */
function serviceOver(rows: readonly ReturnType<typeof record>[]): TournamentOperationService {
  const transaction = {
    listTournaments: async (options: { includeUnfinalized: boolean }) => rows
      .filter((row) => options.includeUnfinalized || row.stage === "finalized")
      .map((row) => ({ record: row, participantCount: 12, presentCount: 12 })),
    listTournamentsPlayedBy: async () => [],
    listSelectableDirectors: async () => [
      { userAccountId: "user_account.director", internalId: 7, displayName: "Evan", isAdministrator: false, hasCapability: true },
    ],
    findTournament: async (id: string) => rows.find((row) => row.tournamentId === id) ?? null,
    loadParticipants: async () => [],
    loadGroups: async () => [],
    loadGroupRaces: async () => [],
    loadManualScores: async () => [],
    loadLifecycle: async () => [],
    loadStationCables: async () => [],
    loadLiveSeeds: async () => [],
    loadCompletedTournamentTimes: async () => [],
  } as unknown as TournamentOperationTransaction;
  return new TournamentOperationService({
    repository: { transaction: async <T>(run: (t: TournamentOperationTransaction) => Promise<T>) => run(transaction) },
    raceResults: {}, publications: {}, rating: {},
    ids: { newTournamentId: () => "tournament.x", newGroupId: () => "group.x" },
    clock: { nowMs: () => 1_000 },
  } as unknown as TournamentOperationDependencies);
}

describe("what a signed-out visitor may read", () => {
  it("lists a night that is coming and one that is being raced", async () => {
    const service = serviceOver([
      record("tournament.friday", "setup", false),
      record("tournament.tonight", "qualifiers", false),
    ]);
    const listed = await service.listPublic(anonymous);
    expect(listed.map((entry) => entry.tournamentId).sort())
      .toEqual(["tournament.friday", "tournament.tonight"]);
    expect(await service.loadPublic(anonymous, "tournament.friday")).not.toBeNull();
    expect(await service.loadPublic(anonymous, "tournament.tonight")).not.toBeNull();
  });

  it("still keeps a finished night that was never published", async () => {
    // Publishing a result stays the Director's own act.
    const service = serviceOver([record("tournament.hidden", "finalized", false)]);
    expect(await service.loadPublic(anonymous, "tournament.hidden")).toBeNull();
    expect(await service.loadPublic(account, "tournament.hidden")).toBeNull();
  });

  it("does not tell a visitor the Director's name, and does tell a reader", async () => {
    const service = serviceOver([record("tournament.friday", "setup", false)]);
    expect((await service.listPublic(anonymous))[0]!.directorDisplayName).toBeUndefined();
    expect((await service.listPublic(account))[0]!.directorDisplayName).toBe("Evan");
  });
});
