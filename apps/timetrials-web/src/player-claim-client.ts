export const PLAYER_DIRECTORY_PATH = "/v1/player-directory";
export const PLAYER_CLAIMS_PATH = "/v1/me/player-claims";
export const PLAYER_CLAIM_REQUEST_PATH = "/v1/player-claims";
export const PLAYER_CLAIM_CSRF_PATH = "/v1/session/csrf";
export const OWN_PLAYER_PATH = "/v1/me/player";
export const ADMINISTRATOR_PLAYER_CLAIMS_PATH = "/v1/administrator/player-claims";
export const CLAIM_CANDIDATES_PATH = "/v1/me/claim-candidates";

const maximumResponseBytes = 65_536;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const claimIdPattern = /^player_claim\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const accountIdPattern = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const claimStatuses = new Set([
  "requested", "under_review", "verified", "rejected", "released", "revoked",
] as const);
const disputeStatuses = new Set(["none", "open", "resolved"] as const);
const reviewActions = new Set([
  "start_review", "verify", "reject", "resolve_dispute",
] as const);

export type ClaimStatus = "requested" | "under_review" | "verified" |
  "rejected" | "released" | "revoked";
export type DisputeStatus = "none" | "open" | "resolved";
export type ClaimablePlayerSummary = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
  /**
   * Public active aliases (`mk8dx.player-directory.v1`, migration 0049), so a
   * person can find themselves under an in-game handle. ADR-0006 still forbids
   * a name match from approving a claim or merging identities.
   */
  aliases: readonly string[];
}>;
export type AccountPlayerClaimSummary = Readonly<{
  playerClaimId: string;
  playerId: string;
  playerUsername: string;
  playerDisplayName: string;
  claimStatus: ClaimStatus;
  disputeStatus: DisputeStatus;
  updatedAtMs: number;
}>;
export type RequestedPlayerClaimSummary = Readonly<{
  playerClaimId: string;
  playerId: string;
  claimStatus: ClaimStatus;
  disputeStatus: DisputeStatus;
}>;

/**
 * ADR-0219: a Player a signed-in person may be, with the public context that
 * tells namesakes apart (`mk8dx.claim-candidates.v1`).
 */
export type ClaimCandidate = ClaimablePlayerSummary & Readonly<{
  claimed: boolean;
  /** The Player has what the person said they have (Time Trials, nights). */
  matchesAnswers: boolean;
  timeTrials: Readonly<{ times: number; lastAt: string | null; classes: readonly (150 | 200)[] }>;
  tournaments: Readonly<{
    nights: number;
    directorNames: readonly string[];
    lastNight: Readonly<{ name: string; date: string | null }> | null;
  }>;
}>;

export type ClaimCandidateQuery = Readonly<{ query: string; timeTrials: boolean; tournaments: boolean }>;

export type OwnPlayerCreatedSummary = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
  playerClaimId: string;
}>;

export class PlayerClaimClientError extends Error {
  public constructor(
    public readonly code:
      | "invalid_input"
      | "not_authenticated"
      | "not_authorized"
      | "conflict"
      | "username_taken"
      | "display_name_taken"
      | "already_linked"
      | "rate_limited"
      /** ADR-0221: the installation lets only Directors create Players. */
      | "creation_closed"
      | "unavailable"
      | "invalid_response",
  ) {
    super("The Player claim operation could not be completed.");
    this.name = "PlayerClaimClientError";
  }
}

export interface PlayerClaimClient {
  listMine(signal?: AbortSignal): Promise<readonly AccountPlayerClaimSummary[]>;
  listAll?(signal?: AbortSignal): Promise<readonly ClaimablePlayerSummary[]>;
  search(query: string, signal?: AbortSignal): Promise<readonly ClaimablePlayerSummary[]>;
  /** ADR-0219: candidates with public context, sorted by the person's two answers. */
  candidates?(input: ClaimCandidateQuery, signal?: AbortSignal): Promise<readonly ClaimCandidate[]>;
  /** `note` tells the reviewer how to recognise the person asking (ADR-0216). */
  request(playerId: string, signal?: AbortSignal, note?: string): Promise<RequestedPlayerClaimSummary>;
  createOwnPlayer(
    username: string,
    displayName?: string,
    signal?: AbortSignal,
  ): Promise<OwnPlayerCreatedSummary>;
}

