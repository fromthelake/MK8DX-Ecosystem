import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

import {
  AuthenticationProvisioningService,
  type AuthenticationProvisioningDecision,
} from "../src/authentication/authentication-provisioning-service.js";
import { MysqlAuthenticationBindingRepository } from
  "../src/authentication/mysql-authentication-binding-repository.js";
import { MysqlAuthenticationProvisioningRepository } from
  "../src/authentication/mysql-authentication-provisioning-repository.js";

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

const createdAccountId = "user_account.synthetic_auth_provisioned_01";
const linkedAccountId = "user_account.synthetic_auth_link_target_01";
const otherAccountId = "user_account.synthetic_auth_link_other_01";
const createdBindingId = "restricted_auth_binding.synthetic_auth_provisioned_01";
const linkedBindingId = "restricted_auth_binding.synthetic_auth_linked_01";
const createdSubject = {
  issuerKey: "synthetic_provisioner",
  lookupKeyVersion: "lookup_key_v1",
  subjectLookupHmac: Buffer.alloc(32, 31),
} as const;
const linkedSubject = {
  issuerKey: "synthetic_provisioner",
  lookupKeyVersion: "lookup_key_v1",
  subjectLookupHmac: Buffer.alloc(32, 32),
} as const;

integration("MySQL authentication provisioning repository integration", () => {
  let pool: Pool;
  let decision: AuthenticationProvisioningDecision = { action: "deny" };
  let accountIdIndex = 0;
  let bindingIdIndex = 0;
  let service: AuthenticationProvisioningService;

  beforeAll(async () => {
    const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
    if (!/^[a-z][a-z0-9_]*(?:_test|_contract)$/.test(database)) {
      throw new Error("integration database must be an explicit _test/_contract schema");
    }
    const options: PoolOptions = {
      host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
      port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
      user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
      database,
      connectionLimit: 1,
      multipleStatements: false,
      namedPlaceholders: false,
    };
    const password = process.env["MK8DX_MYSQL_TEST_PASSWORD"];
    if (password !== undefined) { options.password = password; }
    pool = mysql.createPool(options);
    const [migrationRows] = await pool.execute<any[]>(
      "SELECT migration_version FROM schema_migrations ORDER BY migration_version",
    );
    expect(migrationRows).toHaveLength(pinnedMigrationCatalogLength);
    await pool.execute(
      `INSERT INTO user_accounts (
         public_id, revision, privacy_class, account_status,
         created_at_ms, updated_at_ms
       ) VALUES
         (?, 1, 'private', 'active', 1, 1),
         (?, 1, 'private', 'active', 1, 1)`,
      [linkedAccountId, otherAccountId],
    );
    service = new AuthenticationProvisioningService(
      new MysqlAuthenticationProvisioningRepository(pool),
      { decide: async () => decision },
      {
        newUserAccountId: () => {
          accountIdIndex += 1;
          return accountIdIndex === 1
            ? createdAccountId
            : `user_account.synthetic_unexpected_${accountIdIndex}`;
        },
        newAuthenticationBindingId: () => {
          bindingIdIndex += 1;
          return bindingIdIndex === 1 ? createdBindingId : linkedBindingId;
        },
      },
      { nowMs: () => 2_100_000_000_000 },
      "authentication_provisioner.synthetic_integration",
    );
  });

  afterAll(async () => {
    if (pool === undefined) { return; }
    await pool.execute(
      `DELETE log
       FROM restricted_identity_access_log AS log
       INNER JOIN restricted_authentication_bindings AS binding
         ON binding.authentication_binding_id = log.authentication_binding_id
       WHERE binding.public_id IN (?, ?)`,
      [createdBindingId, linkedBindingId],
    );
    await pool.execute(
      `DELETE FROM restricted_authentication_binding_lifecycle
       WHERE authentication_binding_id IN (
         SELECT authentication_binding_id
         FROM restricted_authentication_bindings
         WHERE public_id IN (?, ?)
       )`,
      [createdBindingId, linkedBindingId],
    );
    await pool.execute(
      "DELETE FROM restricted_authentication_bindings WHERE public_id IN (?, ?)",
      [createdBindingId, linkedBindingId],
    );
    await pool.execute(
      "DELETE FROM user_accounts WHERE public_id IN (?, ?, ?)",
      [createdAccountId, linkedAccountId, otherAccountId],
    );
    await pool.end();
  });

  it("creates, links, resolves, and retains opaque authentication provenance without Players", async () => {
    const [[playerCountBefore]] = await pool.execute<any[]>(
      "SELECT COUNT(*) AS countValue FROM players",
    );
    const [[claimCountBefore]] = await pool.execute<any[]>(
      "SELECT COUNT(*) AS countValue FROM player_claims",
    );

    decision = { action: "create_account" };
    await expect(service.provision(createdSubject)).resolves.toEqual({
      authenticationBindingId: createdBindingId,
      userAccountId: createdAccountId,
      accountCreated: true,
      bindingCreated: true,
    });
    await expect(service.provision(createdSubject)).resolves.toMatchObject({
      userAccountId: createdAccountId,
      accountCreated: false,
      bindingCreated: false,
    });

    decision = { action: "link_account", userAccountId: linkedAccountId };
    await expect(service.provision(linkedSubject)).resolves.toEqual({
      authenticationBindingId: linkedBindingId,
      userAccountId: linkedAccountId,
      accountCreated: false,
      bindingCreated: true,
    });
    decision = { action: "link_account", userAccountId: otherAccountId };
    await expect(service.provision(linkedSubject)).rejects.toMatchObject({
      code: "conflict",
    });

    const resolver = new MysqlAuthenticationBindingRepository(pool, {
      nowMs: () => 2_100_000_000_001,
    });
    await expect(resolver.resolveActiveAccount(createdSubject)).resolves.toEqual({
      userAccountId: createdAccountId,
    });
    await expect(resolver.resolveActiveAccount(linkedSubject)).resolves.toEqual({
      userAccountId: linkedAccountId,
    });

    const [lifecycleRows] = await pool.execute<any[]>(
      `SELECT
         b.public_id AS bindingId,
         l.actor_type AS actorType,
         l.actor_reference AS actorReference,
         l.event_type AS eventType,
         l.sequence_number AS sequenceNumber
       FROM restricted_authentication_binding_lifecycle AS l
       INNER JOIN restricted_authentication_bindings AS b
         ON b.authentication_binding_id = l.authentication_binding_id
       WHERE b.public_id IN (?, ?)
       ORDER BY b.public_id`,
      [createdBindingId, linkedBindingId],
    );
    expect(lifecycleRows).toEqual([
      {
        bindingId: linkedBindingId,
        actorType: "authentication",
        actorReference: "authentication_provisioner.synthetic_integration",
        eventType: "binding_created",
        sequenceNumber: 1,
      },
      {
        bindingId: createdBindingId,
        actorType: "authentication",
        actorReference: "authentication_provisioner.synthetic_integration",
        eventType: "binding_created",
        sequenceNumber: 1,
      },
    ]);
    const [[playerCountAfter]] = await pool.execute<any[]>(
      "SELECT COUNT(*) AS countValue FROM players",
    );
    const [[claimCountAfter]] = await pool.execute<any[]>(
      "SELECT COUNT(*) AS countValue FROM player_claims",
    );
    expect(playerCountAfter.countValue).toBe(playerCountBefore.countValue);
    expect(claimCountAfter.countValue).toBe(claimCountBefore.countValue);
  });
});
