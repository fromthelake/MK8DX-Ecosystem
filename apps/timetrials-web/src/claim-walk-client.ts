/**
 * The claim walk of ADR-0216: the person's own claims with the conversation, the reviewer's cards,
 * and the actions on both sides. Responses are checked key for key, like every client here.
 */
import { forgetSharedPlayerClaims, PlayerClaimClientError } from "./player-claim-client.js";

export const CLAIM_WALK_PATH = "/v1/me/player-claim-walk";
export const CLAIM_REVIEWS_PATH = "/v1/player-claim-reviews";
const CSRF_PATH = "/v1/session/csrf";

const maximumResponseBytes = 262_144;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const claimIdPattern = /^player_claim\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const accountIdPattern = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const claimStatuses = ["requested", "under_review", "verified", "rejected", "released", "revoked"] as const;
const disputeStatuses = ["none", "open", "resolved"] as const;

export type ClaimStatus = typeof claimStatuses[number];
export type DisputeStatus = typeof disputeStatuses[number];
export type ClaimPlayerRef = Readonly<{ playerId: string; username: string; displayName: string }>;
export type ClaimNote = Readonly<{
  role: "requester" | "reviewer";
  kind: "request" | "question" | "reply" | "decision";
  body: string;
  authorName: string | null;
  createdAtMs: number;
}>;
export type ClaimDecision = Readonly<{
  decision: "verified" | "rejected" | "released" | "revoked";
  byRole: "requester" | "administrator" | "director";
  byName: string | null;
  reasonCode: string | null;
  decidedAtMs: number;
}>;
export type ClaimWalkItem = Readonly<{
  playerClaimId: string;
  player: ClaimPlayerRef;
  claimStatus: ClaimStatus;
  disputeStatus: DisputeStatus;
  requestedAtMs: number;
  updatedAtMs: number;
  reviewerDirectorNames: readonly string[];
  lastDecision: ClaimDecision | null;
  notes: readonly ClaimNote[];
}>;
export type ClaimReviewCard = Readonly<{
  playerClaimId: string;
  claimStatus: ClaimStatus;
  disputeStatus: DisputeStatus;
  requestedAtMs: number;
  updatedAtMs: number;
  reviewerRole: "administrator" | "director";
  requester: Readonly<{ userAccountId: string; accountCreatedAtMs: number; verifiedPlayers: readonly ClaimPlayerRef[] }>;
  player: ClaimPlayerRef & Readonly<{
    tournamentNights: number;
    lastNightName: string | null;
    lastNightDate: string | null;
    directorNames: readonly string[];
    conservativeRating: number | null;
    publishedTimeTrials: number;
    otherOpenClaims: number;
  }>;
  conflicts: Readonly<{ playerAlreadyLinked: boolean; sharedTournament: string | null }>;
  notes: readonly ClaimNote[];
}>;
export type LinkedClaimRow = Readonly<{
  playerClaimId: string;
  player: ClaimPlayerRef;
  accountPlayers: readonly ClaimPlayerRef[];
  linkedAtMs: number;
  reviewerRole: "administrator" | "director";
}>;
export type ClaimReviewQueue = Readonly<{ open: readonly ClaimReviewCard[]; linked: readonly LinkedClaimRow[] }>;

export type ReviewAction = "start_review" | "verify" | "reject" | "request_information" | "revoke" | "resolve_dispute";
export type RevokeReason = "linked_by_mistake" | "account_misuse" | "person_asked";

export interface ClaimWalkClient {
  listMine(signal?: AbortSignal): Promise<readonly ClaimWalkItem[]>;
  reply(playerClaimId: string, note: string, signal?: AbortSignal): Promise<void>;
  release(playerClaimId: string, note: string | undefined, signal?: AbortSignal): Promise<void>;
}

export interface ClaimReviewClient {
  listReviews(signal?: AbortSignal): Promise<ClaimReviewQueue>;
  review(
    playerClaimId: string,
    action: ReviewAction,
    options: Readonly<{ note?: string; reasonCode?: RevokeReason | "dispute_resolved" }>,
    signal?: AbortSignal,
  ): Promise<void>;
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

function fail(): never { throw new PlayerClaimClientError("invalid_response"); }

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) { fail(); }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) { fail(); }
}

function text(value: unknown, maximum: number, pattern?: RegExp): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum ||
    (pattern !== undefined && !pattern.test(value))) { fail(); }
  return value;
}

function nullableText(value: unknown, maximum: number): string | null {
  return value === null ? null : text(value, maximum);
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) { fail(); }
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) { fail(); }
  return value as T;
}

function list<T>(value: unknown, maximum: number, parse: (entry: unknown) => T): readonly T[] {
  if (!Array.isArray(value) || value.length > maximum) { fail(); }
  return value.map(parse);
}

