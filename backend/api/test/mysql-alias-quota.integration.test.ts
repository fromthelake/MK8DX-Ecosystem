import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";
import mysql, { type Pool, type PoolOptions, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { AliasService } from "../src/identity/alias-service.js";
import { MysqlAliasReadRepository } from "../src/identity/mysql-alias-read-repository.js";
import { MysqlAliasWriteRepository } from "../src/identity/mysql-alias-write-repository.js";
import type { ActorContext, IdentityReadRepository } from "../src/identity/types.js";
import { MysqlMutationRateLimiter } from "../src/security/mysql-mutation-rate-limiter.js";

const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" ? describe : describe.skip;

// F04 part B on a real disposable database: the per-Player alias quota holds under concurrent
// requests from two API processes, refused writes leave nothing behind, the real HTTP route
// enforces CSRF and the durable account budget, and public reads page.
const run = randomUUID().slice(0, 8);
const ownerPlayer = `player.sec_s3_alias_owner_${run}`;
const otherPlayer = `player.sec_s3_alias_other_${run}`;
const ownerAccount = `user_account.sec_s3_alias_owner_${run}`;
const ownerActor: ActorContext = { role: "account", userAccountId: ownerAccount };

class NullIdentityReads implements IdentityReadRepository {
  async findPublicPlayerById(): Promise<null> { return null; }
  async findUserAccountSummaryById(): Promise<null> { return null; }
  async findPlayerClaimSummaryById(): Promise<null> { return null; }
}

integration("alias quotas on a real database", () => {
  let pools: Pool[] = [];
  let sequence = 0;

  const service = (pool: Pool) => new AliasService(new MysqlAliasWriteRepository(pool),
    { newAliasId: () => `alias.sec_s3_${run}_${String(++sequence)}` }, { nowMs: () => Date.now() });
  const declare = (text: string, playerId = ownerPlayer) => ({
    playerId, aliasText: text, aliasType: "declared" as const, visibility: "public" as const,
    provenance: [{ sourceType: "player_declaration" as const, sourceReference: "source.sec_s3_declaration",
      observedAtMs: 1_900_000_000_000 }],
  });
  async function aliasRows(playerId: string): Promise<number> {
    const [rows] = await pools[0]!.execute<Array<{ total: number } & RowDataPacket>>(
      `SELECT COUNT(*) AS total FROM aliases AS a INNER JOIN players AS p ON p.player_id = a.player_id
       WHERE p.public_id = ?`, [playerId]);
    return Number(rows[0]?.total);
  }

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
      connectionLimit: 6,
    };
    const password = process.env["MK8DX_MYSQL_TEST_PASSWORD"];
    if (password !== undefined) { options.password = password; }
    pools = [mysql.createPool(options), mysql.createPool(options)];
    const pool = pools[0]!;
    await pool.execute(
      `INSERT INTO players (public_id, revision, player_kind, display_name, record_status, created_at_ms, updated_at_ms)
       VALUES (?, 1, 'human', 'Sec S3 Alias Owner', 'active', 1, 1), (?, 1, 'human', 'Sec S3 Other', 'active', 1, 1)`,
      [ownerPlayer, otherPlayer]);
    await pool.execute(
      `INSERT INTO user_accounts (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
       VALUES (?, 1, 'private', 'active', 1, 1)`, [ownerAccount]);
    await pool.execute(
      `INSERT INTO player_claims (public_id, revision, privacy_class, player_id, user_account_id, claim_status,
         dispute_status, created_at_ms, updated_at_ms)
       SELECT ?, 1, 'private', p.player_id, a.user_account_id, 'verified', 'none', 1, 1
       FROM players AS p, user_accounts AS a WHERE p.public_id = ? AND a.public_id = ?`,
      [`player_claim.sec_s3_${run}`, ownerPlayer, ownerAccount]);
  });

  afterAll(async () => {
    const pool = pools[0];
    if (pool !== undefined) {
      for (const table of ["alias_lifecycle", "alias_provenance"]) {
        await pool.execute(
          `DELETE t FROM ${table} AS t INNER JOIN aliases AS a ON a.alias_id = t.alias_id
           WHERE a.public_id LIKE ?`, [`alias.sec_s3_${run}_%`]);
      }
      await pool.execute("DELETE FROM aliases WHERE public_id LIKE ?", [`alias.sec_s3_${run}_%`]);
      await pool.execute("DELETE FROM player_claims WHERE public_id = ?", [`player_claim.sec_s3_${run}`]);
      await pool.execute("DELETE FROM players WHERE public_id IN (?, ?)", [ownerPlayer, otherPlayer]);
      await pool.execute("DELETE FROM user_accounts WHERE public_id = ?", [ownerAccount]);
      await pool.execute("DELETE FROM api_mutation_rate_limits WHERE scope_key LIKE ?", [`alias-mutations-hour|${ownerAccount}%`]);
    }
    await Promise.all(pools.map(async (each) => each.end()));
  });

  it("admits exactly the quota under concurrent creates from two processes", async () => {
    const services = pools.map(service);
    const outcomes = await Promise.allSettled(Array.from({ length: 30 }, (_, index) =>
      services[index % 2]!.createAlias(ownerActor, declare(`Concurrent ${String(index)}`))));
    const created = outcomes.filter((outcome) => outcome.status === "fulfilled").length;
    const refused = outcomes.filter((outcome) => outcome.status === "rejected" &&
      (outcome.reason as { code?: string }).code === "quota_exceeded").length;
    expect(created).toBe(20);
    expect(refused).toBe(10);
    expect(await aliasRows(ownerPlayer)).toBe(20);
  });

  it("refuses another Player's aliases and pages public reads", async () => {
    await expect(service(pools[0]!).createAlias(ownerActor, declare("Not mine", otherPlayer)))
      .rejects.toMatchObject({ code: "forbidden" });
    expect(await aliasRows(otherPlayer)).toBe(0);
    const reads = new MysqlAliasReadRepository(pools[0]!);
    const first = await reads.listPublicAliasesByPlayerId(ownerPlayer, { limit: 8 });
    const second = await reads.listPublicAliasesByPlayerId(ownerPlayer, { limit: 8, after: first[7]!.aliasId });
    const all = await reads.listPublicAliasesByPlayerId(ownerPlayer);
    expect(first).toHaveLength(8);
    expect([...first, ...second].map((alias) => alias.aliasId)).toEqual(all.slice(0, 16).map((alias) => alias.aliasId));
  });

  it("enforces CSRF and the durable budget on the real HTTP route", async () => {
    const limiter = new MysqlMutationRateLimiter(pools[0]!);
    const resolveActor = async (_request: FastifyRequest): Promise<ActorContext> => ownerActor;
    const app: FastifyInstance = await buildApp({
      identityRepository: new NullIdentityReads(),
      resolveActor,
      aliasRepository: new MysqlAliasReadRepository(pools[0]!),
      aliasService: service(pools[0]!),
      aliasProtection: { rateLimiter: limiter, csrfVerifier: { verify: (_actor, proof) => proof === "good" } },
    });
    try {
      const retire = (aliasId: string, proof?: string) => app.inject({
        method: "POST", url: `/v1/aliases/${aliasId}/actions`,
        headers: { "content-type": "application/json", ...(proof === undefined ? {} : { "x-mk8dx-csrf": proof }) },
        payload: { action: "retire" },
      });
      const list = await app.inject({ method: "GET", url: `/v1/players/${ownerPlayer}/aliases` });
      expect(Object.keys(list.json()).sort()).toEqual(["aliases", "playerId", "schemaVersion"]);
      const ids = list.json<{ aliases: Array<{ aliasId: string }> }>().aliases.map((alias) => alias.aliasId);
      expect((await retire(ids[0]!)).statusCode).toBe(403);
      expect((await retire(ids[0]!, "good")).statusCode).toBe(200);
      const paged = await app.inject({ method: "GET", url: `/v1/players/${ownerPlayer}/aliases?limit=5` });
      expect(paged.json<{ nextAfter?: string }>().nextAfter).toMatch(/^alias\./);
      // Quota full again? One place is free after the retirement; the next is refused with 409.
      const create = (text: string) => app.inject({ method: "POST", url: "/v1/aliases",
        headers: { "content-type": "application/json", "x-mk8dx-csrf": "good" }, payload: declare(text) });
      expect((await create("Freed place")).statusCode).toBe(201);
      const full = await create("Over quota");
      expect(full.statusCode).toBe(409);
      expect(full.json<{ code: string }>().code).toBe("alias_quota_exceeded");
      let status = 0;
      let retryAfter: unknown;
      for (let index = 0; index < 40 && status !== 429; index += 1) {
        const response = await create(`Budget ${String(index)}`);
        status = response.statusCode;
        retryAfter = response.headers["retry-after"];
      }
      expect(status).toBe(429);
      expect(String(retryAfter)).toMatch(/^[0-9]+$/);
      expect(await aliasRows(ownerPlayer)).toBe(21);
    } finally {
      await app.close();
    }
  });
});
