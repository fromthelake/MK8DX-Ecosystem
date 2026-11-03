import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

import {
  ClaimLifecycleService,
  type ClaimIdGenerator,
  type Clock,
} from "../src/identity/claim-lifecycle-service.js";
import { MysqlClaimWriteRepository } from "../src/identity/mysql-claim-write-repository.js";
import type { ActorContext } from "../src/identity/types.js";

const integrationEnabled = process.env["MK8DX_MYSQL_INTEGRATION"] === "1";
const integration = integrationEnabled ? describe : describe.skip;

const playerId = "player.synthetic_claim_write_01";
const secondPlayerId = "player.synthetic_claim_write_02";
const ownerAccountId = "user_account.synthetic_claim_write_owner_01";
const replacementAccountId = "user_account.synthetic_claim_write_owner_02";
const adminAccountId = "user_account.synthetic_claim_write_admin_01";
const evidenceId = "restricted_evidence.synthetic_claim_write_01";
const adminEvidenceId = "restricted_evidence.synthetic_claim_write_admin_01";

const owner: ActorContext = { role: "account", userAccountId: ownerAccountId };
const replacementOwner: ActorContext = {
  role: "account",
  userAccountId: replacementAccountId,
};
const administrator: ActorContext = {
  role: "administrator",
  userAccountId: adminAccountId,
};

class DeterministicIds implements ClaimIdGenerator {
  private claimSequence = 0;
  private reviewSequence = 0;

  newPlayerClaimId(): string {
    this.claimSequence += 1;
    return `player_claim.synthetic_claim_write_${this.claimSequence
      .toString()
      .padStart(2, "0")}`;
  }

  newRestrictedReviewId(): string {
    this.reviewSequence += 1;
    return `restricted_review.synthetic_claim_write_${this.reviewSequence
      .toString()
      .padStart(2, "0")}`;
  }
}

class DeterministicClock implements Clock {
  private current = 1_800_000_000_000;

  nowMs(): number {
    this.current += 1_000;
    return this.current;
  }
}

