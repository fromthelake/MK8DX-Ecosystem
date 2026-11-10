export const AUTH_SESSION_PATH = "/api/auth/get-session";
export const AUTH_MAGIC_LINK_PATH = "/api/auth/sign-in/magic-link";
export const AUTH_SIGN_OUT_PATH = "/api/auth/sign-out";
export const AUTH_CHANGE_EMAIL_PATH = "/api/auth/change-email";
export const AUTH_SESSION_CAPABILITIES_PATH = "/v1/session/capabilities";
export const AUTH_DEVICE_LOOKUP_PATH = "/api/auth/device";
export const AUTH_DEVICE_APPROVE_PATH = "/api/auth/device/approve";
export const AUTH_DEVICE_DENY_PATH = "/api/auth/device/deny";
export const PUBLIC_CLIENT_CONFIG_PATH = "/client-config.json";
export const AUTH_REVOKE_SESSIONS_PATH = "/api/auth/revoke-sessions";
export const DEVICE_INVITATION_PATH = "/v1/session/device-invitations";
export const REMEMBERED_ACCOUNTS_PATH = "/v1/session/remembered-accounts";
export const ACCOUNT_SWITCH_PATH = "/v1/session/account-switch";
export const ACCOUNT_SWITCH_PIN_PATH = "/v1/account/switch-pin";
export const ACCOUNT_SWITCH_PIN_CLEAR_PATH = "/v1/account/switch-pin/clear";
/** Sent only by "Sign in with another account": the server then keeps this account remembered. */
export const KEEP_REMEMBERED_HEADER = "X-MK8DX-Keep-Remembered";
const CSRF_PATH = "/v1/session/csrf";

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
      | "not_available"
      | "pin_required"
      | "pin_invalid"
      | "rate_limited"
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

/** ADR-0224 "add another device": a one-use card for the signed-in account itself. */
export type WebDeviceInvitation = Readonly<{
  invitationUrl: string;
  expiresAtMs: number;
  /** The QR matrix row by row; true is a dark module. */
  qr: Readonly<{ size: number; modules: readonly boolean[] }>;
}>;

/**
 * ADR-0224 phase 2: an account this browser remembers. Labels and an opaque entry id only; the
 * page never holds a session token, and nothing here is written to browser storage.
 */
export type WebRememberedAccount = Readonly<{
  entryId: string;
  label: string | null;
  pinRequired: boolean;
  current: boolean;
}>;

export type WebSwitchPinState = Readonly<{ enabled: boolean; currentPinRequired: boolean }>;

