// Fresh e-mail confirmation (step-up) before dangerous actions, against the real hosted runtime: real
// Better Auth sessions (browser cookie and native bearer), the real routes and guard, the real SMTP-shaped
// delivery port captured in memory, and a disposable MySQL schema of its own (MK8DX_MYSQL_TEST_DATABASE
// ending in _test). Synthetic accounts and keys only.
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdministratorGrantService } from "../src/administration/administrator-grant-service.js";
import { MysqlAdministratorGrantWriteRepository } from
  "../src/administration/mysql-administrator-grant-repository.js";
import {
  MK8DX_TOURNAMENT_DESKTOP_CLIENT_ID,
  type PasswordlessMagicLink,
} from "../src/authentication/embedded-passwordless-auth.js";
import {
  createPasswordlessHostedRuntime,
  type PasswordlessHostedRuntime,
} from "../src/composition/hosted-runtime.js";
import type { StepUpEmail } from "../src/security/step-up-service.js";
import { STEP_UP_ROUTES } from "../src/security/step-up-policy.js";
import { issueOperatorStepUpLink, OperatorStepUpError } from "../src/security/step-up-operator-main.js";

const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" ? describe : describe.skip;
const baseUrl = "http://127.0.0.1:47811";
const json = { "content-type": "application/json" };

type Session = Readonly<{ cookie?: string; bearer?: string; accountId: string; csrf?: string }>;