integration("MySQL claim write repository integration", () => {
  let pool: Pool;
  let lifecycle: ClaimLifecycleService;

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
      connectionLimit: 2,
      multipleStatements: false,
      namedPlaceholders: false,
    };
    const password = process.env["MK8DX_MYSQL_TEST_PASSWORD"];
    if (password !== undefined) {
      poolOptions.password = password;
    }
    pool = mysql.createPool(poolOptions);
    lifecycle = new ClaimLifecycleService(
      new MysqlClaimWriteRepository(pool),
      new DeterministicIds(),
      new DeterministicClock(),
    );

    await pool.execute(
      `INSERT INTO players
       (public_id, revision, player_kind, display_name, record_status,
        created_at_ms, updated_at_ms)
       VALUES
         (?, 1, 'human', 'Synthetic Claim Racer One', 'active', 1, 1),
         (?, 1, 'human', 'Synthetic Claim Racer Two', 'active', 1, 1)`,
      [playerId, secondPlayerId],
    );
    await pool.execute(
      `INSERT INTO user_accounts
       (public_id, revision, privacy_class, account_status,
        created_at_ms, updated_at_ms)
       VALUES
         (?, 1, 'private', 'active', 1, 1),
         (?, 1, 'private', 'active', 1, 1),
         (?, 1, 'private', 'active', 1, 1)`,
      [ownerAccountId, replacementAccountId, adminAccountId],
    );
    await pool.execute(
      `INSERT INTO restricted_claim_evidence
       (public_id, player_claim_id, uploaded_by_user_account_id,
        source_type, captured_at_ms, storage_reference)
       SELECT ?, NULL, a.user_account_id, 'account_submission', 1, NULL
       FROM user_accounts AS a
       WHERE a.public_id = ?`,
      [evidenceId, ownerAccountId],
    );
    await pool.execute(
      `INSERT INTO restricted_claim_evidence
       (public_id, player_claim_id, uploaded_by_user_account_id,
        source_type, captured_at_ms, storage_reference)
       SELECT ?, NULL, a.user_account_id, 'administrator_observation', 2, NULL
       FROM user_accounts AS a
       WHERE a.public_id = ?`,
      [adminEvidenceId, adminAccountId],
    );
  });

  afterAll(async () => {
    if (pool === undefined) {
      return;
    }
    await pool.execute(
      `DELETE FROM restricted_identity_access_log
       WHERE accessor_reference IN (?, ?, ?)`,
      [ownerAccountId, replacementAccountId, adminAccountId],
    );
    await pool.execute(
      `DELETE ee FROM player_claim_event_evidence AS ee
       INNER JOIN player_claim_lifecycle AS l
         ON l.claim_lifecycle_id = ee.claim_lifecycle_id
       INNER JOIN player_claims AS c ON c.player_claim_id = l.player_claim_id
       WHERE c.public_id LIKE 'player_claim.synthetic_claim_write_%'`,
    );
    await pool.execute(
      `DELETE l FROM player_claim_lifecycle AS l
       INNER JOIN player_claims AS c ON c.player_claim_id = l.player_claim_id
       WHERE c.public_id LIKE 'player_claim.synthetic_claim_write_%'`,
    );
    await pool.execute(
      `DELETE r FROM restricted_claim_reviews AS r
       INNER JOIN player_claims AS c ON c.player_claim_id = r.player_claim_id
       WHERE c.public_id LIKE 'player_claim.synthetic_claim_write_%'`,
    );
    await pool.execute(
      "DELETE FROM restricted_claim_evidence WHERE public_id IN (?, ?)",
      [evidenceId, adminEvidenceId],
    );
    await pool.execute(
      "DELETE FROM player_claims WHERE public_id LIKE 'player_claim.synthetic_claim_write_%'",
    );
    await pool.execute("DELETE FROM players WHERE public_id IN (?, ?)", [
      playerId,
      secondPlayerId,
    ]);
    await pool.execute("DELETE FROM user_accounts WHERE public_id IN (?, ?, ?)", [
      ownerAccountId,
      replacementAccountId,
      adminAccountId,
    ]);
    await pool.end();
  });

  it("persists reviewed lifecycle, private reviews, evidence provenance, and release", async () => {
    const requested = await lifecycle.requestClaim(owner, {
      playerId,
      evidenceIds: [evidenceId],
    });
    await lifecycle.administratorAction(administrator, {
      playerClaimId: requested.playerClaimId,
      action: "start_review",
      evidenceIds: [adminEvidenceId],
    });
    const verified = await lifecycle.administratorAction(administrator, {
      playerClaimId: requested.playerClaimId,
      action: "verify",
      evidenceIds: [evidenceId],
      reasonCode: "evidence_confirmed",
    });
    expect(verified).toMatchObject({
      claimStatus: "verified",
      revision: 3,
      lastSequence: 3,
    });

    const [claimRows] = await pool.execute<any[]>(
      `SELECT claim_status AS claimStatus, revision
       FROM player_claims WHERE public_id = ?`,
      [requested.playerClaimId],
    );
    expect(claimRows).toEqual([{ claimStatus: "verified", revision: 3 }]);

    const [auditRows] = await pool.execute<any[]>(
      `SELECT
         (SELECT COUNT(*) FROM player_claim_lifecycle WHERE player_claim_id = c.player_claim_id) AS lifecycleCount,
         (SELECT COUNT(*) FROM restricted_claim_reviews WHERE player_claim_id = c.player_claim_id) AS reviewCount,
         (SELECT COUNT(*)
          FROM player_claim_event_evidence AS ee
          INNER JOIN player_claim_lifecycle AS l
            ON l.claim_lifecycle_id = ee.claim_lifecycle_id
          WHERE l.player_claim_id = c.player_claim_id) AS evidenceLinkCount
       FROM player_claims AS c WHERE c.public_id = ?`,
      [requested.playerClaimId],
    );
    expect(auditRows).toEqual([
      { lifecycleCount: 3, reviewCount: 2, evidenceLinkCount: 3 },
    ]);

    const [accessRows] = await pool.execute<any[]>(
      `SELECT
         evidence.public_id AS evidenceId,
         accessor_type AS accessorType,
         purpose_code AS purposeCode
       FROM restricted_identity_access_log AS log
       INNER JOIN restricted_claim_evidence AS evidence
         ON evidence.claim_evidence_id = log.claim_evidence_id
       WHERE evidence.public_id IN (?, ?)
       ORDER BY log.identity_access_log_id`,
      [evidenceId, adminEvidenceId],
    );
    expect(accessRows).toEqual([
      {
        evidenceId,
        accessorType: "account",
        purposeCode: "claim_requested",
      },
      {
        evidenceId: adminEvidenceId,
        accessorType: "administrator",
        purposeCode: "review_started",
      },
      {
        evidenceId,
        accessorType: "administrator",
        purposeCode: "claim_verified",
      },
    ]);

    const released = await lifecycle.administratorAction(administrator, {
      playerClaimId: requested.playerClaimId,
      action: "release",
      reasonCode: "administrator_assisted_release",
    });
    expect(released).toMatchObject({ claimStatus: "released", revision: 4 });

    const replacement = await lifecycle.requestClaim(replacementOwner, {
      playerId,
      evidenceIds: [],
    });
    expect(replacement).toMatchObject({
      userAccountId: replacementAccountId,
      claimStatus: "requested",
    });
    expect(replacement.playerClaimId).not.toBe(requested.playerClaimId);
  });

  it("rejects evidence owned by another account without creating a claim", async () => {
    await expect(
      lifecycle.requestClaim(replacementOwner, {
        playerId: secondPlayerId,
        evidenceIds: [evidenceId],
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const [rows] = await pool.execute<any[]>(
      `SELECT COUNT(*) AS claimCount
       FROM player_claims AS c
       INNER JOIN players AS p ON p.player_id = c.player_id
       WHERE p.public_id = ?`,
      [secondPlayerId],
    );
    expect(rows).toEqual([{ claimCount: 0 }]);
  });
});