export interface WebAuthenticationClient {
  session(signal?: AbortSignal): Promise<WebAuthenticationSession | null>;
  installationMode?(signal?: AbortSignal): Promise<"email-link" | "offline-invitation">;
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
  /** keepRemembered: "Sign in with another account" - the device keeps offering this account. */
  signOut(signal?: AbortSignal, options?: Readonly<{ keepRemembered?: boolean }>): Promise<void>;
  /** The accounts this browser remembers (ADR-0224 phase 2); administrators are never listed. */
  rememberedAccounts?(signal?: AbortSignal): Promise<readonly WebRememberedAccount[]>;
  /** One tap (or the PIN) to become a remembered account; the server sets the session cookie. */
  switchAccount?(entryId: string, pin?: string, signal?: AbortSignal): Promise<void>;
  switchPin?(signal?: AbortSignal): Promise<WebSwitchPinState>;
  setSwitchPin?(pin: string, currentPin?: string, signal?: AbortSignal): Promise<WebSwitchPinState>;
  clearSwitchPin?(currentPin?: string, signal?: AbortSignal): Promise<WebSwitchPinState>;
  /**
   * Ends every session of this account, other devices and apps included, then this browser's
   * own cookie exactly as signOut does (ADR-0224).
   */
  signOutEverywhere?(signal?: AbortSignal): Promise<void>;
  /** Offline-invitation installations only; anywhere else it fails with not_available. */
  createDeviceInvitation?(signal?: AbortSignal): Promise<WebDeviceInvitation>;
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
  const signOut = async (
    signal?: AbortSignal,
    options: Readonly<{ keepRemembered?: boolean }> = {},
  ): Promise<void> => {
    const init = post(signal, {});
    const response = await request(fetchPort, AUTH_SIGN_OUT_PATH, options.keepRemembered === true
      ? { ...init, headers: { ...init.headers as Record<string, string>, [KEEP_REMEMBERED_HEADER]: "1" } }
      : init);
    if (response.status !== 200 || !isObject(response.document) ||
      response.document["success"] !== true) {
      fail(response.status >= 500 ? "service_unavailable" : "invalid_response", true);
    }
  };
  return {
    async installationMode(signal) {
      let response: Response;
      try {
        response = await fetchPort(PUBLIC_CLIENT_CONFIG_PATH, {
          method: "GET", headers: { Accept: "application/json" },
          credentials: "same-origin", mode: "same-origin", redirect: "error",
          referrerPolicy: "same-origin", cache: "no-store",
          ...(signal === undefined ? {} : { signal }),
        });
      } catch { fail("network_unavailable", true); }
      // Older and source-built Web hosts have no public client config yet.
      if (response.status === 404) { return "email-link"; }
      if (response.status !== 200) { fail("invalid_response"); }
      const document = await boundedJson(response);
      if (!isObject(document) ||
          document["schemaVersion"] !== "mk8dx.public-client.v1" ||
          typeof document["websiteOrigin"] !== "string" ||
          (document["authenticationMode"] !== undefined &&
           document["authenticationMode"] !== "offline-invitation")) {
        fail("invalid_response");
      }
      return document["authenticationMode"] === "offline-invitation"
        ? "offline-invitation" : "email-link";
    },
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

    signOut,

    async signOutEverywhere(signal) {
      const response = await request(fetchPort, AUTH_REVOKE_SESSIONS_PATH, post(signal, {}));
      if (response.status === 401) { fail("not_authenticated"); }
      if (response.status === 429 || response.status >= 500) { fail("service_unavailable", true); }
      if (response.status !== 200 || !isObject(response.document) ||
        response.document["status"] !== true) {
        fail("invalid_response");
      }
      // The server already ended this session with the others; this clears the cookie.
      await signOut(signal);
    },

    async rememberedAccounts(signal) {
      const response = await request(fetchPort, REMEMBERED_ACCOUNTS_PATH, {
        method: "GET",
        headers: { Accept: "application/json" },
        ...(signal === undefined ? {} : { signal }),
      });
      if (response.status === 404) { return []; }
      if (response.status >= 500) { fail("service_unavailable", true); }
      return parseRememberedAccounts(response.status, response.document);
    },

    async switchAccount(entryId, pin, signal) {
      if (!/^[A-Za-z0-9_-]{22}$/.test(entryId) || (pin !== undefined && !/^[0-9]{4}$/.test(pin))) {
        fail("invalid_input");
      }
      const response = await request(fetchPort, ACCOUNT_SWITCH_PATH,
        post(signal, { entryId, ...(pin === undefined ? {} : { pin }) }));
      if (response.status === 200) {
        if (!isObject(response.document) || Object.keys(response.document).length !== 2 ||
          response.document["schemaVersion"] !== "mk8dx.account-switch.v1" ||
          response.document["switched"] !== true) {
          fail("invalid_response");
        }
        return;
      }
      failSwitch(response.status, response.document);
    },

    async switchPin(signal) {
      const response = await request(fetchPort, ACCOUNT_SWITCH_PIN_PATH, {
        method: "GET",
        headers: { Accept: "application/json" },
        ...(signal === undefined ? {} : { signal }),
      });
      if (response.status !== 200) { failSwitch(response.status, response.document); }
      return parseSwitchPinState(response.status, response.document);
    },

    async setSwitchPin(pin, currentPin, signal) {
      if (!/^[0-9]{4}$/.test(pin) || (currentPin !== undefined && !/^[0-9]{4}$/.test(currentPin))) {
        fail("invalid_input");
      }
      const proof = await csrfProof(fetchPort, signal);
      const init = post(signal, { pin, ...(currentPin === undefined ? {} : { currentPin }) });
      const response = await request(fetchPort, ACCOUNT_SWITCH_PIN_PATH, {
        ...init, method: "PUT",
        headers: { ...init.headers as Record<string, string>, "X-MK8DX-CSRF": proof },
      });
      if (response.status !== 200) { failSwitch(response.status, response.document); }
      return parseSwitchPinState(response.status, response.document);
    },

    async clearSwitchPin(currentPin, signal) {
      if (currentPin !== undefined && !/^[0-9]{4}$/.test(currentPin)) { fail("invalid_input"); }
      const proof = await csrfProof(fetchPort, signal);
      const init = post(signal, currentPin === undefined ? {} : { currentPin });
      const response = await request(fetchPort, ACCOUNT_SWITCH_PIN_CLEAR_PATH, {
        ...init, headers: { ...init.headers as Record<string, string>, "X-MK8DX-CSRF": proof },
      });
      if (response.status !== 200) { failSwitch(response.status, response.document); }
      return parseSwitchPinState(response.status, response.document);
    },

    async createDeviceInvitation(signal) {
      const proof = await csrfProof(fetchPort, signal);
      const response = await request(fetchPort, DEVICE_INVITATION_PATH, {
        ...post(signal, {}),
        headers: {
          Accept: "application/json", "Content-Type": "application/json",
          "X-MK8DX-CSRF": proof,
        },
      });
      if (response.status === 401) { fail("not_authenticated"); }
      if (response.status === 403 || response.status === 404) { fail("not_available"); }
      if (response.status === 429 || response.status >= 500) { fail("service_unavailable", true); }
      return parseDeviceInvitation(response.status, response.document);
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

async function csrfProof(fetchPort: FetchPort, signal?: AbortSignal): Promise<string> {
  const proof = await request(fetchPort, CSRF_PATH, {
    method: "GET",
    headers: { Accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  if (proof.status === 401 || proof.status === 403) { fail("not_authenticated"); }
  if (proof.status >= 500) { fail("service_unavailable", true); }
  if (proof.status !== 200 || !isObject(proof.document) ||
    Object.keys(proof.document).length !== 3 ||
    proof.document["schemaVersion"] !== "mk8dx.web-csrf.v1" ||
    proof.document["headerName"] !== "X-MK8DX-CSRF" ||
    typeof proof.document["value"] !== "string" || proof.document["value"].length === 0) {
    fail("invalid_response");
  }
  return proof.document["value"];
}

/** Error answers of the switch and PIN routes (account-switch-routes.ts). */
function failSwitch(status: number, document: unknown): never {
  const code = isObject(document) ? document["code"] : undefined;
  if (status === 401) { fail("not_authenticated"); }
  if (status === 400) { fail("invalid_input"); }
  if (status === 429) { fail("rate_limited", true); }
  if (status === 403 && (code === "account_switch_pin_required" ||
      code === "account_switch_pin_current_required")) { fail("pin_required"); }
  if (status === 403 && code === "account_switch_pin_invalid") { fail("pin_invalid"); }
  if (status === 403 || status === 404) { fail("not_available"); }
  if (status >= 500) { fail("service_unavailable", true); }
  fail("invalid_response");
}

const rememberedKeys = new Set(["entryId", "label", "pinRequired", "current"]);

/** Key for key against rememberedAccountsResponseSchema in account-switch-routes.ts. */
export function parseRememberedAccounts(status: number, document: unknown): readonly WebRememberedAccount[] {
  if (status !== 200 || !isObject(document) || Object.keys(document).length !== 2 ||
    document["schemaVersion"] !== "mk8dx.remembered-accounts.v1" ||
    !Array.isArray(document["accounts"]) || document["accounts"].length > 6) {
    fail("invalid_response");
  }
  return (document["accounts"] as unknown[]).map((entry) => {
    if (!isObject(entry) || Object.keys(entry).some((key) => !rememberedKeys.has(key)) ||
      typeof entry["entryId"] !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(entry["entryId"]) ||
      (entry["label"] !== undefined && (typeof entry["label"] !== "string" ||
        entry["label"].length < 1 || entry["label"].length > 128)) ||
      typeof entry["pinRequired"] !== "boolean" || typeof entry["current"] !== "boolean") {
      fail("invalid_response");
    }
    return {
      entryId: entry["entryId"],
      label: typeof entry["label"] === "string" ? entry["label"] : null,
      pinRequired: entry["pinRequired"],
      current: entry["current"],
    };
  });
}

/** Key for key against accountSwitchPinResponseSchema in account-switch-routes.ts. */
export function parseSwitchPinState(status: number, document: unknown): WebSwitchPinState {
  if (status !== 200 || !isObject(document) || Object.keys(document).length !== 3 ||
    document["schemaVersion"] !== "mk8dx.account-switch-pin.v1" ||
    typeof document["enabled"] !== "boolean" || typeof document["currentPinRequired"] !== "boolean") {
    fail("invalid_response");
  }
  return { enabled: document["enabled"], currentPinRequired: document["currentPinRequired"] };
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

const invitationTokenPattern = /^#token=[A-Za-z0-9_-]{43}$/;

/** Key for key against the API's response schema (device-invitation-routes.ts). */
export function parseDeviceInvitation(status: number, document: unknown): WebDeviceInvitation {
  if (status !== 200 || !isObject(document) || Object.keys(document).length !== 4 ||
    document["schemaVersion"] !== "mk8dx.device-invitation.v1" ||
    typeof document["invitationUrl"] !== "string" ||
    typeof document["expiresAtMs"] !== "number" ||
    !Number.isSafeInteger(document["expiresAtMs"]) || document["expiresAtMs"] < 0 ||
    !isObject(document["qr"]) || Object.keys(document["qr"]).length !== 2) {
    fail("invalid_response");
  }
  const invitationUrl = document["invitationUrl"];
  let parsed: URL;
  try { parsed = new URL(invitationUrl); } catch { fail("invalid_response"); }
  // Only this installation's own invitation page, never somewhere a page could be sent.
  const ownOrigin = globalThis.location?.origin;
  if (invitationUrl.length > 512 || parsed.protocol !== "https:" ||
    parsed.pathname !== "/offline-invite" || parsed.search !== "" ||
    parsed.username !== "" || parsed.password !== "" ||
    !invitationTokenPattern.test(parsed.hash) ||
    (typeof ownOrigin === "string" && ownOrigin !== "null" && ownOrigin.startsWith("https:") &&
      parsed.origin !== ownOrigin)) {
    fail("invalid_response");
  }
  const qr = document["qr"] as Record<string, unknown>;
  const size = qr["size"];
  const modules = qr["modules"];
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 21 || size > 73 ||
    (size - 17) % 4 !== 0 || typeof modules !== "string" ||
    modules.length !== size * size || !/^[01]+$/.test(modules)) {
    fail("invalid_response");
  }
  return {
    invitationUrl,
    expiresAtMs: document["expiresAtMs"],
    qr: { size, modules: [...modules].map((module) => module === "1") },
  };
}
