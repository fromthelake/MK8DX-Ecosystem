export const IDENTITY_LINKS_PATH = "/v1/administrator/identity-links";
export const IDENTITY_LINK_ACTION_PATH = "/v1/administrator/identity-links/actions/link";
export const IDENTITY_UNLINK_ACTION_PATH = "/v1/administrator/identity-links/actions/unlink";
export const IDENTITY_LINK_CSRF_PATH = "/v1/session/csrf";

const maximumResponseBytes = 262_144;

export type IdentityLinkAccount = Readonly<{
  userAccountId: string;
  email: string | null;
  accountStatus: string;
  screenName: string | null;
  linkedPlayerId: string | null;
  linkedPlayerName: string | null;
  playerClaimId: string | null;
}>;

export type IdentityLinkPlayer = Readonly<{
  playerId: string;
  displayName: string;
  username: string | null;
  timeTrials: number;
  tournamentRaces: number;
  linkedAccountId: string | null;
}>;

export type IdentityLinkOverview = Readonly<{
  accounts: readonly IdentityLinkAccount[];
  players: readonly IdentityLinkPlayer[];
}>;

export type IdentityLinkClientErrorCode =
  | "not_authorized" | "conflict" | "invalid_input" | "invalid_response" | "unavailable";

export class IdentityLinkClientError extends Error {
  public constructor(public readonly code: IdentityLinkClientErrorCode, message?: string) {
    super(message ?? code);
    this.name = "IdentityLinkClientError";
  }
}

export type FetchPort = typeof globalThis.fetch;

async function read(
  fetchPort: FetchPort, path: string, init: RequestInit,
): Promise<Readonly<{ status: number; body: unknown }>> {
  const response = await fetchPort(path, { credentials: "same-origin", ...init });
  const text = await response.text();
  if (text.length > maximumResponseBytes) {
    throw new IdentityLinkClientError("invalid_response");
  }
  let body: unknown = null;
  try { body = text.length === 0 ? null : JSON.parse(text); }
  catch { throw new IdentityLinkClientError("invalid_response"); }
  return { status: response.status, body };
}

function statusToError(status: number): IdentityLinkClientError {
  if (status === 401 || status === 403) { return new IdentityLinkClientError("not_authorized"); }
  if (status === 409) { return new IdentityLinkClientError("conflict"); }
  if (status === 400 || status === 404) { return new IdentityLinkClientError("invalid_input"); }
  return new IdentityLinkClientError("unavailable");
}

export interface IdentityLinkClient {
  overview(signal?: AbortSignal): Promise<IdentityLinkOverview>;
  link(userAccountId: string, playerId: string, signal?: AbortSignal): Promise<void>;
  unlink(userAccountId: string, signal?: AbortSignal): Promise<void>;
}

export function createIdentityLinkClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): IdentityLinkClient {
  // The proof is fetched once and reused; it only has to be refreshed when the
  // server says it is stale.
  let proof: Readonly<{ headerName: string; value: string }> | null = null;
  const csrf = async (signal?: AbortSignal, refresh = false) => {
    if (proof !== null && !refresh) { return proof; }
    const answer = await read(fetchPort, IDENTITY_LINK_CSRF_PATH, {
      method: "GET",
      headers: { Accept: "application/json" },
      ...(signal === undefined ? {} : { signal }),
    });
    if (answer.status !== 200 || typeof answer.body !== "object" || answer.body === null) {
      throw statusToError(answer.status);
    }
    const row = answer.body as Record<string, unknown>;
    if (typeof row["headerName"] !== "string" || typeof row["value"] !== "string") {
      throw new IdentityLinkClientError("invalid_response");
    }
    proof = { headerName: row["headerName"], value: row["value"] };
    return proof;
  };

  const post = async (path: string, payload: unknown, signal?: AbortSignal): Promise<void> => {
    for (const refresh of [false, true]) {
      const token = await csrf(signal, refresh);
      const answer = await read(fetchPort, path, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          [token.headerName]: token.value,
        },
        body: JSON.stringify(payload),
        ...(signal === undefined ? {} : { signal }),
      });
      if (answer.status === 200) { return; }
      // A stale proof is worth one silent retry; anything else is the answer.
      if (answer.status === 403 && !refresh) { continue; }
      throw statusToError(answer.status);
    }
  };

  return {
    async overview(signal) {
      const answer = await read(fetchPort, IDENTITY_LINKS_PATH, {
        method: "GET",
        headers: { Accept: "application/json" },
        ...(signal === undefined ? {} : { signal }),
      });
      if (answer.status !== 200) { throw statusToError(answer.status); }
      const body = answer.body as Record<string, unknown> | null;
      if (body === null || body["schemaVersion"] !== "mk8dx.administrator-identity-links.v1" ||
        !Array.isArray(body["accounts"]) || !Array.isArray(body["players"])) {
        throw new IdentityLinkClientError("invalid_response");
      }
      return {
        accounts: body["accounts"] as readonly IdentityLinkAccount[],
        players: body["players"] as readonly IdentityLinkPlayer[],
      };
    },
    async link(userAccountId, playerId, signal) {
      await post(IDENTITY_LINK_ACTION_PATH, { userAccountId, playerId }, signal);
    },
    async unlink(userAccountId, signal) {
      await post(IDENTITY_UNLINK_ACTION_PATH, { userAccountId }, signal);
    },
  };
}
