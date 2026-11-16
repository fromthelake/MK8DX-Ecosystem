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
import {
  OFFLINE_INVITATION_LIFETIME_MS,
  OfflineInvitationTicketService,
} from "../src/authentication/offline-invitation-ticket.js";
import {
  NATIVE_INVITATION_PREVIEW_PATH,
  NATIVE_INVITATION_REDEEM_PATH,
  registerNativeInvitationRoutes,
  type NativeInvitationAuthApi,
} from "../src/authentication/native-invitation-routes.js";
import { PreAuthBudget } from "../src/security/pre-auth-budget.js";
import { MysqlOfflineHostAccounts } from "../src/administration/offline-host-accounts.js";

const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" &&
  /^[a-z][a-z0-9_]*(?:_test|_contract)$/.test(database) ? describe : describe.skip;
const origin = "https://192.168.50.4";
const device = "d".repeat(43);
const native = { "content-type": "application/json", "x-mk8dx-account-device": device };

integration("native sign-in card redemption (ADR-0224 amendment 2026-11-16)", () => {
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
  let clockMs = Date.now();
  const issuer = () => ({ role: "administrator" as const, userAccountId: issuerId });

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
    await pool.execute("DELETE FROM api_mutation_rate_limits");
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
      new MysqlOfflineInvitationTicketRepository(pool), Buffer.alloc(32, 45), () => clockMs,
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
    await registerNativeInvitationRoutes(app, {
      api: auth.api as unknown as NativeInvitationAuthApi,
      origin,
      preAuthBudget: new PreAuthBudget(new MysqlMutationRateLimiter(pool), Buffer.alloc(32, 49)),
    });
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

  const redeem = (token: string, cardOrigin = origin) => app.inject({ method: "POST",
    url: NATIVE_INVITATION_REDEEM_PATH, headers: native, payload: { token, origin: cardOrigin } });

  it("gives the app a bearer session for exactly the card's account, once", async () => {
    const ticket = await tickets.issue(issuer(), accountKey, "account");
    const preview = await app.inject({ method: "POST", url: NATIVE_INVITATION_PREVIEW_PATH,
      headers: native, payload: { token: ticket.token, origin } });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toEqual({ schemaVersion: "mk8dx.native-invitation-preview.v1",
      displayLabel: "Synthetic offline target" });
    const redeemed = await redeem(ticket.token);
    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.headers["set-cookie"]).toBeUndefined();
    const body = redeemed.json() as { schemaVersion: string; token: string; expiresIn: number };
    expect(body.schemaVersion).toBe("mk8dx.native-invitation-session.v1");
    expect(body.expiresIn).toBeGreaterThan(6 * 86_400);
    // The same Better Auth session a device approval gives: the bearer token works on its own.
    const session = await app.inject({ method: "GET", url: "/api/auth/get-session",
      headers: { authorization: `Bearer ${body.token}` } });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({ user: { email: authEmail, emailVerified: true } });
    const [authRows] = await pool.execute<(RowDataPacket & { id: string })[]>(
      "SELECT id FROM mk8dx_auth_user WHERE email=?", [authEmail]);
    const subject = protector.protectVerifiedSubjectCandidates(MK8DX_PASSWORDLESS_ISSUER, authRows[0]!.id)[0]!;
    const bound = await new MysqlAuthenticationBindingRepository(pool, { nowMs: Date.now })
      .resolveActiveAccount(subject);
    expect(bound?.userAccountId).toBe(targetId);
    // Used up: the browser route and the app route both refuse it now.
    expect((await redeem(ticket.token)).statusCode).toBe(401);
    const browser = await app.inject({ method: "POST", url: "/api/auth/offline-invitation/redeem",
      headers: { origin, "content-type": "application/json" }, payload: { token: ticket.token } });
    expect(browser.statusCode).toBe(401);
    // Neither the token nor its digest-free form is kept by the limiters.
    const [limits] = await pool.execute<RowDataPacket[]>("SELECT * FROM api_mutation_rate_limits");
    expect(JSON.stringify(limits)).not.toContain(ticket.token);
  });

  it("shows a card the app redeemed as used in MK8DX beheer's Add a device wizard", async () => {
    const adminKey = `offline_account.${randomUUID()}`;
    await pool.execute(
      `INSERT INTO offline_auth_accounts
         (account_key, auth_email, display_label, account_role, active,
          user_account_id, created_at_ms, updated_at_ms)
       SELECT ?, ?, 'Synthetic administrator', 'administrator', TRUE, user_account_id, ?, ?
       FROM user_accounts WHERE public_id=?`,
      [adminKey, `${randomUUID()}@accounts.mk8dx.invalid`, clockMs, clockMs, issuerId]);
    try {
      const hostAccounts = new MysqlOfflineHostAccounts(pool, () => clockMs);
      const card = await tickets.issue(issuer(), accountKey, "account");
      expect(await hostAccounts.invitationState(issuerId, card.invitationId)).toBe("open");
      expect((await redeem(card.token)).statusCode).toBe(200);
      expect(await hostAccounts.invitationState(issuerId, card.invitationId)).toBe("used");
    } finally {
      await pool.execute("DELETE FROM offline_auth_accounts WHERE account_key=?", [adminKey]);
    }
  });

  it("lets exactly one of two simultaneous redemptions of the same card through", async () => {
    const card = await tickets.issue(issuer(), accountKey, "account");
    const [first, second] = await Promise.all([redeem(card.token), redeem(card.token)]);
    const statuses = [first.statusCode, second.statusCode].sort();
    expect(statuses).toEqual([200, 401]);
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) used FROM offline_invitation_tickets WHERE invitation_id=? AND consumed_at_ms IS NOT NULL",
      [card.invitationId]);
    expect(Number(rows[0]!["used"])).toBe(1);
  });

  it("a flood of made-up tokens does not block a real card", async () => {
    for (let attempt = 0; attempt < 130; attempt += 1) {
      const fake = randomBytes(32).toString("base64url");
      const response = attempt % 2 === 0 ? await redeem(fake) : await app.inject({ method: "POST",
        url: NATIVE_INVITATION_PREVIEW_PATH, headers: native, payload: { token: fake, origin } });
      expect([401, 429]).toContain(response.statusCode);
      if (response.statusCode === 429) { break; } // the per-address budget of this one test client
    }
    await pool.execute("DELETE FROM api_mutation_rate_limits WHERE scope_key LIKE 'native-invitation-preauth|%'");
    const card = await tickets.issue(issuer(), accountKey, "account");
    expect((await redeem(card.token)).statusCode).toBe(200);
  });

  it("refuses an expired card and a card of another installation (which stays usable)", async () => {
    const expired = await tickets.issue(issuer(), accountKey, "account");
    clockMs += OFFLINE_INVITATION_LIFETIME_MS;
    const late = await redeem(expired.token);
    expect(late.statusCode).toBe(401);
    expect(late.json()).toMatchObject({ code: "native_invitation_unavailable" });
    const card = await tickets.issue(issuer(), accountKey, "account");
    const foreign = await redeem(card.token, "https://192.168.50.5");
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json()).toMatchObject({ code: "native_invitation_origin_invalid" });
    const browserOrigin = await app.inject({ method: "POST", url: NATIVE_INVITATION_REDEEM_PATH,
      headers: { ...native, origin }, payload: { token: card.token, origin } });
    expect(browserOrigin.statusCode).toBe(403);
    expect((await redeem(card.token)).statusCode).toBe(200);
  });

  it("stops guessing at the card's own limit, shared with the browser page", async () => {
    const card = await tickets.issue(issuer(), accountKey, "account");
    const statuses: number[] = [];
    // Five attempts per card per 15 minutes, previews and the browser route included.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push((await app.inject({ method: "POST", url: NATIVE_INVITATION_PREVIEW_PATH,
        headers: native, payload: { token: card.token, origin } })).statusCode);
    }
    statuses.push((await app.inject({ method: "POST", url: "/api/auth/offline-invitation/preview",
      headers: { origin, "content-type": "application/json" }, payload: { token: card.token } })).statusCode);
    const limited = await redeem(card.token);
    statuses.push(limited.statusCode);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect(limited.json()).toMatchObject({ code: "native_invitation_rate_limited" });
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
  });
});
