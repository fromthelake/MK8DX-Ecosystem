import Fastify from "fastify";
import { memoryAdapter, type MemoryDB } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";

import {
  EmbeddedAuthConfigurationError,
  MK8DX_ANDROID_CLIENT_ID,
  MK8DX_DESKTOP_CLIENT_ID,
  createEmbeddedPasswordlessAuth,
  createEmbeddedVerifiedSubjectResolver,
  registerEmbeddedAuthRoutes,
  type EmbeddedAuthAuditEvent,
  type EmbeddedAuthConfig,
  type PasswordlessMagicLink,
} from "../src/authentication/embedded-passwordless-auth.js";

const baseUrl = "https://mk8dx.example.test";

function config(overrides: Partial<EmbeddedAuthConfig> = {}): EmbeddedAuthConfig {
  return {
    baseUrl,
    production: true,
    trustedOrigins: [baseUrl],
    secrets: [
      { version: 2, value: "n1DLRIGl7jpbMj99RFVrBcMeOrBAvccvREek3FWYjzk=" },
      { version: 1, value: "dCuH+LADr9EwzTFgybShWjgxzm5geZtQjmUNuu8ydqY=" },
    ],
    nativeClientIds: [MK8DX_ANDROID_CLIENT_ID, MK8DX_DESKTOP_CLIENT_ID],
    clientIpHeaders: ["x-real-ip"],
    trustedProxyAddresses: ["127.0.0.1"],
    ...overrides,
  };
}

type Harness = Awaited<ReturnType<typeof harness>>;

async function harness(offlineLan = false) {
  const database: MemoryDB = {
    mk8dx_auth_user: [],
    mk8dx_auth_session: [],
    mk8dx_auth_account: [],
    mk8dx_auth_verification: [],
    mk8dx_auth_rate_limit: [],
    mk8dx_auth_device_code: [],
  };
  const links: PasswordlessMagicLink[] = [];
  const audit: EmbeddedAuthAuditEvent[] = [];
  const auth = createEmbeddedPasswordlessAuth(
    memoryAdapter(database),
    config(),
    { async sendMagicLink(message) { links.push(message); } },
    { async record(event) { audit.push(event); } },
  );
  const app = Fastify({ logger: false });
  await registerEmbeddedAuthRoutes(app, auth, baseUrl, offlineLan);
  const resolveSubject = createEmbeddedVerifiedSubjectResolver(auth);
  app.get("/test/subject", async (request, reply) => {
    const subject = await resolveSubject(request);
    return subject === null
      ? reply.code(401).send({ authenticated: false })
      : reply.send(subject);
  });
  await app.ready();
  return { app, auth, database, links, audit };
}

const browserHeaders = {
  origin: baseUrl,
  "content-type": "application/json",
  "x-real-ip": "203.0.113.7",
};

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers["set-cookie"];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== "string") { throw new Error("session cookie missing"); }
  return first.split(";", 1)[0]!;
}

async function signIn(h: Harness, email = "player@example.test") {
  const response = await h.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/magic-link",
    headers: browserHeaders,
    payload: { email, callbackURL: "/" },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ status: true });
  const link = h.links.at(-1);
  if (link === undefined) { throw new Error("magic link missing"); }
  const parsed = new URL(link.url);
  const token = parsed.searchParams.get("token");
  if (token === null) { throw new Error("magic-link token missing"); }
  return { response, link, parsed, token };
}

async function redeem(h: Harness, parsed: URL) {
  const response = await h.app.inject({
    method: "GET",
    url: `${parsed.pathname}${parsed.search}`,
    headers: { "x-real-ip": "203.0.113.7" },
  });
  expect(response.statusCode).toBe(302);
  return { response, cookie: cookieFrom(response) };
}

