import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

import { buildApp } from "../src/app.js";
import { MysqlIdentityReadRepository } from "../src/identity/mysql-identity-read-repository.js";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The applied ledger must be an exact prefix of the hash-pinned catalog, so
// the expected count follows that catalog instead of a frozen number.
const pinnedMigrationCatalogLength = (JSON.parse(readFileSync(
  fileURLToPath(new URL(
    "../../../infrastructure/mysql/migration-catalog-v1.json",
    import.meta.url,
  )),
  "utf8",
)) as { migrations: readonly unknown[] }).migrations.length;

const integrationEnabled = process.env["MK8DX_MYSQL_INTEGRATION"] === "1";
const integration = integrationEnabled ? describe : describe.skip;

const playerId = "player.synthetic_mysql_integration_01";
const accountId = "user_account.synthetic_mysql_integration_01";
const claimId = "player_claim.synthetic_mysql_integration_01";

integration("MySQL identity read repository integration", () => {
  let pool: Pool;
  let repository: MysqlIdentityReadRepository;

  beforeAll(async () => {
    const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
    if (!/^[a-z][a-z0-9_]*(?:_test|_contract)$/.test(database)) {
      throw new Error("integration database must be an explicit _test/_contract schema");
    }
    const poolOptions: PoolOptions = {
      host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
      port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
      user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
      database,
      connectionLimit: 1,
      multipleStatements: false,
      namedPlaceholders: false,
    };
    const password = process.env["MK8DX_MYSQL_TEST_PASSWORD"];
    if (password !== undefined) {
      poolOptions.password = password;
    }
    pool = mysql.createPool(poolOptions);
    repository = new MysqlIdentityReadRepository(pool);

    const [migrationRows] = await pool.execute(
      "SELECT migration_version FROM schema_migrations ORDER BY migration_version",
    );
    expect(migrationRows).toHaveLength(pinnedMigrationCatalogLength);

    await pool.execute(
      `INSERT INTO players
       (public_id, revision, player_kind, display_name, record_status,
        created_at_ms, updated_at_ms)
       VALUES (?, 1, 'human', ?, 'active', 1, 1)`,
      [playerId, "Synthetic MySQL Racer"],
    );
    await pool.execute(
      `INSERT INTO player_username_history
       (player_id, sequence_number, username_value, comparison_key,
        allocated_at_ms, released_at_ms)
       SELECT player_id, 1, ?, ?, 1, NULL FROM players WHERE public_id = ?`,
      ["SyntheticMysqlRacer", Buffer.from("syntheticmysqlracer"), playerId],
    );
    await pool.execute(
      `INSERT INTO user_accounts
       (public_id, revision, privacy_class, account_status,
        created_at_ms, updated_at_ms)
       VALUES (?, 1, 'private', 'active', 1, 1)`,
      [accountId],
    );
    await pool.execute(
      `INSERT INTO player_claims
       (public_id, revision, privacy_class, player_id, user_account_id,
        claim_status, dispute_status, created_at_ms, updated_at_ms)
       SELECT ?, 1, 'private', p.player_id, a.user_account_id,
              'verified', 'none', 1, 1
       FROM players AS p CROSS JOIN user_accounts AS a
       WHERE p.public_id = ? AND a.public_id = ?`,
      [claimId, playerId, accountId],
    );
  });

  afterAll(async () => {
    if (pool === undefined) {
      return;
    }
    await pool.execute("DELETE FROM player_claims WHERE public_id = ?", [claimId]);
    await pool.execute(
      `DELETE h FROM player_username_history AS h
       INNER JOIN players AS p ON p.player_id = h.player_id
       WHERE p.public_id = ?`,
      [playerId],
    );
    await pool.execute("DELETE FROM user_accounts WHERE public_id = ?", [accountId]);
    await pool.execute("DELETE FROM players WHERE public_id = ?", [playerId]);
    await pool.end();
  });

  it("maps all three read models through prepared MySQL queries", async () => {
    await expect(repository.findPublicPlayerById(playerId)).resolves.toEqual({
      playerId,
      username: { value: "SyntheticMysqlRacer" },
      displayName: "Synthetic MySQL Racer",
      timeTrialModePreference: "all",
    });
    await expect(repository.findUserAccountSummaryById(accountId)).resolves.toEqual({
      userAccountId: accountId,
      accountStatus: "active",
    });
    await expect(repository.findPlayerClaimSummaryById(claimId)).resolves.toEqual({
      playerClaimId: claimId,
      playerId,
      userAccountId: accountId,
      claimStatus: "verified",
      disputeStatus: "none",
    });
  });

  it("serves the MySQL-backed projection without exposing private fields", async () => {
    const app = await buildApp({
      identityRepository: repository,
      resolveActor: async () => ({ role: "account", userAccountId: accountId }),
    });
    try {
      const publicResponse = await app.inject({
        method: "GET",
        url: `/v1/players/${playerId}`,
      });
      expect(publicResponse.statusCode).toBe(200);
      expect(publicResponse.json()).toEqual({
        playerId,
        username: { value: "SyntheticMysqlRacer" },
        displayName: "Synthetic MySQL Racer",
        timeTrialModePreference: "all",
      });

      const claimResponse = await app.inject({
        method: "GET",
        url: `/v1/player-claims/${claimId}`,
      });
      expect(claimResponse.statusCode).toBe(200);
      expect(claimResponse.body).not.toContain("evidence");
      expect(claimResponse.body).not.toContain("review");
    } finally {
      await app.close();
    }
  });
});
