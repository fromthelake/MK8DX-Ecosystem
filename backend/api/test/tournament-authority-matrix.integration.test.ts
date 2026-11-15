import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolConnection, type PoolOptions } from "mysql2/promise";

import { MysqlAdministratorGrantStatusRepository } from
  "../src/administration/mysql-administrator-grant-repository.js";
import { createAdministratorAwareActorResolver } from
  "../src/authentication/authentication-binding-resolver.js";
import type { ActorContext, ActorResolver } from "../src/identity/types.js";
import { MysqlTournamentConnectedRepository } from
  "../src/tournaments/mysql-tournament-connected-repository.js";
import { MysqlTournamentOperationRepository } from
  "../src/tournaments/mysql-tournament-operation-repository.js";
import { MysqlTournamentOperatorCapabilityRepository } from
  "../src/tournaments/mysql-tournament-operator-capability-repository.js";
import { MysqlTournamentWriteRepository } from
  "../src/tournaments/mysql-tournament-write-repository.js";
import { TournamentRaceResultService } from "../src/tournaments/race-result-service.js";
import { MysqlTournamentAcceptUnitOfWork } from
  "../src/tournaments/tournament-accept-unit-of-work.js";
import { registerTournamentConnectedRoutes } from
  "../src/tournaments/tournament-connected-routes.js";
import {
  TournamentConnectedService,
  type TournamentEvidenceLimits,
} from "../src/tournaments/tournament-connected-service.js";
import { registerTournamentNativeOperationRoutes } from
  "../src/tournaments/tournament-native-operation-routes.js";
import { TournamentOperationService } from "../src/tournaments/tournament-operation-service.js";
import { TournamentOperatorCapabilityService } from
  "../src/tournaments/tournament-operator-capability-service.js";
import { MysqlMutationRateLimiter } from "../src/security/mysql-mutation-rate-limiter.js";

/**
 * The Tournament authority matrix (security findings F02, F05 and F04 part A)
 * through the real Fastify routes, the real services and a disposable MySQL
 * schema. Only the Better Auth session check is replaced: a bearer names a
 * synthetic account, and the production administrator-aware resolver turns it
 * into an actor from the real administrator grants. Needs a freshly migrated
 * schema of its own (MK8DX_MYSQL_TEST_DATABASE ending in _test).
 */
const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" ? describe : describe.skip;

const NOW = 1_900_000_500_000;
const account = (name: string) => `user_account.synthetic_matrix_${name}`;
const ids = {
  administrator: account("administrator"),
  directorA: account("director_a"),
  directorB: account("director_b"),
  ordinary: account("ordinary"),
  revoked: account("revoked"),
  delegate: account("delegate"),
  quotaA: account("quota_a"),
  quotaB: account("quota_b"),
  quotaC: account("quota_c"),
  rate: account("rate"),
} as const;
type Who = keyof typeof ids | "anonymous";
const tournaments = {
  a: "tournament.synthetic_matrix_a",
  b: "tournament.synthetic_matrix_b",
  r: "tournament.synthetic_matrix_r",
} as const;
const groups = {
  a: "tournament_group.synthetic_matrix_a_one",
  b: "tournament_group.synthetic_matrix_b_one",
  r: "tournament_group.synthetic_matrix_r_one",
} as const;
const rosterNames = {
  a: ["Alpha Moss", "Bravo Evan", "Charlie Nola", "Delta Rook"],
  b: ["Echo Lark", "Foxtrot Vale", "Golf Wren", "Hotel Pike"],
  r: ["India Fern", "Juliet Moor", "Kilo Reed", "Lima Sage"],
} as const;
const playerId = (key: keyof typeof tournaments, index: number) => `player.synthetic_matrix_${key}_${index + 1}`;
const pendingId = (key: keyof typeof tournaments, n: number) =>
  `00000000-0000-4000-8000-0000000${key === "a" ? "1" : key === "b" ? "2" : "3"}000${n}`;

const bearer = (who: Who) => who === "anonymous"
  ? {}
  : { authorization: `Bearer tok.${who}.synthetic-session-signature` };
const csrf = (who: Who) => who === "anonymous" ? {} : { "x-mk8dx-csrf": `csrf:${ids[who as keyof typeof ids]}` };

function race(key: keyof typeof tournaments, raceNumber: number, namespace: "player" | "producer_local_player") {
  return {
    schemaVersion: "mk8dx.tournament-race-result.v1" as const,
    raceResultId: `tournament_race_result.synthetic_matrix_${key}_${raceNumber}`,
    revision: 1,
    raceNumber,
    scoringSegment: 1,
    trackId: "track.mario_kart_stadium",
    countsTowardStandings: true,
    placements: rosterNames[key].map((name, index) => ({
      finishPosition: index + 1,
      observedPlayerName: name,
      participantReference: namespace === "player"
        ? { namespace: "player" as const, value: playerId(key, index) }
        : { namespace: "producer_local_player" as const, value: `local.${key}.${index + 1}` },
      scoring: { racePoints: 15 - index * 3, totalBeforeRace: 0, totalAfterRace: 15 - index * 3, rankAfterRace: index + 1 },
    })),
    source: { kind: "tournament_live_capture" as const, transport: "native_contract" as const },
    timestamps: { occurredAtMs: NOW - 10_000 + raceNumber, createdAtMs: NOW - 9_000 + raceNumber },
  };
}