integration("step-up before dangerous actions (real HTTP routes, real sessions, real MySQL)", () => {
  let pool: Pool;
  let hosted: PasswordlessHostedRuntime;
  const magicLinks: PasswordlessMagicLink[] = [];
  const stepUpMails: StepUpEmail[] = [];
  const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
  const mysqlOptions = {
    host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
    port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
    user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
    password: process.env["MK8DX_MYSQL_TEST_PASSWORD"] ?? "",
    database,
  };
  let admin: Session;
  let adminSecondBrowser: Session;
  let adminPhone: Session;
  let ordinary: Session;
  let other: Session;

  const headers = (who: Session, extra: Record<string, string> = {}) => ({
    ...(who.cookie === undefined ? {} : { cookie: who.cookie, origin: baseUrl }),
    ...(who.bearer === undefined ? {} : { authorization: `Bearer ${who.bearer}` }),
    ...(who.csrf === undefined ? {} : { "x-mk8dx-csrf": who.csrf }),
    ...extra,
  });

  async function signIn(email: string): Promise<Session> {
    const requested = await hosted.app.inject({
      method: "POST", url: "/api/auth/sign-in/magic-link",
      headers: { ...json, origin: baseUrl }, payload: { email, callbackURL: "/" },
    });
    expect(requested.statusCode).toBe(200);
    const magic = new URL(magicLinks.at(-1)?.url ?? "");
    const redeemed = await hosted.app.inject({ method: "GET", url: `${magic.pathname}${magic.search}` });
    const setCookie = redeemed.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";", 1)[0] ?? "";
    expect(cookie).not.toBe("");
    const csrf = await hosted.app.inject({ method: "GET", url: "/v1/session/csrf", headers: { cookie } });
    expect(csrf.statusCode).toBe(200);
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT public_id AS id FROM user_accounts ORDER BY user_account_id DESC LIMIT 1");
    return { cookie, accountId: String(rows[0]?.["id"]), csrf: csrf.json<{ value: string }>().value };
  }

  async function nativeSession(browser: Session): Promise<Session> {
    const device = await hosted.app.inject({
      method: "POST", url: "/api/auth/device/code", headers: json,
      payload: { client_id: MK8DX_TOURNAMENT_DESKTOP_CLIENT_ID },
    });
    const codes = device.json<{ device_code: string; user_code: string }>();
    await hosted.app.inject({
      method: "GET", url: `/api/auth/device?user_code=${codes.user_code}`, headers: { cookie: browser.cookie! },
    });
    const approved = await hosted.app.inject({
      method: "POST", url: "/api/auth/device/approve",
      headers: { ...json, origin: baseUrl, cookie: browser.cookie! }, payload: { userCode: codes.user_code },
    });
    expect(approved.statusCode).toBe(200);
    const token = await hosted.app.inject({
      method: "POST", url: "/api/auth/device/token", headers: json,
      payload: {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: codes.device_code, client_id: MK8DX_TOURNAMENT_DESKTOP_CLIENT_ID,
      },
    });
    expect(token.statusCode).toBe(200);
    return { bearer: token.json<{ access_token: string }>().access_token, accountId: browser.accountId };
  }

  const linkToken = (mail: StepUpEmail | undefined): string =>
    new URL(mail?.url ?? "http://invalid/").searchParams.get("step-up") ?? "";

  async function requestStepUp(who: Session) {
    return hosted.app.inject({ method: "POST", url: "/v1/session/step-up", headers: headers(who, json), payload: {} });
  }

  async function confirm(token: string) {
    return hosted.app.inject({
      method: "POST", url: "/v1/session/step-up/link", headers: json, payload: { token },
    });
  }

  async function stepUp(who: Session): Promise<void> {
    const before = stepUpMails.length;
    expect((await requestStepUp(who)).statusCode).toBe(202);
    expect(stepUpMails.length).toBe(before + 1);
    expect((await confirm(linkToken(stepUpMails.at(-1)))).statusCode).toBe(200);
  }

  async function status(who: Session) {
    const answer = await hosted.app.inject({ method: "GET", url: "/v1/session/step-up", headers: headers(who) });
    expect(answer.statusCode).toBe(200);
    return answer.json<{ active: boolean; pending: boolean; expiresAtMs: number | null; windowSeconds: number }>();
  }

  async function grantAdministrator(who: Session, target: string) {
    return hosted.app.inject({
      method: "POST", url: "/v1/administrator-grants", headers: headers(who, json),
      payload: { userAccountId: target, reasonCode: "step_up_integration" },
    });
  }

  async function activeAdministrators(): Promise<string[]> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT account.public_id AS id FROM administrator_grants AS grant_record
         JOIN user_accounts AS account ON account.user_account_id = grant_record.user_account_id
        WHERE grant_record.grant_status = 'active' ORDER BY id`);
    return rows.map((row) => String(row["id"]));
  }

  async function auditKinds(): Promise<string[]> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT event_kind AS kind FROM api_step_up_audit_events ORDER BY step_up_audit_event_id");
    return rows.map((row) => String(row["kind"]));
  }

  beforeAll(async () => {
    if (!/^[a-z][a-z0-9_]*(?:_test|_contract)$/.test(database)) {
      throw new Error("integration database must be an explicit _test/_contract schema");
    }
    pool = mysql.createPool({ ...mysqlOptions, timezone: "Z", connectionLimit: 4 });
    hosted = await createPasswordlessHostedRuntime({
      core: {
        mysql: { ...mysqlOptions, connectionLimit: 6 },
        schema9CatalogPath: new URL("../../../packages/assets/schema9-asset-catalog-v1.json", import.meta.url).pathname
          .replace(/^\/([A-Za-z]:)/, "$1"),
        authenticationKeys: { lookupHmacKey: Buffer.alloc(32, 41), lookupKeyVersion: "h3-auth-v1" },
        timeTrialKeys: {
          encryptionKey: Buffer.alloc(32, 42), encryptionKeyVersion: "h3-tt-enc-v1",
          lookupHmacKey: Buffer.alloc(32, 43), lookupKeyVersion: "h3-tt-lookup-v1",
        },
        timeTrialDecryptionKeys: { "h3-tt-enc-v1": Buffer.alloc(32, 42) },
        tournamentKeys: {
          encryptionKey: Buffer.alloc(32, 44), encryptionKeyVersion: "h3-tournament-enc-v1",
          lookupHmacKey: Buffer.alloc(32, 45), lookupKeyVersion: "h3-tournament-lookup-v1",
        },
        tournamentDecryptionKeys: { "h3-tournament-enc-v1": Buffer.alloc(32, 44) },
      },
      authentication: {
        baseUrl,
        production: false,
        trustedOrigins: [baseUrl],
        secrets: [{ version: 1, value: "n1DLRIGl7jpbMj99RFVrBcMeOrBAvccvREek3FWYjzk=" }],
        nativeClientIds: [MK8DX_TOURNAMENT_DESKTOP_CLIENT_ID],
        clientIpHeaders: ["x-real-ip"],
        trustedProxyAddresses: [],
      },
      smtp: {
        host: "smtp.example.test", port: 465, secure: true, username: "synthetic-user",
        password: "synthetic-password", fromAddress: "auth@example.test", allowedLinkOrigin: baseUrl,
      },
      webManual: {
        producerVersion: "h3-step-up-integration",
        csrfKeys: { activeKeyVersion: "h3-csrf-v1", keys: { "h3-csrf-v1": Buffer.alloc(32, 46) } },
      },
    }, () => ({
      async verify() {},
      async sendMagicLink(message) { magicLinks.push(message); },
      async sendStepUp(message) { stepUpMails.push(message); },
      close() {},
    }));
    admin = await signIn("h3-admin@example.test");
    await new AdministratorGrantService(
      new MysqlAdministratorGrantWriteRepository(pool),
      { newAdministratorGrantId: () => "administrator_grant.synthetic_h3_first" },
      { nowMs: () => Date.now() },
    ).bootstrapFirstAdministrator(admin.accountId);
    ordinary = await signIn("h3-ordinary@example.test");
    other = await signIn("h3-other@example.test");
    adminSecondBrowser = await signIn("h3-admin@example.test");
    expect(adminSecondBrowser.cookie).not.toBe(admin.cookie);
    adminPhone = await nativeSession(admin);
  }, 60_000);

  afterAll(async () => {
    await hosted?.close();
    await pool?.end();
  });

  it("refuses a dangerous action without a fresh confirmation and changes nothing", async () => {
    const refused = await grantAdministrator(admin, ordinary.accountId);
    expect(refused.statusCode).toBe(403);
    expect(refused.headers["x-mk8dx-step-up"]).toBe("required");
    expect(refused.json()).toMatchObject({ code: "step_up_required", stepUp: { request: "/v1/session/step-up", windowSeconds: 600 } });
    expect(await activeAdministrators()).toEqual([admin.accountId]);
    expect(await auditKinds()).toContain("step_up_action_refused");
    // The list of every account with its e-mail address is a read that needs the confirmation too,
    // also through HEAD; nothing of it is sent.
    for (const method of ["GET", "HEAD"] as const) {
      const list = await hosted.app.inject({ method, url: "/v1/administrator/identity-links", headers: headers(admin) });
      expect(list.statusCode).toBe(403);
      expect(list.headers["x-mk8dx-step-up"]).toBe("required");
      expect(list.body).not.toContain("@example.test");
    }
    // Someone who is not an administrator meets the route's own refusal, not a confirmation request.
    const notAdministrator = await hosted.app.inject({ method: "GET", url: "/v1/administrator/identity-links",
      headers: headers(ordinary) });
    expect(notAdministrator.statusCode).toBe(403);
    expect(notAdministrator.headers["x-mk8dx-step-up"]).toBeUndefined();
    expect(notAdministrator.body).not.toContain("@example.test");
  });

  it("leaves ordinary users and routine administrator work as they were", async () => {
    // An ordinary account meets the route's own refusal, not a confirmation request.
    const notAdministrator = await grantAdministrator(ordinary, other.accountId);
    expect(notAdministrator.statusCode).toBe(403);
    expect(notAdministrator.headers["x-mk8dx-step-up"]).toBeUndefined();
    expect(notAdministrator.json<{ code: string }>().code).not.toBe("step_up_required");
    // Routine administrator reads need no confirmation, in the browser or in the app.
    expect((await hosted.app.inject({ method: "GET", url: "/v1/administrator/overview", headers: headers(admin) }))
      .statusCode).toBe(200);
    expect((await hosted.app.inject({ method: "GET", url: "/v1/native/administrator/overview", headers: headers(adminPhone) }))
      .statusCode).toBe(200);
    // Signed out: the route's own refusal, unchanged.
    const signedOut = await hosted.app.inject({ method: "POST", url: "/v1/administrator-grants", headers: json,
      payload: { userAccountId: other.accountId, reasonCode: "x" } });
    expect(signedOut.statusCode).toBe(403);
    expect(signedOut.headers["x-mk8dx-step-up"]).toBeUndefined();
    expect(await activeAdministrators()).toEqual([admin.accountId]);
  });

  it("sends the link only on request from this installation's page, and opening it confirms nothing", async () => {
    const crossSite = await hosted.app.inject({
      method: "POST", url: "/v1/session/step-up",
      headers: { ...json, cookie: admin.cookie!, origin: "https://elsewhere.example" }, payload: {},
    });
    expect(crossSite.statusCode).toBe(403);
    expect((await hosted.app.inject({ method: "POST", url: "/v1/session/step-up", headers: json, payload: {} }))
      .statusCode).toBe(401);
    const before = stepUpMails.length;
    // Hook order (app.ts): actor lookup, step-up guard, then the H1 mutation backstop. Sending a link
    // spends the backstop (and its own budget); a dangerous action refused for want of a confirmation
    // spends nothing.
    const spent = async (): Promise<number> => {
      const [counted] = await pool.execute<RowDataPacket[]>(
        `SELECT COALESCE(SUM(event_count), 0) AS total FROM api_mutation_rate_limits
          WHERE scope_key LIKE 'api-mutations.installation%'`);
      return Number(counted[0]?.["total"] ?? 0);
    };
    const spentBeforeSend = await spent();
    const sent = await requestStepUp(admin);
    expect(sent.statusCode).toBe(202);
    expect(await spent()).toBe(spentBeforeSend + 1);
    expect(stepUpMails.length).toBe(before + 1);
    expect(stepUpMails.at(-1)).toMatchObject({ email: "h3-admin@example.test", clientKind: "web", expiresInMinutes: 10 });
    const token = linkToken(stepUpMails.at(-1));
    const view = await hosted.app.inject({ method: "GET", url: `/v1/session/step-up/link?token=${token}` });
    expect(view.statusCode).toBe(200);
    expect(view.json()).toMatchObject({ clientKind: "web" });
    expect(await status(admin)).toMatchObject({ active: false, pending: true });
    const spentBeforeRefusal = await spent();
    expect((await grantAdministrator(admin, ordinary.accountId)).statusCode).toBe(403);
    expect(await spent()).toBe(spentBeforeRefusal);
    // No token is stored, only its digest.
    const [rows] = await pool.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM api_step_up_challenges WHERE link_digest = ?",
      [Buffer.from(token)]);
    expect(Number(rows[0]?.["n"])).toBe(0);
  });

  it("allows the action after confirmation, once per link, for that session only", async () => {
    const token = linkToken(stepUpMails.at(-1));
    const [first, second] = await Promise.all([confirm(token), confirm(token)]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 404]);
    expect((await confirm(token)).statusCode).toBe(404);
    expect(await status(admin)).toMatchObject({ active: true, pending: false });
    // Another session of the same account, and the same account's phone, are not confirmed by it.
    expect(await status(adminSecondBrowser)).toMatchObject({ active: false });
    expect((await grantAdministrator(adminSecondBrowser, ordinary.accountId)).statusCode).toBe(403);
    expect((await hosted.app.inject({ method: "POST", url: "/v1/native/administrator/identity-links/actions/unlink",
      headers: headers(adminPhone, json), payload: { userAccountId: other.accountId } })).json<{ code: string }>().code)
      .toBe("step_up_required");
    // Nor any other account.
    expect(await status(ordinary)).toMatchObject({ active: false });

    // The confirmed browser may now list the accounts; the unconfirmed second browser may not.
    const list = await hosted.app.inject({ method: "GET", url: "/v1/administrator/identity-links", headers: headers(admin) });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ accounts: Array<{ email: string | null }> }>().accounts.map((row) => row.email))
      .toContain("h3-ordinary@example.test");
    const secondList = await hosted.app.inject({ method: "GET", url: "/v1/administrator/identity-links",
      headers: headers(adminSecondBrowser) });
    expect(secondList.statusCode).toBe(403);
    expect(secondList.json<{ code: string }>().code).toBe("step_up_required");

    const granted = await grantAdministrator(admin, ordinary.accountId);
    expect(granted.statusCode).toBe(201);
    expect(await activeAdministrators()).toEqual([admin.accountId, ordinary.accountId].sort());
    expect(await auditKinds()).toEqual(expect.arrayContaining(["step_up_requested", "step_up_confirmed",
      "step_up_link_refused", "step_up_action_allowed"]));
  });

  it("works the same for a native app session with a bearer", async () => {
    const unlink = () => hosted.app.inject({ method: "POST", url: "/v1/native/administrator/identity-links/actions/unlink",
      headers: headers(adminPhone, json), payload: { userAccountId: other.accountId } });
    // Routine reads need no confirmation; the account list with addresses does.
    expect((await hosted.app.inject({ method: "GET", url: "/v1/native/administrator/overview",
      headers: headers(adminPhone) })).statusCode).toBe(200);
    const listing = () => hosted.app.inject({ method: "GET", url: "/v1/native/administrator/identity-links",
      headers: headers(adminPhone) });
    const hidden = await listing();
    expect(hidden.statusCode).toBe(403);
    expect(hidden.json<{ code: string }>().code).toBe("step_up_required");
    expect(hidden.body).not.toContain("@example.test");
    const refused = await unlink();
    expect(refused.statusCode).toBe(403);
    expect(refused.json<{ code: string }>().code).toBe("step_up_required");
    const before = stepUpMails.length;
    expect((await requestStepUp(adminPhone)).statusCode).toBe(202);
    expect(stepUpMails.at(-1)).toMatchObject({ clientKind: "native" });
    expect(stepUpMails.length).toBe(before + 1);
    expect((await confirm(linkToken(stepUpMails.at(-1)))).statusCode).toBe(200);
    const list = await listing();
    expect(list.statusCode).toBe(200);
    expect(list.json<{ accounts: unknown[] }>().accounts.length).toBeGreaterThanOrEqual(3);
    // Past the confirmation, the route's own answer: this account has no Player to unlink.
    const allowed = await unlink();
    expect(allowed.headers["x-mk8dx-step-up"]).toBeUndefined();
    expect(allowed.json<{ code?: string }>().code).not.toBe("step_up_required");
  });

  it("refuses an expired link, a superseded link and an expired window", async () => {
    // Superseded: only the newest link of a session works.
    await requestStepUp(other);
    const older = linkToken(stepUpMails.at(-1));
    await requestStepUp(other);
    const newer = linkToken(stepUpMails.at(-1));
    expect((await confirm(older)).statusCode).toBe(404);
    // Expired: the link's lifetime is over (moved into the past in the database).
    await pool.execute("UPDATE api_step_up_challenges SET link_expires_at_ms = ? WHERE confirmed_at_ms IS NULL",
      [Date.now() - 1_000]);
    expect((await confirm(newer)).statusCode).toBe(404);
    expect(await status(other)).toMatchObject({ active: false, pending: false });
    // Expired window: the confirmed web session of the first browser needs a new confirmation.
    await pool.execute(`UPDATE api_step_up_challenges SET confirmed_at_ms = ?, grant_expires_at_ms = ?
      WHERE grant_expires_at_ms IS NOT NULL`, [Date.now() - 2_000, Date.now() - 1_000]);
    const again = await hosted.app.inject({ method: "POST", url: "/v1/administrator-grants/" +
      `${encodeURIComponent(ordinary.accountId)}/actions/revoke`, headers: headers(admin, json),
      payload: { reasonCode: "step_up_integration" } });
    expect(again.statusCode).toBe(403);
    expect(again.json<{ code: string }>().code).toBe("step_up_required");
    expect(await activeAdministrators()).toEqual([admin.accountId, ordinary.accountId].sort());
    // A malformed token is refused without touching anything.
    expect((await confirm("not-a-token")).statusCode).toBe(404);
  });

  it("does not let a confirmed session of an ordinary account do anything it could not do before", async () => {
    await stepUp(other);
    expect(await status(other)).toMatchObject({ active: true });
    const refused = await grantAdministrator(other, other.accountId);
    expect(refused.statusCode).toBe(403);
    expect(refused.json<{ code: string }>().code).not.toBe("step_up_required");
    expect(await activeAdministrators()).toEqual([admin.accountId, ordinary.accountId].sort());
  });

  it("lets a host operator hand out the link of a pending request when e-mail fails", async () => {
    // The person presses Send the link; the e-mail never arrives. The operator issues a new link on the host.
    expect((await requestStepUp(ordinary)).statusCode).toBe(202);
    const mailed = linkToken(stepUpMails.at(-1));
    const issued = await issueOperatorStepUpLink(pool, { email: "h3-ordinary@example.test", linkOrigin: baseUrl,
      nowMs: Date.now() });
    expect(issued.clientKind).toBe("web");
    const operatorToken = new URL(issued.stepUpLink).searchParams.get("step-up") ?? "";
    expect(new URL(issued.stepUpLink).origin).toBe(baseUrl);
    // Issuing confirms nothing; the mailed link stops working; the new link confirms that one session.
    expect(await status(ordinary)).toMatchObject({ active: false, pending: true });
    expect((await confirm(mailed)).statusCode).toBe(404);
    expect((await confirm(operatorToken)).statusCode).toBe(200);
    expect(await status(ordinary)).toMatchObject({ active: true });
    expect(await auditKinds()).toContain("step_up_operator_link");
    // Nothing is pending any more, so a second run is refused.
    await expect(issueOperatorStepUpLink(pool, { email: "h3-ordinary@example.test", linkOrigin: baseUrl,
      nowMs: Date.now() })).rejects.toMatchObject({ reason: "no_pending_request" });
    // Two sessions waiting: the operator could not tell which is the person's own, so it is refused.
    const [users] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM mk8dx_auth_user WHERE email = 'h3-ordinary@example.test'");
    const authUserId = String(users[0]?.["id"]);
    for (const byte of [1, 2]) {
      await pool.execute(`INSERT INTO api_step_up_challenges
        (session_digest, auth_user_id, link_digest, client_kind, requested_at_ms, link_expires_at_ms)
        VALUES (?, ?, ?, 'web', ?, ?)`,
      [Buffer.alloc(32, byte), authUserId, Buffer.alloc(32, 200 + byte), Date.now(), Date.now() + 300_000]);
    }
    const ambiguous = await issueOperatorStepUpLink(pool, { email: "h3-ordinary@example.test", linkOrigin: baseUrl,
      nowMs: Date.now() }).catch((error: unknown) => error);
    expect(ambiguous).toBeInstanceOf(OperatorStepUpError);
    expect((ambiguous as OperatorStepUpError).reason).toBe("several_sessions_pending");
    await pool.execute("DELETE FROM api_step_up_challenges WHERE auth_user_id = ? AND confirmed_at_ms IS NULL", [authUserId]);
  });

  it("limits how many confirmation emails one account can ask for", async () => {
    const fresh = await signIn("h3-rate@example.test");
    const answers: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      answers.push((await requestStepUp(fresh)).statusCode);
    }
    expect(answers).toEqual([202, 202, 202, 429]);
    const limited = await requestStepUp(fresh);
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(await auditKinds()).toContain("step_up_rate_limited");
  });

  it("names only routes the real composition registers", async () => {
    const registered = new Set<string>();
    for (const policy of STEP_UP_ROUTES) {
      if (hosted.app.hasRoute({ method: policy.method, url: policy.url })) { registered.add(`${policy.method} ${policy.url}`); }
    }
    expect([...registered].sort()).toEqual(STEP_UP_ROUTES.map((policy) => `${policy.method} ${policy.url}`).sort());
  });

  it("asks a Director for a fresh confirmation before deleting a Tournament, and a sign-out ends the window", async () => {
    const created = await hosted.app.inject({
      method: "POST", url: "/v1/tournaments", headers: headers(admin, json),
      payload: {
        name: "H3 step-up night", eventDate: "2026-11-20", startAtMs: Date.parse("2026-11-20T19:00:00Z"),
        timezone: "Europe/Amsterdam", placementStrategy: "balanced", qualifierRounds: true,
      },
    });
    expect(created.statusCode).toBeLessThan(300);
    const body = created.json<{ tournamentId?: string; revision?: number; summary?: { tournamentId: string; revision: number } }>();
    const tournamentId = body.tournamentId ?? body.summary?.tournamentId ?? "";
    const revision = body.revision ?? body.summary?.revision ?? 1;
    const remove = () => hosted.app.inject({
      method: "POST", url: `/v1/tournaments/${encodeURIComponent(tournamentId)}/actions/delete`,
      headers: headers(admin, json), payload: { expectedRevision: revision },
    });
    // The administrator's window was ended above: deleting needs a new confirmation.
    const refused = await remove();
    expect(refused.statusCode).toBe(403);
    expect(refused.json<{ code: string }>().code).toBe("step_up_required");
    const [still] = await pool.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM tournaments WHERE public_id = ?", [tournamentId]);
    expect(Number(still[0]?.["n"])).toBe(1);
    await stepUp(admin);
    expect((await remove()).statusCode).toBe(200);
    // A signed-out session's window is worth nothing: the request is simply signed out.
    const signedOut = await hosted.app.inject({ method: "POST", url: "/api/auth/sign-out",
      headers: { ...json, cookie: admin.cookie!, origin: baseUrl }, payload: {} });
    expect(signedOut.statusCode).toBe(200);
    const afterSignOut = await grantAdministrator(admin, other.accountId);
    expect(afterSignOut.statusCode).toBe(403);
    expect(afterSignOut.headers["x-mk8dx-step-up"]).toBeUndefined();
  });
});
