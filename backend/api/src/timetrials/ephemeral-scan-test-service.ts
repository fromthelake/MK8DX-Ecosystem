import { createHash } from "node:crypto";

import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";

import {
  TimeTrialSubmissionError,
  type TimeTrialAssetCatalog,
  type TimeTrialSubmissionResult,
  type TimeTrialSubmissionV1,
} from "./submission-service.js";

export const ANDROID_SCAN_TEST_RETENTION_MS = 24 * 60 * 60 * 1_000;

export type EphemeralScanTestSummary = Readonly<{
  submissionId: string;
  revision: number;
  playerId: string;
  mode: 150 | 200;
  trackId: string;
  totalTimeMs: number;
  createdAtMs: number;
  expiresAtMs: number;
}>;

interface ExistingRow extends RowDataPacket {
  revision: unknown;
  accountId: unknown;
  playerId: unknown;
  payloadSha256: unknown;
  expiresAtMs: unknown;
}

interface SummaryRow extends RowDataPacket {
  submissionId: unknown;
  revision: unknown;
  playerId: unknown;
  mode: unknown;
  trackId: unknown;
  totalTimeMs: unknown;
  createdAtMs: unknown;
  expiresAtMs: unknown;
}

function integer(value: unknown): number {
  const result = typeof value === "string" ? Number(value) : value;
  if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 0) {
    throw new Error("Ephemeral scan test persistence returned invalid data.");
  }
  return result;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Ephemeral scan test persistence returned invalid data.");
  }
  return value;
}

function bytes(value: unknown): Buffer {
  if (!Buffer.isBuffer(value) || value.length !== 32) {
    throw new Error("Ephemeral scan test persistence returned invalid data.");
  }
  return value;
}

function duplicate(error: unknown): boolean {
  const candidate = error as { code?: unknown; errno?: unknown } | null;
  return candidate?.code === "ER_DUP_ENTRY" || candidate?.errno === 1062;
}

export class EphemeralAndroidScanTestService {
  public constructor(
    private readonly pool: Pool,
    private readonly assetCatalog: TimeTrialAssetCatalog,
    private readonly clock: Readonly<{ nowMs(): number }>,
  ) {}

  public async submit(
    input: TimeTrialSubmissionV1,
    userAccountId: string,
  ): Promise<TimeTrialSubmissionResult> {
    if (input.source.kind !== "android_scan_test" ||
      input.playerReference.namespace !== "player" || input.revision !== 1) {
      throw new TimeTrialSubmissionError(
        "invalid_submission",
        "an Android scan test must be a first revision owned by a canonical Player",
      );
    }
    const issues = await this.assetCatalog.validateReferences({
      trackId: input.trackId,
      ...(input.loadout === undefined ? {} : { loadout: input.loadout }),
      ...(input.countryId === undefined ? {} : { countryId: input.countryId }),
    });
    if (issues.length > 0) {
      throw new TimeTrialSubmissionError("invalid_assets", "asset references are invalid");
    }
    const createdAtMs = this.clock.nowMs();
    const expiresAtMs = createdAtMs + ANDROID_SCAN_TEST_RETENTION_MS;
    const payload = JSON.stringify(input);
    const digest = createHash("sha256").update(payload, "utf8").digest();
    await this.purgeExpired(createdAtMs);
    try {
      const [result] = await this.pool.execute<ResultSetHeader>(
        `INSERT INTO ephemeral_time_trial_scan_tests (
           public_id, revision_number, user_account_id, player_id,
           mode_cc, track_id, total_time_ms, canonical_payload,
           payload_sha256, created_at_ms, expires_at_ms
         )
         SELECT ?, ?, account.user_account_id, player.player_id,
                ?, ?, ?, ?, ?, ?, ?
         FROM user_accounts AS account
         INNER JOIN player_claims AS claim
           ON claim.user_account_id = account.user_account_id
          AND claim.claim_status = 'verified'
         INNER JOIN players AS player
           ON player.player_id = claim.player_id
          AND player.record_status = 'active'
         WHERE account.public_id = ? AND account.account_status = 'active'
           AND player.public_id = ?`,
        [
          input.submissionId, input.revision, input.mode, input.trackId,
          input.totalTimeMs, payload, digest, createdAtMs, expiresAtMs,
          userAccountId, input.playerReference.value,
        ],
      );
      if (result.affectedRows !== 1) {
        throw new TimeTrialSubmissionError("player_not_found", "verified Player was not found");
      }
    } catch (error) {
      if (!duplicate(error)) throw error;
      const [rows] = await this.pool.execute<ExistingRow[]>(
        `SELECT test.revision_number AS revision,
                account.public_id AS accountId, player.public_id AS playerId,
                test.payload_sha256 AS payloadSha256,
                test.expires_at_ms AS expiresAtMs
         FROM ephemeral_time_trial_scan_tests AS test
         INNER JOIN user_accounts AS account
           ON account.user_account_id = test.user_account_id
         INNER JOIN players AS player ON player.player_id = test.player_id
         WHERE test.public_id = ? LIMIT 1`,
        [input.submissionId],
      );
      const existing = rows[0];
      if (rows.length !== 1 || existing === undefined ||
        integer(existing.revision) !== input.revision ||
        text(existing.accountId) !== userAccountId ||
        text(existing.playerId) !== input.playerReference.value ||
        !bytes(existing.payloadSha256).equals(digest) ||
        integer(existing.expiresAtMs) <= createdAtMs) {
        throw new TimeTrialSubmissionError(
          "revision_conflict",
          "ephemeral scan test submission conflicts with current state",
        );
      }
    }
    return { submissionId: input.submissionId, revision: input.revision };
  }

  public async listForAccount(userAccountId: string): Promise<readonly EphemeralScanTestSummary[]> {
    const nowMs = this.clock.nowMs();
    await this.purgeExpired(nowMs);
    const [rows] = await this.pool.execute<SummaryRow[]>(
      `SELECT test.public_id AS submissionId,
              test.revision_number AS revision,
              player.public_id AS playerId,
              test.mode_cc AS mode, test.track_id AS trackId,
              test.total_time_ms AS totalTimeMs,
              test.created_at_ms AS createdAtMs,
              test.expires_at_ms AS expiresAtMs
       FROM ephemeral_time_trial_scan_tests AS test
       INNER JOIN user_accounts AS account
         ON account.user_account_id = test.user_account_id
       INNER JOIN players AS player ON player.player_id = test.player_id
       WHERE account.public_id = ? AND test.expires_at_ms > ?
       ORDER BY test.created_at_ms DESC`,
      [userAccountId, nowMs],
    );
    return rows.map((row) => ({
      submissionId: text(row.submissionId),
      revision: integer(row.revision),
      playerId: text(row.playerId),
      mode: integer(row.mode) as 150 | 200,
      trackId: text(row.trackId),
      totalTimeMs: integer(row.totalTimeMs),
      createdAtMs: integer(row.createdAtMs),
      expiresAtMs: integer(row.expiresAtMs),
    }));
  }

  public async purgeExpired(nowMs = this.clock.nowMs()): Promise<number> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      "DELETE FROM ephemeral_time_trial_scan_tests WHERE expires_at_ms <= ?",
      [nowMs],
    );
    return result.affectedRows;
  }
}
