import { describe, expect, it } from "vitest";
import type { FieldPacket, QueryResult, ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

import {
  MysqlTournamentWriteRepository,
  TournamentPersistenceError,
} from "../src/tournaments/mysql-tournament-write-repository.js";
import {
  TournamentResultServiceError,
  type TournamentRevisionPersistenceInput,
} from "../src/tournaments/race-result-service.js";

class SyntheticConnection {
  readonly calls: { sql: string; values: unknown[] }[] = [];
  began = 0;
  committed = 0;
  rolledBack = 0;
  released = 0;

  public constructor(private readonly results: QueryResult[] = []) {}

  async beginTransaction(): Promise<void> { this.began += 1; }
  async commit(): Promise<void> { this.committed += 1; }
  async rollback(): Promise<void> { this.rolledBack += 1; }
  release(): void { this.released += 1; }

  async execute<T extends QueryResult>(sql: string, values?: any[]): Promise<[T, FieldPacket[]]> {
    this.calls.push({ sql, values: values ?? [] });
    const result = this.results.shift();
    if (result === undefined) { throw new Error("synthetic connection has no queued result"); }
    return [result as T, []];
  }
}

function repository(connection: SyntheticConnection): MysqlTournamentWriteRepository {
  return new MysqlTournamentWriteRepository({
    getConnection: async () => connection as unknown as PoolConnection,
  } as unknown as Pool);
}

function header(insertId = 0): ResultSetHeader {
  return { affectedRows: 1, insertId } as ResultSetHeader;
}

function persistenceInput(): TournamentRevisionPersistenceInput {
  return {
    revision: {
      schemaVersion: "mk8dx.tournament-race-result.v1",
      raceResultId: "tournament_race_result.synthetic_mysql_adapter_01",
      revision: 1,
      raceNumber: 1,
      scoringSegment: 1,
      mode: 150,
      trackId: "track.mario_kart_stadium",
      countsTowardStandings: true,
      observedGroupLabel: "Group Alpha",
      source: { kind: "tournament_recorded_video", transport: "native_contract" },
      timestamps: { createdAtMs: 1_900_000_000_000 },
      verification: { status: "needs_review" },
    },
    placements: [
      {
        finishPosition: 1,
        observedPlayerName: "Central Racer",
        characterId: "character.mario",
        scoring: { racePoints: 15, totalBeforeRace: 0, totalAfterRace: 15, rankAfterRace: 1 },
        playerId: "player.synthetic_tournament_adapter_01",
        restrictedParticipant: null,
      },
      {
        finishPosition: 2,
        observedPlayerName: "Observed Racer",
        scoring: { racePoints: 12, totalBeforeRace: 0, totalAfterRace: 12, rankAfterRace: 2 },
        playerId: null,
        restrictedParticipant: {
          namespace: "unresolved_observation",
          lookupHmac: new Uint8Array(32).fill(1),
          lookupKeyVersion: "lookup-v1",
          ciphertext: new Uint8Array([1, 2, 3]),
          encryptionKeyVersion: "encryption-v1",
        },
      },
    ],
    protectedContext: [{
      contextKind: "group",
      namespace: "producer_local_group",
      lookupHmac: new Uint8Array(32).fill(2),
      lookupKeyVersion: "lookup-v1",
      ciphertext: new Uint8Array([4, 5, 6]),
      encryptionKeyVersion: "encryption-v1",
    }],
    protectedEvidence: [{
      sequenceNumber: 1,
      kind: "race_score_screen",
      protectedReference: {
        ciphertext: new Uint8Array([7, 8, 9]),
        encryptionKeyVersion: "encryption-v1",
      },
    }],
    protectedIssues: [{
      sequenceNumber: 1,
      code: "capture.synthetic_review",
      protectedMessage: {
        ciphertext: new Uint8Array([10, 11, 12]),
        encryptionKeyVersion: "encryption-v1",
      },
    }],
  };
}

describe("MySQL Tournament write repository", () => {
  it("commits success and rolls back/translates duplicate races", async () => {
    const successful = new SyntheticConnection();
    await expect(repository(successful).transaction(async () => "ok")).resolves.toBe("ok");
    expect(successful).toMatchObject({ began: 1, committed: 1, rolledBack: 0, released: 1 });

    const duplicate = new SyntheticConnection();
    await expect(repository(duplicate).transaction(async () => {
      throw Object.assign(new Error("private index detail"), { errno: 1062 });
    })).rejects.toEqual(new TournamentResultServiceError(
      "revision_conflict",
      "Tournament result identity or revision was occupied concurrently",
    ));
    expect(duplicate).toMatchObject({ rolledBack: 1, released: 1 });
  });

  it("locks and strictly maps stable result revision state", async () => {
    const connection = new SyntheticConnection([
      [{ resultInternalId: "7", firstCreatedAtMs: "1900000000000" } as RowDataPacket],
      [{ latestRevision: "2" } as RowDataPacket],
    ]);
    await expect(repository(connection).transaction((transaction) =>
      transaction.findRaceResultForUpdate(
        "tournament_race_result.synthetic_mysql_adapter_01",
      ),
    )).resolves.toEqual({ firstCreatedAtMs: 1_900_000_000_000, latestRevision: 2 });
    expect(connection.calls[0]?.sql).toContain("FOR UPDATE");
    expect(connection.calls[0]?.values).toEqual([
      "tournament_race_result.synthetic_mysql_adapter_01",
    ]);
  });

  it("locks active Players with bounded placeholders and strict output", async () => {
    const connection = new SyntheticConnection([[
      { internalId: 1, publicId: "player.synthetic_01" } as RowDataPacket,
      { internalId: 2, publicId: "player.synthetic_02" } as RowDataPacket,
    ]]);
    await expect(repository(connection).transaction((transaction) =>
      transaction.findActiveHumanPlayersForUpdate([
        "player.synthetic_02", "player.synthetic_01", "player.synthetic_01",
      ]),
    )).resolves.toEqual(new Set(["player.synthetic_01", "player.synthetic_02"]));
    expect(connection.calls[0]?.sql.match(/\?/g)).toHaveLength(2);
    expect(connection.calls[0]?.sql).toContain("FOR UPDATE");

    const oversized = new SyntheticConnection();
    await expect(repository(oversized).transaction((transaction) =>
      transaction.findActiveHumanPlayersForUpdate(
        Array.from({ length: 13 }, (_, index) => `player.synthetic_${index}`),
      ),
    )).rejects.toThrow("exceeds race bounds");
    expect(oversized.calls).toEqual([]);
  });

  it("writes placements and every restricted union kind with placeholders", async () => {
    const connection = new SyntheticConnection([
      [{ resultInternalId: 8, firstCreatedAtMs: 1 } as RowDataPacket],
      header(20),
      [{ internalId: 9, publicId: "player.synthetic_tournament_adapter_01" } as RowDataPacket],
      header(30),
      header(31),
      header(), header(), header(), header(),
    ]);
    const input = persistenceInput();
    await repository(connection).transaction((transaction) =>
      transaction.insertRevision(input),
    );

    const restrictedCalls = connection.calls.filter((call) =>
      call.sql.includes("INSERT INTO restricted_tournament_race_data"),
    );
    expect(restrictedCalls).toHaveLength(4);
    expect(restrictedCalls.map((call) => call.values[2])).toEqual([
      "participant_reference",
      "context_reference",
      "evidence_reference",
      "verification_issue",
    ]);
    expect(connection.calls.filter((call) =>
      call.sql.includes("INSERT INTO tournament_race_placements"),
    )).toHaveLength(2);
    expect(connection.calls.every((call) =>
      !call.sql.includes(input.revision.raceResultId),
    )).toBe(true);
  });

  it("rejects raw or structurally inconsistent commands before SQL", async () => {
    const raw = persistenceInput() as any;
    raw.placements[1].participantReference = {
      namespace: "unresolved_observation",
      value: "private-raw-value",
    };
    const rawConnection = new SyntheticConnection();
    await expect(repository(rawConnection).transaction((transaction) =>
      transaction.insertRevision(raw),
    )).rejects.toBeInstanceOf(TournamentPersistenceError);
    expect(rawConnection.calls).toEqual([]);

    const sequence = persistenceInput() as any;
    sequence.protectedEvidence[0].sequenceNumber = 2;
    const sequenceConnection = new SyntheticConnection();
    await expect(repository(sequenceConnection).transaction((transaction) =>
      transaction.insertRevision(sequence),
    )).rejects.toThrow("restricted sequence invariant failed");
    expect(sequenceConnection.calls).toEqual([]);
  });
});
