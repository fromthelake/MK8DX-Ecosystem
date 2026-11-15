// Fresh e-mail confirmation (step-up) before a dangerous administrator action.
//
// The server answers such an action with 403 and the header `x-mk8dx-step-up: required` until this
// browser session has confirmed a new link sent to the account's own address. `stepUpAwareFetch` wraps
// the page's fetch: on that answer it asks `confirm` (the dialog in step-up-dialog.ts) and, once the
// session is confirmed, repeats the original request exactly once. Every other answer passes through
// untouched. The link in the email opens `/?step-up=<token>`; that page only shows what is being
// confirmed, and confirming is a separate, explicit POST because mail scanners open links.

export const STEP_UP_PATH = "/v1/session/step-up";
export const STEP_UP_LINK_PATH = "/v1/session/step-up/link";
export const STEP_UP_HEADER = "x-mk8dx-step-up";
const SCHEMA_VERSION = "mk8dx.step-up.v1";
const tokenPattern = /^[A-Za-z0-9_-]{43}$/u;

export type StepUpClientErrorCode =
  | "rate_limited" | "unavailable" | "expired_or_used" | "signed_out" | "invalid_response"
  // The link was created but the e-mail failed; the operator's `install.py step-up-link` hands it over.
  | "mail_unavailable";

export class StepUpClientError extends Error {
  public constructor(
    public readonly code: StepUpClientErrorCode,
    public readonly retryAfterSeconds: number | null = null,
    /** For `mail_unavailable`: until when the created link can still be confirmed. */
    public readonly linkExpiresAtMs: number | null = null,
  ) {
    super("The confirmation could not be completed.");
    this.name = "StepUpClientError";
  }
}

export type StepUpStatus = Readonly<{ active: boolean; expiresAtMs: number | null; pending: boolean; windowSeconds: number }>;
export type StepUpSent = Readonly<{ linkExpiresAtMs: number; windowSeconds: number }>;
export type StepUpLinkView = Readonly<{
  clientKind: "web" | "native"; requestedAtMs: number; linkExpiresAtMs: number; windowSeconds: number;
}>;

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StepUpClientError("invalid_response");
  }
  const root = value as Record<string, unknown>;
  if (Object.keys(root).length !== keys.length || keys.some((key) => !(key in root)) ||
    root["schemaVersion"] !== SCHEMA_VERSION) {
    throw new StepUpClientError("invalid_response");
  }
  return root;
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new StepUpClientError("invalid_response");
  }
  return value;
}

export function parseStepUpStatus(value: unknown): StepUpStatus {
  const root = object(value, ["schemaVersion", "active", "expiresAtMs", "pending", "windowSeconds"]);
  if (typeof root["active"] !== "boolean" || typeof root["pending"] !== "boolean") {
    throw new StepUpClientError("invalid_response");
  }
  return {
    active: root["active"],
    expiresAtMs: root["expiresAtMs"] === null ? null : count(root["expiresAtMs"]),
    pending: root["pending"],
    windowSeconds: count(root["windowSeconds"]),
  };
}

export function parseStepUpSent(value: unknown): StepUpSent {
  const root = object(value, ["schemaVersion", "status", "linkExpiresAtMs", "windowSeconds"]);
  if (root["status"] !== "sent") { throw new StepUpClientError("invalid_response"); }
  return { linkExpiresAtMs: count(root["linkExpiresAtMs"]), windowSeconds: count(root["windowSeconds"]) };
}

export function parseStepUpLinkView(value: unknown): StepUpLinkView {
  const root = object(value, ["schemaVersion", "clientKind", "requestedAtMs", "linkExpiresAtMs", "windowSeconds"]);
  if (root["clientKind"] !== "web" && root["clientKind"] !== "native") {
    throw new StepUpClientError("invalid_response");
  }
  return {
    clientKind: root["clientKind"],
    requestedAtMs: count(root["requestedAtMs"]),
    linkExpiresAtMs: count(root["linkExpiresAtMs"]),
    windowSeconds: count(root["windowSeconds"]),
  };
}

export function isStepUpToken(value: string | null): value is string {
  return value !== null && tokenPattern.test(value);
}

