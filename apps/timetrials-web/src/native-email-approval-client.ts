// The link in a native sign-in email (ADR-0209): `/?device-email=<token>`. Opening it only reads what
// the app asked for; approving is a separate, explicit POST, because mail scanners open links.

export type DeviceEmailRequest = Readonly<{
  userCode: string;
  clientName: string;
  expiresAtMs: number;
}>;

export class NativeEmailApprovalClientError extends Error {
  public constructor(public readonly code: "expired_or_used" | "unavailable" | "invalid_response") {
    super("The sign-in link could not be used.");
    this.name = "NativeEmailApprovalClientError";
  }
}

const SCHEMA_VERSION = "mk8dx.native-email-approval.v1";
const tokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const userCodePattern = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/u;

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NativeEmailApprovalClientError("invalid_response");
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) {
    throw new NativeEmailApprovalClientError("invalid_response");
  }
}

export function isDeviceEmailToken(value: string | null): value is string {
  return value !== null && tokenPattern.test(value);
}

export function parseDeviceEmailRequest(value: unknown): DeviceEmailRequest {
  const root = object(value);
  exact(root, ["schemaVersion", "userCode", "clientName", "expiresAtMs"]);
  const { userCode, clientName, expiresAtMs } = root;
  if (root["schemaVersion"] !== SCHEMA_VERSION || typeof userCode !== "string" || !userCodePattern.test(userCode) ||
    typeof clientName !== "string" || clientName.length < 1 || clientName.length > 64 ||
    typeof expiresAtMs !== "number" || !Number.isSafeInteger(expiresAtMs) || expiresAtMs < 0) {
    throw new NativeEmailApprovalClientError("invalid_response");
  }
  return { userCode, clientName, expiresAtMs };
}

export function parseDeviceEmailApproval(value: unknown): void {
  const root = object(value);
  exact(root, ["schemaVersion", "status"]);
  if (root["schemaVersion"] !== SCHEMA_VERSION || root["status"] !== "approved") {
    throw new NativeEmailApprovalClientError("invalid_response");
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function inspectDeviceEmail(token: string, fetcher: Fetch = globalThis.fetch.bind(globalThis)): Promise<DeviceEmailRequest> {
  const response = await fetcher(`/v1/native/device-authorization/email/link?token=${encodeURIComponent(token)}`, {
    method: "GET", credentials: "omit", cache: "no-store", headers: { accept: "application/json" },
  }).catch(() => { throw new NativeEmailApprovalClientError("unavailable"); });
  if (response.status === 404) { throw new NativeEmailApprovalClientError("expired_or_used"); }
  if (!response.ok) { throw new NativeEmailApprovalClientError("unavailable"); }
  return parseDeviceEmailRequest(await response.json().catch(() => null));
}

export async function approveDeviceEmail(token: string, fetcher: Fetch = globalThis.fetch.bind(globalThis)): Promise<void> {
  const response = await fetcher("/v1/native/device-authorization/email/link", {
    method: "POST", credentials: "omit", cache: "no-store",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ token }),
  }).catch(() => { throw new NativeEmailApprovalClientError("unavailable"); });
  if (response.status === 404) { throw new NativeEmailApprovalClientError("expired_or_used"); }
  if (!response.ok) { throw new NativeEmailApprovalClientError("unavailable"); }
  parseDeviceEmailApproval(await response.json().catch(() => null));
}
