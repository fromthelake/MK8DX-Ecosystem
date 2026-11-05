import { isIP } from "node:net";

import type { FastifyInstance, FastifyRequest } from "fastify";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { fromNodeHeaders } from "better-auth/node";
import { bearer, deviceAuthorization, magicLink } from "better-auth/plugins";
import {
  offlineInvitationAuthPlugin,
  type OfflineInvitationAuthPluginOptions,
} from "./offline-invitation-auth-plugin.js";

export const MK8DX_PASSWORDLESS_ISSUER = "mk8dx_passwordless_v1";
export const MK8DX_AUTH_BASE_PATH = "/api/auth";
export const MK8DX_ANDROID_CLIENT_ID = "mk8dx.timetrials.android.v1";
export const MK8DX_DESKTOP_CLIENT_ID = "mk8dx.timetrials.desktop.v1";
export const MK8DX_TOURNAMENT_DESKTOP_CLIENT_ID = "mk8dx.tournament.desktop.v1";

const clientIdPattern = /^mk8dx\.[a-z0-9]+(?:[._-][a-z0-9]+)*\.v[1-9][0-9]*$/;
const headerNamePattern = /^[a-z0-9-]{1,64}$/;

export class EmbeddedAuthConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EmbeddedAuthConfigurationError";
  }
}

export type EmbeddedAuthSecret = Readonly<{
  version: number;
  value: string;
}>;

export type EmbeddedAuthConfig = Readonly<{
  baseUrl: string;
  production: boolean;
  trustedOrigins: readonly string[];
  /**
   * Where a native client is told to go and approve a device code.
   *
   * Absent by default, which is production: the device URI is built against
   * the auth origin exactly as before. It exists because a native client
   * requires an HTTPS verification URI while a loopback QA mirror serves the
   * Web over plain HTTP, so the two cannot be the same origin there. It never
   * lowers the bar: the origin must still be HTTPS unless it is loopback, and
   * it must already be a trusted origin.
   */
  nativeVerificationOrigin?: string;
  secrets: readonly EmbeddedAuthSecret[];
  nativeClientIds: readonly string[];
  clientIpHeaders: readonly string[];
  trustedProxyAddresses: readonly string[];
}>;

export type PasswordlessMagicLink = Readonly<{
  email: string;
  url: string;
  /**
   * Whether this address has no account yet, so the delivery can welcome a
   * new arrival instead of asking them to "sign in" to something they have
   * never been inside. Left undefined when the runtime cannot answer, which
   * keeps the wording true for both cases rather than guessing.
   */
  newAccount?: boolean;
}>;

/**
 * Answers whether an account already exists for an address, so the magic-link
 * email can be written for the right reader. Only the recipient ever sees the
 * result, so this does not widen the address-enumeration surface that the
 * sign-in page deliberately keeps closed.
 */
export interface PasswordlessAccountLookup {
  hasAccount(email: string): Promise<boolean>;
}

export type PasswordlessAccountEmail = Readonly<{
  email: string;
  url: string;
}>;

export interface PasswordlessEmailDelivery {
  sendMagicLink(message: PasswordlessMagicLink): Promise<void>;
  sendEmailVerification?(message: PasswordlessAccountEmail): Promise<void>;
  sendChangeEmailConfirmation?(message: PasswordlessAccountEmail): Promise<void>;
  /** A native client's sign-in link and code (ADR-0209); absent disables the route. */
  sendNativeSignIn?(message: import("./native-email-approval.js").NativeEmailSignIn): Promise<void>;
}

export type EmbeddedAuthAuditEvent = Readonly<{
  kind:
    | "auth_user_created"
    | "auth_session_created"
    | "auth_session_revoked"
    | "device_authorization_requested"
    | "device_authorization_operator_approved"
    | "native_email_approval_sent"
    | "native_email_approval_approved"
    | "native_email_approval_locked";
  subjectId?: string;
  sessionId?: string;
  clientId?: string;
}>;

export interface EmbeddedAuthAuditSink {
  record(event: EmbeddedAuthAuditEvent): Promise<void>;
}

type EmbeddedAuthDatabase = NonNullable<BetterAuthOptions["database"]>;

/** One-time sign-in link lifetime, in seconds. */
export const MAGIC_LINK_LIFETIME_SECONDS = 900;

function exactOrigin(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new EmbeddedAuthConfigurationError(`${label} must be an absolute origin`);
  }
  if (
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new EmbeddedAuthConfigurationError(`${label} must be an exact origin`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new EmbeddedAuthConfigurationError(`${label} protocol is invalid`);
  }
  return parsed.origin;
}

