import { randomUUID } from "node:crypto";

import type { RowDataPacket } from "mysql2";
import mysql, { type Pool } from "mysql2/promise";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdministratorGrantService } from
  "../src/administration/administrator-grant-service.js";
import {
  MysqlAdministratorGrantStatusRepository,
  MysqlAdministratorGrantWriteRepository,
} from "../src/administration/mysql-administrator-grant-repository.js";
import { buildApp } from "../src/app.js";
import { createAdministratorAwareActorResolver } from
  "../src/authentication/authentication-binding-resolver.js";
import { ClaimLifecycleService } from "../src/identity/claim-lifecycle-service.js";
import { MysqlClaimWriteRepository } from
  "../src/identity/mysql-claim-write-repository.js";
import { MysqlIdentityReadRepository } from
  "../src/identity/mysql-identity-read-repository.js";
import { MysqlPlayerClaimProductRepository } from
  "../src/profiles/mysql-player-claim-product-repository.js";
import { PlayerClaimProductService } from
  "../src/profiles/player-claim-product-service.js";

const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
const integration = database.endsWith("_test") || database.endsWith("_contract")
  ? describe
  : describe.skip;

integration("administrator claim request-to-verification product", () => {
  let pool: Pool;
  let app: FastifyInstance;
  const suffix = randomUUID();
  const playerId = `player.claim_review_${suffix}`;
  const claimantId = `user_account.claimant_${suffix}`;
  const administratorId = `user_account.administrator_${suffix}`;
  const claimId = `player_claim.claim_review_${suffix}`;
  const grantId = `administrator_grant.claim_review_${suffix}`;

  beforeAll(async () => {
    pool = mysql.createPool({
      host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
      port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
      user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
      password: process.env["MK8DX_MYSQL_TEST_PASSWORD"] ?? "",
      database,
      connectionLimit: 2,
    });
    const now = 1_900_000_000_000;
    await pool.execute(
      `INSERT INTO players (
         public_id, revision, player_kind, display_name, record_status,
         created_at_ms, updated_at_ms
       ) VALUES (?, 1, 'human', 'Claim Review Racer', 'active', ?, ?)`,
      [playerId, now, now],
    );
    await pool.execute(
      `INSERT INTO player_username_history (
         player_id, sequence_number, username_value, comparison_key,
         allocated_at_ms, released_at_ms
       ) SELECT player_id, 1, 'ClaimReviewRacer', ?, ?, NULL
         FROM players WHERE public_id = ?`,
      [Buffer.from(`claimreviewracer_${suffix}`, "utf8"), now, playerId],
    );
    await pool.execute(
      `INSERT INTO user_accounts (
         public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms
       ) VALUES (?, 1, 'private', 'active', ?, ?),
                (?, 1, 'private', 'active', ?, ?)`,
      [claimantId, now, now, administratorId, now, now],
    );

    await new AdministratorGrantService(
      new MysqlAdministratorGrantWriteRepository(pool),
      { newAdministratorGrantId: () => grantId },
      { nowMs: () => now },
    ).bootstrapFirstAdministrator(administratorId);

    let generatedClaim = false;
    const lifecycle = new ClaimLifecycleService(
      new MysqlClaimWriteRepository(pool),
      {
        newPlayerClaimId: () => {
          if (generatedClaim) { throw new Error("claim ID requested twice"); }
          generatedClaim = true;
          return claimId;
        },
        newRestrictedReviewId: () => `restricted_review.${randomUUID()}`,
      },
      { nowMs: () => now + 100 },
    );
    const baseResolver = async (request: FastifyRequest) => {
      if (request.headers.authorization === "Synthetic claimant") {
        return { role: "account" as const, userAccountId: claimantId };
      }
      if (request.headers.authorization === "Synthetic administrator") {
        return { role: "account" as const, userAccountId: administratorId };
      }
      return { role: "anonymous" as const };
    };
    const resolveActor = createAdministratorAwareActorResolver(
      baseResolver,
      new MysqlAdministratorGrantStatusRepository(pool),
    );
    app = await buildApp({
      identityRepository: new MysqlIdentityReadRepository(pool),
      resolveActor,
      claimLifecycle: lifecycle,
      claimCsrfVerifier: {
        verify: (actor, token) => actor.role !== "anonymous" &&
          actor.role !== "migration_operator" && token === "synthetic-csrf",
      },
      playerClaimProduct: {
        service: new PlayerClaimProductService(
          new MysqlPlayerClaimProductRepository(pool),
        ),
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    if (pool === undefined) { return; }
    await pool.execute(
      `DELETE lifecycle FROM player_claim_lifecycle AS lifecycle
       INNER JOIN player_claims AS claim
         ON claim.player_claim_id = lifecycle.player_claim_id
       WHERE claim.public_id = ?`,
      [claimId],
    );
    await pool.execute(
      `DELETE review_record FROM restricted_claim_reviews AS review_record
       INNER JOIN player_claims AS claim
         ON claim.player_claim_id = review_record.player_claim_id
       WHERE claim.public_id = ?`,
      [claimId],
    );
    await pool.execute("DELETE FROM player_claims WHERE public_id = ?", [claimId]);
    await pool.execute(
      `DELETE lifecycle FROM administrator_grant_lifecycle AS lifecycle
       INNER JOIN administrator_grants AS grant_record
         ON grant_record.administrator_grant_id = lifecycle.administrator_grant_id
       WHERE grant_record.public_id = ?`,
      [grantId],
    );
    await pool.execute("DELETE FROM administrator_grants WHERE public_id = ?", [grantId]);
    await pool.execute(
      `DELETE username FROM player_username_history AS username
       INNER JOIN players AS player ON player.player_id = username.player_id
       WHERE player.public_id = ?`,
      [playerId],
    );
    await pool.execute("DELETE FROM players WHERE public_id = ?", [playerId]);
    await pool.execute("DELETE FROM user_accounts WHERE public_id IN (?, ?)", [
      claimantId,
      administratorId,
    ]);
    await pool.end();
  });

  it("requests, queues, starts, verifies, and exposes verified state to its owner", async () => {
    const csrfHeaders = { "x-mk8dx-csrf": "synthetic-csrf" };
    const request = await app.inject({
      method: "POST",
      url: "/v1/player-claims",
      headers: { authorization: "Synthetic claimant", ...csrfHeaders },
      payload: { playerId, evidenceIds: [] },
    });
    expect(request.statusCode).toBe(201);

    const accountQueue = await app.inject({
      method: "GET",
      url: "/v1/administrator/player-claims",
      headers: { authorization: "Synthetic claimant" },
    });
    expect(accountQueue.statusCode).toBe(403);
    const administratorQueue = await app.inject({
      method: "GET",
      url: "/v1/administrator/player-claims",
      headers: { authorization: "Synthetic administrator" },
    });
    expect(administratorQueue.statusCode).toBe(200);
    expect(administratorQueue.json()).toMatchObject({
      claims: [{ playerClaimId: claimId, claimStatus: "requested" }],
    });
    expect(administratorQueue.body).not.toMatch(
      /userAccountId|email|evidence|reviewReference/i,
    );

    for (const [action, reasonCode] of [
      ["start_review", "administrator_review_started"],
      ["verify", "identity_evidence_reviewed"],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: `/v1/player-claims/${claimId}/actions`,
        headers: { authorization: "Synthetic administrator", ...csrfHeaders },
        payload: { action, evidenceIds: [], reasonCode },
      });
      expect(response.statusCode).toBe(200);
    }

    const mine = await app.inject({
      method: "GET",
      url: "/v1/me/player-claims",
      headers: { authorization: "Synthetic claimant" },
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json()).toMatchObject({
      claims: [{ playerClaimId: claimId, claimStatus: "verified" }],
    });
    const [events] = await pool.execute<RowDataPacket[]>(
      `SELECT lifecycle.event_type AS eventType
       FROM player_claim_lifecycle AS lifecycle
       INNER JOIN player_claims AS claim
         ON claim.player_claim_id = lifecycle.player_claim_id
       WHERE claim.public_id = ? ORDER BY lifecycle.sequence_number`,
      [claimId],
    );
    expect(events.map((event) => event["eventType"])).toEqual([
      "claim_requested",
      "review_started",
      "claim_verified",
    ]);
  });
});