export interface AdministratorPlayerClaimClient {
  listReviewQueue(signal?: AbortSignal): Promise<readonly AccountPlayerClaimSummary[]>;
  reviewAction(
    playerClaimId: string,
    action: "start_review" | "verify" | "reject" | "resolve_dispute",
    reasonCode: string,
    signal?: AbortSignal,
  ): Promise<RequestedPlayerClaimSummary>;
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PlayerClaimClientError("invalid_response");
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) {
    throw new PlayerClaimClientError("invalid_response");
  }
}

function text(value: unknown, maximum: number, pattern?: RegExp): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum ||
    (pattern !== undefined && !pattern.test(value))) {
    throw new PlayerClaimClientError("invalid_response");
  }
  return value;
}

function aliasList(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 32) {
    throw new PlayerClaimClientError("invalid_response");
  }
  return value.map((entry) => text(entry, 128));
}

function player(value: unknown): ClaimablePlayerSummary {
  const row = object(value);
  exact(row, ["playerId", "username", "displayName", "aliases"]);
  return {
    playerId: text(row["playerId"], 135, playerIdPattern),
    username: text(row["username"], 64),
    displayName: text(row["displayName"], 128),
    aliases: aliasList(row["aliases"]),
  };
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new PlayerClaimClientError("invalid_response");
  }
  return value;
}

function nullableDate(value: unknown): string | null {
  return value === null ? null : text(value, 10, datePattern);
}

function nameList(value: unknown, maximum: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new PlayerClaimClientError("invalid_response");
  }
  return value.map((entry) => text(entry, 128));
}

function candidateTimeTrials(value: unknown): ClaimCandidate["timeTrials"] {
  const row = object(value);
  exact(row, ["times", "lastAt", "classes"]);
  const classes: unknown = row["classes"];
  if (!Array.isArray(classes) || classes.length > 2 ||
    classes.some((entry) => entry !== 150 && entry !== 200)) {
    throw new PlayerClaimClientError("invalid_response");
  }
  return { times: count(row["times"]), lastAt: nullableDate(row["lastAt"]), classes: classes as (150 | 200)[] };
}

function candidateLastNight(value: unknown): ClaimCandidate["tournaments"]["lastNight"] {
  if (value === null) { return null; }
  const row = object(value);
  exact(row, ["name", "date"]);
  return { name: text(row["name"], 160), date: nullableDate(row["date"]) };
}

function candidateTournaments(value: unknown): ClaimCandidate["tournaments"] {
  const row = object(value);
  exact(row, ["nights", "directorNames", "lastNight"]);
  return {
    nights: count(row["nights"]),
    directorNames: nameList(row["directorNames"], 5),
    lastNight: candidateLastNight(row["lastNight"]),
  };
}

function claimCandidate(value: unknown): ClaimCandidate {
  const row = object(value);
  exact(row, ["playerId", "username", "displayName", "aliases", "claimed", "matchesAnswers", "timeTrials", "tournaments"]);
  const claimed = row["claimed"];
  const matchesAnswers = row["matchesAnswers"];
  if (typeof claimed !== "boolean" || typeof matchesAnswers !== "boolean") {
    throw new PlayerClaimClientError("invalid_response");
  }
  return {
    playerId: text(row["playerId"], 135, playerIdPattern),
    username: text(row["username"], 64),
    displayName: text(row["displayName"], 128),
    aliases: nameList(row["aliases"], 8),
    claimed,
    matchesAnswers,
    timeTrials: candidateTimeTrials(row["timeTrials"]),
    tournaments: candidateTournaments(row["tournaments"]),
  };
}