function validateConfig(config: EmbeddedAuthConfig): Readonly<{
  baseUrl: string;
  nativeVerificationOrigin: string | null;
  trustedOrigins: string[];
  secrets: Array<{ version: number; value: string }>;
  nativeClientIds: Set<string>;
  clientIpHeaders: string[];
  trustedProxyAddresses: string[];
}> {
  const baseUrl = exactOrigin(config.baseUrl, "auth base URL");
  const base = new URL(baseUrl);
  if (config.production && base.protocol !== "https:") {
    throw new EmbeddedAuthConfigurationError("production auth requires HTTPS");
  }
  if (!config.production && base.protocol === "http:" &&
    !new Set(["127.0.0.1", "localhost", "::1"]).has(base.hostname)) {
    throw new EmbeddedAuthConfigurationError("development HTTP auth must be loopback");
  }

  const trustedOrigins = config.trustedOrigins.map((origin, index) =>
    exactOrigin(origin, `trusted origin ${index}`));
  if (!trustedOrigins.includes(baseUrl)) {
    throw new EmbeddedAuthConfigurationError("trusted origins must contain the auth origin");
  }
  if (new Set(trustedOrigins).size !== trustedOrigins.length) {
    throw new EmbeddedAuthConfigurationError("trusted origins must be unique");
  }
  if (config.production && trustedOrigins.some((origin) =>
    new URL(origin).protocol !== "https:")) {
    throw new EmbeddedAuthConfigurationError("production trusted origins require HTTPS");
  }

  // A separate native verification origin is opt-in and is held to the same
  // rules as the auth origin itself, plus one more: it must be somewhere the
  // deployment already trusts.
  const nativeVerificationOrigin = config.nativeVerificationOrigin === undefined
    ? null
    : exactOrigin(config.nativeVerificationOrigin, "native verification origin");
  if (nativeVerificationOrigin !== null) {
    const native = new URL(nativeVerificationOrigin);
    if (native.protocol !== "https:" &&
      !(!config.production && native.protocol === "http:" &&
        new Set(["127.0.0.1", "localhost", "::1"]).has(native.hostname))) {
      throw new EmbeddedAuthConfigurationError(
        "native verification origin requires HTTPS",
      );
    }
    if (!trustedOrigins.includes(nativeVerificationOrigin)) {
      throw new EmbeddedAuthConfigurationError(
        "native verification origin must be a trusted origin",
      );
    }
  }

  if (config.secrets.length < 1 || config.secrets.length > 4) {
    throw new EmbeddedAuthConfigurationError("one to four auth secrets are required");
  }
  const secrets = config.secrets.map(({ version, value }, index) => {
    if (!Number.isSafeInteger(version) || version < 1 || version > 2_147_483_647) {
      throw new EmbeddedAuthConfigurationError(`auth secret version ${index} is invalid`);
    }
    const decoded = Buffer.from(value, "base64");
    if (decoded.length !== 32 || decoded.toString("base64") !== value) {
      throw new EmbeddedAuthConfigurationError(`auth secret ${index} is invalid`);
    }
    return { version, value };
  });
  if (
    new Set(secrets.map(({ version }) => version)).size !== secrets.length ||
    new Set(secrets.map(({ value }) => value)).size !== secrets.length
  ) {
    throw new EmbeddedAuthConfigurationError("auth secrets must be distinct");
  }
  for (let index = 1; index < secrets.length; index += 1) {
    if (secrets[index - 1]!.version <= secrets[index]!.version) {
      throw new EmbeddedAuthConfigurationError(
        "auth secrets must be ordered newest version first",
      );
    }
  }

  if (config.nativeClientIds.length < 1 || config.nativeClientIds.length > 8) {
    throw new EmbeddedAuthConfigurationError("native auth clients are required");
  }
  if (config.nativeClientIds.some((clientId) => !clientIdPattern.test(clientId)) ||
    new Set(config.nativeClientIds).size !== config.nativeClientIds.length) {
    throw new EmbeddedAuthConfigurationError("native auth client IDs are invalid");
  }

  if (config.clientIpHeaders.length < 1 || config.clientIpHeaders.length > 4 ||
    config.clientIpHeaders.some((name) => !headerNamePattern.test(name)) ||
    new Set(config.clientIpHeaders).size !== config.clientIpHeaders.length) {
    throw new EmbeddedAuthConfigurationError("client IP headers are invalid");
  }
  if (config.production && config.trustedProxyAddresses.length < 1) {
    throw new EmbeddedAuthConfigurationError(
      "production auth requires an explicit trusted proxy address",
    );
  }
  const validProxyAddress = (value: string): boolean => {
    const separator = value.lastIndexOf("/");
    if (separator === -1) { return isIP(value) !== 0; }
    const address = value.slice(0, separator);
    const prefix = value.slice(separator + 1);
    const family = isIP(address);
    const maximum = family === 4 ? 32 : family === 6 ? 128 : -1;
    return /^[0-9]{1,3}$/.test(prefix) && Number(prefix) <= maximum;
  };
  if (config.trustedProxyAddresses.length > 16 ||
    config.trustedProxyAddresses.some((value) => !validProxyAddress(value))) {
    throw new EmbeddedAuthConfigurationError("trusted proxy addresses are invalid");
  }

  return {
    baseUrl,
    nativeVerificationOrigin,
    trustedOrigins,
    secrets,
    nativeClientIds: new Set(config.nativeClientIds),
    clientIpHeaders: [...config.clientIpHeaders],
    trustedProxyAddresses: [...config.trustedProxyAddresses],
  };
}

