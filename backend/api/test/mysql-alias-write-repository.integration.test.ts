import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

import {
  AliasService,
  type AliasClock,
  type AliasIdGenerator,
} from "../src/identity/alias-service.js";
import { MysqlAliasReadRepository } from "../src/identity/mysql-alias-read-repository.js";
import { MysqlAliasWriteRepository } from "../src/identity/mysql-alias-write-repository.js";
import type { ActorContext } from "../src/identity/types.js";

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

const firstPlayerId = "player.synthetic_alias_mysql_01";
const secondPlayerId = "player.synthetic_alias_mysql_02";
const adminAccountId = "user_account.synthetic_alias_mysql_admin_01";
const sharedAliasText = "Shared Synthetic MySQL Alias";

const administrator: ActorContext = {
  role: "administrator",
  userAccountId: adminAccountId,
};

class DeterministicAliasIds implements AliasIdGenerator {
  private sequence = 0;

  newAliasId(): string {
    this.sequence += 1;
    return `alias.synthetic_mysql_generated_${this.sequence}`;
  }
}

class DeterministicAliasClock implements AliasClock {
  private current = 2_100_000_000_000;

  nowMs(): number {
    this.current += 1;
    return this.current;
  }
}

integration("MySQL Alias write repository integration", () => {
  let pool: Pool;
  let service: AliasService;
  let readRepository: MysqlAliasReadRepository;

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
    service = new AliasService(
      new MysqlAliasWriteRepository(pool),
      new DeterministicAliasIds(),
      new DeterministicAliasClock(),
    );
    readRepository = new MysqlAliasReadRepository(pool);

    const [migrationRows] = await pool.execute<any[]>(
      "SELECT migration_version FROM schema_migrations ORDER BY migration_version",
    );
    expect(migrationRows).toHaveLength(pinnedMigrationCatalogLength);
    await pool.execute(
      `INSERT INTO players
       (public_id, revision, player_kind, display_name, record_status,
        created_at_ms, updated_at_ms)
       VALUES
         (?, 1, 'human', 'Synthetic Alias Racer One', 'active', 1, 1),
         (?, 1, 'human', 'Synthetic Alias Racer Two', 'active', 1, 1)`,
      [firstPlayerId, secondPlayerId],
    );
    await pool.execute(
      `INSERT INTO user_accounts
       (public_id, revision, privacy_class, account_status,
        created_at_ms, updated_at_ms)
       VALUES (?, 1, 'private', 'active', 1, 1)`,
      [adminAccountId],
    );
  });

  afterAll(async () => {
    if (pool === undefined) {
      return;
    }
    await pool.execute(
      `DELETE lifecycle FROM alias_lifecycle AS lifecycle
       INNER JOIN aliases AS alias_record ON alias_record.alias_id = lifecycle.alias_id
       WHERE alias_record.public_id LIKE 'alias.synthetic_mysql_generated_%'`,
    );
    await pool.execute(
      `DELETE provenance FROM alias_provenance AS provenance
       INNER JOIN aliases AS alias_record ON alias_record.alias_id = provenance.alias_id
       WHERE alias_record.public_id LIKE 'alias.synthetic_mysql_generated_%'`,
    );
    await pool.execute(
      "DELETE FROM aliases WHERE public_id LIKE 'alias.synthetic_mysql_generated_%'",
    );
    await pool.execute("DELETE FROM players WHERE public_id IN (?, ?)", [
      firstPlayerId,
      secondPlayerId,
    ]);
    await pool.execute("DELETE FROM user_accounts WHERE public_id = ?", [
      adminAccountId,
    ]);
    await pool.end();
  });

  it("persists equal text separately with provenance and ordered lifecycle", async () => {
    const command = (playerId: string) => ({
      playerId,
      aliasText: sharedAliasText,
      aliasType: "tournament_name" as const,
      visibility: "restricted" as const,
      provenance: [
        {
          sourceType: "tournament_workbook" as const,
          sourceReference: `source.synthetic_alias_mysql_${
            playerId === firstPlayerId ? "01" : "02"
          }`,
          observedAtMs: 2_000_000_000_000,
        },
      ],
    });
    const first = await service.createAlias(administrator, command(firstPlayerId));
    const second = await service.createAlias(
      administrator,
      command(secondPlayerId),
    );
    await service.updateAlias(administrator, {
      aliasId: first.aliasId,
      action: "set_visibility",
      visibility: "public",
      reasonCode: "reviewed_for_public_profile",
    });
    await expect(readRepository.findPublicAliasById(first.aliasId)).resolves.toEqual({
      aliasId: first.aliasId,
      playerId: firstPlayerId,
      aliasText: sharedAliasText,
      aliasType: "tournament_name",
    });
    await expect(readRepository.findPublicAliasById(second.aliasId)).resolves.toBeNull();
    await expect(readRepository.listPublicAliasesByPlayerId(firstPlayerId))
      .resolves.toEqual([{
        aliasId: first.aliasId,
        playerId: firstPlayerId,
        aliasText: sharedAliasText,
        aliasType: "tournament_name",
      }]);
    await expect(readRepository.listPublicAliasesByPlayerId(secondPlayerId))
      .resolves.toEqual([]);
    const retired = await service.updateAlias(administrator, {
      aliasId: first.aliasId,
      action: "retire",
      reasonCode: "superseded_observation",
    });

    expect(first.aliasText).toBe(second.aliasText);
    expect(first.playerId).not.toBe(second.playerId);
    expect(retired).toMatchObject({ recordStatus: "retired", revision: 3 });
    await expect(readRepository.findPublicAliasById(first.aliasId)).resolves.toBeNull();
    await expect(readRepository.listPublicAliasesByPlayerId(firstPlayerId))
      .resolves.toEqual([]);
    const [aliasRows] = await pool.execute<any[]>(
      `SELECT alias_record.public_id AS aliasId, player.public_id AS playerId,
              alias_record.alias_text AS aliasText,
              alias_record.record_status AS recordStatus
       FROM aliases AS alias_record
       INNER JOIN players AS player ON player.player_id = alias_record.player_id
       WHERE alias_record.public_id IN (?, ?)
       ORDER BY alias_record.alias_id`,
      [first.aliasId, second.aliasId],
    );
    expect(aliasRows).toEqual([
      {
        aliasId: first.aliasId,
        playerId: firstPlayerId,
        aliasText: sharedAliasText,
        recordStatus: "retired",
      },
      {
        aliasId: second.aliasId,
        playerId: secondPlayerId,
        aliasText: sharedAliasText,
        recordStatus: "active",
      },
    ]);
    const [auditRows] = await pool.execute<any[]>(
      `SELECT alias_record.public_id AS aliasId,
              COUNT(DISTINCT lifecycle.alias_lifecycle_id) AS lifecycleCount,
              COUNT(DISTINCT provenance.alias_provenance_id) AS provenanceCount
       FROM aliases AS alias_record
       LEFT JOIN alias_lifecycle AS lifecycle ON lifecycle.alias_id = alias_record.alias_id
       LEFT JOIN alias_provenance AS provenance ON provenance.alias_id = alias_record.alias_id
       WHERE alias_record.public_id IN (?, ?)
       GROUP BY alias_record.alias_id, alias_record.public_id
       ORDER BY alias_record.alias_id`,
      [first.aliasId, second.aliasId],
    );
    expect(auditRows).toEqual([
      { aliasId: first.aliasId, lifecycleCount: 3, provenanceCount: 1 },
      { aliasId: second.aliasId, lifecycleCount: 1, provenanceCount: 1 },
    ]);
  });
});
