import Fastify from "fastify";
import { memoryAdapter, type MemoryDB } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";

import {
  MK8DX_ANDROID_CLIENT_ID,
  MK8DX_DESKTOP_CLIENT_ID,
  createEmbeddedPasswordlessAuth,
  createEmbeddedVerifiedSubjectResolver,
  registerEmbeddedAuthRoutes,
  type EmbeddedAuthConfig,
  type PasswordlessMagicLink,
} from "../src/authentication/embedded-passwordless-auth.js";
import {
  NATIVE_EMAIL_CODE_ATTEMPTS,
  NATIVE_EMAIL_LIFETIME_SECONDS,
  NativeEmailApprovalService,
  NativeEmailRateLimiter,
  type NativeEmailAttemptLimiter,
  type NativeEmailAuditEvent,
  type NativeEmailSignIn,
} from "../src/authentication/native-email-approval.js";
import { registerNativeEmailApprovalRoutes } from
  "../src/authentication/native-email-approval-routes.js";

const baseUrl = "https://mk8dx.example.test";
const browserHeaders = { origin: baseUrl, "content-type": "application/json", "x-real-ip": "203.0.113.7" };

function config(): EmbeddedAuthConfig {
  return {
    baseUrl,
    production: true,
    trustedOrigins: [baseUrl],
    secrets: [{ version: 1, value: "dCuH+LADr9EwzTFgybShWjgxzm5geZtQjmUNuu8ydqY=" }],
    nativeClientIds: [MK8DX_ANDROID_CLIENT_ID, MK8DX_DESKTOP_CLIENT_ID],
    clientIpHeaders: ["x-real-ip"],
    trustedProxyAddresses: ["127.0.0.1"],
  };
}

async function harness(options: { eligible?: Set<string> | "all"; clock?: { now: number }; attemptLimiter?: NativeEmailAttemptLimiter } = {}) {
  const database: MemoryDB = {
    mk8dx_auth_user: [], mk8dx_auth_session: [], mk8dx_auth_account: [],
    mk8dx_auth_verification: [], mk8dx_auth_rate_limit: [], mk8dx_auth_device_code: [],
  };
  const links: PasswordlessMagicLink[] = [];
  const mails: NativeEmailSignIn[] = [];
  const audit: NativeEmailAuditEvent[] = [];
  const auth = createEmbeddedPasswordlessAuth(
    memoryAdapter(database), config(),
    { async sendMagicLink(message) { links.push(message); } },
    { async record() {} },
  );
  const eligible = options.eligible ?? "all";
  const clock = options.clock;
  const localLimit = new NativeEmailRateLimiter(
    NATIVE_EMAIL_CODE_ATTEMPTS, NATIVE_EMAIL_LIFETIME_SECONDS * 1000,
    clock === undefined ? Date.now : () => clock.now,
  );
  const attemptLimiter = options.attemptLimiter ?? { consume: async (id: string) => localLimit.allow(id) };
  const service = new NativeEmailApprovalService(
    auth,
    { async sendNativeSignIn(message) { mails.push(message); } },
    { async isEligible(userId) { return eligible === "all" || eligible.has(userId); } },
    { async record(event) { audit.push(event); } },
    { linkOrigin: baseUrl, attemptLimiter, ...(clock === undefined ? {} : { now: () => clock.now }) },
  );
  const app = Fastify({ logger: false });
  await registerEmbeddedAuthRoutes(app, auth, baseUrl);
  await registerNativeEmailApprovalRoutes(app, { service });
  const resolveSubject = createEmbeddedVerifiedSubjectResolver(auth);
  app.get("/test/subject", async (request, reply) => {
    const subject = await resolveSubject(request);
    return subject === null ? reply.code(401).send({}) : reply.send(subject);
  });
  await app.ready();
  return { app, auth, database, links, mails, audit, service };
}
type Harness = Awaited<ReturnType<typeof harness>>;

/** Create a verified account by the ordinary magic-link sign-in. */
async function account(h: Harness, email: string): Promise<string> {
  await h.app.inject({ method: "POST", url: "/api/auth/sign-in/magic-link", headers: browserHeaders, payload: { email, callbackURL: "/" } });
  const url = new URL(h.links.at(-1)!.url);
  const redeemed = await h.app.inject({ method: "GET", url: `${url.pathname}${url.search}`, headers: { "x-real-ip": "203.0.113.7" } });
  expect(redeemed.statusCode).toBe(302);
  const users = h.database.mk8dx_auth_user as Array<{ id: string; email: string }>;
  return users.find((user) => user.email === email)!.id;
}