function playerRef(value: unknown): ClaimPlayerRef {
  const row = object(value);
  exact(row, ["playerId", "username", "displayName"]);
  return {
    playerId: text(row["playerId"], 135, playerIdPattern),
    username: text(row["username"], 64),
    displayName: text(row["displayName"], 128),
  };
}

function note(value: unknown): ClaimNote {
  const row = object(value);
  exact(row, ["role", "kind", "body", "authorName", "createdAtMs"]);
  return {
    role: oneOf(row["role"], ["requester", "reviewer"] as const),
    kind: oneOf(row["kind"], ["request", "question", "reply", "decision"] as const),
    body: text(row["body"], 500),
    authorName: nullableText(row["authorName"], 128),
    createdAtMs: count(row["createdAtMs"]),
  };
}

function decision(value: unknown): ClaimDecision | null {
  if (value === null) { return null; }
  const row = object(value);
  exact(row, ["decision", "byRole", "byName", "reasonCode", "decidedAtMs"]);
  return {
    decision: oneOf(row["decision"], ["verified", "rejected", "released", "revoked"] as const),
    byRole: oneOf(row["byRole"], ["requester", "administrator", "director"] as const),
    byName: nullableText(row["byName"], 128),
    reasonCode: nullableText(row["reasonCode"], 64),
    decidedAtMs: count(row["decidedAtMs"]),
  };
}

function walkItem(value: unknown): ClaimWalkItem {
  const row = object(value);
  exact(row, [
    "playerClaimId", "player", "claimStatus", "disputeStatus", "requestedAtMs", "updatedAtMs",
    "reviewerDirectorNames", "lastDecision", "notes",
  ]);
  return {
    playerClaimId: text(row["playerClaimId"], 141, claimIdPattern),
    player: playerRef(row["player"]),
    claimStatus: oneOf(row["claimStatus"], claimStatuses),
    disputeStatus: oneOf(row["disputeStatus"], disputeStatuses),
    requestedAtMs: count(row["requestedAtMs"]),
    updatedAtMs: count(row["updatedAtMs"]),
    reviewerDirectorNames: list(row["reviewerDirectorNames"], 10, (entry) => text(entry, 128)),
    lastDecision: decision(row["lastDecision"]),
    notes: list(row["notes"], 50, note),
  };
}

function reviewCard(value: unknown): ClaimReviewCard {
  const row = object(value);
  exact(row, [
    "playerClaimId", "claimStatus", "disputeStatus", "requestedAtMs", "updatedAtMs", "reviewerRole",
    "requester", "player", "conflicts", "notes",
  ]);
  const requester = object(row["requester"]);
  exact(requester, ["userAccountId", "accountCreatedAtMs", "verifiedPlayers"]);
  const player = object(row["player"]);
  exact(player, [
    "playerId", "username", "displayName", "tournamentNights", "lastNightName", "lastNightDate",
    "directorNames", "conservativeRating", "publishedTimeTrials", "otherOpenClaims",
  ]);
  const conflicts = object(row["conflicts"]);
  exact(conflicts, ["playerAlreadyLinked", "sharedTournament"]);
  const rating = player["conservativeRating"];
  if (rating !== null && (typeof rating !== "number" || !Number.isFinite(rating))) { fail(); }
  if (typeof conflicts["playerAlreadyLinked"] !== "boolean") { fail(); }
  return {
    playerClaimId: text(row["playerClaimId"], 141, claimIdPattern),
    claimStatus: oneOf(row["claimStatus"], claimStatuses),
    disputeStatus: oneOf(row["disputeStatus"], disputeStatuses),
    requestedAtMs: count(row["requestedAtMs"]),
    updatedAtMs: count(row["updatedAtMs"]),
    reviewerRole: oneOf(row["reviewerRole"], ["administrator", "director"] as const),
    requester: {
      userAccountId: text(requester["userAccountId"], 141, accountIdPattern),
      accountCreatedAtMs: count(requester["accountCreatedAtMs"]),
      verifiedPlayers: list(requester["verifiedPlayers"], 10, playerRef),
    },
    player: {
      ...playerRef({ playerId: player["playerId"], username: player["username"], displayName: player["displayName"] }),
      tournamentNights: count(player["tournamentNights"]),
      lastNightName: nullableText(player["lastNightName"], 128),
      lastNightDate: nullableText(player["lastNightDate"], 10),
      directorNames: list(player["directorNames"], 10, (entry) => text(entry, 128)),
      conservativeRating: rating as number | null,
      publishedTimeTrials: count(player["publishedTimeTrials"]),
      otherOpenClaims: count(player["otherOpenClaims"]),
    },
    conflicts: {
      playerAlreadyLinked: conflicts["playerAlreadyLinked"],
      sharedTournament: nullableText(conflicts["sharedTournament"], 128),
    },
    notes: list(row["notes"], 50, note),
  };
}