function claim(value: unknown): AccountPlayerClaimSummary {
  const row = object(value);
  exact(row, ["playerClaimId", "playerId", "playerUsername", "playerDisplayName",
    "claimStatus", "disputeStatus", "updatedAtMs"]);
  const claimStatus = row["claimStatus"];
  const disputeStatus = row["disputeStatus"];
  if (typeof claimStatus !== "string" || !claimStatuses.has(claimStatus as ClaimStatus) ||
    typeof disputeStatus !== "string" || !disputeStatuses.has(disputeStatus as DisputeStatus)) {
    throw new PlayerClaimClientError("invalid_response");
  }
  const updatedAtMs = row["updatedAtMs"];
  if (typeof updatedAtMs !== "number" || !Number.isSafeInteger(updatedAtMs) ||
    updatedAtMs < 0) {
    throw new PlayerClaimClientError("invalid_response");
  }
  return {
    playerClaimId: text(row["playerClaimId"], 141, claimIdPattern),
    playerId: text(row["playerId"], 135, playerIdPattern),
    playerUsername: text(row["playerUsername"], 64),
    playerDisplayName: text(row["playerDisplayName"], 128),
    claimStatus: claimStatus as ClaimStatus,
    disputeStatus: disputeStatus as DisputeStatus,
    updatedAtMs,
  };
}

function requestedClaim(value: unknown): RequestedPlayerClaimSummary {
  const row = object(value);
  exact(row, ["playerClaimId", "playerId", "userAccountId", "claimStatus",
    "disputeStatus", "revision", "lastSequence"]);
  const claimStatus = row["claimStatus"];
  const disputeStatus = row["disputeStatus"];
  if (typeof claimStatus !== "string" || !claimStatuses.has(claimStatus as ClaimStatus) ||
    typeof disputeStatus !== "string" || !disputeStatuses.has(disputeStatus as DisputeStatus)) {
    throw new PlayerClaimClientError("invalid_response");
  }
  text(row["userAccountId"], 141, accountIdPattern);
  for (const field of ["revision", "lastSequence"] as const) {
    if (typeof row[field] !== "number" || !Number.isSafeInteger(row[field]) ||
      row[field] < 1) {
      throw new PlayerClaimClientError("invalid_response");
    }
  }
  return {
    playerClaimId: text(row["playerClaimId"], 141, claimIdPattern),
    playerId: text(row["playerId"], 135, playerIdPattern),
    claimStatus: claimStatus as ClaimStatus,
    disputeStatus: disputeStatus as DisputeStatus,
  };
}

async function bounded(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const declared = response.headers.get("content-length");
  if (!/^application\/json(?:\s*;|$)/.test(contentType) || response.body === null ||
    (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > maximumResponseBytes))) {
    throw new PlayerClaimClientError("invalid_response");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let result = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) { break; }
      bytes += chunk.value.byteLength;
      if (bytes > maximumResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new PlayerClaimClientError("invalid_response");
      }
      result += decoder.decode(chunk.value, { stream: true });
    }
    result += decoder.decode();
    return JSON.parse(result) as unknown;
  } catch (error) {
    if (error instanceof PlayerClaimClientError) { throw error; }
    throw new PlayerClaimClientError("invalid_response");
  }
}

async function send(
  fetchPort: FetchPort,
  path: string,
  init: RequestInit,
): Promise<Readonly<{ status: number; body: unknown }>> {
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
    throw new PlayerClaimClientError("unavailable");
  }
  return { status: response.status, body: await bounded(response) };
}

function checkStatus(status: number, administrator = false): void {
  if (status === 401) {
    throw new PlayerClaimClientError("not_authenticated");
  }
  if (status === 403) {
    throw new PlayerClaimClientError(
      administrator ? "not_authorized" : "not_authenticated",
    );
  }
  if (status === 409) { throw new PlayerClaimClientError("conflict"); }
  if (status !== 200 && status !== 201) {
    throw new PlayerClaimClientError(status >= 500 ? "unavailable" : "invalid_response");
  }
}

