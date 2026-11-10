import { randomBytes, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  MK8DX_PASSWORDLESS_ISSUER,
  createEmbeddedPasswordlessAuth,
  registerEmbeddedAuthRoutes,
} from "../src/authentication/embedded-passwordless-auth.js";
import { AuthenticationSubjectHmacKeyringProtector } from
  "../src/authentication/authentication-subject-hmac-protector.js";
import { AuthenticationProvisioningService } from
  "../src/authentication/authentication-provisioning-service.js";
import { MysqlAuthenticationProvisioningRepository } from
  "../src/authentication/mysql-authentication-provisioning-repository.js";
import { MysqlAuthenticationBindingRepository } from
  "../src/authentication/mysql-authentication-binding-repository.js";
import { MysqlOfflineInvitationTicketRepository } from
  "../src/authentication/mysql-offline-invitation-tickets.js";
import { MysqlMutationRateLimiter } from "../src/security/mysql-mutation-rate-limiter.js";
import { OfflineInvitationTicketService } from
  "../src/authentication/offline-invitation-ticket.js";

const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" &&
  /^[a-z][a-z0-9_]*(?:_test|_contract)$/.test(database) ? describe : describe.skip;
const origin = "https://192.168.50.4";

integration("offline invitation Better Auth session", () => {
  const suffix = randomUUID();
  const issuerId = `user_account.offline_issuer_${suffix}`;
  const targetId = `user_account.offline_target_${suffix}`;
  const accountKey = `offline_account.${suffix}`;
  const grantId = `administrator_grant.offline_${suffix}`;
  const authEmail = `${suffix}@accounts.mk8dx.invalid`;
  let pool: Pool;
  let app: FastifyInstance;
  let tickets: OfflineInvitationTicketService;
  let protector: AuthenticationSubjectHmacKeyringProtector;

  beforeAll(async () => {
    pool = mysql.createPool({
      host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
      port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
      user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
      password: process.env["MK8DX_MYSQL_TEST_PASSWORD"] ?? "",
      database,
      connectionLimit: 3,
    });
    await pool.execute("DELETE FROM mk8dx_auth_rate_limit");
    const now = Date.now();
    await pool.execute(
      `INSERT INTO user_accounts
         (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
       VALUES (?, 1, 'private', 'active', ?, ?), (?, 1, 'private', 'active', ?, ?)`,
      [issuerId, now, now, targetId, now, now],
    );
    await pool.execute(
      `INSERT INTO administrator_grants
         (public_id, revision, user_account_id, grant_status, grant_origin,
          granted_at_ms, revoked_at_ms, updated_at_ms)
       SELECT ?, 1, user_account_id, 'active', 'administrator', ?, NULL, ?
       FROM user_accounts WHERE public_id=?`,
      [grantId, now, now, issuerId],
    );
    await pool.execute(
      `INSERT INTO offline_auth_accounts
         (account_key, auth_email, display_label, account_role, active,
          user_account_id, created_at_ms, updated_at_ms)
       SELECT ?, ?, 'Synthetic offline target', 'account', TRUE,
              user_account_id, ?, ? FROM user_accounts WHERE public_id=?`,
      [accountKey, authEmail, now, now, targetId],
    );
    protector = new AuthenticationSubjectHmacKeyringProtector({
      active: { lookupHmacKey: Buffer.alloc(32, 39), lookupKeyVersion: "offline_test_v1" },
      retained: [],
    });
    tickets = new OfflineInvitationTicketService(
      new MysqlOfflineInvitationTicketRepository(pool), Buffer.alloc(32, 45),
    );
    const auth = createEmbeddedPasswordlessAuth(
      pool,
      {
        baseUrl: origin,
        production: true,
        trustedOrigins: [origin],
        secrets: [{ version: 1, value: randomBytes(32).toString("base64") }],
        nativeClientIds: ["mk8dx.timetrials.android.v1"],
        clientIpHeaders: ["x-real-ip"],
        trustedProxyAddresses: ["127.0.0.1"],
      },
      { async sendMagicLink() { throw new Error("offline mail forbidden"); } },
      { async record() {} },
      undefined,
      {
        origin,
        tickets,
        attempts: { limiter: new MysqlMutationRateLimiter(pool), tokenKey: Buffer.alloc(32, 47) },
        async bindAccount(authUserId, target) {
          const subject = protector.protectVerifiedSubjectCandidates(
            MK8DX_PASSWORDLESS_ISSUER, authUserId,
          )[0]!;
          await new AuthenticationProvisioningService(
            new MysqlAuthenticationProvisioningRepository(pool),
            { async decide() { return { action: "link_account" as const,
              userAccountId: target.userAccountId }; } },
            {
              newUserAccountId: () => `user_account.${randomUUID()}`,
              newAuthenticationBindingId: () => `restricted_auth_binding.${randomUUID()}`,
            },
            { nowMs: Date.now },
            "authentication_provisioner.offline_test",
          ).provision(subject);
        },
      },
    );
    app = Fastify({ logger: false });
    await registerEmbeddedAuthRoutes(app, auth, origin, true);
    await app.ready();
  });

  afterAll(async () => {
    if (app !== undefined) { await app.close(); }
    if (pool === undefined) { return; }
    await pool.execute("DELETE FROM mk8dx_auth_session");
    await pool.execute("DELETE FROM mk8dx_auth_account");
    await pool.execute("DELETE FROM mk8dx_auth_user WHERE email=?", [authEmail]);
    await pool.execute("DELETE FROM offline_invitation_tickets WHERE account_key=?", [accountKey]);
    await pool.execute("DELETE FROM offline_auth_accounts WHERE account_key=?", [accountKey]);
    await pool.execute(
      `DELETE log FROM restricted_identity_access_log log
       INNER JOIN restricted_authentication_bindings binding
         ON binding.authentication_binding_id=log.authentication_binding_id
       INNER JOIN user_accounts user ON user.user_account_id=binding.user_account_id
       WHERE user.public_id=?`, [targetId],
    );
    await pool.execute(
      `DELETE FROM restricted_authentication_binding_lifecycle
       WHERE authentication_binding_id IN (
         SELECT binding.authentication_binding_id
         FROM restricted_authentication_bindings binding
         INNER JOIN user_accounts user ON user.user_account_id=binding.user_account_id
         WHERE user.public_id=?)`, [targetId],
    );
    await pool.execute("DELETE FROM restricted_authentication_bindings WHERE user_account_id=(SELECT user_account_id FROM user_accounts WHERE public_id=?)", [targetId]);
    await pool.execute("DELETE FROM administrator_grants WHERE public_id=?", [grantId]);
    await pool.execute("DELETE FROM user_accounts WHERE public_id IN (?,?)", [issuerId, targetId]);
    await pool.end();
  });

  it("rejects foreign origin and unavailable public mail sign-in", async () => {
    const mail = await app.inject({ method: "POST", url: "/api/auth/sign-in/magic-link",
      headers: { origin, "content-type": "application/json" },
      payload: { email: authEmail } });
    expect(mail.statusCode).toBe(404);
    const ticket = await tickets.issue({ role: "administrator", userAccountId: issuerId },
      accountKey, "account");
    const foreign = await app.inject({ method: "POST", url: "/api/auth/offline-invitation/redeem",
      headers: { origin: "https://192.168.50.5", "content-type": "application/json" },
      payload: { token: ticket.token } });
    expect(foreign.statusCode).toBe(403);
    const redeemed = await app.inject({ method: "POST", url: "/api/auth/offline-invitation/redeem",
      headers: { origin, "content-type": "application/json" }, payload: { token: ticket.token } });
    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.json()).toEqual({ ok: true });
    const setCookie = redeemed.headers["set-cookie"];
    const cookieLine = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (typeof cookieLine !== "string") { throw new Error("offline cookie missing"); }
    const cookie = cookieLine.split(";", 1)[0]!;
    expect(cookieLine).toContain("Secure");
    const session = await app.inject({ method: "GET", url: "/api/auth/get-session",
      headers: { cookie, origin } });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({ user: { email: authEmail, emailVerified: true } });
    const [authRows] = await pool.execute<(RowDataPacket & { id: string })[]>(
      "SELECT id FROM mk8dx_auth_user WHERE email=?", [authEmail],
    );
    const subject = protector.protectVerifiedSubjectCandidates(
      MK8DX_PASSWORDLESS_ISSUER, authRows[0]!.id,
    )[0]!;
    const bound = await new MysqlAuthenticationBindingRepository(pool, { nowMs: Date.now })
      .resolveActiveAccount(subject);
    expect(bound?.userAccountId).toBe(targetId);
    const replay = await app.inject({ method: "POST", url: "/api/auth/offline-invitation/redeem",
      headers: { origin, "content-type": "application/json" }, payload: { token: ticket.token } });
    expect(replay.statusCode).toBe(401);
  });
});
