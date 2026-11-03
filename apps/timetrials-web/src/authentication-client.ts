export const AUTH_SESSION_PATH = "/api/auth/get-session";
export const AUTH_MAGIC_LINK_PATH = "/api/auth/sign-in/magic-link";
export const AUTH_SIGN_OUT_PATH = "/api/auth/sign-out";
export const AUTH_CHANGE_EMAIL_PATH = "/api/auth/change-email";
export const AUTH_SESSION_CAPABILITIES_PATH = "/v1/session/capabilities";
export const AUTH_DEVICE_LOOKUP_PATH = "/api/auth/device";
export const AUTH_DEVICE_APPROVE_PATH = "/api/auth/device/approve";
export const AUTH_DEVICE_DENY_PATH = "/api/auth/device/deny";

const maximumResponseBytes = 16_384;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const userCodePattern = /^[A-Za-z0-9-]{4,32}$/;

export class WebAuthenticationError extends Error {
  public constructor(
    public readonly code:
      | "invalid_input"
      | "network_unavailable"
      | "not_authenticated"
      | "invalid_device_code"
      | "service_unavailable"
      | "invalid_response",
    public readonly retryable: boolean,
  ) {
    super("The authentication operation could not be completed.");
    this.name = "WebAuthenticationError";
  }
}

export type WebAuthenticationSession = Readonly<{
  authenticated: true;
  email?: string;
  administrator?: boolean;
}>;

export type WebDeviceAuthorization = Readonly<{
  userCode: string;
  clientId: "mk8dx.timetrials.android.v1" | "mk8dx.timetrials.desktop.v1" | "mk8dx.tournament.desktop.v1";
}>;

export interface WebAuthenticationClient {
  session(signal?: AbortSignal): Promise<WebAuthenticationSession | null>;
  // Asked for only where an answer changes what is rendered. It is not
  // part of signing in: the Home page never needed it, and requesting it
  // for a signed-out visitor produced a 401 in every console.
  capabilities(signal?: AbortSignal): Promise<Readonly<{
    administrator: boolean;
    tournamentOperation?: boolean;
  }> | null>;
  requestMagicLink(
    email: string,
    callbackURL: string,
    signal?: AbortSignal,
  ): Promise<void>;
  changeEmail?(newEmail: string, callbackURL: string, signal?: AbortSignal): Promise<void>;
  signOut(signal?: AbortSignal): Promise<void>;
  device(userCode: string, signal?: AbortSignal): Promise<WebDeviceAuthorization>;
  approveDevice(userCode: string, signal?: AbortSignal): Promise<void>;
  denyDevice(userCode: string, signal?: AbortSignal): Promise<void>;
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

function fail(
  code: WebAuthenticationError["code"],
  retryable = false,
): never {
  throw new WebAuthenticationError(code, retryable);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function boundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const declared = response.headers.get("content-length");
  if (!/^application\/json(?:\s*;|$)/.test(contentType) ||
    (declared !== null && (!/^[0-9]+$/.test(declared) ||
      Number(declared) > maximumResponseBytes)) || response.body === null) {
    fail("invalid_response");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let received = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) { break; }
      received += chunk.value.byteLength;
      if (received > maximumResponseBytes) {
        await reader.cancel().catch(() => undefined);
        fail("invalid_response");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof WebAuthenticationError) { throw error; }
    fail("invalid_response");
  }
}

async function request(
  fetchPort: FetchPort,
  path: string,
  init: RequestInit,
): Promise<Readonly<{ status: number; document: unknown }>> {
  let response: Response;
  try {
    response = await fetchPort(path, {
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      referrerPolicy: "same-origin",
      cache: "no-store",
      ...init,
    });
  } catch {
    fail("network_unavailable", true);
  }
  return { status: response.status, document: await boundedJson(response) };
}

function post(signal: AbortSignal | undefined, body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  };
}

function validCallback(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") &&
    value.length <= 2_048 && !/[\u0000-\u001f\u007f]/.test(value);
}

