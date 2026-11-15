import Fastify, { type FastifyInstance } from "fastify";
import mysql, { type Pool, type PoolOptions, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MysqlNotificationChannelRepository } from
  "../src/notifications/mysql-notification-channel-repository.js";
import { registerNotificationChannelRoutes } from "../src/notifications/notification-channel-routes.js";
import { NotificationChannelService } from "../src/notifications/notification-channel-service.js";
import { MysqlWebPushDeliveryRepository } from "../src/notifications/web-push-delivery.js";
import { MysqlMutationRateLimiter } from "../src/security/mysql-mutation-rate-limiter.js";

// The real routes, service, repositories and durable limiter against a
// disposable schema. Only the signed-in identity is synthetic (a test header),
// because the boundary under test is per account, not authentication.

const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" ? describe : describe.skip;
const prefix = "user_account.s4push_";
const accounts = ["quota", "race", "limit", "other", "delivery", "legacy", "same"] as const;
const accountId = (name: string) => `${prefix}${name}`;
const keys = {
  p256dh: Buffer.alloc(65, 1).toString("base64url"),
  auth: Buffer.alloc(16, 2).toString("base64url"),
};
const fcm = (name: string) => `https://fcm.googleapis.com/fcm/send/s4push-${name}`;

integration("Web Push subscription boundary (MySQL)", () => {
  let pool: Pool;
  let app: FastifyInstance;
  let repository: MysqlNotificationChannelRepository;
  let nowMs = 1_900_200_000_000;

  const post = (account: string, endpoint: string) => app.inject({
    method: "POST", url: "/v1/web-push/subscriptions",
    headers: { "x-test-account": accountId(account) },
    payload: { endpoint, keys },
  });
  const active = async (account: string): Promise<number> => {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM web_push_subscriptions AS s
       INNER JOIN user_accounts AS a ON a.user_account_id = s.user_account_id
       WHERE a.public_id = ? AND s.revoked_at_ms IS NULL`, [accountId(account)]);
    return Number(rows[0]!["n"]);
  };
  const all = async (account: string): Promise<number> => {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM web_push_subscriptions AS s
       INNER JOIN user_accounts AS a ON a.user_account_id = s.user_account_id
       WHERE a.public_id = ?`, [accountId(account)]);
    return Number(rows[0]!["n"]);
  };
  const internalId = async (account: string): Promise<number> => {
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT user_account_id AS id FROM user_accounts WHERE public_id = ?", [accountId(account)]);
    return Number(rows[0]!["id"]);
  };

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
      connectionLimit: 8,
    };
    const password = process.env["MK8DX_MYSQL_TEST_PASSWORD"];
    if (password !== undefined) options.password = password;
    pool = mysql.createPool(options);
    for (const name of accounts) {
      await pool.execute(
        `INSERT INTO user_accounts
           (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
         VALUES (?, 1, 'private', 'active', 1, 1)`,
        [accountId(name)],
      );
    }
    repository = new MysqlNotificationChannelRepository(pool);
    const service = new NotificationChannelService(
      repository,
      { protectSubscription: (document) => ({
        ciphertext: Uint8Array.from(Buffer.from(document, "utf8")), encryptionKeyVersion: "test",
      }) },
      Buffer.alloc(65, 3).toString("base64url"),
      () => { nowMs += 1; return nowMs; },
    );
    app = Fastify();
    await registerNotificationChannelRoutes(app, {
      resolveActor: async (request) => {
        const header = request.headers["x-test-account"];
        return typeof header === "string"
          ? { role: "account", userAccountId: header }
          : { role: "anonymous" };
      },
      service,
      rateLimiter: new MysqlMutationRateLimiter(pool, () => nowMs),
    });
    await app.ready();
  });

  afterAll(async () => {
    if (pool === undefined) return;
    await app?.close();
    const owned = `SELECT user_account_id FROM user_accounts WHERE public_id LIKE 'user\\_account.s4push\\_%'`;
    await pool.execute(`DELETE FROM notification_deliveries WHERE web_push_subscription_id IN
      (SELECT web_push_subscription_id FROM web_push_subscriptions WHERE user_account_id IN (${owned}))`);
    await pool.execute(`DELETE FROM notifications WHERE user_account_id IN (${owned})`);
    await pool.execute(`DELETE FROM web_push_subscriptions WHERE user_account_id IN (${owned})`);
    await pool.execute(`DELETE FROM api_mutation_rate_limits WHERE scope_key LIKE 'web-push-subscriptions-hour|user\\_account.s4push\\_%'`);
    await pool.execute(`DELETE FROM user_accounts WHERE public_id LIKE 'user\\_account.s4push\\_%'`);
    await pool.end();
  });

  it("keeps at most ten active subscriptions per account, retiring the oldest", async () => {
    for (let index = 0; index < 12; index += 1) {
      expect((await post("quota", fcm(`quota-${index}`))).statusCode).toBe(200);
    }
    expect(await active("quota")).toBe(10);
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT s.revoked_at_ms IS NULL AS live FROM web_push_subscriptions AS s
       INNER JOIN user_accounts AS a ON a.user_account_id = s.user_account_id
       WHERE a.public_id = ? ORDER BY s.web_push_subscription_id`, [accountId("quota")]);
    // The two first registrations made room for the two newest.
    expect(rows.map((row) => Number(row["live"]))).toEqual([0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const status = await app.inject({
      method: "GET", url: "/v1/notification-settings", headers: { "x-test-account": accountId("quota") },
    });
    expect(status.json()).toMatchObject({ webPush: { subscriptionCount: 10 } });
    // Another account is not affected by this account's quota.
    expect((await post("other", fcm("other-0"))).statusCode).toBe(200);
    expect(await active("other")).toBe(1);
  });

  it("enforces the quota atomically under concurrent registrations", async () => {
    const replies = await Promise.all(Array.from({ length: 15 }, (_, index) => post("race", fcm(`race-${index}`))));
    expect(replies.filter((reply) => reply.statusCode === 200).length).toBeGreaterThanOrEqual(10);
    expect(replies.every((reply) => reply.statusCode === 200 || reply.statusCode === 503)).toBe(true);
    expect(await active("race")).toBe(10);
  });

  it("refreshes a known browser in place instead of spending quota", async () => {
    for (let index = 0; index < 10; index += 1) await post("same", fcm(`same-${index}`));
    for (let index = 0; index < 3; index += 1) {
      expect((await post("same", fcm("same-0"))).statusCode).toBe(200);
    }
    expect(await active("same")).toBe(10);
    expect(await all("same")).toBe(10);
  });

  it("stores nothing for an endpoint outside the push services", async () => {
    for (const endpoint of ["https://127.0.0.1/push", "https://[::1]/push", "https://10.1.2.3/push",
      "https://[::ffff:127.0.0.1]/push", "https://fcm.googleapis.com:8443/fcm/send/x",
      "https://push.internal.example/push"]) {
      const reply = await post("other", endpoint);
      expect(reply.statusCode, endpoint).toBe(400);
    }
    expect((await post("other", "https://push.internal.example/push")).json())
      .toMatchObject({ code: "web_push_provider_not_allowed" });
    expect(await all("other")).toBe(1);
  });

  it("rate-limits subscription changes per account with Retry-After and no write", async () => {
    for (let index = 0; index < 30; index += 1) {
      const reply = index % 2 === 0
        ? await post("limit", fcm(`limit-${index}`))
        : await app.inject({
          method: "DELETE", url: "/v1/web-push/subscriptions",
          headers: { "x-test-account": accountId("limit") }, payload: { endpoint: fcm(`limit-${index - 1}`) },
        });
      expect(reply.statusCode).toBe(200);
    }
    const before = await all("limit");
    const refused = await post("limit", fcm("limit-over"));
    expect(refused.statusCode).toBe(429);
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
    expect(refused.json()).toMatchObject({ code: "web_push_subscription_rate_limited" });
    expect(await all("limit")).toBe(before);
    // Other accounts keep their own budget.
    expect((await post("other", fcm("other-1"))).statusCode).toBe(200);
    // Anonymous callers are refused before any budget or row is touched.
    const anonymous = await app.inject({ method: "POST", url: "/v1/web-push/subscriptions", payload: { endpoint: fcm("anon"), keys } });
    expect(anonymous.statusCode).toBe(401);
  });

  it("retires a subscription after three dead deliveries without success and releases unsent work", async () => {
    expect((await post("delivery", fcm("delivery-0"))).statusCode).toBe(200);
    const account = await internalId("delivery");
    const later = nowMs + 1_000;
    for (let index = 0; index < 4; index += 1) {
      await pool.execute(
        `INSERT INTO notifications
           (user_account_id, notification_kind, aggregation_key, event_count, first_event_at_ms, last_event_at_ms)
         VALUES (?, 'poke', ?, 1, ?, ?)`,
        [account, `s4push|delivery|${index}`, later, later],
      );
    }
    const deliveries = new MysqlWebPushDeliveryRepository(pool, {
      decryptSubscription: (value) => Buffer.from(value.ciphertext).toString("utf8"),
    });
    await deliveries.materialize(later);
    const claimed = (await deliveries.claim(later, 50)).filter((entry) =>
      entry.subscription.endpoint === fcm("delivery-0"));
    expect(claimed).toHaveLength(4);
    // The fourth is handed back without an attempt counted.
    await deliveries.release([claimed[3]!.deliveryId], later + 60_000);
    const [released] = await pool.execute<RowDataPacket[]>(
      "SELECT delivery_status AS status, attempt_count AS attempts, next_attempt_at_ms AS next FROM notification_deliveries WHERE notification_delivery_id = ?",
      [claimed[3]!.deliveryId]);
    expect(released[0]).toMatchObject({ status: "retry", attempts: 0, next: later + 60_000 });
    for (const [index, entry] of claimed.slice(0, 3).entries()) {
      await deliveries.failed({
        deliveryId: entry.deliveryId, subscriptionId: entry.subscriptionId, nowMs: later + index,
        permanent: true, expiredSubscription: false, errorCode: "destination_refused",
      });
      expect(await active("delivery"), `after ${index + 1} dead deliveries`).toBe(index < 2 ? 1 : 0);
    }
    // The released delivery now belongs to a revoked subscription and is not delivered.
    await deliveries.materialize(later + 120_000);
    expect((await deliveries.claim(later + 120_000, 50)).filter((entry) =>
      entry.subscription.endpoint === fcm("delivery-0"))).toHaveLength(0);
  });

  it("trims legacy accounts over the quota and deletes long-revoked subscriptions", async () => {
    const account = await internalId("legacy");
    for (let index = 0; index < 13; index += 1) {
      await pool.execute(
        `INSERT INTO web_push_subscriptions
           (user_account_id, endpoint_sha256, subscription_ciphertext, encryption_key_version,
            created_at_ms, updated_at_ms, revoked_at_ms)
         VALUES (?, UNHEX(SHA2(?, 256)), ?, 'test', ?, ?, NULL)`,
        [account, `legacy-${index}`, Buffer.from("{}"), 1_000 + index, 1_000 + index],
      );
    }
    const old = { endpoint: "legacy-old", revokedAt: 2_000 };
    await pool.execute(
      `INSERT INTO web_push_subscriptions
         (user_account_id, endpoint_sha256, subscription_ciphertext, encryption_key_version,
          created_at_ms, updated_at_ms, revoked_at_ms)
       VALUES (?, UNHEX(SHA2(?, 256)), ?, 'test', 1500, 1500, ?)`,
      [account, old.endpoint, Buffer.from("{}"), old.revokedAt],
    );
    const purgeAt = 40 * 24 * 60 * 60 * 1_000;
    const result = await repository.purgeStaleSubscriptions({
      nowMs: purgeAt, maximumActive: 10, revokedRetentionMs: 30 * 24 * 60 * 60 * 1_000,
    });
    expect(result.trimmed).toBeGreaterThanOrEqual(3);
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(await active("legacy")).toBe(10);
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM web_push_subscriptions WHERE user_account_id = ? AND endpoint_sha256 = UNHEX(SHA2(?, 256))`,
      [account, old.endpoint]);
    expect(Number(rows[0]!["n"])).toBe(0);
    // The three just retired stay until their own retention has passed.
    expect(await all("legacy")).toBe(13);
  });
});