async function body(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

const defaultFetch = (): Fetch => globalThis.fetch.bind(globalThis);

/** Asks the server to email a new confirmation link for this session. */
export async function requestStepUp(fetcher: Fetch = defaultFetch()): Promise<StepUpSent> {
  const response = await fetcher(STEP_UP_PATH, {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { accept: "application/json", "content-type": "application/json" }, body: "{}",
  }).catch(() => { throw new StepUpClientError("unavailable"); });
  if (response.status === 429) {
    const retry = Number(response.headers.get("retry-after"));
    throw new StepUpClientError("rate_limited", Number.isFinite(retry) && retry > 0 ? retry : null);
  }
  if (response.status === 401) { throw new StepUpClientError("signed_out"); }
  if (response.status === 503) {
    const failed = await body(response) as Record<string, unknown> | null;
    const until = failed?.["linkExpiresAtMs"];
    if (failed?.["code"] === "step_up_mail_unavailable" && typeof until === "number" && Number.isSafeInteger(until) && until > 0) {
      throw new StepUpClientError("mail_unavailable", null, until);
    }
  }
  if (response.status !== 202) { throw new StepUpClientError("unavailable"); }
  return parseStepUpSent(await body(response));
}

export async function stepUpStatus(fetcher: Fetch = defaultFetch()): Promise<StepUpStatus> {
  const response = await fetcher(STEP_UP_PATH, {
    method: "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" },
  }).catch(() => { throw new StepUpClientError("unavailable"); });
  if (response.status === 401) { throw new StepUpClientError("signed_out"); }
  if (!response.ok) { throw new StepUpClientError("unavailable"); }
  return parseStepUpStatus(await body(response));
}

export async function inspectStepUpLink(token: string, fetcher: Fetch = defaultFetch()): Promise<StepUpLinkView> {
  const response = await fetcher(`${STEP_UP_LINK_PATH}?token=${encodeURIComponent(token)}`, {
    method: "GET", credentials: "omit", cache: "no-store", headers: { accept: "application/json" },
  }).catch(() => { throw new StepUpClientError("unavailable"); });
  if (response.status === 404) { throw new StepUpClientError("expired_or_used"); }
  if (!response.ok) { throw new StepUpClientError("unavailable"); }
  return parseStepUpLinkView(await body(response));
}

export async function confirmStepUpLink(token: string, fetcher: Fetch = defaultFetch()): Promise<void> {
  const response = await fetcher(STEP_UP_LINK_PATH, {
    method: "POST", credentials: "omit", cache: "no-store",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ token }),
  }).catch(() => { throw new StepUpClientError("unavailable"); });
  if (response.status === 404) { throw new StepUpClientError("expired_or_used"); }
  if (response.status === 429) { throw new StepUpClientError("rate_limited"); }
  if (!response.ok) { throw new StepUpClientError("unavailable"); }
  const root = object(await body(response), ["schemaVersion", "status", "windowSeconds"]);
  if (root["status"] !== "confirmed") { throw new StepUpClientError("invalid_response"); }
}

export function isStepUpRequired(response: Response): boolean {
  return response.status === 403 && response.headers.get(STEP_UP_HEADER) === "required";
}

function sameOrigin(input: RequestInfo | URL, origin: string): boolean {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try { return new URL(raw, origin).origin === origin; } catch { return false; }
}

/**
 * A fetch that meets `step_up_required` by asking `confirm` once and then repeating the request once.
 * Concurrent requests share one confirmation. Without confirmation the original answer is returned.
 */
export function stepUpAwareFetch(
  base: Fetch,
  confirm: () => Promise<boolean>,
  origin: string,
): Fetch {
  let inFlight: Promise<boolean> | null = null;
  return async (input, init) => {
    // A Request body can be read only once, so the copy for the repeat is taken before sending.
    const repeat = typeof Request !== "undefined" && input instanceof Request ? input.clone() : input;
    const response = await base(input, init);
    if (!isStepUpRequired(response) || !sameOrigin(input, origin)) { return response; }
    const shared = inFlight ?? (inFlight = confirm().catch(() => false).finally(() => { inFlight = null; }));
    if (!(await shared)) { return response; }
    return base(repeat, init);
  };
}
