import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

import { MysqlAuthenticationBindingRepository } from "../src/authentication/mysql-authentication-binding-repository.js";

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

const ownerAccountId = "user_account.synthetic_auth_binding_owner_01";
const replacementAccountId = "user_account.synthetic_auth_binding_owner_02";
const suspendedAccountId = "user_account.synthetic_auth_binding_suspended_01";
const adminAccountId = "user_account.synthetic_auth_binding_admin_01";
const firstBindingId = "restricted_auth_binding.synthetic_auth_01";
const replacementBindingId = "restricted_auth_binding.synthetic_auth_02";
const suspendedBindingId = "restricted_auth_binding.synthetic_auth_suspended_01";
const subjectHmac = Buffer.alloc(32, 21);
const suspendedSubjectHmac = Buffer.alloc(32, 22);

integration("MySQL authentication binding repository integration", () => {
  let pool: Pool;
  let repository: MysqlAuthenticationBindingRepository;

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
    repository = new MysqlAuthenticationBindingRepository(pool, {
      nowMs: () => 2_000_000_000_000,
    });

    const [migrationRows] = await pool.execute<any[]>(
      "SELECT migration_version FROM schema_migrations ORDER BY migration_version",
    );
    expect(migrationRows).toHaveLength(pinnedMigrationCatalogLength);
    await pool.execute(
      `INSERT INTO user_accounts
       (public_id, revision, privacy_class, account_status,
        created_at_ms, updated_at_ms)
       VALUES
         (?, 1, 'private', 'active', 1, 1),
         (?, 1, 'private', 'active', 1, 1),
         (?, 1, 'private', 'suspended', 1, 1),
         (?, 1, 'private', 'active', 1, 1)`,
      [ownerAccountId, replacementAccountId, suspendedAccountId, adminAccountId],
    );
    await pool.execute(
      `INSERT INTO restricted_authentication_bindings
       (public_id, revision, privacy_class, user_account_id, issuer_key,
        subject_lookup_hmac, lookup_key_version, binding_status,
        bound_at_ms, ended_at_ms, updated_at_ms)
       SELECT ?, 1, 'private', a.user_account_id, 'synthetic_issuer', ?,
              'lookup_key_v1', 'active', 10, NULL, 10
       FROM user_accounts AS a WHERE a.public_id = ?`,
      [firstBindingId, subjectHmac, ownerAccountId],
    );
    await pool.execute(
      `INSERT INTO restricted_authentication_bindings
       (public_id, revision, privacy_class, user_account_id, issuer_key,
        subject_lookup_hmac, lookup_key_version, binding_status,
        bound_at_ms, ended_at_ms, updated_at_ms)
       SELECT ?, 1, 'private', a.user_account_id, 'synthetic_issuer', ?,
              'lookup_key_v1', 'active', 10, NULL, 10
       FROM user_accounts AS a WHERE a.public_id = ?`,
      [suspendedBindingId, suspendedSubjectHmac, suspendedAccountId],
    );
    await pool.execute(
      `INSERT INTO restricted_authentication_binding_lifecycle
       (authentication_binding_id, sequence_number, event_type, actor_type,
        actor_user_account_id, actor_reference, reason_code, occurred_at_ms)
       SELECT b.authentication_binding_id, 1, 'binding_created',
              'migration_operator', NULL, 'source.synthetic_setup', NULL, 10
       FROM restricted_authentication_bindings AS b
       WHERE b.public_id IN (?, ?)`,
      [firstBindingId, suspendedBindingId],
    );
  });

  afterAll(async () => {
    if (pool === undefined) {
      return;
    }
    await pool.execute(
      `DELETE log FROM restricted_identity_access_log AS log
       INNER JOIN restricted_authentication_bindings AS binding
         ON binding.authentication_binding_id = log.authentication_binding_id
       WHERE binding.public_id IN (?, ?, ?)`,
      [firstBindingId, replacementBindingId, suspendedBindingId],
    );
    await pool.execute(
      `DELETE lifecycle
       FROM restricted_authentication_binding_lifecycle AS lifecycle
       INNER JOIN restricted_authentication_bindings AS binding
         ON binding.authentication_binding_id = lifecycle.authentication_binding_id
       WHERE binding.public_id IN (?, ?, ?)`,
      [firstBindingId, replacementBindingId, suspendedBindingId],
    );
    await pool.execute(
      "DELETE FROM restricted_authentication_bindings WHERE public_id IN (?, ?, ?)",
      [firstBindingId, replacementBindingId, suspendedBindingId],
    );
    await pool.execute(
      "DELETE FROM user_accounts WHERE public_id IN (?, ?, ?, ?)",
      [ownerAccountId, replacementAccountId, suspendedAccountId, adminAccountId],
    );
    await pool.end();
  });

  it("resolves, audits, releases, and explicitly rebinds without replacing history", async () => {
    const lookup = {
      issuerKey: "synthetic_issuer",
      lookupKeyVersion: "lookup_key_v1",
      subjectLookupHmac: subjectHmac,
    };
    await expect(repository.resolveActiveAccount(lookup)).resolves.toEqual({
      userAccountId: ownerAccountId,
    });

    await pool.execute(
      `UPDATE restricted_authentication_bindings
       SET revision = 2, binding_status = 'released', ended_at_ms = 20,
           updated_at_ms = 20
       WHERE public_id = ? AND revision = 1`,
      [firstBindingId],
    );
    await pool.execute(
      `INSERT INTO restricted_authentication_binding_lifecycle
       (authentication_binding_id, sequence_number, event_type, actor_type,
        actor_user_account_id, actor_reference, reason_code, occurred_at_ms)
       SELECT b.authentication_binding_id, 2, 'binding_released',
              'administrator', a.user_account_id, NULL,
              'administrator_assisted_rebind', 20
       FROM restricted_authentication_bindings AS b
       INNER JOIN user_accounts AS a ON a.public_id = ?
       WHERE b.public_id = ?`,
      [adminAccountId, firstBindingId],
    );
    await pool.execute(
      `INSERT INTO restricted_authentication_bindings
       (public_id, revision, privacy_class, user_account_id, issuer_key,
        subject_lookup_hmac, lookup_key_version, binding_status,
        bound_at_ms, ended_at_ms, updated_at_ms)
       SELECT ?, 1, 'private', a.user_account_id, 'synthetic_issuer', ?,
              'lookup_key_v1', 'active', 30, NULL, 30
       FROM user_accounts AS a WHERE a.public_id = ?`,
      [replacementBindingId, subjectHmac, replacementAccountId],
    );
    await pool.execute(
      `INSERT INTO restricted_authentication_binding_lifecycle
       (authentication_binding_id, sequence_number, event_type, actor_type,
        actor_user_account_id, actor_reference, reason_code, occurred_at_ms)
       SELECT b.authentication_binding_id, 1, 'binding_created',
              'administrator', a.user_account_id, NULL,
              'administrator_assisted_rebind', 30
       FROM restricted_authentication_bindings AS b
       INNER JOIN user_accounts AS a ON a.public_id = ?
       WHERE b.public_id = ?`,
      [adminAccountId, replacementBindingId],
    );

    await expect(repository.resolveActiveAccount(lookup)).resolves.toEqual({
      userAccountId: replacementAccountId,
    });
    const [bindingRows] = await pool.execute<any[]>(
      `SELECT public_id AS bindingId, binding_status AS bindingStatus
       FROM restricted_authentication_bindings
       WHERE public_id IN (?, ?)
       ORDER BY bound_at_ms`,
      [firstBindingId, replacementBindingId],
    );
    expect(bindingRows).toEqual([
      { bindingId: firstBindingId, bindingStatus: "released" },
      { bindingId: replacementBindingId, bindingStatus: "active" },
    ]);
    const [auditRows] = await pool.execute<any[]>(
      `SELECT binding.public_id AS bindingId, log.purpose_code AS purposeCode
       FROM restricted_identity_access_log AS log
       INNER JOIN restricted_authentication_bindings AS binding
         ON binding.authentication_binding_id = log.authentication_binding_id
       WHERE binding.public_id IN (?, ?)
       ORDER BY log.identity_access_log_id`,
      [firstBindingId, replacementBindingId],
    );
    expect(auditRows).toEqual([
      { bindingId: firstBindingId, purposeCode: "actor_resolution" },
      { bindingId: replacementBindingId, purposeCode: "actor_resolution" },
    ]);
  });

  it("does not authenticate a binding whose UserAccount is suspended", async () => {
    await expect(
      repository.resolveActiveAccount({
        issuerKey: "synthetic_issuer",
        lookupKeyVersion: "lookup_key_v1",
        subjectLookupHmac: suspendedSubjectHmac,
      }),
    ).resolves.toBeNull();
  });

  it("rotates an active binding digest after retained-key resolution", async () => {
    const activeHmac = Buffer.alloc(32, 23);
    await repository.rotateActiveSubject(
      {
        issuerKey: "synthetic_issuer",
        lookupKeyVersion: "lookup_key_v1",
        subjectLookupHmac: subjectHmac,
      },
      {
        issuerKey: "synthetic_issuer",
        lookupKeyVersion: "lookup_key_v2",
        subjectLookupHmac: activeHmac,
      },
    );
    await expect(repository.resolveActiveAccount({
      issuerKey: "synthetic_issuer",
      lookupKeyVersion: "lookup_key_v1",
      subjectLookupHmac: subjectHmac,
    })).resolves.toBeNull();
    await expect(repository.resolveActiveAccount({
      issuerKey: "synthetic_issuer",
      lookupKeyVersion: "lookup_key_v2",
      subjectLookupHmac: activeHmac,
    })).resolves.toEqual({ userAccountId: replacementAccountId });
    const [rows] = await pool.execute<any[]>(
      `SELECT revision, lookup_key_version AS lookupKeyVersion
       FROM restricted_authentication_bindings WHERE public_id = ?`,
      [replacementBindingId],
    );
    expect(rows).toEqual([{ revision: 2, lookupKeyVersion: "lookup_key_v2" }]);
  });
});
