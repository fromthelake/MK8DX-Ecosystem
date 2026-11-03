export const ADMINISTRATOR_OVERVIEW_PATH = "/v1/administrator/overview";
export const ADMINISTRATOR_OVERVIEW_SCHEMA_VERSION = "mk8dx.administrator-overview.v1";

const maximumResponseBytes = 8_192;

export type AdministratorOverviewWindow = Readonly<{
  signedIn: number;
  submitted: number;
}>;

export type AdministratorOverview = Readonly<{
  generatedAtMs: number;
  registered: Readonly<{
    signInIdentities: number;
    accounts: number;
    players: number;
    linkedPlayers: number;
    administrators: number;
  }>;
  active: Readonly<{
    last24h: AdministratorOverviewWindow;
    last7d: AdministratorOverviewWindow;
    last30d: AdministratorOverviewWindow;
  }>;
  pending: Readonly<{ playerClaims: number }>;
}>;

export type AdministratorOverviewClientErrorCode =
  | "not_authorized" | "unavailable" | "invalid_response";

export class AdministratorOverviewClientError extends Error {
  public constructor(public readonly code: AdministratorOverviewClientErrorCode) {
    super(`administrator overview ${code}`);
    this.name = "AdministratorOverviewClientError";
  }
}

export interface AdministratorOverviewClient {
  overview(signal?: AbortSignal): Promise<AdministratorOverview>;
}

type FetchPort = typeof globalThis.fetch;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new AdministratorOverviewClientError("invalid_response");
  }
  return value;
}

function windowOf(value: unknown): AdministratorOverviewWindow {
  if (!isObject(value)) { throw new AdministratorOverviewClientError("invalid_response"); }
  return { signedIn: countOf(value["signedIn"]), submitted: countOf(value["submitted"]) };
}

export function parseAdministratorOverview(body: unknown): AdministratorOverview {
  if (!isObject(body) || body["schemaVersion"] !== ADMINISTRATOR_OVERVIEW_SCHEMA_VERSION ||
    !isObject(body["registered"]) || !isObject(body["active"]) || !isObject(body["pending"])) {
    throw new AdministratorOverviewClientError("invalid_response");
  }
  const registered = body["registered"];
  const active = body["active"];
  return {
    generatedAtMs: countOf(body["generatedAtMs"]),
    registered: {
      signInIdentities: countOf(registered["signInIdentities"]),
      accounts: countOf(registered["accounts"]),
      players: countOf(registered["players"]),
      linkedPlayers: countOf(registered["linkedPlayers"]),
      administrators: countOf(registered["administrators"]),
    },
    active: {
      last24h: windowOf(active["last24h"]),
      last7d: windowOf(active["last7d"]),
      last30d: windowOf(active["last30d"]),
    },
    pending: { playerClaims: countOf(body["pending"]["playerClaims"]) },
  };
}

export function createAdministratorOverviewClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): AdministratorOverviewClient {
  return {
    async overview(signal) {
      const response = await fetchPort(ADMINISTRATOR_OVERVIEW_PATH, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
        ...(signal === undefined ? {} : { signal }),
      });
      if (response.status === 401 || response.status === 403) {
        throw new AdministratorOverviewClientError("not_authorized");
      }
      if (response.status !== 200) { throw new AdministratorOverviewClientError("unavailable"); }
      const text = await response.text();
      if (text.length > maximumResponseBytes) {
        throw new AdministratorOverviewClientError("invalid_response");
      }
      let body: unknown;
      try { body = JSON.parse(text); }
      catch { throw new AdministratorOverviewClientError("invalid_response"); }
      return parseAdministratorOverview(body);
    },
  };
}