export function createWebAuthenticationClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): WebAuthenticationClient {
  return {
    async session(signal) {
      // Whether someone is signed in is one question with one answer.
      // What they are allowed to do is a second question, asked by the
      // pages that act on it.
      const response = await request(fetchPort, AUTH_SESSION_PATH, {
        method: "GET",
        headers: { Accept: "application/json" },
        ...(signal === undefined ? {} : { signal }),
      });
      if (response.status === 401 || response.document === null) { return null; }
      if (response.status >= 500) { fail("service_unavailable", true); }
      if (response.status !== 200 || !isObject(response.document) ||
        !isObject(response.document["session"]) ||
        !isObject(response.document["user"]) ||
        response.document["user"]["emailVerified"] !== true) {
        fail("invalid_response");
      }
      return { authenticated: true };
    },

    async capabilities(signal) {
      const response = await request(
        fetchPort,
        AUTH_SESSION_CAPABILITIES_PATH,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          ...(signal === undefined ? {} : { signal }),
        },
      );
      if (response.status === 401 || response.status === 403) { return null; }
      if (response.status >= 500) { fail("service_unavailable", true); }
      if (response.status !== 200 || !isObject(response.document) ||
        ![2, 3].includes(Object.keys(response.document).length) ||
        response.document["schemaVersion"] !==
          "mk8dx.web-session-capabilities.v1" ||
        typeof response.document["administrator"] !== "boolean" ||
        (response.document["tournamentOperation"] !== undefined &&
          typeof response.document["tournamentOperation"] !== "boolean")) {
        fail("invalid_response");
      }
      return {
        administrator: response.document["administrator"],
        tournamentOperation: response.document["tournamentOperation"] === true,
      };
    },

    async requestMagicLink(email, callbackURL, signal) {
      const normalized = email.trim().toLowerCase();
      if (normalized.length < 3 || normalized.length > 320 ||
        !emailPattern.test(normalized) || !validCallback(callbackURL)) {
        fail("invalid_input");
      }
      // A new account passes through onboarding and a dead link through the
      // link-error screen; both carry the original destination so neither
      // detour discards where the person was going (the reader validates it
      // against the same-origin allow-list before navigating). The value is
      // encoded twice: Better Auth's verify step decodeURIComponent()s the
      // whole callback once more than the URL parser already did, and its
      // relative-path rule rejects a query containing a bare "?".
      const carried = callbackURL === "/"
        ? ""
        : `&return=${encodeURIComponent(encodeURIComponent(callbackURL))}`;
      const response = await request(
        fetchPort,
        AUTH_MAGIC_LINK_PATH,
        post(signal, {
          email: normalized,
          callbackURL,
          newUserCallbackURL: `/?welcome=1${carried}`,
          errorCallbackURL: `/?authError=1${carried}`,
        }),
      );
      if (response.status === 429 || response.status >= 500) {
        fail("service_unavailable", true);
      }
      if (response.status !== 200 || !isObject(response.document) ||
        response.document["status"] !== true) {
        fail("invalid_response");
      }
    },

    async changeEmail(newEmail, callbackURL, signal) {
      const normalized = newEmail.trim().toLowerCase();
      if (normalized.length < 3 || normalized.length > 320 ||
          !emailPattern.test(normalized) || !validCallback(callbackURL)) fail("invalid_input");
      const response = await request(fetchPort, AUTH_CHANGE_EMAIL_PATH,
        post(signal, { newEmail: normalized, callbackURL }));
      if (response.status === 401 || response.status === 403) fail("not_authenticated");
      if (response.status === 429 || response.status >= 500) fail("service_unavailable", true);
      if (response.status !== 200 || !isObject(response.document) || response.document["status"] !== true) fail("invalid_response");
    },

    async signOut(signal) {
      const response = await request(fetchPort, AUTH_SIGN_OUT_PATH, post(signal, {}));
      if (response.status !== 200 || !isObject(response.document) ||
        response.document["success"] !== true) {
        fail(response.status >= 500 ? "service_unavailable" : "invalid_response", true);
      }
    },

    async device(userCode, signal) {
      const normalized = userCode.trim().toUpperCase();
      if (!userCodePattern.test(normalized)) { fail("invalid_input"); }
      const response = await request(
        fetchPort,
        `${AUTH_DEVICE_LOOKUP_PATH}?user_code=${encodeURIComponent(normalized)}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          ...(signal === undefined ? {} : { signal }),
        },
      );
      if (response.status === 401) { fail("not_authenticated"); }
      if (response.status === 400 || response.status === 404) {
        fail("invalid_device_code");
      }
      if (response.status >= 500) { fail("service_unavailable", true); }
      if (response.status !== 200 || !isObject(response.document) ||
        response.document["user_code"] !== normalized ||
        response.document["status"] !== "pending" ||
        (response.document["client_id"] !== "mk8dx.timetrials.android.v1" &&
          response.document["client_id"] !== "mk8dx.timetrials.desktop.v1" &&
          response.document["client_id"] !== "mk8dx.tournament.desktop.v1")) {
        fail("invalid_response");
      }
      return {
        userCode: normalized,
        clientId: response.document["client_id"],
      };
    },

    async approveDevice(userCode, signal) {
      await deviceDecision(fetchPort, AUTH_DEVICE_APPROVE_PATH, userCode, signal);
    },

    async denyDevice(userCode, signal) {
      await deviceDecision(fetchPort, AUTH_DEVICE_DENY_PATH, userCode, signal);
    },
  };
}

async function deviceDecision(
  fetchPort: FetchPort,
  path: string,
  userCode: string,
  signal?: AbortSignal,
): Promise<void> {
  const normalized = userCode.trim().toUpperCase();
  if (!userCodePattern.test(normalized)) { fail("invalid_input"); }
  const response = await request(fetchPort, path, post(signal, { userCode: normalized }));
  if (response.status === 401) { fail("not_authenticated"); }
  if (response.status === 400 || response.status === 404) {
    fail("invalid_device_code");
  }
  if (response.status >= 500) { fail("service_unavailable", true); }
  if (response.status !== 200 || !isObject(response.document) ||
    response.document["success"] !== true) {
    fail("invalid_response");
  }
}