function get(signal?: AbortSignal): RequestInit {
  return {
    method: "GET",
    headers: { Accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  };
}

async function csrfProof(
  fetchPort: FetchPort,
  signal?: AbortSignal,
): Promise<Readonly<{ headerName: string; value: string }>> {
  const response = await send(fetchPort, PLAYER_CLAIM_CSRF_PATH, get(signal));
  checkStatus(response.status);
  const proof = object(response.body);
  exact(proof, ["schemaVersion", "headerName", "value"]);
  if (proof["schemaVersion"] !== "mk8dx.web-csrf.v1" ||
    typeof proof["headerName"] !== "string" ||
    !/^x-[a-z0-9-]{1,62}$/i.test(proof["headerName"]) ||
    typeof proof["value"] !== "string" || proof["value"].length < 1 ||
    proof["value"].length > 4096 || !/^[\x21-\x7e]+$/.test(proof["value"])) {
    throw new PlayerClaimClientError("invalid_response");
  }
  return { headerName: proof["headerName"], value: proof["value"] };
}

/**
 * Which Players this account has claimed does not change while a page is being
 * built, but several sections ask for it independently while mounting. Measured
 * on a phone-width page against the mirror: Ranking, Compare and Activity each
 * fetched it twice within the same second, and the whole load already sits at
 * or above the 5-request-per-second-per-IP budget. One in-flight promise is
 * shared and its answer is reused; an explicit refresh drops it, and any error
 * is not cached at all.
 */
let sharedClaims: Promise<readonly AccountPlayerClaimSummary[]> | null = null;

/** Drop the shared answer after anything that can change the claim set. */
export function forgetSharedPlayerClaims(): void { sharedClaims = null; }

export function createPlayerClaimClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): PlayerClaimClient & AdministratorPlayerClaimClient {
  const fetchMine = async (signal?: AbortSignal): Promise<readonly AccountPlayerClaimSummary[]> => {
    const response = await send(fetchPort, PLAYER_CLAIMS_PATH, get(signal));
    checkStatus(response.status);
    const root = object(response.body);
    exact(root, ["schemaVersion", "claims"]);
    if (root["schemaVersion"] !== "mk8dx.account-player-claims.v1" ||
      !Array.isArray(root["claims"]) || root["claims"].length > 20) {
      throw new PlayerClaimClientError("invalid_response");
    }
    return root["claims"].map(claim);
  };
  return {
    async listMine() {
      if (sharedClaims === null) {
        // The abort signal of whichever section asked first must not cancel the
        // answer the others are waiting for, so the shared call carries none.
        sharedClaims = fetchMine().catch((error: unknown) => {
          sharedClaims = null;
          throw error;
        });
      }
      return sharedClaims;
    },
    async search(rawQuery, signal) {
      const query = rawQuery.trim();
      if (query.length < 2 || query.length > 64 || /[\u0000-\u001f\u007f]/.test(query)) {
        throw new PlayerClaimClientError("invalid_input");
      }
      const response = await send(
        fetchPort,
        `${PLAYER_DIRECTORY_PATH}?query=${encodeURIComponent(query)}`,
        get(signal),
      );
      checkStatus(response.status);
      const root = object(response.body);
      exact(root, ["schemaVersion", "players"]);
      if (root["schemaVersion"] !== "mk8dx.player-directory.v1" ||
        !Array.isArray(root["players"]) || root["players"].length > 20) {
        throw new PlayerClaimClientError("invalid_response");
      }
      return root["players"].map(player);
    },
    async listAll(signal) {
      const response = await send(fetchPort, PLAYER_DIRECTORY_PATH, get(signal));
      checkStatus(response.status);
      const root = object(response.body);
      exact(root, ["schemaVersion", "players"]);
      if (root["schemaVersion"] !== "mk8dx.player-directory.v1" ||
        !Array.isArray(root["players"]) || root["players"].length > 500) {
        throw new PlayerClaimClientError("invalid_response");
      }
      return root["players"].map(player);
    },
    async candidates(input, signal) {
      const query = input.query.trim();
      if (query.length < 2 || query.length > 64 || /[\u0000-\u001f\u007f]/.test(query)) {
        throw new PlayerClaimClientError("invalid_input");
      }
      const proof = await csrfProof(fetchPort, signal);
      const response = await send(fetchPort, CLAIM_CANDIDATES_PATH, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          [proof.headerName]: proof.value,
        },
        body: JSON.stringify({ query, timeTrials: input.timeTrials, tournaments: input.tournaments }),
        ...(signal === undefined ? {} : { signal }),
      });
      checkStatus(response.status);
      const root = object(response.body);
      exact(root, ["schemaVersion", "candidates"]);
      if (root["schemaVersion"] !== "mk8dx.claim-candidates.v1" ||
        !Array.isArray(root["candidates"]) || root["candidates"].length > 20) {
        throw new PlayerClaimClientError("invalid_response");
      }
      return root["candidates"].map(claimCandidate);
    },
    async request(playerId, signal, rawNote) {
      // Any change to the claim set invalidates the shared answer.
      forgetSharedPlayerClaims();
      const note = rawNote?.trim() ?? "";
      if (!playerIdPattern.test(playerId) || playerId.length > 135 || [...note].length > 500) {
        throw new PlayerClaimClientError("invalid_input");
      }
      const proof = await csrfProof(fetchPort, signal);
      const response = await send(fetchPort, PLAYER_CLAIM_REQUEST_PATH, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          [proof.headerName]: proof.value,
        },
        body: JSON.stringify({ playerId, evidenceIds: [], ...(note.length === 0 ? {} : { note }) }),
        ...(signal === undefined ? {} : { signal }),
      });
      checkStatus(response.status);
      return requestedClaim(response.body);
    },
    async createOwnPlayer(username, displayName, signal) {
      forgetSharedPlayerClaims();
      const trimmedDisplayName = displayName?.trim();
      if (!/^[a-z0-9_-]{3,16}$/.test(username) ||
        (trimmedDisplayName !== undefined && trimmedDisplayName.length > 0 &&
          (trimmedDisplayName.length > 64 ||
            /[\u0000-\u001f\u007f]/.test(trimmedDisplayName)))) {
        throw new PlayerClaimClientError("invalid_input");
      }
      const proof = await csrfProof(fetchPort, signal);
      const response = await send(fetchPort, OWN_PLAYER_PATH, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          [proof.headerName]: proof.value,
        },
        body: JSON.stringify({
          username,
          ...(trimmedDisplayName === undefined || trimmedDisplayName.length === 0
            ? {}
            : { displayName: trimmedDisplayName }),
        }),
        ...(signal === undefined ? {} : { signal }),
      });
      if (response.status === 409) {
        const body = object(response.body);
        const code = body["code"];
        if (code === "username_taken" || code === "display_name_taken") {
          throw new PlayerClaimClientError(code);
        }
        if (code === "player_already_linked") {
          throw new PlayerClaimClientError("already_linked");
        }
        throw new PlayerClaimClientError("conflict");
      }
      if (response.status === 429) {
        throw new PlayerClaimClientError("rate_limited");
      }
      if (response.status === 403) {
        const body = response.body;
        if (typeof body === "object" && body !== null && (body as Record<string, unknown>)["code"] === "player_creation_self_disabled") {
          throw new PlayerClaimClientError("creation_closed");
        }
      }
      checkStatus(response.status);
      const root = object(response.body);
      exact(root, [
        "schemaVersion", "playerId", "username", "displayName", "playerClaimId",
      ]);
      if (root["schemaVersion"] !== "mk8dx.own-player-created.v1") {
        throw new PlayerClaimClientError("invalid_response");
      }
      return {
        playerId: text(root["playerId"], 135, playerIdPattern),
        username: text(root["username"], 16),
        displayName: text(root["displayName"], 64),
        playerClaimId: text(root["playerClaimId"], 141, claimIdPattern),
      };
    },
    async listReviewQueue(signal) {
      const response = await send(
        fetchPort,
        ADMINISTRATOR_PLAYER_CLAIMS_PATH,
        get(signal),
      );
      checkStatus(response.status, true);
      const root = object(response.body);
      exact(root, ["schemaVersion", "claims"]);
      if (root["schemaVersion"] !== "mk8dx.administrator-player-claim-queue.v1" ||
        !Array.isArray(root["claims"]) || root["claims"].length > 50) {
        throw new PlayerClaimClientError("invalid_response");
      }
      return root["claims"].map(claim);
    },
    async reviewAction(playerClaimId, action, reasonCode, signal) {
      forgetSharedPlayerClaims();
      if (!claimIdPattern.test(playerClaimId) || playerClaimId.length > 141 ||
        !reviewActions.has(action) ||
        !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(reasonCode) ||
        reasonCode.length > 64) {
        throw new PlayerClaimClientError("invalid_input");
      }
      const proof = await csrfProof(fetchPort, signal);
      const response = await send(
        fetchPort,
        `/v1/player-claims/${encodeURIComponent(playerClaimId)}/actions`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            [proof.headerName]: proof.value,
          },
          body: JSON.stringify({ action, evidenceIds: [], reasonCode }),
          ...(signal === undefined ? {} : { signal }),
        },
      );
      checkStatus(response.status, true);
      return requestedClaim(response.body);
    },
  };
}