integration("Tournament authority matrix (native and web routes, real MySQL)", () => {
  let pool: Pool;
  let app: FastifyInstance;
  let capabilities: TournamentOperatorCapabilityService;
  let makeApp: (options?: Readonly<{
    pool?: Pool;
    evidenceLimits?: Partial<TournamentEvidenceLimits>;
    nowMs?: () => number;
  }>) => Promise<{ app: FastifyInstance; service: TournamentConnectedService }>;
  const apps: FastifyInstance[] = [];
  const pools: Pool[] = [];
  let poolOptions: PoolOptions;

  async function rows<T = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T[]> {
    const [result] = await pool.query(sql, values);
    return result as T[];
  }

  /** Everything a review could have touched for one Tournament. */
  async function reviewState(key: keyof typeof tournaments) {
    const incoming = await rows<{ public_id: string; status: string; revision: number }>(
      `SELECT ir.public_id, ir.status, ir.revision FROM tournament_incoming_results ir
         JOIN tournaments t ON t.tournament_id = ir.tournament_id WHERE t.public_id = ? ORDER BY ir.public_id`,
      [tournaments[key]]);
    const reviews = await rows<{ total: number }>(
      `SELECT COUNT(*) AS total FROM tournament_incoming_result_reviews review
         JOIN tournament_incoming_results ir ON ir.tournament_incoming_result_id = review.tournament_incoming_result_id
         JOIN tournaments t ON t.tournament_id = ir.tournament_id WHERE t.public_id = ?`, [tournaments[key]]);
    const races = await rows<{ total: number }>(
      `SELECT COUNT(*) AS total FROM tournament_group_races race
         JOIN tournament_groups grp ON grp.tournament_group_id = race.tournament_group_id
         JOIN tournaments t ON t.tournament_id = grp.tournament_id WHERE t.public_id = ?`, [tournaments[key]]);
    const tournament = await rows<{ revision: number }>(
      "SELECT revision FROM tournaments WHERE public_id = ?", [tournaments[key]]);
    return {
      incoming: incoming.map((row) => `${row.public_id}:${row.status}:${row.revision}`),
      reviews: Number(reviews[0]?.total ?? 0),
      races: Number(races[0]?.total ?? 0),
      revision: Number(tournament[0]?.revision ?? 0),
    };
  }

  async function seedPending(key: keyof typeof tournaments, n: number) {
    await pool.execute(
      `INSERT INTO tournament_incoming_results (
         public_id, tournament_id, source_kind, status, revision,
         result_payload_json, semantic_fingerprint, suggested_phase,
         suggested_group_public_id, suggested_race_number, occurred_at_ms,
         captured_at_ms, submitted_by_user_account_id, created_at_ms, updated_at_ms
       ) SELECT ?, tournament_id, 'tournament_live_capture', 'pending', 1,
                ?, ?, 'qualifier', ?, ?, ?, ?, director_user_account_id, ?, ?
           FROM tournaments WHERE public_id = ?`,
      [pendingId(key, n), JSON.stringify(race(key, n, "player")), `fingerprint-matrix-${key}-${n}`,
        groups[key], n, NOW - 5_000, NOW - 5_000, NOW - 5_000, NOW - 5_000, tournaments[key]],
    );
  }

  async function grantCapability(name: keyof typeof ids) {
    await capabilities.grant({ role: "administrator", userAccountId: ids.administrator }, ids[name], "matrix.setup");
  }

  beforeAll(async () => {
    const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
    if (!database.endsWith("_test") && !database.endsWith("_contract")) throw new Error("explicit test schema required");
    const options: PoolOptions = {
      host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
      port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
      user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
      database,
    };
    if (process.env["MK8DX_MYSQL_TEST_PASSWORD"] !== undefined) options.password = process.env["MK8DX_MYSQL_TEST_PASSWORD"];
    poolOptions = options;
    pool = mysql.createPool(options);

    for (const id of Object.values(ids)) {
      await pool.execute(
        `INSERT INTO user_accounts (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
         VALUES (?, 1, 'private', 'active', 1, 1)`, [id]);
    }
    await pool.execute(
      `INSERT INTO administrator_grants (public_id, revision, user_account_id, grant_status, grant_origin, granted_at_ms, updated_at_ms)
       SELECT 'administrator_grant.synthetic_matrix', 1, user_account_id, 'active', 'administrator', 1, 1
         FROM user_accounts WHERE public_id = ?`, [ids.administrator]);
    capabilities = new TournamentOperatorCapabilityService(
      new MysqlTournamentOperatorCapabilityRepository(pool),
      { newGrantId: (() => { let n = 0; return () => `account_capability_grant.synthetic_matrix_${++n}`; })() },
      { nowMs: () => NOW },
    );
    await grantCapability("directorA");
    await grantCapability("directorB");
    await grantCapability("revoked");
    await capabilities.revoke({ role: "administrator", userAccountId: ids.administrator }, ids.revoked, "matrix.revoked");

    const directorOf = { a: ids.directorA, b: ids.directorB, r: ids.revoked } as const;
    for (const key of ["a", "b", "r"] as const) {
      await pool.execute(
        `INSERT INTO tournaments (
           public_id, name, start_at_ms, timezone_name, director_user_account_id, stage,
           lifecycle_status, workflow_step, qualifier_rounds, revision, seed_order,
           placement_strategy, public_results, affects_rating, created_at_ms, updated_at_ms
         ) SELECT ?, ?, ?, 'Europe/Amsterdam', user_account_id,
                  'qualifiers', 'active', 5, TRUE, 1, 'ranked', 'balanced', FALSE, FALSE, 1, 1
             FROM user_accounts WHERE public_id = ?`,
        [tournaments[key], `Matrix ${key.toUpperCase()}`, NOW - 3_600_000, directorOf[key]]);
      await pool.execute(
        `INSERT INTO tournament_groups (
           tournament_id, public_id, stage, sequence_number, name, locked,
           manual_score_segments, created_at_ms, updated_at_ms
         ) SELECT tournament_id, ?, 'qualifier', 1, 'Groep 1', FALSE, 1, 1, 1
             FROM tournaments WHERE public_id = ?`, [groups[key], tournaments[key]]);
      for (const [index, name] of rosterNames[key].entries()) {
        await pool.execute(
          `INSERT INTO players (public_id, revision, player_kind, display_name, record_status, created_at_ms, updated_at_ms)
           VALUES (?, 1, 'human', ?, 'active', 1, 1)`, [playerId(key, index), name]);
        await pool.execute(
          `INSERT INTO tournament_participants (tournament_id, player_id, attendance, has_switch_1, has_switch_2, added_at_ms, updated_at_ms)
           SELECT t.tournament_id, p.player_id, 'present', ?, FALSE, 1, 1
             FROM tournaments t JOIN players p ON p.public_id = ? WHERE t.public_id = ?`,
          [index === 0, playerId(key, index), tournaments[key]]);
        await pool.execute(
          `INSERT INTO tournament_group_members (tournament_group_id, player_id, seat_order)
           SELECT g.tournament_group_id, p.player_id, ?
             FROM tournament_groups g JOIN players p ON p.public_id = ? WHERE g.public_id = ?`,
          [index + 1, playerId(key, index), groups[key]]);
      }
      await seedPending(key, 1);
      await seedPending(key, 2);
    }

    makeApp = async (appOptions = {}) => {
    const db = appOptions.pool ?? pool;
    const clock = appOptions.nowMs ?? (() => NOW);
    const operationService = (connection?: PoolConnection) => new TournamentOperationService({
      repository: new MysqlTournamentOperationRepository(db, connection),
      raceResults: { async submit() { throw new Error("unused"); } } as never,
      publications: { async review() { throw new Error("unused"); } } as never,
      rating: { async include() { throw new Error("unused"); } } as never,
      ids: { newTournamentId: () => "tournament.unused", newGroupId: () => "tournament_group.unused" },
      clock: { nowMs: () => NOW },
    });
    const build = (connection: PoolConnection) => ({
      repository: new MysqlTournamentConnectedRepository(db, connection),
      raceResults: new TournamentRaceResultService(
        new MysqlTournamentWriteRepository(db, connection),
        { async validateReferences() { return []; } },
        passthroughProtector(),
      ),
      operations: operationService(connection),
    });
    const operations = operationService();
    const connected = new TournamentConnectedService(
      new MysqlTournamentConnectedRepository(db),
      { async submit() { throw new Error("accept must use the unit of work"); } },
      { async attachRaces() { throw new Error("accept must use the unit of work"); } },
      clock,
      new MysqlTournamentAcceptUnitOfWork(db, build),
      (userAccountId) => capabilities.has(userAccountId),
      {
        rateLimiter: new MysqlMutationRateLimiter(db, clock),
        ...(appOptions.evidenceLimits === undefined ? {} : { evidenceLimits: appOptions.evidenceLimits }),
      },
    );
    const sessions: ActorResolver = async (request) => {
      const match = /^Bearer tok\.([a-zA-Z]+)\./u.exec(request.headers.authorization ?? "");
      const name = match?.[1] as keyof typeof ids | undefined;
      return name === undefined || ids[name] === undefined
        ? { role: "anonymous" }
        : { role: "account", userAccountId: ids[name] };
    };
    const resolveActor = createAdministratorAwareActorResolver(
      sessions, new MysqlAdministratorGrantStatusRepository(db));
    const built = Fastify();
    apps.push(built);
    registerTournamentConnectedRoutes(built, {
      resolveActor,
      tournamentConnected: connected,
      csrfVerifier: {
        verify: (actor: ActorContext, token: string) =>
          (actor.role === "account" || actor.role === "administrator") && token === `csrf:${actor.userAccountId}`,
      },
    });
    await registerTournamentNativeOperationRoutes(built, {
      resolveActor,
      operations,
      connected,
      hasOperationCapability: (userAccountId) => capabilities.has(userAccountId),
    });
    return { app: built, service: connected };
    };
    app = (await makeApp()).app;
  });

  afterAll(async () => {
    await Promise.all(apps.map((built) => built.close()));
    await Promise.all(pools.map((extra) => extra.end()));
    await pool?.end();
  });

  describe("F02: reading and rejecting another director's results", () => {
    const nativeIncoming = (key: keyof typeof tournaments, who: Who) => app.inject({
      method: "GET", url: `/v1/native/tournaments/${tournaments[key]}/incoming-results`, headers: bearer(who),
    });
    const nativeEvidence = (key: keyof typeof tournaments, who: Who) => app.inject({
      method: "GET", url: `/v1/native/tournaments/${tournaments[key]}/evidence-records`, headers: bearer(who),
    });
    const nativeReject = (key: keyof typeof tournaments, n: number, who: Who) => app.inject({
      method: "POST", url: `/v1/native/tournament-incoming-results/${pendingId(key, n)}/actions/reject`,
      headers: bearer(who), payload: { expectedRevision: 1, reason: "matrix rejection" },
    });
    const webIncoming = (key: keyof typeof tournaments, who: Who) => app.inject({
      method: "GET", url: `/v1/administrator/tournaments/${tournaments[key]}/incoming-results`, headers: bearer(who),
    });
    const webReject = (key: keyof typeof tournaments, n: number, who: Who) => app.inject({
      method: "POST", url: `/v1/administrator/tournament-incoming-results/${pendingId(key, n)}/actions/reject`,
      headers: { ...bearer(who), ...csrf(who) }, payload: { expectedRevision: 1, reason: "matrix rejection" },
    });

    it("refuses director A on director B's Tournament through the native route, with no side effects", async () => {
      const before = await reviewState("b");
      const list = await nativeIncoming("b", "directorA");
      expect(list.statusCode).toBe(403);
      expect(list.body).not.toContain(pendingId("b", 1));
      const evidence = await nativeEvidence("b", "directorA");
      expect(evidence.statusCode).toBe(403);
      const reject = await nativeReject("b", 1, "directorA");
      expect(reject.statusCode).toBe(403);
      const document = await app.inject({
        method: "GET", url: `/v1/native/tournaments/${tournaments.b}`, headers: bearer("directorA"),
      });
      expect(document.statusCode).toBe(403);
      expect(await reviewState("b")).toEqual(before);
    });

    it("refuses director A on director B's Tournament through the web route", async () => {
      const before = await reviewState("b");
      expect((await webIncoming("b", "directorA")).statusCode).toBe(403);
      expect((await webReject("b", 1, "directorA")).statusCode).toBe(403);
      expect(await reviewState("b")).toEqual(before);
    });

    it("refuses anonymous, ordinary and revoked accounts everywhere", async () => {
      const before = { a: await reviewState("a"), r: await reviewState("r") };
      for (const who of ["anonymous", "ordinary", "revoked"] as const) {
        expect((await nativeIncoming("a", who)).statusCode, `${who} native list`).toBe(403);
        expect((await nativeReject("a", 1, who)).statusCode, `${who} native reject`).toBe(403);
        expect((await webIncoming("a", who)).statusCode, `${who} web list`).toBe(403);
        expect((await webReject("a", 1, who)).statusCode, `${who} web reject`).toBe(403);
      }
      // The revoked director still is the recorded director of R: revocation ends that authority.
      expect((await nativeIncoming("r", "revoked")).statusCode).toBe(403);
      expect((await webIncoming("r", "revoked")).statusCode).toBe(403);
      expect((await webReject("r", 1, "revoked")).statusCode).toBe(403);
      expect(await reviewState("a")).toEqual(before.a);
      expect(await reviewState("r")).toEqual(before.r);
    });

    it("re-checks the reviewer inside the reject transaction", async () => {
      const repository = new MysqlTournamentConnectedRepository(pool);
      const before = await reviewState("b");
      await expect(repository.markRejected({
        incomingResultId: pendingId("b", 2), expectedRevision: 1, reviewReason: "direct repository call",
        reviewedByUserAccountId: ids.directorA, nowMs: NOW,
      })).rejects.toMatchObject({ code: "forbidden" });
      await expect(repository.markRejected({
        incomingResultId: pendingId("r", 2), expectedRevision: 1, reviewReason: "revoked director",
        reviewedByUserAccountId: ids.revoked, nowMs: NOW,
      })).rejects.toMatchObject({ code: "forbidden" });
      expect(await reviewState("b")).toEqual(before);
    });

    it("lets director A review and accept on A's own Tournament", async () => {
      const list = await nativeIncoming("a", "directorA");
      expect(list.statusCode).toBe(200);
      expect(list.json().results.map((row: { incomingResultId: string }) => row.incomingResultId))
        .toContain(pendingId("a", 1));
      expect((await nativeEvidence("a", "directorA")).statusCode).toBe(200);
      const reject = await nativeReject("a", 2, "directorA");
      expect(reject.statusCode).toBe(200);
      const revision = (await reviewState("a")).revision;
      const accept = await app.inject({
        method: "POST", url: `/v1/native/tournament-incoming-results/${pendingId("a", 1)}/actions/accept`,
        headers: bearer("directorA"),
        payload: {
          expectedRevision: 1, tournamentRevision: revision, groupId: groups.a, raceNumber: 1,
          correctedResult: race("a", 1, "player"), reason: "Director A checked the race",
        },
      });
      expect(accept.statusCode, accept.body).toBe(200);
      const after = await reviewState("a");
      expect(after.incoming).toEqual([`${pendingId("a", 1)}:accepted:2`, `${pendingId("a", 2)}:rejected:2`]);
      expect(after.reviews).toBe(2);
      expect(after.races).toBe(1);
    });

    it("lets a real administrator review any Tournament", async () => {
      expect((await nativeIncoming("b", "administrator")).statusCode).toBe(200);
      expect((await webIncoming("b", "administrator")).statusCode).toBe(200);
      const reject = await webReject("b", 2, "administrator");
      expect(reject.statusCode).toBe(200);
      expect((await reviewState("b")).incoming).toContain(`${pendingId("b", 2)}:rejected:2`);
    });
  });

  describe("F05: a roster match is never an authorization", () => {
    async function uploadLive(who: Who, key: keyof typeof tournaments, clientRecordId: string, raceCount = 1) {
      const registered = await app.inject({
        method: "POST", url: "/v1/tournament-evidence-records", headers: bearer(who),
        payload: {
          clientRecordId, sourceKind: "tournament_live_capture", suggestedTournamentId: tournaments[key],
          complete: false, entries: [], startedAtMs: NOW - 60_000,
          liveMappings: [{ observedGroupLabel: "Card 1", groupId: groups[key], phase: "qualifier" }],
        },
      });
      expect(registered.statusCode, registered.body).toBe(200);
      const raced = await app.inject({
        method: "POST", url: "/v1/tournament-evidence-records", headers: bearer(who),
        payload: {
          clientRecordId, sourceKind: "tournament_live_capture", suggestedTournamentId: tournaments[key],
          complete: false, startedAtMs: NOW - 60_000,
          entries: Array.from({ length: raceCount }, (_, index) => ({
            entryKey: `card-1:${index + 1}`, observedGroupLabel: "Card 1",
            result: race(key, index + 1, "producer_local_player"),
          })),
        },
      });
      expect(raced.statusCode, raced.body).toBe(200);
      return raced.json().record as { recordId: string; revision: number; live?: { status: string } };
    }
    const publicGroups = async (key: keyof typeof tournaments) =>
      (await app.inject({ method: "GET", url: `/v1/public/tournaments/${tournaments[key]}/live-standings` })).json().groups;

    it("keeps an ordinary account's feed with matching roster names out of the public view", async () => {
      const officialBefore = await reviewState("b");
      const record = await uploadLive("ordinary", "b", "matrix-live-ordinary", 12);
      expect(record.live?.status).toBe("requested");
      expect(await publicGroups("b")).toEqual([]);
      // It reserved nothing: the director's own feed can take the same group.
      const own = await uploadLive("directorB", "b", "matrix-live-director-b");
      expect(own.live?.status).toBe("active");
      expect((await publicGroups("b")).map((group: { recordId: string }) => group.recordId)).toEqual([own.recordId]);
      // Official standings are unchanged until the director accepts results.
      expect(await reviewState("b")).toEqual(officialBefore);
    });

    it("does not let director A's roster match activate a feed on B's Tournament", async () => {
      const record = await uploadLive("directorA", "b", "matrix-live-a-on-b");
      expect(record.live?.status).toBe("requested");
    });

    const grant = (who: Who, key: keyof typeof tournaments, delegate: keyof typeof ids, minutes?: number) => app.inject({
      method: "POST", url: `/v1/native/tournaments/${tournaments[key]}/live-capture-delegations`, headers: bearer(who),
      payload: { delegateUserAccountId: ids[delegate], reason: "Capture PC at the venue",
        ...(minutes === undefined ? {} : { expiresInMinutes: minutes }) },
    });
    const auditBases = async (recordId: string) => (await rows<{ authorization_basis: string | null }>(
      `SELECT audit.authorization_basis FROM tournament_live_mapping_audit audit
         JOIN tournament_evidence_records evidence
           ON evidence.tournament_evidence_record_id = audit.tournament_evidence_record_id
        WHERE evidence.public_id = ? ORDER BY audit.tournament_live_mapping_audit_id`, [recordId]))
      .map((row) => row.authorization_basis);

    it("lets only the director grant a capture delegation, and only for the director's own Tournament", async () => {
      expect((await grant("ordinary", "a", "delegate")).statusCode).toBe(403);
      expect((await grant("directorB", "a", "delegate")).statusCode).toBe(403);
      expect((await grant("revoked", "r", "delegate")).statusCode).toBe(403);
      expect((await grant("anonymous", "a", "delegate")).statusCode).toBe(403);
      const web = await app.inject({
        method: "POST", url: `/v1/administrator/tournaments/${tournaments.a}/live-capture-delegations`,
        headers: bearer("directorB"), payload: { delegateUserAccountId: ids.delegate, reason: "not mine" },
      });
      expect(web.statusCode).toBe(403);
      expect(await rows("SELECT 1 FROM tournament_live_capture_delegations")).toEqual([]);
    });

    it("activates a delegated capture operator's feed, records the basis, and takes it down on revocation", async () => {
      const before = await uploadLive("delegate", "a", "matrix-live-delegate-before");
      expect(before.live?.status).toBe("requested");

      const granted = await grant("directorA", "a", "delegate");
      expect(granted.statusCode, granted.body).toBe(200);
      const delegation = granted.json().delegation as { delegationId: string; status: string; expiresAtMs: number };
      expect(delegation.status).toBe("active");
      expect(delegation.expiresAtMs).toBe(NOW + 720 * 60_000);
      // The Director's web list serves exactly the documented keys, with a name to recognize the delegate by.
      const webList = await app.inject({
        method: "GET", url: `/v1/administrator/tournaments/${tournaments.a}/live-capture-delegations`,
        headers: bearer("directorA"),
      });
      expect(webList.statusCode, webList.body).toBe(200);
      const [listedDelegation] = webList.json().delegations as Record<string, unknown>[];
      expect(Object.keys(listedDelegation ?? {}).sort()).toEqual([
        "delegateDisplayName", "delegateUserAccountId", "delegationId", "expiresAtMs", "grantedAtMs",
        "grantedByUserAccountId", "reason", "revokeReason", "revokedAtMs", "revokedByUserAccountId", "status", "tournamentId",
      ]);
      expect(listedDelegation).toMatchObject({
        delegationId: delegation.delegationId, delegateUserAccountId: ids.delegate, status: "active",
        delegateDisplayName: expect.any(String), revokedAtMs: null,
      });
      expect((await app.inject({
        method: "GET", url: `/v1/administrator/tournaments/${tournaments.a}/live-capture-delegations`,
        headers: bearer("directorB"),
      })).statusCode).toBe(403);

      // The delegation is for Tournament A only.
      expect((await uploadLive("delegate", "b", "matrix-live-delegate-on-b")).live?.status).toBe("requested");

      const delegated = await uploadLive("delegate", "a", "matrix-live-delegate");
      expect(delegated.live?.status).toBe("active");
      expect((await publicGroups("a")).map((group: { recordId: string }) => group.recordId)).toEqual([delegated.recordId]);
      expect(await auditBases(delegated.recordId)).toEqual(["capture_delegation"]);

      const revoked = await app.inject({
        method: "POST",
        url: `/v1/administrator/tournaments/${tournaments.a}/live-capture-delegations/${delegation.delegationId}/actions/revoke`,
        headers: { ...bearer("directorA"), ...csrf("directorA") }, payload: { reason: "capture PC replaced" },
      });
      expect(revoked.statusCode, revoked.body).toBe(200);
      expect(revoked.json().delegation).toMatchObject({ status: "revoked", revokedByUserAccountId: ids.directorA });
      expect(await publicGroups("a")).toEqual([]);
      expect(await auditBases(delegated.recordId)).toEqual(["capture_delegation", "delegation_revoked"]);

      // A replay of the same run cannot reopen it on its roster match.
      const replay = await uploadLive("delegate", "a", "matrix-live-delegate", 2);
      expect(replay.live?.status).toBe("requested");
      expect(await publicGroups("a")).toEqual([]);
      // The evidence itself is kept for the director.
      const listed = await app.inject({
        method: "GET", url: `/v1/native/tournaments/${tournaments.a}/evidence-records`, headers: bearer("directorA"),
      });
      expect(listed.json().records.map((record: { recordId: string }) => record.recordId)).toContain(delegated.recordId);
      // Revoking twice is a conflict, not a second event.
      const again = await app.inject({
        method: "POST",
        url: `/v1/native/tournaments/${tournaments.a}/live-capture-delegations/${delegation.delegationId}/actions/revoke`,
        headers: bearer("directorA"), payload: { reason: "again" },
      });
      expect(again.statusCode).toBe(409);
    });

    it("refuses an expired delegation", async () => {
      await pool.execute(
        `INSERT INTO tournament_live_capture_delegations (
           public_id, tournament_id, delegate_user_account_id, delegation_status,
           granted_by_user_account_id, grant_reason, granted_at_ms, expires_at_ms, updated_at_ms
         ) SELECT 'live_capture_delegation.synthetic_expired', t.tournament_id, delegate.user_account_id, 'active',
                  t.director_user_account_id, 'expired synthetic', ?, ?, ?
             FROM tournaments t JOIN user_accounts delegate ON delegate.public_id = ?
            WHERE t.public_id = ?`,
        [NOW - 7_200_000, NOW - 1, NOW - 7_200_000, ids.ordinary, tournaments.r]);
      expect((await uploadLive("ordinary", "r", "matrix-live-expired")).live?.status).toBe("requested");
    });

    it("lets the director withdraw a public feed and confirm it again explicitly", async () => {
      const [feed] = await publicGroups("b");
      expect(feed).toBeDefined();
      const listed = (await app.inject({
        method: "GET", url: `/v1/administrator/tournaments/${tournaments.b}/evidence-records`, headers: bearer("directorB"),
      })).json().records as { recordId: string; revision: number }[];
      const record = listed.find((item) => item.recordId === feed.recordId)!;
      expect((await app.inject({
        method: "POST", url: `/v1/administrator/tournaments/${tournaments.b}/evidence-records/${record.recordId}/actions/withdraw-live`,
        headers: { ...bearer("directorA"), ...csrf("directorA") }, payload: { expectedRevision: record.revision },
      })).statusCode).toBe(403);
      const withdrawn = await app.inject({
        method: "POST", url: `/v1/administrator/tournaments/${tournaments.b}/evidence-records/${record.recordId}/actions/withdraw-live`,
        headers: { ...bearer("directorB"), ...csrf("directorB") },
        payload: { expectedRevision: record.revision, reason: "wrong card" },
      });
      expect(withdrawn.statusCode, withdrawn.body).toBe(200);
      expect(withdrawn.json().record.live.status).toBe("requested");
      expect(await publicGroups("b")).toEqual([]);
      const confirmed = await app.inject({
        method: "POST", url: `/v1/native/tournaments/${tournaments.b}/evidence-records/${record.recordId}/actions/approve-live`,
        headers: bearer("directorB"),
        payload: {
          expectedRevision: withdrawn.json().record.revision,
          mappings: [{ observedGroupLabel: "Card 1", groupId: groups.b, phase: "qualifier" }],
          reason: "card checked",
        },
      });
      expect(confirmed.statusCode, confirmed.body).toBe(200);
      expect((await publicGroups("b")).map((group: { recordId: string }) => group.recordId)).toEqual([record.recordId]);
      expect(await auditBases(record.recordId)).toEqual(["director", "director", "director"]);
    });
  });

  describe("F04: evidence storage limits", () => {
    let limited: FastifyInstance;
    const limits = {
      maxOpenRecordsPerAccount: 3,
      maxNewRecordsPerAccountPerDay: 5,
      maxOpenBytesPerAccount: 40_000,
      accountUploadsPerWindow: 1_000,
      installationUploadsPerWindow: 10_000,
    };
    beforeAll(async () => { limited = (await makeApp({ evidenceLimits: limits })).app; });

    const upload = (target: FastifyInstance, who: Who, clientRecordId: string, raceCount = 1) => target.inject({
      method: "POST", url: "/v1/tournament-evidence-records", headers: bearer(who),
      payload: {
        clientRecordId, complete: true, startedAtMs: NOW - 60_000,
        entries: Array.from({ length: raceCount }, (_, index) => ({
          entryKey: `feed:${index + 1}`, observedGroupLabel: "Groep 1",
          result: race("a", index + 1, "producer_local_player"),
        })),
      },
    });
    const stored = async (who: keyof typeof ids) => Number((await rows<{ total: number }>(
      `SELECT COUNT(*) AS total FROM tournament_evidence_records evidence
         JOIN user_accounts uploader ON uploader.user_account_id = evidence.uploaded_by_user_account_id
        WHERE uploader.public_id = ?`, [ids[who]]))[0]?.total ?? 0);

    it("refuses the record past the open-record quota and keeps idempotent retries working", async () => {
      for (const n of [1, 2, 3]) expect((await upload(limited, "quotaA", `quota-a-${n}`)).statusCode).toBe(200);
      const over = await upload(limited, "quotaA", "quota-a-4");
      expect(over.statusCode).toBe(409);
      expect(over.json().code).toBe("tournament_evidence_quota_exceeded");
      expect(await stored("quotaA")).toBe(3);
      // A retry of a stored record is not new storage.
      expect((await upload(limited, "quotaA", "quota-a-2")).statusCode).toBe(200);
      // Another account has its own quota.
      expect((await upload(limited, "quotaB", "quota-b-1")).statusCode).toBe(200);
      expect(await stored("quotaA")).toBe(3);
    });

    it("refuses growth past the byte quota without changing the stored record", async () => {
      const [before] = await rows<{ revision: number; entries_byte_length: number }>(
        `SELECT revision, entries_byte_length FROM tournament_evidence_records WHERE client_record_id = 'quota-b-1'`);
      const grown = await upload(limited, "quotaB", "quota-b-1", 60);
      expect(grown.statusCode).toBe(409);
      const [after] = await rows<{ revision: number; entries_byte_length: number }>(
        `SELECT revision, entries_byte_length FROM tournament_evidence_records WHERE client_record_id = 'quota-b-1'`);
      expect(after).toEqual(before);
      expect(Number(before?.entries_byte_length)).toBeGreaterThan(0);
    });

    it("holds the quota under concurrent new records", async () => {
      const responses = await Promise.all(Array.from({ length: 6 }, (_, n) => upload(limited, "quotaC", `quota-c-${n}`)));
      expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(3);
      expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(3);
      expect(await stored("quotaC")).toBe(3);
    });

    it("shares one durable rate budget across two API processes and answers 429 with Retry-After", async () => {
      const otherPool = mysql.createPool(poolOptions);
      pools.push(otherPool);
      const rateLimits = { ...limits, maxOpenRecordsPerAccount: 100, maxNewRecordsPerAccountPerDay: 100, accountUploadsPerWindow: 4 };
      const first = (await makeApp({ evidenceLimits: rateLimits })).app;
      const second = (await makeApp({ pool: otherPool, evidenceLimits: rateLimits })).app;
      const statuses = [];
      for (const n of [1, 2, 3, 4, 5]) statuses.push((await upload(n % 2 === 0 ? second : first, "rate", `rate-${n}`)).statusCode);
      expect(statuses).toEqual([200, 200, 200, 200, 429]);
      const refused = await upload(second, "rate", "rate-6");
      expect(refused.statusCode).toBe(429);
      expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
      expect(await stored("rate")).toBe(4);
    });

    it("pages an account's own records", async () => {
      const firstPage = await limited.inject({
        method: "GET", url: "/v1/tournament-evidence-records/own?limit=2", headers: bearer("quotaA"),
      });
      expect(firstPage.statusCode).toBe(200);
      const body = firstPage.json() as { records: { recordId: string }[]; nextCursor: string | null };
      expect(body.records).toHaveLength(2);
      expect(body.nextCursor).not.toBeNull();
      const secondPage = (await limited.inject({
        method: "GET", url: `/v1/tournament-evidence-records/own?limit=2&before=${encodeURIComponent(body.nextCursor!)}`,
        headers: bearer("quotaA"),
      })).json() as { records: { recordId: string }[]; nextCursor: string | null };
      expect(secondPage.records).toHaveLength(1);
      expect(secondPage.nextCursor).toBeNull();
      expect(new Set([...body.records, ...secondPage.records].map((record) => record.recordId)).size).toBe(3);
      expect((await limited.inject({
        method: "GET", url: "/v1/tournament-evidence-records/own?limit=999", headers: bearer("quotaA"),
      })).statusCode).toBe(400);
    });

    it("removes only stale evidence nobody can still need", async () => {
      const day = 86_400_000;
      const old = NOW - 91 * day;
      // quota-a-1: stale, never linked, no suggestion -> deleted.
      // quota-a-3: stale but suggested for running Tournament A -> kept.
      // quota-b-1: recent -> kept. matrix-live-delegate: audited, but for running Tournament A -> kept.
      // matrix-live-expired: audited? no; suggested for running R -> kept.
      await pool.execute("UPDATE tournament_evidence_records SET updated_at_ms = ? WHERE client_record_id IN ('quota-a-1', 'quota-a-3', 'quota-c-0', 'quota-c-1', 'quota-c-2', 'quota-c-3', 'quota-c-4', 'quota-c-5')", [old]);
      await pool.execute(
        `UPDATE tournament_evidence_records SET suggested_tournament_id =
           (SELECT tournament_id FROM tournaments WHERE public_id = ?) WHERE client_record_id = 'quota-a-3'`, [tournaments.a]);
      const before = await rows<{ client_record_id: string }>(
        "SELECT client_record_id FROM tournament_evidence_records ORDER BY client_record_id");
      const { service } = await makeApp({ evidenceLimits: limits });
      const outcome = await service.applyEvidenceRetention(100);
      const after = (await rows<{ client_record_id: string }>(
        "SELECT client_record_id FROM tournament_evidence_records ORDER BY client_record_id")).map((row) => row.client_record_id);
      const removed = before.map((row) => row.client_record_id).filter((id) => !after.includes(id));
      expect(removed.sort()).toEqual(["quota-a-1", "quota-c-0", "quota-c-1", "quota-c-2", "quota-c-3", "quota-c-4", "quota-c-5"]
        .filter((id) => before.some((row) => row.client_record_id === id)).sort());
      expect(outcome.deleted).toBe(removed.length);
      expect(after).toContain("quota-a-3");
      expect(after).toContain("quota-b-1");
      expect(after).toContain("matrix-live-delegate");
      // A freed slot is usable again.
      expect((await upload(limited, "quotaA", "quota-a-5")).statusCode).toBe(200);
      // A second pass has nothing left to do.
      expect(await service.applyEvidenceRetention(100)).toEqual({ deleted: 0, purged: 0 });
    });

    it("purges a stale audited record of a finished night but keeps its row and audit", async () => {
      const day = 86_400_000;
      await pool.execute("UPDATE tournaments SET stage = 'finalized', finalized_at_ms = ? WHERE public_id = ?", [NOW, tournaments.r]);
      await pool.execute(
        `INSERT INTO tournament_live_mapping_audit (
           tournament_evidence_record_id, tournament_id, changed_by_user_account_id,
           previous_mappings_json, next_mappings_json, reason, changed_at_ms
         ) SELECT evidence.tournament_evidence_record_id, evidence.suggested_tournament_id,
                  evidence.uploaded_by_user_account_id, JSON_ARRAY(), JSON_ARRAY(), 'synthetic', ?
             FROM tournament_evidence_records evidence WHERE client_record_id = 'matrix-live-expired'`, [NOW]);
      await pool.execute("UPDATE tournament_evidence_records SET updated_at_ms = ? WHERE client_record_id = 'matrix-live-expired'",
        [NOW - 91 * day]);
      const { service } = await makeApp({ evidenceLimits: limits });
      expect(await service.applyEvidenceRetention(100)).toEqual({ deleted: 0, purged: 1 });
      const [row] = await rows<{ record_status: string; live_status: string; entries_byte_length: number; purged: number | null; audits: number }>(
        `SELECT record_status, live_status, entries_byte_length, payload_purged_at_ms AS purged,
                (SELECT COUNT(*) FROM tournament_live_mapping_audit audit
                  WHERE audit.tournament_evidence_record_id = evidence.tournament_evidence_record_id) AS audits
           FROM tournament_evidence_records evidence WHERE client_record_id = 'matrix-live-expired'`);
      expect(row).toMatchObject({ record_status: "blocked", live_status: "invalidated", entries_byte_length: 0 });
      expect(Number(row?.purged)).toBe(NOW);
      expect(Number(row?.audits)).toBe(1);
    });
  });
});

function passthroughProtector() {
  return {
    async protectParticipantReference() { return { protectedReference: "unused", lookupHash: "unused" }; },
    async protectContextReference() { return { protectedReference: "unused", lookupHash: "unused" }; },
    async protectEvidenceReference() { return "unused"; },
    async protectVerificationIssueMessage() { return "unused"; },
  } as never;
}