function linkedRow(value: unknown): LinkedClaimRow {
  const row = object(value);
  exact(row, ["playerClaimId", "player", "accountPlayers", "linkedAtMs", "reviewerRole"]);
  return {
    playerClaimId: text(row["playerClaimId"], 141, claimIdPattern),
    player: playerRef(row["player"]),
    accountPlayers: list(row["accountPlayers"], 10, playerRef),
    linkedAtMs: count(row["linkedAtMs"]),
    reviewerRole: oneOf(row["reviewerRole"], ["administrator", "director"] as const),
  };
}

async function bounded(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!/^application\/json(?:\s*;|$)/.test(contentType)) { fail(); }
  const body = await response.text().catch(() => fail());
  if (body.length > maximumResponseBytes) { fail(); }
  try { return JSON.parse(body) as unknown; } catch { return fail(); }
}

function checkStatus(status: number): void {
  if (status === 401) { throw new PlayerClaimClientError("not_authenticated"); }
  if (status === 403) { throw new PlayerClaimClientError("not_authorized"); }
  if (status === 404 || status === 409) { throw new PlayerClaimClientError("conflict"); }
  if (status === 400) { throw new PlayerClaimClientError("invalid_input"); }
  if (status !== 200) { throw new PlayerClaimClientError(status >= 500 ? "unavailable" : "invalid_response"); }
}

export function createClaimWalkClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): ClaimWalkClient & ClaimReviewClient {
  const send = async (path: string, init: RequestInit): Promise<unknown> => {
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
    checkStatus(response.status);
    return bounded(response);
  };
  const get = (path: string, signal?: AbortSignal): Promise<unknown> => send(path, {
    method: "GET",
    headers: { Accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  const post = async (path: string, body: unknown, signal?: AbortSignal): Promise<void> => {
    forgetSharedPlayerClaims();
    const proof = object(await get(CSRF_PATH, signal));
    exact(proof, ["schemaVersion", "headerName", "value"]);
    if (proof["schemaVersion"] !== "mk8dx.web-csrf.v1") { fail(); }
    const headerName = text(proof["headerName"], 64, /^x-[a-z0-9-]{1,62}$/i);
    const value = text(proof["value"], 4096, /^[\x21-\x7e]+$/);
    await send(path, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", [headerName]: value },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    });
  };
  const claimPath = (playerClaimId: string, suffix: string): string => {
    if (!claimIdPattern.test(playerClaimId) || playerClaimId.length > 141) {
      throw new PlayerClaimClientError("invalid_input");
    }
    return `/v1/player-claims/${encodeURIComponent(playerClaimId)}/${suffix}`;
  };
  const cleanNote = (value: string | undefined): string | undefined => {
    const trimmed = value?.trim() ?? "";
    if (trimmed.length === 0) { return undefined; }
    if ([...trimmed].length > 500) { throw new PlayerClaimClientError("invalid_input"); }
    return trimmed;
  };
  return {
    async listMine(signal) {
      const root = object(await get(CLAIM_WALK_PATH, signal));
      exact(root, ["schemaVersion", "claims"]);
      if (root["schemaVersion"] !== "mk8dx.account-player-claim-walk.v1") { fail(); }
      return list(root["claims"], 20, walkItem);
    },
    async reply(playerClaimId, rawNote, signal) {
      const body = cleanNote(rawNote);
      if (body === undefined) { throw new PlayerClaimClientError("invalid_input"); }
      await post(claimPath(playerClaimId, "replies"), { note: body }, signal);
    },
    async release(playerClaimId, rawNote, signal) {
      const body = cleanNote(rawNote);
      await post(claimPath(playerClaimId, "release"), body === undefined ? {} : { note: body }, signal);
    },
    async listReviews(signal) {
      const root = object(await get(CLAIM_REVIEWS_PATH, signal));
      exact(root, ["schemaVersion", "open", "linked"]);
      if (root["schemaVersion"] !== "mk8dx.player-claim-review-queue.v1") { fail(); }
      return { open: list(root["open"], 50, reviewCard), linked: list(root["linked"], 300, linkedRow) };
    },
    async review(playerClaimId, action, options, signal) {
      const body = cleanNote(options.note);
      if (action === "request_information" && body === undefined) {
        throw new PlayerClaimClientError("invalid_input");
      }
      await post(claimPath(playerClaimId, "actions"), {
        action,
        evidenceIds: [],
        ...(options.reasonCode === undefined ? {} : { reasonCode: options.reasonCode }),
        ...(body === undefined ? {} : { note: body }),
      }, signal);
    },
  };
}
