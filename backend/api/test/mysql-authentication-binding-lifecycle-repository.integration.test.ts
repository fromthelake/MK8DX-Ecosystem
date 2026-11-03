import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

import { AuthenticationBindingLifecycleService } from
  "../src/authentication/authentication-binding-lifecycle-service.js";
import { MysqlAuthenticationBindingLifecycleRepository } from
  "../src/authentication/mysql-authentication-binding-lifecycle-repository.js";
import { MysqlAuthenticationBindingRepository } from
  "../src/authentication/mysql-authentication-binding-repository.js";

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

const adminId = "user_account.synthetic_auth_lifecycle_admin_01";
const releaseOwnerId = "user_account.synthetic_auth_lifecycle_release_01";
const revokeOwnerId = "user_account.synthetic_auth_lifecycle_revoke_01";
const releaseBindingId = "restricted_auth_binding.synthetic_lifecycle_release_01";
const revokeBindingId = "restricted_auth_binding.synthetic_lifecycle_revoke_01";
const releaseHmac = Buffer.alloc(32, 41);
const revokeHmac = Buffer.alloc(32, 42);

integration("MySQL authentication binding lifecycle repository integration", () => {
  let pool: Pool;
  let service: AuthenticationBindingLifecycleService;

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
         (?, 1, 'private', 'active', 1, 1),
         (?, 2, 'private', 'closed', 1, 2)`,
      [adminId, releaseOwnerId, revokeOwnerId],
    );
    await pool.execute(
      `INSERT INTO restricted_authentication_bindings (
         public_id, revision, privacy_class, user_account_id, issuer_key,
         subject_lookup_hmac, lookup_key_version, binding_status,
         bound_at_ms, ended_at_ms, updated_at_ms
       )
       SELECT ?, 1, 'private', account.user_account_id, 'synthetic_lifecycle', ?,
              'lookup_key_v1', 'active', 10, NULL, 10
       FROM user_accounts AS account WHERE account.public_id = ?
       UNION ALL
       SELECT ?, 1, 'private', account.user_account_id, 'synthetic_lifecycle', ?,
              'lookup_key_v1', 'active', 10, NULL, 10
       FROM user_accounts AS account WHERE account.public_id = ?`,
      [
        releaseBindingId,
        releaseHmac,
        releaseOwnerId,
        revokeBindingId,
        revokeHmac,
        revokeOwnerId,
      ],
    );
    await pool.execute(
      `INSERT INTO restricted_authentication_binding_lifecycle (
         authentication_binding_id, sequence_number, event_type, actor_type,
         actor_user_account_id, actor_reference, reason_code, occurred_at_ms
       )
       SELECT binding.authentication_binding_id, 1, 'binding_created',
              'authentication', NULL, 'authentication_provisioner.synthetic_integration',
              NULL, 10
       FROM restricted_authentication_bindings AS binding
       WHERE binding.public_id IN (?, ?)`,
      [releaseBindingId, revokeBindingId],
    );
    service = new AuthenticationBindingLifecycleService(
      new MysqlAuthenticationBindingLifecycleRepository(pool),
      { nowMs: () => 2_200_000_000_000 },
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
      [releaseBindingId, revokeBindingId],
    );
    await pool.execute(
      `DELETE lifecycle
       FROM restricted_authentication_binding_lifecycle AS lifecycle
       INNER JOIN restricted_authentication_bindings AS binding
         ON binding.authentication_binding_id = lifecycle.authentication_binding_id
       WHERE binding.public_id IN (?, ?)`,
      [releaseBindingId, revokeBindingId],
    );
    await pool.execute(
      "DELETE FROM restricted_authentication_bindings WHERE public_id IN (?, ?)",
      [releaseBindingId, revokeBindingId],
    );
    await pool.execute(
      "DELETE FROM user_accounts WHERE public_id IN (?, ?, ?)",
      [adminId, releaseOwnerId, revokeOwnerId],
    );
    await pool.end();
  });

  it("releases and revokes with ordered administrator history, including a closed target", async () => {
    const administrator = { role: "administrator", userAccountId: adminId } as const;
    await expect(
      service.endBinding(administrator, {
        authenticationBindingId: releaseBindingId,
        expectedRevision: 1,
        action: "release",
        reasonCode: "administrator_assisted_rebind",
      }),
    ).resolves.toMatchObject({ bindingStatus: "released", revision: 2, lastSequence: 2 });
    await expect(
      service.endBinding(administrator, {
        authenticationBindingId: revokeBindingId,
        expectedRevision: 1,
        action: "revoke",
        reasonCode: "security_revocation",
      }),
    ).resolves.toMatchObject({ bindingStatus: "revoked", revision: 2, lastSequence: 2 });

    const resolver = new MysqlAuthenticationBindingRepository(pool, {
      nowMs: () => 2_200_000_000_001,
    });
    await expect(
      resolver.resolveActiveAccount({
        issuerKey: "synthetic_lifecycle",
        lookupKeyVersion: "lookup_key_v1",
        subjectLookupHmac: releaseHmac,
      }),
    ).resolves.toBeNull();
    await expect(
      resolver.resolveActiveAccount({
        issuerKey: "synthetic_lifecycle",
        lookupKeyVersion: "lookup_key_v1",
        subjectLookupHmac: revokeHmac,
      }),
    ).resolves.toBeNull();

    const [bindingRows] = await pool.execute<any[]>(
      `SELECT public_id AS bindingId, binding_status AS bindingStatus,
              revision, ended_at_ms AS endedAtMs,
              active_subject_lookup_hmac AS activeLookup,
              OCTET_LENGTH(subject_lookup_hmac) AS retainedHmacBytes
       FROM restricted_authentication_bindings
       WHERE public_id IN (?, ?)
       ORDER BY public_id`,
      [releaseBindingId, revokeBindingId],
    );
    expect(bindingRows).toEqual([
      {
        bindingId: releaseBindingId,
        bindingStatus: "released",
        revision: 2,
        endedAtMs: 2_200_000_000_000,
        activeLookup: null,
        retainedHmacBytes: 32,
      },
      {
        bindingId: revokeBindingId,
        bindingStatus: "revoked",
        revision: 2,
        endedAtMs: 2_200_000_000_000,
        activeLookup: null,
        retainedHmacBytes: 32,
      },
    ]);
    const [endEvents] = await pool.execute<any[]>(
      `SELECT binding.public_id AS bindingId,
              lifecycle.sequence_number AS sequenceNumber,
              lifecycle.event_type AS eventType,
              lifecycle.actor_type AS actorType,
              administrator.public_id AS administratorId,
              lifecycle.reason_code AS reasonCode
       FROM restricted_authentication_binding_lifecycle AS lifecycle
       INNER JOIN restricted_authentication_bindings AS binding
         ON binding.authentication_binding_id = lifecycle.authentication_binding_id
       INNER JOIN user_accounts AS administrator
         ON administrator.user_account_id = lifecycle.actor_user_account_id
       WHERE binding.public_id IN (?, ?)
         AND lifecycle.sequence_number = 2
       ORDER BY binding.public_id`,
      [releaseBindingId, revokeBindingId],
    );
    expect(endEvents).toEqual([
      {
        bindingId: releaseBindingId,
        sequenceNumber: 2,
        eventType: "binding_released",
        actorType: "administrator",
        administratorId: adminId,
        reasonCode: "administrator_assisted_rebind",
      },
      {
        bindingId: revokeBindingId,
        sequenceNumber: 2,
        eventType: "binding_revoked",
        actorType: "administrator",
        administratorId: adminId,
        reasonCode: "security_revocation",
      },
    ]);
  });
});
