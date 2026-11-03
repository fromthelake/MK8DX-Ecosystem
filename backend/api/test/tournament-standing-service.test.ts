import { describe, expect, it } from "vitest";

import {
  rankStanding,
  TournamentStandingError,
  TournamentStandingService,
  type TournamentRivalry,
  type TournamentSharedRaces,
  type TournamentStandingEntry,
  type TournamentStandingRepository,
} from "../src/tournaments/tournament-standing-service.js";

function entry(
  overrides: Partial<Omit<TournamentStandingEntry, "rank">> = {},
): Omit<TournamentStandingEntry, "rank"> {
  return {
    playerId: "player.ben",
    username: "ben",
    displayName: "Ben",
    score: 30,
    tournaments: 4,
    races: 40,
    wins: 8,
    podiums: 20,
    points: 380,
    finishPositionTotal: 140,
    finishes: [8, 6, 6, 5, 4, 3, 3, 2, 1, 1, 1, 0],
    ...overrides,
  };
}

class FakeRepository implements TournamentStandingRepository {
  public constructor(
    private readonly entries: readonly Omit<TournamentStandingEntry, "rank">[] = [],
    private readonly opponents: readonly TournamentRivalry[] = [],
  ) {}
  public standingLimit = 0;
  public rivalryPlayer: string | null = null;

  async listStanding(limit: number): Promise<readonly TournamentStandingEntry[]> {
    this.standingLimit = limit;
    return rankStanding(this.entries);
  }

  async listRivalries(playerId: string): Promise<readonly TournamentRivalry[]> {
    this.rivalryPlayer = playerId;
    return this.opponents;
  }

  public sharedAsked: readonly string[] | null = null;
  public shared: TournamentSharedRaces = { sharedRaces: 0, entries: [] };

  async listSharedRaces(playerIds: readonly string[]): Promise<TournamentSharedRaces> {
    this.sharedAsked = playerIds;
    return this.shared;
  }
}

describe("the Tournament standing", () => {
  it("ranks by skill, and puts an unrated Player behind every rated one", () => {
    const { score: _unrated, ...evan } = entry({
      playerId: "player.evan", username: "evan", races: 90,
    });
    const ranked = rankStanding([
      entry({ playerId: "player.nova", username: "nova", score: 25 }),
      evan,
      entry({ playerId: "player.ben", username: "ben", score: 31 }),
    ]);
    expect(ranked.map((row) => row.playerId)).toEqual([
      "player.ben", "player.nova", "player.evan",
    ]);
    expect(ranked.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it("separates two unrated Players by how much they have actually raced", () => {
    const { score: _quiet, ...quiet } = entry({ playerId: "player.a", username: "a", races: 12 });
    const { score: _busy, ...busy } = entry({ playerId: "player.b", username: "b", races: 60 });
    const ranked = rankStanding([quiet, busy]);
    expect(ranked.map((row) => row.playerId)).toEqual(["player.b", "player.a"]);
  });

  it("is stable when two Players hold exactly the same skill", () => {
    const ranked = rankStanding([
      entry({ playerId: "player.zoe", username: "zoe", score: 20, races: 10 }),
      entry({ playerId: "player.amy", username: "amy", score: 20, races: 10 }),
    ]);
    expect(ranked.map((row) => row.playerId)).toEqual(["player.amy", "player.zoe"]);
  });

  it("asks for the whole community, not a page of it", async () => {
    const repository = new FakeRepository([entry()]);
    const service = new TournamentStandingService(repository);
    await service.standing();
    expect(repository.standingLimit).toBe(200);
  });

  it("refuses a Player id that is not one", async () => {
    const service = new TournamentStandingService(new FakeRepository());
    await expect(service.rivalries("../etc/passwd")).rejects.toBeInstanceOf(
      TournamentStandingError,
    );
    await expect(service.rivalries("player.ben")).resolves.toEqual([]);
  });

  it("turns a persistence failure into an unavailable answer", async () => {
    const service = new TournamentStandingService({
      async listStanding() { throw new Error("database is gone"); },
      async listRivalries() { throw new Error("database is gone"); },
      async listSharedRaces() { throw new Error("database is gone"); },
    });
    await expect(service.standing()).rejects.toMatchObject({ code: "unavailable" });
    await expect(service.rivalries("player.ben"))
      .rejects.toMatchObject({ code: "unavailable" });
    await expect(service.sharedRaces(["player.ben", "player.nova"]))
      .rejects.toMatchObject({ code: "unavailable" });
  });
});

/**
 * A comparison counts only the races every compared Player finished (owner,
 * 2026-09-17): the main Player with one other, or with two.
 */
describe("a comparison over shared races", () => {
  const record = (playerId: string, races: number) => ({
    playerId, races, wins: 1, podiums: 2, points: races * 8,
    finishPositionTotal: races * 4,
    finishes: [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, races - 2],
  });

  it("takes the main Player with one other, or with two", async () => {
    const repository = new FakeRepository();
    const service = new TournamentStandingService(repository);
    await service.sharedRaces(["player.ben", "player.matteo"]);
    expect(repository.sharedAsked).toEqual(["player.ben", "player.matteo"]);
    await service.sharedRaces(["player.ben", "player.matteo", "player.valerio"]);
    expect(repository.sharedAsked).toHaveLength(3);
  });

  it("refuses one Player, four Players, a repeat, or a bad id", async () => {
    const service = new TournamentStandingService(new FakeRepository());
    for (const ask of [
      ["player.ben"],
      ["player.a", "player.b", "player.c", "player.d"],
      ["player.ben", "player.ben"],
      ["player.ben", "../etc/passwd"],
    ]) {
      await expect(service.sharedRaces(ask)).rejects.toMatchObject({ code: "invalid_input" });
    }
  });

  it("answers in the order asked, with zeros when nothing was shared", async () => {
    const repository = new FakeRepository();
    const service = new TournamentStandingService(repository);
    repository.shared = {
      sharedRaces: 105,
      entries: [record("player.valerio", 105), record("player.ben", 105), record("player.matteo", 105)],
    };
    const shared = await service.sharedRaces(["player.ben", "player.matteo", "player.valerio"]);
    expect(shared.sharedRaces).toBe(105);
    expect(shared.entries.map((row) => row.playerId))
      .toEqual(["player.ben", "player.matteo", "player.valerio"]);

    repository.shared = { sharedRaces: 0, entries: [] };
    const none = await service.sharedRaces(["player.ben", "player.nova"]);
    expect(none.sharedRaces).toBe(0);
    expect(none.entries.map((row) => [row.playerId, row.races, row.finishes.length]))
      .toEqual([["player.ben", 0, 12], ["player.nova", 0, 12]]);
  });
});
