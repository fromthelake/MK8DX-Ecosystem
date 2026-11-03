import { describe, expect, it } from "vitest";
import type { FieldPacket, QueryResult, ResultSetHeader } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

import {
  MysqlTournamentReadRepository,
  TournamentReadPersistenceError,
} from "../src/tournaments/mysql-tournament-read-repository.js";

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

function repository(connection: SyntheticConnection): MysqlTournamentReadRepository {
  return new MysqlTournamentReadRepository({
    getConnection: async () => connection as unknown as PoolConnection,
  } as unknown as Pool);
}

function header(affectedRows = 1): ResultSetHeader {
  return { affectedRows } as ResultSetHeader;
}

const request = {
  raceResultId: "tournament_race_result.synthetic_read_01",
  revision: 2,
  accessorUserAccountId: "user_account.admin",
  purposeCode: "administrative_review",
  accessedAtMs: 1_900_000_000_000,
};

function revisionRow() {
  return {
    revisionInternalId: 21,
    schemaVersion: "mk8dx.tournament-race-result.v1",
    raceResultId: request.raceResultId,
    revision: 2,
    raceNumber: 4,
    scoringSegment: 1,
    mode: 150,
    trackId: "track.mario_kart_stadium",
    countsTowardStandings: 1,
    scoringNote: null,
    observedStageLabel: "Final",
    observedGroupLabel: null,
    sourceKind: "tournament_live_capture",
    sourceTransport: "native_contract",
    producerVersion: "synthetic-v1",
    localRecordId: "race-4",
    sessionId: "session-1",
    streamId: null,
    sourceMediaId: null,
    raceOffsetMs: 1000,
    frameIndex: 42,
    occurredAtMs: 1_899_999_999_000,
    capturedAtMs: null,
    createdAtMs: 1_900_000_000_000,
    submittedAtMs: null,
    verificationStatus: "needs_review",
    verificationMethod: "operator_review",
    verificationConfidence: "0.9",
    confidenceTrack: "0.8",
    confidencePlayerCount: null,
    confidenceFinishPositions: null,
    confidencePlayerNames: null,
    confidenceCharacters: null,
    confidenceRacePoints: null,
    confidenceTotalScores: null,
  };
}

function placementRows() {
  return [
    {
      placementInternalId: 31,
      finishPosition: 1,
      participantKind: "player",
      playerId: "player.central_1",
      observedPlayerName: "Central",
      characterId: "character.mario",
      characterVariantId: null,
      racePoints: 15,
      totalBeforeRace: 10,
      totalAfterRace: 25,
      rankAfterRace: 1,
      confidenceFinishPosition: "0.95",
      confidencePlayerName: null,
      confidenceCharacter: null,
      confidenceRacePoints: null,
      confidenceTotalAfterRace: null,
    },
    {
      placementInternalId: 32,
      finishPosition: 2,
      participantKind: "restricted_reference",
      playerId: null,
      observedPlayerName: "Observed",
      characterId: null,
      characterVariantId: null,
      racePoints: 12,
      totalBeforeRace: 5,
      totalAfterRace: 17,
      rankAfterRace: 2,
      confidenceFinishPosition: null,
      confidencePlayerName: null,
      confidenceCharacter: null,
      confidenceRacePoints: null,
      confidenceTotalAfterRace: null,
    },
  ];
}

function restrictedRows(): Record<string, unknown>[] {
  return [
    {
      resourceId: 41,
      placementInternalId: 32,
      dataKind: "participant_reference",
      sequenceNumber: null,
      subtype: "unresolved_observation",
      referenceNamespace: null,
      ciphertext: Buffer.from([0x11]),
      encryptionKeyVersion: "enc-v1",
      sha256: null,
      mediaType: null,
    },
    {
      resourceId: 42,
      placementInternalId: null,
      dataKind: "context_reference",
      sequenceNumber: null,
      subtype: "tournament",
      referenceNamespace: "tournament_slug",
      ciphertext: Buffer.from([0x22]),
      encryptionKeyVersion: "enc-v1",
      sha256: null,
      mediaType: null,
    },
    {
      resourceId: 43,
      placementInternalId: null,
      dataKind: "evidence_reference",
      sequenceNumber: 1,
      subtype: "race_score_screen",
      referenceNamespace: null,
      ciphertext: Buffer.from([0x33]),
      encryptionKeyVersion: "enc-v1",
      sha256: Buffer.alloc(32, 0xaa),
      mediaType: "image/png",
    },
    {
      resourceId: 44,
      placementInternalId: null,
      dataKind: "verification_issue",
      sequenceNumber: 1,
      subtype: "ocr.name_uncertain",
      referenceNamespace: null,
      ciphertext: Buffer.from([0x44]),
      encryptionKeyVersion: "enc-v1",
      sha256: null,
      mediaType: null,
    },
  ];
}