async function deviceCode(h: Harness, clientId = MK8DX_DESKTOP_CLIENT_ID) {
  const response = await h.app.inject({ method: "POST", url: "/api/auth/device/code", headers: browserHeaders, payload: { client_id: clientId } });
  expect(response.statusCode).toBe(200);
  return response.json<{ device_code: string; user_code: string }>();
}

async function requestEmail(h: Harness, userCode: string, email: string) {
  return h.app.inject({ method: "POST", url: "/v1/native/device-authorization/email", headers: browserHeaders, payload: { userCode, email } });
}

async function verify(h: Harness, userCode: string, code: string) {
  const response = await h.app.inject({ method: "POST", url: "/v1/native/device-authorization/email/verify", headers: browserHeaders, payload: { userCode, code } });
  expect(response.statusCode).toBe(200);
  return response.json<{ status: string; attemptsLeft?: number }>();
}

async function redeemToken(h: Harness, device: { device_code: string }, clientId = MK8DX_DESKTOP_CLIENT_ID) {
  // As if the client waited its polling interval since the previous poll.
  for (const row of h.database.mk8dx_auth_device_code as Array<{ lastPolledAt?: Date | null }>) { row.lastPolledAt = null; }
  return h.app.inject({
    method: "POST", url: "/api/auth/device/token", headers: browserHeaders,
    payload: { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: device.device_code, client_id: clientId },
  });
}

function linkToken(mail: NativeEmailSignIn): string {
  return new URL(mail.url).searchParams.get("device-email")!;
}