describe("embedded passwordless auth", () => {
  it("does not expose e-mail issuance or verification in offline LAN mode", async () => {
    const h = await harness(true);
    try {
      const issued = await h.app.inject({
        method: "POST", url: "/api/auth/sign-in/magic-link",
        headers: browserHeaders, payload: { email: "player@example.test" },
      });
      expect(issued.statusCode).toBe(404);
      expect(h.links).toHaveLength(0);
      const verified = await h.app.inject({
        method: "GET", url: "/api/auth/magic-link/verify?token=synthetic",
      });
      expect(verified.statusCode).toBe(404);
      const encoded = await h.app.inject({
        method: "GET", url: "/api/auth/magic-link%2Fverify?token=synthetic",
      });
      expect(encoded.statusCode).toBe(404);
      expect(h.database.mk8dx_auth_session).toHaveLength(0);
    } finally {
      await h.app.close();
    }
  });
  it("rejects unsafe origin, secret, proxy, and client configuration", () => {
    const database = memoryAdapter({});
    const mail = { async sendMagicLink() {} };
    const audit = { async record() {} };
    for (const unsafe of [
      config({ baseUrl: "http://example.test", trustedOrigins: ["http://example.test"] }),
      config({ trustedOrigins: ["https://other.example.test"] }),
      config({ secrets: [{ version: 1, value: "short" }] }),
      config({ secrets: [{ version: 1, value: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }] }),
      config({ nativeClientIds: ["unknown-client"] }),
      config({ clientIpHeaders: ["X Bad"] }),
      config({ trustedProxyAddresses: [] }),
      config({ trustedProxyAddresses: ["127.0.0.1/99"] }),
      // A native verification origin is opt-in, but it is not a way around
      // HTTPS, and it cannot point somewhere the deployment does not trust.
      config({ nativeVerificationOrigin: "http://native.example.test" }),
      config({ nativeVerificationOrigin: "https://native.example.test" }),
      config({ nativeVerificationOrigin: "https://example.test/device" }),
    ]) {
      expect(() => createEmbeddedPasswordlessAuth(
        database,
        unsafe,
        mail,
        audit,
      )).toThrow(EmbeddedAuthConfigurationError);
    }
  });

  it("keeps the device verification URI relative unless one is configured", () => {
    // Production sets nothing, so the device URI is built against the auth
    // origin exactly as it always was. This pins that the option is inert
    // when absent, which is the only thing production depends on.
    expect(() => createEmbeddedPasswordlessAuth(
      memoryAdapter({}), config(), { async sendMagicLink() {} }, { async record() {} },
    )).not.toThrow();
    expect(() => createEmbeddedPasswordlessAuth(
      memoryAdapter({}),
      config({
        nativeVerificationOrigin: baseUrl,
        trustedOrigins: [baseUrl],
      }),
      { async sendMagicLink() {} },
      { async record() {} },
    )).not.toThrow();
  });

  it("uses a generic request response and stores only a hash of the magic token", async () => {
    const h = await harness();
    try {
      const first = await signIn(h);
      expect(first.link.email).toBe("player@example.test");
      expect(first.token).toHaveLength(32);
      expect(JSON.stringify(h.database)).not.toContain(first.token);

      const redeemed = await redeem(h, first.parsed);
      expect(String(redeemed.response.headers["set-cookie"])).toContain("HttpOnly");
      expect(String(redeemed.response.headers["set-cookie"])).toContain("Secure");
      expect(String(redeemed.response.headers["set-cookie"])).toContain("SameSite=Lax");

      const existing = await signIn(h);
      expect(existing.response.body).toBe(first.response.body);
      expect(existing.response.statusCode).toBe(first.response.statusCode);
      expect(h.links).toHaveLength(2);
    } finally {
      await h.app.close();
    }
  });

  it("consumes a magic link once and resolves only its verified opaque subject", async () => {
    const h = await harness();
    try {
      const link = await signIn(h);
      const redeemed = await redeem(h, link.parsed);

      const subject = await h.app.inject({
        method: "GET",
        url: "/test/subject",
        headers: { cookie: redeemed.cookie, "x-real-ip": "203.0.113.7" },
      });
      expect(subject.statusCode).toBe(200);
      expect(subject.json()).toEqual({
        issuerKey: "mk8dx_passwordless_v1",
        subject: expect.any(String),
      });
      expect(subject.body).not.toContain("player@example.test");

      const replay = await h.app.inject({
        method: "GET",
        url: `${link.parsed.pathname}${link.parsed.search}`,
        headers: { "x-real-ip": "203.0.113.7" },
      });
      expect(replay.statusCode).toBe(302);
      expect(replay.headers.location).toContain("error=INVALID_TOKEN");
      expect(h.audit.filter(({ kind }) => kind === "auth_user_created")).toHaveLength(1);
      expect(h.audit.filter(({ kind }) => kind === "auth_session_created")).toHaveLength(1);
      expect(JSON.stringify(h.audit)).not.toContain("player@example.test");
      expect(JSON.stringify(h.audit)).not.toContain(link.token);
    } finally {
      await h.app.close();
    }
  });

  it("authorizes an allow-listed device in the browser and accepts its bearer session", async () => {
    const h = await harness();
    try {
      const link = await signIn(h);
      const signedIn = await redeem(h, link.parsed);

      const rejectedClient = await h.app.inject({
        method: "POST",
        url: "/api/auth/device/code",
        headers: browserHeaders,
        payload: { client_id: "mk8dx.unknown.v1" },
      });
      expect(rejectedClient.statusCode).toBe(400);
      expect(rejectedClient.json()).toMatchObject({ error: "invalid_client" });

      const requested = await h.app.inject({
        method: "POST",
        url: "/api/auth/device/code",
        headers: browserHeaders,
        payload: { client_id: MK8DX_ANDROID_CLIENT_ID },
      });
      expect(requested.statusCode).toBe(200);
      expect(requested.headers["cache-control"]).toBe("no-store");
      const code = requested.json<{
        device_code: string;
        user_code: string;
        verification_uri: string;
        verification_uri_complete: string;
        expires_in: number;
        interval: number;
      }>();
      expect(code.verification_uri).toBe(`${baseUrl}/device`);
      expect(code.verification_uri_complete).toContain(code.user_code);
      expect(code.expires_in).toBe(600);
      expect(code.interval).toBe(5);

      const verified = await h.app.inject({
        method: "GET",
        url: `/api/auth/device?user_code=${encodeURIComponent(code.user_code)}`,
        headers: { cookie: signedIn.cookie, "x-real-ip": "203.0.113.7" },
      });
      expect(verified.statusCode).toBe(200);
      expect(verified.json()).toMatchObject({
        user_code: code.user_code,
        status: "pending",
        client_id: MK8DX_ANDROID_CLIENT_ID,
      });

      const approved = await h.app.inject({
        method: "POST",
        url: "/api/auth/device/approve",
        headers: { ...browserHeaders, cookie: signedIn.cookie },
        payload: { userCode: code.user_code },
      });
      expect(approved.statusCode).toBe(200);
      expect(approved.json()).toEqual({ success: true });

      const token = await h.app.inject({
        method: "POST",
        url: "/api/auth/device/token",
        headers: browserHeaders,
        payload: {
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: code.device_code,
          client_id: MK8DX_ANDROID_CLIENT_ID,
        },
      });
      expect(token.statusCode).toBe(200);
      const access = token.json<{ access_token: string; token_type: string }>();
      expect(access.token_type).toBe("Bearer");
      expect(access.access_token.length).toBeGreaterThan(20);

      const subject = await h.app.inject({
        method: "GET",
        url: "/test/subject",
        headers: {
          authorization: `Bearer ${access.access_token}`,
          "x-real-ip": "203.0.113.7",
        },
      });
      expect(subject.statusCode).toBe(200);
      expect(subject.json()).toMatchObject({ issuerKey: "mk8dx_passwordless_v1" });
      expect(JSON.stringify(h.audit)).not.toContain(access.access_token);
      expect(h.audit).toContainEqual({
        kind: "device_authorization_requested",
        clientId: MK8DX_ANDROID_CLIENT_ID,
      });
    } finally {
      await h.app.close();
    }
  });
});
