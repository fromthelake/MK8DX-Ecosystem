import { describe, expect, it } from "vitest";
import type { FieldPacket, QueryResult, ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

import {
  MysqlTimeTrialWriteTransaction,
  MysqlTimeTrialWriteRepository,
  TimeTrialPersistenceError,
} from "../src/timetrials/mysql-time-trial-write-repository.js";
import {
  TimeTrialSubmissionError,
  type TimeTrialRevisionPersistenceInput,
} from "../src/timetrials/submission-service.js";

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

  async execute<T extends QueryResult>(
    sql: string,
    values?: any[],
  ): Promise<[T, FieldPacket[]]> {
    this.calls.push({ sql, values: values ?? [] });
    const result = this.results.shift();
    if (result === undefined) {
      throw new Error("synthetic connection has no queued result");
    }
    return [result as T, []];
  }
}

function repository(connection: SyntheticConnection): MysqlTimeTrialWriteRepository {
  return new MysqlTimeTrialWriteRepository({
    getConnection: async () => connection as unknown as PoolConnection,
  } as unknown as Pool);
}

function header(insertId = 0): ResultSetHeader {
  return { affectedRows: 1, insertId } as ResultSetHeader;
}

function restrictedInput(): TimeTrialRevisionPersistenceInput {
  return {
    submission: {
      schemaVersion: "mk8dx.time-trial-submission.v1",
      submissionId: "user_submission.time.SYNTHETICMYSQL01",
      revision: 1,
      mode: 200,
      trackId: "track.water_park",
      totalTimeMs: 143_000,
      laps: [
        { lapNumber: 1, timeMs: 49_234 },
        { lapNumber: 2, timeMs: 47_567 },
        { lapNumber: 3, timeMs: 46_199 },
      ],
      countryId: "country.nl",
      observedPlayerName: "Synthetic Racer",
      source: { kind: "android_scan", localRecordId: "scan.synthetic-01" },
      timestamps: { createdAtMs: 1_900_000_000_000 },
      verification: {
        status: "producer_check_passed",
        lapSumMatches: true,
      },
    },
    playerId: null,
    restrictedParticipant: {
      namespace: "producer_local_profile",
      lookupHmac: new Uint8Array(32).fill(1),
      lookupKeyVersion: "lookup-v1",
      ciphertext: new Uint8Array([1, 2, 3]),
      encryptionKeyVersion: "encryption-v1",
    },
    protectedEvidence: [
      {
        sequenceNumber: 1,
        kind: "screenshot",
        protectedReference: {
          ciphertext: new Uint8Array([4, 5, 6]),
          encryptionKeyVersion: "encryption-v1",
        },
        sha256: new Uint8Array(32).fill(2),
        mediaType: "image/png",
      },
    ],
  };
}