export function createEmbeddedPasswordlessAuth(
  database: EmbeddedAuthDatabase,
  config: EmbeddedAuthConfig,
  emailDelivery: PasswordlessEmailDelivery,
  auditSink: EmbeddedAuthAuditSink,
  accountLookup?: PasswordlessAccountLookup,
  offlineInvitation?: OfflineInvitationAuthPluginOptions,
) {
  const validated = validateConfig(config);
  const currentSecret = validated.secrets[0]!.value;
  return betterAuth({
    appName: "MK8DX",
    baseURL: validated.baseUrl,
    basePath: MK8DX_AUTH_BASE_PATH,
    secret: currentSecret,
    secrets: validated.secrets,
    database,
    trustedOrigins: validated.trustedOrigins,
    emailAndPassword: { enabled: false },
    user: {
      modelName: "mk8dx_auth_user",
      changeEmail: {
        enabled: true,
        updateEmailWithoutVerification: false,
        async sendChangeEmailConfirmation({ user, url }): Promise<void> {
          if (emailDelivery.sendChangeEmailConfirmation === undefined) {
            throw new Error("change-email delivery is unavailable");
          }
          await emailDelivery.sendChangeEmailConfirmation({ email: user.email, url });
        },
      },
      deleteUser: { enabled: false },
    },
    emailVerification: {
      async sendVerificationEmail({ user, url }): Promise<void> {
        if (emailDelivery.sendEmailVerification === undefined) {
          throw new Error("email-verification delivery is unavailable");
        }
        await emailDelivery.sendEmailVerification({ email: user.email, url });
      },
    },
    session: {
      modelName: "mk8dx_auth_session",
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 12,
      freshAge: 60 * 15,
      cookieCache: { enabled: false },
    },
    account: {
      modelName: "mk8dx_auth_account",
      accountLinking: {
        enabled: false,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
      },
      encryptOAuthTokens: true,
    },
    verification: {
      modelName: "mk8dx_auth_verification",
      storeIdentifier: "hashed",
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "mk8dx_auth_rate_limit",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/magic-link": { window: 60, max: 5 },
        "/magic-link/verify": { window: 60, max: 10 },
        "/change-email": { window: 3600, max: 3 },
        "/verify-email": { window: 60, max: 10 },
        "/device/code": { window: 60, max: 10 },
        "/device/token": { window: 60, max: 30 },
      },
    },
    advanced: {
      useSecureCookies: config.production,
      disableCSRFCheck: false,
      disableOriginCheck: false,
      cookiePrefix: "mk8dx",
      defaultCookieAttributes: {
        httpOnly: true,
        secure: config.production,
        sameSite: "lax",
        path: "/",
      },
      ipAddress: {
        ipAddressHeaders: validated.clientIpHeaders,
        trustedProxies: validated.trustedProxyAddresses,
      },
    },
    telemetry: { enabled: false },
    plugins: [
      magicLink({
        // 15 minutes. Five was shorter than plenty of ordinary mail-delivery
        // round trips, and an expired link is the product's most common
        // silent failure.
        expiresIn: MAGIC_LINK_LIFETIME_SECONDS,
        storeToken: "hashed",
        rateLimit: { window: 60, max: 5 },
        async sendMagicLink({ email, url }): Promise<void> {
          // A lookup failure must never block the sign-in itself; the message
          // then falls back to wording that suits either reader.
          const known = accountLookup === undefined
            ? null
            : await accountLookup.hasAccount(email).catch(() => null);
          await emailDelivery.sendMagicLink({
            email,
            url,
            ...(known === null ? {} : { newAccount: !known }),
          });
        },
      }),
      deviceAuthorization({
        expiresIn: "10m",
        interval: "5s",
        // Relative in production, so the device URI is built against the auth
        // origin exactly as it always was. Absolute only where a deployment
        // has deliberately said native clients approve somewhere else.
        verificationUri: validated.nativeVerificationOrigin === null
          ? "/device"
          : `${validated.nativeVerificationOrigin}/device`,
        validateClient(clientId): boolean {
          return validated.nativeClientIds.has(clientId);
        },
        async onDeviceAuthRequest(clientId): Promise<void> {
          await auditSink.record({
            kind: "device_authorization_requested",
            clientId,
          });
        },
        schema: { deviceCode: { modelName: "mk8dx_auth_device_code" } },
      }),
      bearer(),
      ...(offlineInvitation === undefined ? [] : [offlineInvitationAuthPlugin(offlineInvitation)]),
    ],
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({
            data: { ...user, name: "MK8DX account" },
          }),
          after: async (user) => {
            await auditSink.record({ kind: "auth_user_created", subjectId: user.id });
          },
        },
      },
      session: {
        create: {
          after: async (session) => {
            await auditSink.record({
              kind: "auth_session_created",
              subjectId: session.userId,
              sessionId: session.id,
            });
          },
        },
        delete: {
          after: async (session) => {
            await auditSink.record({
              kind: "auth_session_revoked",
              subjectId: session.userId,
              sessionId: session.id,
            });
          },
        },
      },
    },
  });
}