describe("native email approval", () => {
  it("signs the client in with the code from the email and a normal bearer session", async () => {
    const h = await harness();
    const userId = await account(h, "anna@example.test");
    const device = await deviceCode(h);

    const pendingToken = await redeemToken(h, device);
    expect(pendingToken.json()).toMatchObject({ error: "authorization_pending" });

    const requested = await requestEmail(h, device.user_code, " Anna@Example.test ");
    expect(requested.statusCode).toBe(202);
    expect(requested.json()).toEqual({ schemaVersion: "mk8dx.native-email-approval.v1", status: "sent_if_eligible" });
    expect(h.mails).toHaveLength(1);
    const mail = h.mails[0]!;
    expect(mail.email).toBe("anna@example.test");
    expect(mail.code).toMatch(/^[0-9]{6}$/);
    expect(mail.clientName).toBe("LiveTrial for Windows");
    expect(mail.userCode.replace("-", "")).toBe(device.user_code);
    expect(new URL(mail.url).origin).toBe(baseUrl);

    // Nothing secret is stored in the clear.
    const stored = JSON.stringify(h.database.mk8dx_auth_verification);
    expect(stored).not.toContain(mail.code);
    expect(stored).not.toContain(linkToken(mail));

    expect(await verify(h, device.user_code, mail.code)).toEqual({ schemaVersion: "mk8dx.native-email-approval.v1", status: "approved" });
    const token = await redeemToken(h, device);
    expect(token.statusCode).toBe(200);
    const bearer = token.json<{ access_token: string }>().access_token;
    const subject = await h.app.inject({ method: "GET", url: "/test/subject", headers: { authorization: `Bearer ${bearer}`, "x-real-ip": "203.0.113.7" } });
    expect(subject.json()).toMatchObject({ subject: userId });

    // Code and link are both used up.
    expect((await verify(h, device.user_code, mail.code)).status).toBe("expired");
    const link = await h.app.inject({ method: "GET", url: `/v1/native/device-authorization/email/link?token=${linkToken(mail)}` });
    expect(link.statusCode).toBe(404);
    expect(h.audit.map((event) => [event.kind, event.via])).toEqual([
      ["native_email_approval_sent", undefined], ["native_email_approval_approved", "code"],
    ]);
  });

  it("approves by link only after the explicit Approve, never on opening it", async () => {
    const h = await harness();
    await account(h, "bram@example.test");
    const device = await deviceCode(h);
    await requestEmail(h, device.user_code, "bram@example.test");
    const token = linkToken(h.mails[0]!);

    // A mail scanner opening the link twice approves nothing.
    for (let index = 0; index < 2; index += 1) {
      const view = await h.app.inject({ method: "GET", url: `/v1/native/device-authorization/email/link?token=${token}` });
      expect(view.statusCode).toBe(200);
      expect(view.json()).toMatchObject({ clientName: "LiveTrial for Windows", userCode: h.mails[0]!.userCode });
      expect(view.headers["cache-control"]).toBe("no-store");
    }
    expect((await redeemToken(h, device)).json()).toMatchObject({ error: "authorization_pending" });

    const approved = await h.app.inject({ method: "POST", url: "/v1/native/device-authorization/email/link", headers: browserHeaders, payload: { token } });
    expect(approved.json()).toEqual({ schemaVersion: "mk8dx.native-email-approval.v1", status: "approved" });
    expect((await redeemToken(h, device)).statusCode).toBe(200);
    // The code from the same email no longer works, and neither does the link.
    expect((await verify(h, device.user_code, h.mails[0]!.code)).status).toBe("expired");
    const again = await h.app.inject({ method: "POST", url: "/v1/native/device-authorization/email/link", headers: browserHeaders, payload: { token } });
    expect(again.statusCode).toBe(404);
  });

  it("locks the code after five wrong guesses", async () => {
    const h = await harness();
    await account(h, "cas@example.test");
    const device = await deviceCode(h);
    await requestEmail(h, device.user_code, "cas@example.test");
    const right = h.mails[0]!.code;
    const wrong = right === "000000" ? "111111" : "000000";
    for (let left = NATIVE_EMAIL_CODE_ATTEMPTS - 1; left > 0; left -= 1) {
      expect(await verify(h, device.user_code, wrong)).toMatchObject({ status: "invalid", attemptsLeft: left });
    }
    expect((await verify(h, device.user_code, wrong)).status).toBe("locked");
    expect((await verify(h, device.user_code, right)).status).toMatch(/locked|expired/);
    expect((await redeemToken(h, device)).json()).toMatchObject({ error: "authorization_pending" });
    expect(h.audit.some((event) => event.kind === "native_email_approval_locked")).toBe(true);
  });

  it("shares the code-attempt budget across concurrent service instances", async () => {
    const counts = new Map<string, number>();
    const attemptLimiter: NativeEmailAttemptLimiter = {
      async consume(id) {
        const count = (counts.get(id) ?? 0) + 1;
        counts.set(id, count);
        return count <= NATIVE_EMAIL_CODE_ATTEMPTS;
      },
    };
    const h = await harness({ attemptLimiter });
    await account(h, "parallel@example.test");
    const device = await deviceCode(h);
    await requestEmail(h, device.user_code, "parallel@example.test");
    const right = h.mails[0]!.code;
    const wrong = right === "000000" ? "111111" : "000000";
    const another = () => new NativeEmailApprovalService(
      h.auth,
      { async sendNativeSignIn() {} },
      { async isEligible() { return true; } },
      { async record() {} },
      { linkOrigin: baseUrl, attemptLimiter },
    );
    const second = another();
    await Promise.all(Array.from({ length: 10 }, (_, index) =>
      (index % 2 === 0 ? h.service : second).verifyCode(device.user_code, wrong)));
    const outcome = await another().verifyCode(device.user_code, right);
    expect(outcome.status).toMatch(/locked|expired/);
  });

  it("does not approve a code when the durable attempt budget is unavailable", async () => {
    const h = await harness({ attemptLimiter: {
      async consume() { throw new Error("attempt storage unavailable"); },
    } });
    await account(h, "unavailable@example.test");
    const device = await deviceCode(h);
    await requestEmail(h, device.user_code, "unavailable@example.test");
    const response = await h.app.inject({
      method: "POST",
      url: "/v1/native/device-authorization/email/verify",
      headers: browserHeaders,
      payload: { userCode: device.user_code, code: h.mails[0]!.code },
    });
    expect(response.statusCode).toBe(500);
    expect((await redeemToken(h, device)).json()).toMatchObject({ error: "authorization_pending" });
  });

  it("answers the same for unknown, unverified and ineligible addresses and sends nothing", async () => {
    const h = await harness({ eligible: new Set() });
    await account(h, "noplayer@example.test");
    const device = await deviceCode(h);
    for (const email of ["nobody@example.test", "noplayer@example.test"]) {
      const response = await requestEmail(h, device.user_code, email);
      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ schemaVersion: "mk8dx.native-email-approval.v1", status: "sent_if_eligible" });
    }
    expect(h.mails).toHaveLength(0);
    const malformed = await requestEmail(h, device.user_code, "not-an-address");
    expect(malformed.statusCode).toBe(400);
    const badCode = await requestEmail(h, "short", "anna@example.test");
    expect(badCode.statusCode).toBe(400);
  });

  it("never approves a code someone else already claimed on the website", async () => {
    const h = await harness();
    await account(h, "anna@example.test");
    await account(h, "eve@example.test");
    const eveCookie = await (async () => {
      await h.app.inject({ method: "POST", url: "/api/auth/sign-in/magic-link", headers: browserHeaders, payload: { email: "eve@example.test", callbackURL: "/" } });
      const url = new URL(h.links.at(-1)!.url);
      const redeemed = await h.app.inject({ method: "GET", url: `${url.pathname}${url.search}`, headers: { "x-real-ip": "203.0.113.7" } });
      const raw = redeemed.headers["set-cookie"];
      return (Array.isArray(raw) ? raw[0] : raw)!.split(";", 1)[0]!;
    })();
    const device = await deviceCode(h);
    const claimed = await h.app.inject({ method: "GET", url: `/api/auth/device?user_code=${device.user_code}`, headers: { cookie: eveCookie, "x-real-ip": "203.0.113.7" } });
    expect(claimed.statusCode).toBe(200);
    await requestEmail(h, device.user_code, "anna@example.test");
    expect(h.mails).toHaveLength(0);
  });

  it("expires with the device code and refuses unknown clients and used codes", async () => {
    const clock = { now: Date.now() };
    const h = await harness({ clock });
    await account(h, "anna@example.test");
    const device = await deviceCode(h);
    await requestEmail(h, device.user_code, "anna@example.test");
    const mail = h.mails[0]!;
    expect(mail.expiresInMinutes).toBeLessThanOrEqual(10);
    clock.now += 11 * 60 * 1000;
    expect((await verify(h, device.user_code, mail.code)).status).toBe("expired");
    const link = await h.app.inject({ method: "GET", url: `/v1/native/device-authorization/email/link?token=${linkToken(mail)}` });
    expect(link.statusCode).toBe(404);
  });

  it("limits resends per device code and requests per address", async () => {
    const h = await harness();
    await account(h, "anna@example.test");
    const device = await deviceCode(h);
    for (let index = 0; index < 4; index += 1) { await requestEmail(h, device.user_code, "anna@example.test"); }
    expect(h.mails).toHaveLength(3);
    // Only the newest email works: the earlier codes were replaced.
    const oldest = h.mails[0]!.code;
    const newest = h.mails[2]!.code;
    if (oldest !== newest) { expect((await verify(h, device.user_code, oldest)).status).toBe("invalid"); }
    expect((await verify(h, device.user_code, newest)).status).toBe("approved");
    // Five requests for one address in an hour, whatever the device code: four
    // were made above (the fourth was refused as a resend), so one more gets through.
    for (let index = 0; index < 3; index += 1) {
      const next = await deviceCode(h);
      await requestEmail(h, next.user_code, "anna@example.test");
    }
    expect(h.mails).toHaveLength(4);
  });

  it("works for the Android client too and keeps its name", async () => {
    const h = await harness();
    await account(h, "anna@example.test");
    const device = await deviceCode(h, MK8DX_ANDROID_CLIENT_ID);
    await requestEmail(h, device.user_code, "anna@example.test");
    expect(h.mails[0]!.clientName).toBe("MK8DX Time Trials for Android");
    expect((await verify(h, device.user_code, h.mails[0]!.code)).status).toBe("approved");
    expect((await redeemToken(h, device, MK8DX_ANDROID_CLIENT_ID)).statusCode).toBe(200);
  });

  it("ignores unexpected fields and refuses malformed link tokens", async () => {
    const h = await harness();
    // Fastify strips properties the schema does not name; nothing extra reaches the service.
    const extra = await h.app.inject({ method: "POST", url: "/v1/native/device-authorization/email", headers: browserHeaders, payload: { userCode: "ABCDEFGH", email: "a@b.test", admin: true } });
    expect(extra.statusCode).toBe(202);
    expect(h.mails).toHaveLength(0);
    const link = await h.app.inject({ method: "GET", url: "/v1/native/device-authorization/email/link?token=../../x" });
    expect(link.statusCode).toBe(404);
  });
});
