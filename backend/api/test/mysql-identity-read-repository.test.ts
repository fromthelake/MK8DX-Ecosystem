import { describe, expect, it } from "vitest";
import type { FieldPacket, QueryResult, RowDataPacket } from "mysql2";

import {
  MysqlIdentityReadRepository,
  PersistenceContractError,
  type PreparedQueryExecutor,
} from "../src/identity/mysql-identity-read-repository.js";

type QueryCall = Readonly<{ sql: string; values: unknown[] }>;

class SyntheticExecutor implements PreparedQueryExecutor {
  public readonly calls: QueryCall[] = [];

  public constructor(private readonly queuedRows: RowDataPacket[][]) {}

  async execute<T extends QueryResult>(
    sql: string,
    values?: any[],
  ): Promise<[T, FieldPacket[]]> {
    this.calls.push({ sql, values: values ?? [] });
    const rows = this.queuedRows.shift();
    if (rows === undefined) {
      throw new Error("synthetic executor has no queued result");
    }
    return [rows as unknown as T, []];
  }
}

const playerId = "player.synthetic_racer_01";
const accountId = "user_account.synthetic_owner_01";
const claimId = "player_claim.synthetic_claim_01";

describe("MySQL identity read repository", () => {
  it("maps only the public Player projection through a prepared parameter", async () => {
    const executor = new SyntheticExecutor([
      [
        {
          playerId,
          usernameValue: "SyntheticRacer",
          displayName: "Synthetic Racer",
          privateUnexpectedColumn: "must-not-map",
        } as RowDataPacket,
      ],
    ]);
    const repository = new MysqlIdentityReadRepository(executor);

    await expect(repository.findPublicPlayerById(playerId)).resolves.toEqual({
      playerId,
      username: { value: "SyntheticRacer" },
      displayName: "Synthetic Racer",
    });
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0]?.values).toEqual([playerId]);
    expect(executor.calls[0]?.sql).toContain("WHERE p.public_id = ?");
    expect(executor.calls[0]?.sql).not.toContain(playerId);
    expect(executor.calls[0]?.sql).not.toMatch(
      /email|authentication|evidence|review|legacy/i,
    );
  });

  it("maps a private UserAccount summary without authentication data", async () => {
    const executor = new SyntheticExecutor([
      [{ userAccountId: accountId, accountStatus: "active" } as RowDataPacket],
    ]);
    const repository = new MysqlIdentityReadRepository(executor);

    await expect(
      repository.findUserAccountSummaryById(accountId),
    ).resolves.toEqual({
      userAccountId: accountId,
      accountStatus: "active",
    });
    expect(executor.calls[0]?.values).toEqual([accountId]);
    expect(executor.calls[0]?.sql).toContain("WHERE a.public_id = ?");
    expect(executor.calls[0]?.sql).not.toMatch(
      /email|authentication|credential|firebase|legacy/i,
    );
  });

  it("maps a private claim summary without evidence or review tables", async () => {
    const executor = new SyntheticExecutor([
      [
        {
          playerClaimId: claimId,
          playerId,
          userAccountId: accountId,
          claimStatus: "verified",
          disputeStatus: "none",
        } as RowDataPacket,
      ],
    ]);
    const repository = new MysqlIdentityReadRepository(executor);

    await expect(
      repository.findPlayerClaimSummaryById(claimId),
    ).resolves.toEqual({
      playerClaimId: claimId,
      playerId,
      userAccountId: accountId,
      claimStatus: "verified",
      disputeStatus: "none",
    });
    expect(executor.calls[0]?.values).toEqual([claimId]);
    expect(executor.calls[0]?.sql).toContain("WHERE c.public_id = ?");
    expect(executor.calls[0]?.sql).not.toMatch(/restricted_|evidence|review/i);
  });

  it("returns null for a missing record", async () => {
    const repository = new MysqlIdentityReadRepository(
      new SyntheticExecutor([[]]),
    );
    await expect(
      repository.findPublicPlayerById("player.synthetic_missing_01"),
    ).resolves.toBeNull();
  });

  it("rejects duplicate rows instead of selecting one silently", async () => {
    const row = {
      playerId,
      usernameValue: "SyntheticRacer",
      displayName: "Synthetic Racer",
    } as RowDataPacket;
    const repository = new MysqlIdentityReadRepository(
      new SyntheticExecutor([[row, row]]),
    );

    await expect(repository.findPublicPlayerById(playerId)).rejects.toThrow(
      new PersistenceContractError(
        "Player lookup returned 2 rows; expected at most one",
      ),
    );
  });

  it.each([
    [{ playerId: accountId, usernameValue: "Name", displayName: "Name" }],
    [{ playerId, usernameValue: null, displayName: "Name" }],
    [{ playerId, usernameValue: "Name", displayName: "" }],
  ])("rejects malformed persisted Player rows", async (row) => {
    const repository = new MysqlIdentityReadRepository(
      new SyntheticExecutor([[row as RowDataPacket]]),
    );
    await expect(repository.findPublicPlayerById(playerId)).rejects.toThrow(
      PersistenceContractError,
    );
  });

  it("rejects unsupported persisted claim states", async () => {
    const repository = new MysqlIdentityReadRepository(
      new SyntheticExecutor([
        [
          {
            playerClaimId: claimId,
            playerId,
            userAccountId: accountId,
            claimStatus: "silently_merged",
            disputeStatus: "none",
          } as RowDataPacket,
        ],
      ]),
    );
    await expect(
      repository.findPlayerClaimSummaryById(claimId),
    ).rejects.toThrow("claimStatus has an unsupported persisted value");
  });

  it("never interpolates hostile lookup text into SQL", async () => {
    const hostile = "player.synthetic' OR 1=1 --";
    const executor = new SyntheticExecutor([[]]);
    const repository = new MysqlIdentityReadRepository(executor);
    await repository.findPublicPlayerById(hostile);

    expect(executor.calls[0]?.values).toEqual([hostile]);
    expect(executor.calls[0]?.sql).not.toContain(hostile);
    expect(executor.calls[0]?.sql.match(/\?/g)).toHaveLength(1);
  });
});
