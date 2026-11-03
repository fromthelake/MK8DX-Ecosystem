import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import mysql from "mysql2/promise";
import { describe, expect, it } from "vitest";

import { runReferenceSeed } from "../src/composition/reference-seed-main.js";
import { AdministratorGrantService } from "../src/administration/administrator-grant-service.js";
import { MysqlAdministratorGrantWriteRepository } from "../src/administration/mysql-administrator-grant-repository.js";

const configPath = process.env["MK8DX_REFERENCE_TEST_CONFIG"];
const integration = configPath === undefined ? describe.skip : describe;
const staffPath = resolve("../../infrastructure/mysql/reference/nintendo-staff-v1.json");
const worldPath = resolve("../../infrastructure/mysql/reference/world-records-v1.json");

integration("reference seed against isolated MySQL", () => {
  it("preserves synthetic account, administrator grant and submission across an update and rejects local reference edits", async () => {
    const environment = JSON.parse(await readFile(configPath!, "utf8")) as Record<string, string>;
    expect(environment["MK8DX_HOSTED_MYSQL_DATABASE"]).toMatch(/_contract$/);
    const config = {
      host: environment["MK8DX_HOSTED_MYSQL_HOST"]!,
      port: Number(environment["MK8DX_HOSTED_MYSQL_PORT"]),
      user: environment["MK8DX_HOSTED_MYSQL_USER"]!,
      password: environment["MK8DX_HOSTED_MYSQL_PASSWORD"]!,
      database: environment["MK8DX_HOSTED_MYSQL_DATABASE"]!,
    };
    const pool = mysql.createPool(config);
    const original = JSON.parse(await readFile(worldPath, "utf8")) as { records: Array<Record<string, unknown>> };
    const first = original.records[0]!;
    const accountId = `user_account.${randomUUID()}`;
    const submissionId = `user_submission.time.${randomUUID().replaceAll("-", "")}`;
    const temp = await mkdtemp(join(resolve("test"), "reference-fixture-"));
    const updatedPath = join(temp, "updated.json");
    let recordEdited = false;
    try {
      expect(await runReferenceSeed(environment, staffPath, worldPath)).toEqual({ staff: "unchanged", worldRecords: "unchanged" });
      const now = Date.now();
      await pool.execute(
        `INSERT INTO user_accounts(public_id,revision,privacy_class,account_status,created_at_ms,updated_at_ms)
         VALUES(?,1,'private','active',?,?)`, [accountId, now, now],
      );
      await pool.execute(`INSERT INTO time_trial_submissions(public_id,first_created_at_ms) VALUES(?,?)`, [submissionId, now]);
      const [submissionRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT time_trial_submission_id AS id FROM time_trial_submissions WHERE public_id=?`, [submissionId],
      );
      const numericSubmissionId = submissionRows[0]!["id"];
      await pool.execute(
        `INSERT INTO time_trial_submission_revisions(time_trial_submission_id,revision_number,schema_version,
           mode_cc,track_id,total_time_ms,participant_reference_kind,source_kind,created_at_ms)
         VALUES(?,1,'mk8dx.time-trial-submission.v1',150,'track.mario_kart_stadium',120000,
           'restricted_reference','web_manual',?)`, [numericSubmissionId, now],
      );
      const grants = new AdministratorGrantService(
        new MysqlAdministratorGrantWriteRepository(pool),
        { newAdministratorGrantId: () => `administrator_grant.${randomUUID()}` },
        { nowMs: () => Date.now() },
      );
      await grants.bootstrapFirstAdministrator(accountId);

      const updated = structuredClone(original);
      updated.records[0]!["totalTimeMs"] = Number(first["totalTimeMs"]) + 1;
      const laps = updated.records[0]!["lapTimesMs"] as number[];
      laps[0] = laps[0]! + 1;
      await writeFile(updatedPath, JSON.stringify(updated), "utf8");
      expect(await runReferenceSeed(environment, staffPath, updatedPath)).toEqual({ staff: "unchanged", worldRecords: "applied" });
      expect(await runReferenceSeed(environment, staffPath, updatedPath)).toEqual({ staff: "unchanged", worldRecords: "unchanged" });
      const [counts] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT (SELECT COUNT(*) FROM user_accounts WHERE public_id=?) AS accounts,
                (SELECT COUNT(*) FROM administrator_grants WHERE grant_origin='bootstrap_cli') AS administrators,
                (SELECT COUNT(*) FROM time_trial_submission_revisions WHERE time_trial_submission_id=?) AS submissions,
                (SELECT COUNT(*) FROM world_records) AS worldRecords`, [accountId, numericSubmissionId],
      );
      expect(counts[0]).toMatchObject({ accounts: 1, administrators: 1, submissions: 1, worldRecords: 192 });

      await pool.execute(`UPDATE world_records SET total_time_ms=total_time_ms+1 WHERE mode_cc=? AND track_id=?`,
        [Number(first["mode"]), String(first["trackId"])]);
      recordEdited = true;
      await expect(runReferenceSeed(environment, staffPath, worldPath)).rejects.toThrow(/edited/);
      const [versionRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT seed_sha256 AS digest FROM reference_seed_versions WHERE seed_kind='world_records'`,
      );
      expect(versionRows[0]!["digest"]).not.toBeNull();
      await pool.execute(`UPDATE world_records SET total_time_ms=total_time_ms-1 WHERE mode_cc=? AND track_id=?`,
        [Number(first["mode"]), String(first["trackId"])]);
      recordEdited = false;
      expect(await runReferenceSeed(environment, staffPath, worldPath)).toEqual({ staff: "unchanged", worldRecords: "applied" });
    } finally {
      if (recordEdited) {
        await pool.execute(`UPDATE world_records SET total_time_ms=total_time_ms-1 WHERE mode_cc=? AND track_id=?`,
          [Number(first["mode"]), String(first["trackId"])]);
      }
      const [accountRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT user_account_id AS id FROM user_accounts WHERE public_id=?`, [accountId],
      );
      if (accountRows[0] !== undefined) {
        const accountNumericId = accountRows[0]["id"];
        await pool.execute(`DELETE FROM administrator_grant_lifecycle WHERE administrator_grant_id IN (SELECT administrator_grant_id FROM administrator_grants WHERE user_account_id=?)`, [accountNumericId]);
        await pool.execute(`DELETE FROM administrator_grants WHERE user_account_id=?`, [accountNumericId]);
      }
      await pool.execute(`DELETE FROM time_trial_submission_revisions WHERE time_trial_submission_id IN (SELECT time_trial_submission_id FROM time_trial_submissions WHERE public_id=?)`, [submissionId]);
      await pool.execute(`DELETE FROM time_trial_submissions WHERE public_id=?`, [submissionId]);
      await pool.execute(`DELETE FROM user_accounts WHERE public_id=?`, [accountId]);
      await pool.end();
      if (dirname(resolve(temp)) === resolve("test") && basename(temp).startsWith("reference-fixture-")) {
        await rm(temp, { recursive: true, force: true });
      } else {
        throw new Error("temporary fixture escaped the test directory");
      }
    }
  });
});