describe("MySQL Tournament read repository", () => {
  it("maps ordered rows and commits one purpose-bearing audit per protected row", async () => {
    const connection = new SyntheticConnection([
      [revisionRow()] as any,
      placementRows() as any,
      restrictedRows() as any,
      header(), header(), header(), header(),
    ]);
    const result = await repository(connection).findRevisionAndAudit(request);

    expect(connection.began).toBe(1);
    expect(connection.committed).toBe(1);
    expect(connection.rolledBack).toBe(0);
    expect(connection.released).toBe(1);
    expect(result?.publicRevision).toMatchObject({
      raceResultId: request.raceResultId,
      revision: 2,
      countsTowardStandings: true,
      observedStageLabel: "Final",
      source: { kind: "tournament_live_capture", raceOffsetMs: 1000 },
      verification: { status: "needs_review", confidence: 0.9 },
    });
    expect(result?.placements).toEqual([
      expect.objectContaining({
        finishPosition: 1,
        playerId: "player.central_1",
        restrictedParticipant: null,
      }),
      expect.objectContaining({
        finishPosition: 2,
        playerId: null,
        restrictedParticipant: {
          namespace: "unresolved_observation",
          protectedValue: {
            ciphertext: Uint8Array.from([0x11]),
            encryptionKeyVersion: "enc-v1",
          },
        },
      }),
    ]);
    expect(result?.protectedContext).toEqual([{
      contextKind: "tournament",
      namespace: "tournament_slug",
      protectedValue: {
        ciphertext: Uint8Array.from([0x22]),
        encryptionKeyVersion: "enc-v1",
      },
    }]);
    expect(result?.protectedEvidence[0]).toMatchObject({ sequenceNumber: 1 });
    expect(result?.protectedIssues[0]).toMatchObject({ sequenceNumber: 1 });

    const auditCalls = connection.calls.filter((call) =>
      call.sql.includes("INSERT INTO restricted_identity_access_log"));
    expect(auditCalls.map((call) => call.values)).toEqual([41, 42, 43, 44].map(
      (resourceId) => [
        resourceId,
        request.accessorUserAccountId,
        request.purposeCode,
        request.accessedAtMs,
      ],
    ));
    expect(connection.calls.every((call) => !call.sql.includes("lookup_hmac"))).toBe(true);
  });

  it("commits a missing revision without selecting or auditing protected rows", async () => {
    const connection = new SyntheticConnection([[] as any]);
    await expect(repository(connection).findRevisionAndAudit(request)).resolves.toBeNull();
    expect(connection.committed).toBe(1);
    expect(connection.rolledBack).toBe(0);
    expect(connection.calls).toHaveLength(1);
  });

  it("rolls back before audit when a protected participant has no placement", async () => {
    const orphan = restrictedRows();
    orphan[0] = { ...orphan[0]!, placementInternalId: 999 };
    const connection = new SyntheticConnection([
      [revisionRow()] as any,
      placementRows() as any,
      orphan as any,
    ]);
    await expect(repository(connection).findRevisionAndAudit(request)).rejects.toBeInstanceOf(
      TournamentReadPersistenceError,
    );
    expect(connection.committed).toBe(0);
    expect(connection.rolledBack).toBe(1);
    expect(connection.calls.some((call) =>
      call.sql.includes("INSERT INTO restricted_identity_access_log"))).toBe(false);
  });

  it("returns no protected rows when any audit insert fails", async () => {
    const connection = new SyntheticConnection([
      [revisionRow()] as any,
      placementRows() as any,
      restrictedRows() as any,
      header(), header(0),
    ]);
    await expect(repository(connection).findRevisionAndAudit(request)).rejects.toMatchObject({
      message: "restricted access audit was not appended",
    });
    expect(connection.committed).toBe(0);
    expect(connection.rolledBack).toBe(1);
  });
});