describe("MySQL Time Trial write repository", () => {
  it("commits/releases success and rolls back/translates duplicate races", async () => {
    const successful = new SyntheticConnection();
    await expect(repository(successful).transaction(async () => "ok")).resolves.toBe("ok");
    expect(successful).toMatchObject({ began: 1, committed: 1, rolledBack: 0, released: 1 });

    const failed = new SyntheticConnection();
    await expect(repository(failed).transaction(async () => {
      throw Object.assign(new Error("private unique index detail"), { code: "ER_DUP_ENTRY" });
    })).rejects.toEqual(new TimeTrialSubmissionError(
      "revision_conflict",
      "submission or revision was occupied concurrently",
    ));
    expect(failed).toMatchObject({ committed: 0, rolledBack: 1, released: 1 });
  });

  it("locks and strictly maps stable submission revision state", async () => {
    const connection = new SyntheticConnection([
      [{ submissionInternalId: "7", firstCreatedAtMs: "1900000000000" } as RowDataPacket],
      [{ latestRevision: "2" } as RowDataPacket],
    ]);

    await expect(repository(connection).transaction((transaction) =>
      transaction.findSubmissionForUpdate("user_submission.time.SYNTHETICMYSQL01"),
    )).resolves.toEqual({ firstCreatedAtMs: 1_900_000_000_000, latestRevision: 2 });
    expect(connection.calls[0]?.sql).toContain("FOR UPDATE");
    expect(connection.calls[0]?.values).toEqual([
      "user_submission.time.SYNTHETICMYSQL01",
    ]);
    expect(connection.calls[0]?.sql).not.toContain("SYNTHETICMYSQL01");
  });

  it("rejects malformed persisted aggregate values and rolls back", async () => {
    const connection = new SyntheticConnection([
      [{ submissionInternalId: 7, firstCreatedAtMs: 1 } as RowDataPacket],
      [{ latestRevision: "not-a-number" } as RowDataPacket],
    ]);
    await expect(repository(connection).transaction((transaction) =>
      transaction.findSubmissionForUpdate("user_submission.time.SYNTHETICMYSQL01"),
    )).rejects.toThrow("latestRevision has an invalid persisted value");
    expect(connection).toMatchObject({ rolledBack: 1, released: 1 });
  });

  it("writes revision children through placeholders without raw restricted values", async () => {
    const connection = new SyntheticConnection([
      [{ internalId: 8 } as RowDataPacket],
      header(20),
      header(), header(), header(),
      header(),
      header(),
      header(30),
      [{ publicationRevision: 1 } as RowDataPacket],
      header(),
    ]);
    const input = restrictedInput();

    await repository(connection).transaction((transaction) =>
      transaction.insertRevision(input),
    );

    expect(connection.calls.map((call) => call.sql)).toEqual(expect.arrayContaining([
      expect.stringContaining("INSERT INTO time_trial_submission_revisions"),
      expect.stringContaining("INSERT INTO time_trial_laps"),
      expect.stringContaining("INSERT INTO restricted_time_trial_participant_references"),
      expect.stringContaining("INSERT INTO restricted_time_trial_evidence"),
      expect.stringContaining("INSERT INTO time_trial_publications"),
      expect.stringContaining("INSERT INTO time_trial_publication_lifecycle"),
    ]));
    expect(connection.calls.filter((call) => call.sql.includes("time_trial_laps"))).toHaveLength(3);
    const serializedValues = JSON.stringify(connection.calls.map((call) => call.values));
    expect(serializedValues).not.toContain("android.synthetic-profile");
    expect(serializedValues).not.toContain("synthetic/android-scan");
    expect(connection.calls.every((call) => !call.sql.includes(input.submission.submissionId)))
      .toBe(true);
  });

  it("stores one publication-time rank using one standings query", async () => {
    const connection = new SyntheticConnection([
      [{ internalId: 7 } as RowDataPacket],
      [{ internalId: 8 } as RowDataPacket],
      header(20),
      [{ player_claim_id: 9 } as RowDataPacket],
      [{ revisionInternalId: 20, rankAtPublication: 4 } as RowDataPacket],
      header(30),
      [{ publicationRevision: 1 } as RowDataPacket],
      header(),
      header(),
      header(),
      header(),
    ]);
    const transaction = new MysqlTimeTrialWriteTransaction(
      connection as unknown as PoolConnection,
      { nowMs: () => 1_900_000_000_000 },
    );
    const input = {
      ...restrictedInput(),
      submission: { ...restrictedInput().submission, laps: [] },
      playerId: "player.synthetic",
      restrictedParticipant: null,
      protectedEvidence: [],
      publicationEligibility: "runtime_eligible" as const,
    };

    await transaction.insertRevision(input);

    const rankCalls = connection.calls.filter((call) =>
      call.sql.includes("COUNT(DISTINCT CASE"));
    expect(rankCalls).toHaveLength(1);
    expect(rankCalls[0]?.values).toEqual([20]);
    const publication = connection.calls.find((call) =>
      call.sql.includes("INSERT INTO time_trial_publications"));
    expect(publication?.sql).toContain("rank_at_publication");
    expect(publication?.values).toContain(4);
    const lifecycle = connection.calls.find((call) =>
      call.sql.includes("INSERT INTO time_trial_publication_lifecycle"));
    expect(lifecycle?.sql).toContain("rank_at_publication");
    expect(lifecycle?.values).toContain(4);
    expect(connection.calls.some((call) =>
      call.sql.includes("INSERT IGNORE INTO notification_producer_jobs"))).toBe(true);
    expect(connection.calls.some((call) =>
      call.sql.includes("DELETE FROM time_trial_player_bests"))).toBe(true);
    expect(connection.calls.some((call) =>
      call.sql.includes("INSERT INTO time_trial_player_bests"))).toBe(true);
  });

  it("defends against raw restricted fields and non-contiguous evidence", async () => {
    const raw = restrictedInput() as any;
    raw.submission.playerReference = {
      namespace: "producer_local_profile",
      value: "private-value",
    };
    const rawConnection = new SyntheticConnection();
    await expect(repository(rawConnection).transaction((transaction) =>
      transaction.insertRevision(raw),
    )).rejects.toBeInstanceOf(TimeTrialPersistenceError);
    expect(rawConnection.calls).toEqual([]);

    const sequence = restrictedInput() as any;
    sequence.protectedEvidence[0].sequenceNumber = 2;
    const sequenceConnection = new SyntheticConnection();
    await expect(repository(sequenceConnection).transaction((transaction) =>
      transaction.insertRevision(sequence),
    )).rejects.toThrow("evidence sequence invariant failed");
    expect(sequenceConnection.calls).toEqual([]);
  });
});
