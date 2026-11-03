import { describe, expect, it, vi } from "vitest";

import {
  TournamentOperationService,
  type TournamentRecord,
} from "../src/tournaments/tournament-operation-service.js";

// ADR-0177 decisions 2, 3 and 6: a director is an account holding either an
// administrator grant or the tournament.operation capability. An operator
// reaches their own Tournaments; only an administrator acts for someone else.

const BEN = "user_account.ben";
const EVAN = "user_account.evan";
const OUTSIDER = "user_account.outsider";

const accounts: Record<string, { internalId: number; isAdministrator: boolean }> = {
  [BEN]: { internalId: 1, isAdministrator: true },
  [EVAN]: { internalId: 2, isAdministrator: false },
};

const evansTournament: TournamentRecord = {
  internalId: 44,
  directorInternalId: 2,
  tournamentId: "tournament.synthetic_delegation",
  name: "Evans toernooi",
  seriesLabel: null,
  editionNumber: null,
  eventDate: "2026-08-29",
  startAtMs: 1_900_000_000_000,
  timezone: "Europe/Amsterdam",
  stage: "setup",
      ownerSeatingMode: "owner_strict",
      qualifierTieBreakMode: "sp",
      finalTieBreakMode: "sp",
  workflowStep: 2,
  qualifierRounds: true,
  maxParticipants: null,
  revision: 2,
  seedOrder: "ranked",
  placementStrategy: "balanced",
  publicResults: false,
  affectsRating: false,
  publicationId: null,
  publicationVisibility: null,
  finalizedAtMs: null,
  createdAtMs: 1_900_000_000_000,
  updatedAtMs: 1_900_000_000_000,
};

function serviceFor(listed: readonly number[] = []) {
  const listTournaments = vi.fn(async (_options: { directorInternalId?: number }) => []);
  const insertTournament = vi.fn(async () => 77);
  const transaction = {
    findTournamentOperatorAccount: vi.fn(async (publicId: string) => accounts[publicId] ?? null),
    findActiveAdministratorAccount: vi.fn(async (publicId: string) => {
      const account = accounts[publicId];
      return account !== undefined && account.isAdministrator ? account.internalId : null;
    }),
    listSelectableDirectors: vi.fn(async () => [
      { userAccountId: BEN, internalId: 1, displayName: "Ben", isAdministrator: true, hasCapability: false },
      { userAccountId: EVAN, internalId: 2, displayName: "Evan", isAdministrator: false, hasCapability: true },
    ]),
    findTournamentForUpdate: vi.fn(async () => evansTournament),
    findTournament: vi.fn(async () => evansTournament),
    loadGroups: vi.fn(async () => []),
    loadParticipants: vi.fn(async () => []),
    listTournaments,
    insertTournament,
  };
  void listed;
  const service = new TournamentOperationService({
    repository: { transaction: async (work: (t: unknown) => unknown) => work(transaction) },
    clock: { nowMs: () => 1_900_000_100_000 },
    ids: { newTournamentId: () => "tournament.new", newGroupId: () => "tournament_group.new" },
  } as never);
  return { service, transaction };
}

const administrator = (userAccountId: string) =>
  ({ role: "administrator", userAccountId }) as never;
const account = (userAccountId: string) =>
  ({ role: "account", userAccountId }) as never;

describe("Tournament director delegation", () => {
  it("offers only the acting operator to a director who is not an administrator", async () => {
    const { service } = serviceFor();
    const selectable = await service.listSelectableDirectors(account(EVAN));
    expect(selectable.canActForOthers).toBe(false);
    expect(selectable.directors.map((row) => row.userAccountId)).toEqual([EVAN]);
  });

  it("offers every director to an administrator", async () => {
    const { service } = serviceFor();
    const selectable = await service.listSelectableDirectors(administrator(BEN));
    expect(selectable.canActForOthers).toBe(true);
    expect(selectable.directors.map((row) => row.userAccountId)).toEqual([BEN, EVAN]);
  });

  it("refuses an account without any Tournament operator grant", async () => {
    const { service } = serviceFor();
    await expect(service.listSelectableDirectors(account(OUTSIDER))).rejects.toThrow();
  });

  it("scopes the Tournament list to the requested director for an administrator", async () => {
    const { service, transaction } = serviceFor();
    await service.listForAdministrator(administrator(BEN), { directorUserAccountId: EVAN });
    expect(transaction.listTournaments).toHaveBeenCalledWith(
      expect.objectContaining({ directorInternalId: 2 }),
    );
  });

  it("refuses a non-administrator who asks for another director's Tournaments", async () => {
    const { service } = serviceFor();
    await expect(
      service.listForAdministrator(account(EVAN), { directorUserAccountId: BEN }),
    ).rejects.toThrow();
  });

  it("lets a director past the gate on their own Tournament", async () => {
    // The fake transaction cannot complete the whole operation; what matters
    // here is that the director is not refused before it starts.
    const { service } = serviceFor();
    const failure = await service.addHistoricalParticipants!(
      account(EVAN), evansTournament.tournamentId, { expectedRevision: evansTournament.revision },
    ).catch((error: { code?: string }) => error);
    expect((failure as { code?: string }).code).not.toBe("forbidden");
  });

  it("refuses a director who opens another director's Tournament", async () => {
    const { service } = serviceFor();
    accounts[OUTSIDER] = { internalId: 3, isAdministrator: false };
    try {
      await expect(
        service.addHistoricalParticipants!(account(OUTSIDER), evansTournament.tournamentId, {
          expectedRevision: evansTournament.revision,
        }),
      ).rejects.toThrow();
    } finally {
      delete accounts[OUTSIDER];
    }
  });

  it("closes direct document loading across director ownership", async () => {
    const { service } = serviceFor();
    accounts[OUTSIDER] = { internalId: 3, isAdministrator: false };
    try {
      await expect(service.loadForAdministrator(account(OUTSIDER), evansTournament.tournamentId))
        .rejects.toThrow();
    } finally {
      delete accounts[OUTSIDER];
    }
  });

  it("closes draft deletion across director ownership", async () => {
    const { service } = serviceFor();
    accounts[OUTSIDER] = { internalId: 3, isAdministrator: false };
    try {
      await expect(service.deleteDraft(account(OUTSIDER), evansTournament.tournamentId, {
        expectedRevision: evansTournament.revision,
      }))
        .rejects.toThrow();
    } finally {
      delete accounts[OUTSIDER];
    }
  });
});