export type EmbeddedPasswordlessAuth = ReturnType<
  typeof createEmbeddedPasswordlessAuth
>;

export type EmbeddedVerifiedSubject = Readonly<{
  issuerKey: typeof MK8DX_PASSWORDLESS_ISSUER;
  subject: string;
}>;

export function createEmbeddedVerifiedSubjectResolver(
  auth: EmbeddedPasswordlessAuth,
): (request: FastifyRequest) => Promise<EmbeddedVerifiedSubject | null> {
  return async (request) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (session === null || session.user.emailVerified !== true) {
      return null;
    }
    return {
      issuerKey: MK8DX_PASSWORDLESS_ISSUER,
      subject: session.user.id,
    };
  };
}

const excludedResponseHeaders = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export async function registerEmbeddedAuthRoutes(
  app: FastifyInstance,
  auth: EmbeddedPasswordlessAuth,
  baseUrl: string,
  offlineLan = false,
): Promise<void> {
  const origin = exactOrigin(baseUrl, "auth route base URL");
  app.route({
    method: ["GET", "POST"],
    url: `${MK8DX_AUTH_BASE_PATH}/*`,
    async handler(request, reply) {
      const url = new URL(request.raw.url ?? request.url, origin);
      const offlinePath = (() => {
        try { return decodeURIComponent(url.pathname).toLowerCase(); }
        catch { return ""; }
      })();
      if (offlineLan && (offlinePath === "" || [
        `${MK8DX_AUTH_BASE_PATH}/sign-in/magic-link`,
        `${MK8DX_AUTH_BASE_PATH}/magic-link/verify`,
        `${MK8DX_AUTH_BASE_PATH}/change-email`,
        `${MK8DX_AUTH_BASE_PATH}/verify-email`,
      ].some((path) => offlinePath === path || offlinePath.startsWith(`${path}/`)))) {
        return reply.code(404).send({ code: "offline_email_auth_unavailable",
          message: "Use a local invitation from the host administrator." });
      }
      const headers = fromNodeHeaders(request.headers);
      const requestBody = request.method === "GET" || request.body === undefined
        ? undefined
        : JSON.stringify(request.body);
      headers.delete("content-length");
      if (requestBody !== undefined && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      const authRequest = new Request(url, {
        method: request.method,
        headers,
        ...(requestBody === undefined ? {} : { body: requestBody }),
      });
      const response = await auth.handler(authRequest);
      reply.code(response.status);
      for (const [name, value] of response.headers.entries()) {
        if (name !== "set-cookie" && !excludedResponseHeaders.has(name)) {
          reply.header(name, value);
        }
      }
      const getSetCookie = response.headers.getSetCookie;
      const cookies = typeof getSetCookie === "function"
        ? getSetCookie.call(response.headers)
        : [];
      if (cookies.length > 0) {
        reply.header("set-cookie", cookies);
      }
      const body = Buffer.from(await response.arrayBuffer());
      return reply.send(body);
    },
  });
}
