// Reads and corrects the mapping between a name on the console and the person
// who was actually driving.

export const OBSERVED_IDENTITY_PATH = "/v1/administrator/tournament-identities";
export const OBSERVED_IDENTITY_ASSIGN_PATH =
  "/v1/administrator/tournament-identities/actions/assign";
export const OBSERVED_IDENTITY_RESTORE_PATH =
  "/v1/administrator/tournament-identities/actions/restore";
export const OBSERVED_IDENTITY_CSRF_PATH = "/v1/session/csrf";

export type ObservedIdentityLink = Readonly<{
  linkId: string;
  tournamentNumber: number;
  sectionId: string;
  sectionName: string;
  legacySectionLabel: string | null;
  observedName: string;
  playerId: string;
  playerName: string;
  decisionSource: "derived" | "manual";
  orderAgreement: number | null;
  videoPoints: number | null;
  historyPoints: number | null;
  note: string | null;
  placements: number;
}>;

export type ObservedIdentityPlayer = Readonly<{
  playerId: string;
  displayName: string;
  tournamentRaces: number;
}>;

export type ObservedIdentityOverview = Readonly<{
  links: readonly ObservedIdentityLink[];
  players: readonly ObservedIdentityPlayer[];
}>;

export type ObservedIdentityErrorCode =
  | "not_authorized" | "invalid_input" | "not_found"
  | "invalid_response" | "unavailable";

export class ObservedIdentityClientError extends Error {
  public readonly code: ObservedIdentityErrorCode;
  public constructor(code: ObservedIdentityErrorCode) {
    super(code);
    this.name = "ObservedIdentityClientError";
    this.code = code;
  }
}

export type ObservedIdentityClient = Readonly<{
  overview(signal?: AbortSignal): Promise<ObservedIdentityOverview>;
  assign(
    linkId: string, playerId: string, note: string | null,
    signal?: AbortSignal,
  ): Promise<void>;
  restore(linkId: string, signal?: AbortSignal): Promise<void>;
}>;

type FetchPort = typeof globalThis.fetch;

const MAXIMUM_BYTES = 2 * 1024 * 1024;

function statusToError(status: number): ObservedIdentityClientError {
  return new ObservedIdentityClientError(
    status === 403 ? "not_authorized"
      : status === 400 ? "invalid_input"
        : status === 404 ? "not_found" : "unavailable");
}

async function read(
  fetchPort: FetchPort, path: string, init: RequestInit,
): Promise<Readonly<{ status: number; body: unknown }>> {
  let response: Response;
  try {
    response = await fetchPort(path, {
      credentials: "same-origin", mode: "same-origin", redirect: "error",
      referrerPolicy: "same-origin", cache: "no-store", ...init,
    });
  } catch {
    throw new ObservedIdentityClientError("unavailable");
  }
  if (response.status === 204) { return { status: 204, body: null }; }
  const text = await response.text();
  if (text.length > MAXIMUM_BYTES) {
    throw new ObservedIdentityClientError("invalid_response");
  }
  let body: unknown = null;
  if (text.length > 0) {
    try { body = JSON.parse(text) as unknown; } catch { body = null; }
  }
  return { status: response.status, body };
}

export function createObservedIdentityClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): ObservedIdentityClient {
  let proof: Readonly<{ headerName: string; value: string }> | null = null;

  const csrf = async (
    signal?: AbortSignal, refresh = false,
  ): Promise<Readonly<{ headerName: string; value: string }>> => {
    if (proof !== null && !refresh) { return proof; }
    const answer = await read(fetchPort, OBSERVED_IDENTITY_CSRF_PATH, {
      method: "GET",
      headers: { Accept: "application/json" },
      ...(signal === undefined ? {} : { signal }),
    });
    const row = answer.body as Record<string, unknown> | null;
    if (answer.status !== 200 || row === null ||
      typeof row["headerName"] !== "string" ||
      typeof row["value"] !== "string") {
      throw statusToError(answer.status);
    }
    proof = { headerName: row["headerName"], value: row["value"] };
    return proof;
  };

  const post = async (
    path: string, payload: unknown, signal?: AbortSignal,
  ): Promise<void> => {
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
      if (answer.status === 204 || answer.status === 200) { return; }
      // A stale proof is worth one silent retry; anything else is the answer.
      if (answer.status === 403 && !refresh) { continue; }
      throw statusToError(answer.status);
    }
  };

  return {
    async overview(signal) {
      const answer = await read(fetchPort, OBSERVED_IDENTITY_PATH, {
        method: "GET",
        headers: { Accept: "application/json" },
        ...(signal === undefined ? {} : { signal }),
      });
      if (answer.status !== 200) { throw statusToError(answer.status); }
      const body = answer.body as Record<string, unknown> | null;
      if (body === null ||
        body["schemaVersion"] !== "mk8dx.administrator-tournament-identities.v1" ||
        !Array.isArray(body["links"]) || !Array.isArray(body["players"])) {
        throw new ObservedIdentityClientError("invalid_response");
      }
      return {
        links: body["links"] as readonly ObservedIdentityLink[],
        players: body["players"] as readonly ObservedIdentityPlayer[],
      };
    },
    async assign(linkId, playerId, note, signal) {
      await post(
        OBSERVED_IDENTITY_ASSIGN_PATH,
        note === null || note.length === 0
          ? { linkId, playerId }
          : { linkId, playerId, note },
        signal,
      );
    },
    async restore(linkId, signal) {
      await post(OBSERVED_IDENTITY_RESTORE_PATH, { linkId }, signal);
    },
  };
}
