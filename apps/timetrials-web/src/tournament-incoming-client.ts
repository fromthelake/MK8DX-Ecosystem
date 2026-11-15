import { TOURNAMENT_CSRF_PATH } from "./tournament-operation-client.js";

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

export type IncomingTournamentResult = Readonly<{
  incomingResultId: string;
  tournamentId: string;
  sourceKind: string;
  status: "pending" | "accepted" | "rejected" | "blocked";
  revision: number;
  result: Readonly<Record<string, unknown>>;
  suggestedPhase: string | null;
  suggestedGroupId: string | null;
  suggestedRaceNumber: number | null;
  occurredAtMs: number | null;
  capturedAtMs: number | null;
  duplicateWarning: boolean;
  evidenceRecordId: string | null;
  submittedByDisplayName: string | null;
  createdAtMs: number;
}>;

export type TournamentEvidenceRecord = Readonly<{
  recordId: string;
  clientRecordId: string;
  revision: number;
  status: "uploading" | "available" | "linked" | "blocked";
  sourceKind: string;
  uploadedBy: Readonly<{ userAccountId: string; displayName: string }>;
  startedAtMs: number | null;
  stoppedAtMs: number | null;
  analysisCompletedAtMs: number | null;
  complete: boolean;
  suggestedTournamentId: string | null;
  suggestedTournamentName: string | null;
  linkedTournamentId: string | null;
  groups: readonly Readonly<{
    observedGroupLabel: string;
    races: number;
    connectionErrors: number;
    topThree: readonly Readonly<{ observedPlayer: string; points: number }>[];
  }>[];
  resultCount: number;
  createdAtMs: number;
  updatedAtMs: number;
  live?: Readonly<{
    status: "requested" | "active" | "stopping" | "complete" | "invalidated";
    mappings: readonly Readonly<{ observedGroupLabel: string; groupId: string; phase: string }>[];
    approvedAtMs: number | null;
    stoppedAtMs: number | null;
    completedAtMs: number | null;
    /** The Director took the feed off the public view; only the Director reopens it. */
    withdrawnAtMs: number | null;
  }>;
}>;

export type PublicTournamentLiveGroup = Readonly<{
  recordId: string;
  groupId: string;
  phase: string;
  status: "live" | "stopping" | "ready_for_final_review";
  streamRevision: number;
  countedRaces: number;
  receivedRaces: number;
  lastReceivedAtMs: number;
  controlPoints: readonly string[];
  standings: readonly Readonly<{
    rank: number;
    observedPlayerName: string;
    total: number;
    participantReference: Readonly<{ namespace: string; value: string }>;
  }>[];
}>;

/** F05: a Director's time-limited, revocable permission for one account to run this night's live capture. */
export type TournamentLiveCaptureDelegation = Readonly<{
  delegationId: string;
  tournamentId: string;
  delegateUserAccountId: string;
  delegateDisplayName: string;
  status: "active" | "revoked";
  reason: string;
  grantedByUserAccountId: string;
  grantedAtMs: number;
  expiresAtMs: number;
  revokedByUserAccountId: string | null;
  revokeReason: string | null;
  revokedAtMs: number | null;
}>;

/** The capture-delegation durations a Director can pick; the API allows 5 minutes to 7 days. */
export const LIVE_CAPTURE_DELEGATION_DEFAULT_MINUTES = 720;
export const LIVE_CAPTURE_DELEGATION_MAXIMUM_MINUTES = 10_080;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid Tournament response.");
  return value as Record<string, unknown>;
}

// The capture-delegation documents are parsed strictly: an unknown or missing
// key is a contract drift between this client and the API's response schema
// (liveCaptureDelegationSchema in backend/api), not something to guess at.
function exact(value: Record<string, unknown>, keys: readonly string[], what = "capture-delegation response"): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`Invalid ${what}.`);
  }
}

/** A timestamp the API always sends: a number or null, nothing else. */
function nullableTimestamp(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid live evidence association.");
  }
  return value;
}

function liveCaptureDelegation(value: unknown): TournamentLiveCaptureDelegation {
  const row = record(value);
  exact(row, [
    "delegationId", "tournamentId", "delegateUserAccountId", "delegateDisplayName", "status", "reason",
    "grantedByUserAccountId", "grantedAtMs", "expiresAtMs", "revokedByUserAccountId", "revokeReason", "revokedAtMs",
  ]);
  const text = (key: string): string => {
    const candidate = row[key];
    if (typeof candidate !== "string" || candidate.length === 0) throw new Error("Invalid capture-delegation response.");
    return candidate;
  };
  const time = (key: string): number => {
    const candidate = row[key];
    if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < 0) {
      throw new Error("Invalid capture-delegation response.");
    }
    return candidate;
  };
  const optionalText = (key: string): string | null => row[key] === null ? null : text(key);
  if (row["status"] !== "active" && row["status"] !== "revoked") throw new Error("Invalid capture-delegation response.");
  return {
    delegationId: text("delegationId"),
    tournamentId: text("tournamentId"),
    delegateUserAccountId: text("delegateUserAccountId"),
    delegateDisplayName: text("delegateDisplayName"),
    status: row["status"],
    reason: text("reason"),
    grantedByUserAccountId: text("grantedByUserAccountId"),
    grantedAtMs: time("grantedAtMs"),
    expiresAtMs: time("expiresAtMs"),
    revokedByUserAccountId: optionalText("revokedByUserAccountId"),
    revokeReason: optionalText("revokeReason"),
    revokedAtMs: row["revokedAtMs"] === null ? null : time("revokedAtMs"),
  };
}

function incoming(value: unknown): IncomingTournamentResult {
  const row = record(value);
  const result = record(row["result"]);
  if (
    typeof row["incomingResultId"] !== "string"
    || typeof row["tournamentId"] !== "string"
    || typeof row["sourceKind"] !== "string"
    || !["pending", "accepted", "rejected", "blocked"].includes(String(row["status"]))
    || typeof row["revision"] !== "number"
    || typeof row["duplicateWarning"] !== "boolean"
    || typeof row["createdAtMs"] !== "number"
  ) throw new Error("Invalid incoming Tournament result.");
  return {
    incomingResultId: row["incomingResultId"],
    tournamentId: row["tournamentId"],
    sourceKind: row["sourceKind"],
    status: row["status"] as IncomingTournamentResult["status"],
    revision: row["revision"],
    result,
    suggestedPhase: typeof row["suggestedPhase"] === "string" ? row["suggestedPhase"] : null,
    suggestedGroupId: typeof row["suggestedGroupId"] === "string" ? row["suggestedGroupId"] : null,
    suggestedRaceNumber: typeof row["suggestedRaceNumber"] === "number" ? row["suggestedRaceNumber"] : null,
    occurredAtMs: typeof row["occurredAtMs"] === "number" ? row["occurredAtMs"] : null,
    capturedAtMs: typeof row["capturedAtMs"] === "number" ? row["capturedAtMs"] : null,
    duplicateWarning: row["duplicateWarning"],
    evidenceRecordId: typeof row["evidenceRecordId"] === "string" ? row["evidenceRecordId"] : null,
    submittedByDisplayName: typeof row["submittedByDisplayName"] === "string" ? row["submittedByDisplayName"] : null,
    createdAtMs: row["createdAtMs"],
  };
}

function evidence(value: unknown): TournamentEvidenceRecord {
  const row = record(value);
  const uploadedBy = record(row["uploadedBy"]);
  if (typeof row["recordId"] !== "string" || typeof row["clientRecordId"] !== "string" ||
      typeof row["revision"] !== "number" || !["uploading", "available", "linked", "blocked"].includes(String(row["status"])) ||
      typeof row["sourceKind"] !== "string" || typeof uploadedBy["userAccountId"] !== "string" ||
      typeof uploadedBy["displayName"] !== "string" || typeof row["complete"] !== "boolean" ||
      !Array.isArray(row["groups"]) || typeof row["resultCount"] !== "number" ||
      typeof row["createdAtMs"] !== "number" || typeof row["updatedAtMs"] !== "number") {
    throw new Error("Invalid Tournament evidence-record response.");
  }
  const groups = row["groups"].map((value) => {
    const group = record(value);
    if (typeof group["observedGroupLabel"] !== "string" || typeof group["races"] !== "number" ||
        typeof group["connectionErrors"] !== "number" || !Array.isArray(group["topThree"])) {
      throw new Error("Invalid evidence-record group summary.");
    }
    return {
      observedGroupLabel: group["observedGroupLabel"], races: group["races"], connectionErrors: group["connectionErrors"],
      topThree: group["topThree"].map((value) => {
        const score = record(value);
        if (typeof score["observedPlayer"] !== "string" || typeof score["points"] !== "number") {
          throw new Error("Invalid evidence-record top-three summary.");
        }
        return { observedPlayer: score["observedPlayer"], points: score["points"] };
      }),
    };
  });
  const timestamp = (name: string): number | null => typeof row[name] === "number" ? row[name] as number : null;
  let live: TournamentEvidenceRecord["live"];
  if (row["live"] !== undefined) {
    const liveRow = record(row["live"]);
    // Strict like the delegation documents: the keys are TournamentLiveAssociation in backend/api.
    exact(liveRow, ["status", "mappings", "approvedAtMs", "stoppedAtMs", "completedAtMs", "withdrawnAtMs"],
      "live evidence association");
    if (!["requested", "active", "stopping", "complete", "invalidated"].includes(String(liveRow["status"])) ||
        !Array.isArray(liveRow["mappings"])) throw new Error("Invalid live evidence association.");
    live = {
      status: liveRow["status"] as NonNullable<TournamentEvidenceRecord["live"]>["status"],
      mappings: liveRow["mappings"].map((value) => {
        const mapping = record(value);
        if (typeof mapping["observedGroupLabel"] !== "string" || typeof mapping["groupId"] !== "string" || typeof mapping["phase"] !== "string") {
          throw new Error("Invalid live feed mapping.");
        }
        return { observedGroupLabel: mapping["observedGroupLabel"], groupId: mapping["groupId"], phase: mapping["phase"] };
      }),
      approvedAtMs: nullableTimestamp(liveRow, "approvedAtMs"),
      stoppedAtMs: nullableTimestamp(liveRow, "stoppedAtMs"),
      completedAtMs: nullableTimestamp(liveRow, "completedAtMs"),
      withdrawnAtMs: nullableTimestamp(liveRow, "withdrawnAtMs"),
    };
  }
  return {
    recordId: row["recordId"], clientRecordId: row["clientRecordId"], revision: row["revision"],
    status: row["status"] as TournamentEvidenceRecord["status"], sourceKind: row["sourceKind"],
    uploadedBy: { userAccountId: uploadedBy["userAccountId"], displayName: uploadedBy["displayName"] },
    startedAtMs: timestamp("startedAtMs"), stoppedAtMs: timestamp("stoppedAtMs"),
    analysisCompletedAtMs: timestamp("analysisCompletedAtMs"), complete: row["complete"],
    suggestedTournamentId: typeof row["suggestedTournamentId"] === "string" ? row["suggestedTournamentId"] : null,
    suggestedTournamentName: typeof row["suggestedTournamentName"] === "string" ? row["suggestedTournamentName"] : null,
    linkedTournamentId: typeof row["linkedTournamentId"] === "string" ? row["linkedTournamentId"] : null,
    groups, resultCount: row["resultCount"], createdAtMs: row["createdAtMs"], updatedAtMs: row["updatedAtMs"],
    ...(live === undefined ? {} : { live }),
  };
}

function publicLiveGroup(value: unknown): PublicTournamentLiveGroup {
  const row = record(value);
  if (typeof row["recordId"] !== "string" || typeof row["groupId"] !== "string") {
    throw new Error("Invalid public live group response.");
  }
  if (typeof row["phase"] !== "string" || !["live", "stopping", "ready_for_final_review"].includes(String(row["status"])) ||
      typeof row["streamRevision"] !== "number" || typeof row["countedRaces"] !== "number" ||
      typeof row["receivedRaces"] !== "number" || typeof row["lastReceivedAtMs"] !== "number" ||
      !Array.isArray(row["controlPoints"]) || !row["controlPoints"].every((item) => typeof item === "string") ||
      !Array.isArray(row["standings"])) throw new Error("Invalid public live group response.");
  return {
    recordId: row["recordId"], groupId: row["groupId"], phase: row["phase"],
    status: row["status"] as PublicTournamentLiveGroup["status"], streamRevision: row["streamRevision"],
    countedRaces: row["countedRaces"], receivedRaces: row["receivedRaces"], lastReceivedAtMs: row["lastReceivedAtMs"],
    controlPoints: row["controlPoints"] as string[],
    standings: row["standings"].map((value) => {
      const standing = record(value); const reference = record(standing["participantReference"]);
      if (typeof standing["rank"] !== "number" || typeof standing["observedPlayerName"] !== "string" ||
          typeof standing["total"] !== "number" || typeof reference["namespace"] !== "string" || typeof reference["value"] !== "string") {
        throw new Error("Invalid public live standing.");
      }
      return { rank: standing["rank"], observedPlayerName: standing["observedPlayerName"], total: standing["total"],
        participantReference: { namespace: reference["namespace"], value: reference["value"] } };
    }),
  };
}

export class TournamentIncomingClient {
  public constructor(private readonly fetchPort: FetchPort = globalThis.fetch.bind(globalThis)) {}

  public async listPublicLive(tournamentId: string, signal?: AbortSignal): Promise<readonly PublicTournamentLiveGroup[]> {
    const response = await this.fetchPort(`/v1/public/tournaments/${encodeURIComponent(tournamentId)}/live-standings`, {
      method: "GET", headers: { Accept: "application/json" }, ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) throw new Error(`Live standings could not be loaded (${response.status}).`);
    const body = record(await response.json());
    if (body["schemaVersion"] !== "mk8dx.public-tournament-live-groups.v1" || !Array.isArray(body["groups"])) {
      throw new Error("Invalid public live-standings response.");
    }
    return body["groups"].map(publicLiveGroup);
  }

  public async list(tournamentId: string, signal?: AbortSignal): Promise<readonly IncomingTournamentResult[]> {
    const response = await this.fetchPort(`/v1/administrator/tournaments/${encodeURIComponent(tournamentId)}/incoming-results`, {
      method: "GET", credentials: "same-origin", headers: { Accept: "application/json" },
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) throw new Error(`Incoming results could not be loaded (${response.status}).`);
    const body = record(await response.json());
    if (!Array.isArray(body["results"])) throw new Error("Invalid incoming-results response.");
    return body["results"].map(incoming);
  }

  public async listEvidenceRecords(tournamentId: string, signal?: AbortSignal): Promise<readonly TournamentEvidenceRecord[]> {
    const response = await this.fetchPort(`/v1/administrator/tournaments/${encodeURIComponent(tournamentId)}/evidence-records`, {
      method: "GET", credentials: "same-origin", headers: { Accept: "application/json" },
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) throw new Error(`Evidence records could not be loaded (${response.status}).`);
    const body = record(await response.json());
    if (!Array.isArray(body["records"])) throw new Error("Invalid evidence-record response.");
    return body["records"].map(evidence);
  }

  public async linkEvidenceRecord(tournamentId: string, evidenceRecord: TournamentEvidenceRecord, mappings: readonly Readonly<{
    observedGroupLabel: string; groupId: string; phase: string;
  }>[], signal?: AbortSignal): Promise<readonly IncomingTournamentResult[]> {
    const value = await this.post(
      `/v1/administrator/tournaments/${encodeURIComponent(tournamentId)}/evidence-records/${encodeURIComponent(evidenceRecord.recordId)}/actions/link`,
      { expectedRevision: evidenceRecord.revision, mappings, reason: "Evidence record and group suggestions reviewed by Tournament director" },
      signal,
    );
    const body = record(value);
    if (!Array.isArray(body["results"])) throw new Error("Invalid linked evidence-record response.");
    return body["results"].map(incoming);
  }

  public async approveLiveAssociation(tournamentId: string, evidenceRecord: TournamentEvidenceRecord, mappings: readonly Readonly<{
    observedGroupLabel: string; groupId: string; phase: string;
  }>[], signal?: AbortSignal): Promise<TournamentEvidenceRecord> {
    const value = await this.post(
      `/v1/administrator/tournaments/${encodeURIComponent(tournamentId)}/evidence-records/${encodeURIComponent(evidenceRecord.recordId)}/actions/approve-live`,
      { expectedRevision: evidenceRecord.revision, mappings, reason: "Sticker names and live group routing checked by Tournament director" },
      signal,
    );
    return evidence(record(value)["record"]);
  }

  /** Retire a live request that never went public; the API answers the invalidated record. */
  public async dismissLiveRequest(tournamentId: string, evidenceRecord: TournamentEvidenceRecord, signal?: AbortSignal): Promise<TournamentEvidenceRecord> {
    const value = await this.post(
      `/v1/administrator/tournaments/${encodeURIComponent(tournamentId)}/evidence-records/${encodeURIComponent(evidenceRecord.recordId)}/actions/dismiss-live`,
      { expectedRevision: evidenceRecord.revision, reason: "Stale live request dismissed by Tournament director" },
      signal,
    );
    return evidence(record(value)["record"]);
  }

  /**
   * F05: take a public live feed back off the public view. Its evidence stays;
   * the feed returns to the Director's list and only the Director can open it again.
   */
  public async withdrawLiveAssociation(tournamentId: string, evidenceRecord: TournamentEvidenceRecord, signal?: AbortSignal): Promise<TournamentEvidenceRecord> {
    const value = await this.post(
      `/v1/administrator/tournaments/${encodeURIComponent(tournamentId)}/evidence-records/${encodeURIComponent(evidenceRecord.recordId)}/actions/withdraw-live`,
      { expectedRevision: evidenceRecord.revision, reason: "Live feed withdrawn by Tournament director" },
      signal,
    );
    return evidence(record(value)["record"]);
  }

  public async listLiveCaptureDelegations(tournamentId: string, signal?: AbortSignal): Promise<readonly TournamentLiveCaptureDelegation[]> {
    const response = await this.fetchPort(`/v1/administrator/tournaments/${encodeURIComponent(tournamentId)}/live-capture-delegations`, {
      method: "GET", credentials: "same-origin", headers: { Accept: "application/json" },
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) throw new Error(`Capture delegations could not be loaded (${response.status}).`);
    const body = record(await response.json());
    exact(body, ["delegations"]);
    if (!Array.isArray(body["delegations"])) throw new Error("Invalid capture-delegation response.");
    return body["delegations"].map(liveCaptureDelegation);
  }

  public async grantLiveCaptureDelegation(tournamentId: string, input: Readonly<{
    delegateUserAccountId: string;
    expiresInMinutes: number;
  }>, signal?: AbortSignal): Promise<TournamentLiveCaptureDelegation> {
    if (!/^user_account\.[A-Za-z0-9._-]{1,140}$/u.test(input.delegateUserAccountId)) {
      throw new Error("Choose an account to delegate live capture to.");
    }
    if (!Number.isSafeInteger(input.expiresInMinutes) || input.expiresInMinutes < 5 ||
        input.expiresInMinutes > LIVE_CAPTURE_DELEGATION_MAXIMUM_MINUTES) {
      throw new Error("A capture delegation lasts at most 7 days.");
    }
    const value = await this.post(
      `/v1/administrator/tournaments/${encodeURIComponent(tournamentId)}/live-capture-delegations`,
      { delegateUserAccountId: input.delegateUserAccountId, expiresInMinutes: input.expiresInMinutes,
        reason: "Live capture delegated by Tournament director" },
      signal,
    );
    const body = record(value);
    exact(body, ["delegation"]);
    return liveCaptureDelegation(body["delegation"]);
  }

  public async revokeLiveCaptureDelegation(tournamentId: string, delegationId: string, signal?: AbortSignal): Promise<TournamentLiveCaptureDelegation> {
    const value = await this.post(
      `/v1/administrator/tournaments/${encodeURIComponent(tournamentId)}/live-capture-delegations/${encodeURIComponent(delegationId)}/actions/revoke`,
      { reason: "Capture delegation revoked by Tournament director" },
      signal,
    );
    const body = record(value);
    exact(body, ["delegation"]);
    return liveCaptureDelegation(body["delegation"]);
  }

  public async reject(result: IncomingTournamentResult, reason: string, signal?: AbortSignal): Promise<void> {
    await this.post(`/v1/administrator/tournament-incoming-results/${encodeURIComponent(result.incomingResultId)}/actions/reject`, {
      expectedRevision: result.revision, reason,
    }, signal);
  }

  public async accept(result: IncomingTournamentResult, input: Readonly<{
    tournamentRevision: number;
    groupId: string;
    raceNumber: number;
    correctedResult: Readonly<Record<string, unknown>>;
    occurredAtMs?: number;
    reason: string;
  }>, signal?: AbortSignal): Promise<Readonly<{ raceResultId: string; tournamentRevision: number }>> {
    const value = await this.post(`/v1/administrator/tournament-incoming-results/${encodeURIComponent(result.incomingResultId)}/actions/accept`, {
      expectedRevision: result.revision, ...input,
    }, signal);
    const row = record(value);
    if (typeof row["raceResultId"] !== "string" || typeof row["tournamentRevision"] !== "number") {
      throw new Error("Invalid incoming-result acceptance response.");
    }
    return { raceResultId: row["raceResultId"], tournamentRevision: row["tournamentRevision"] };
  }

  public async acceptGroup(input: Readonly<{
    tournamentRevision: number;
    groupId: string;
    replaceExisting?: boolean;
    entries: readonly Readonly<{
      incomingResultId: string;
      expectedRevision: number;
      raceNumber: number;
      correctedResult: Readonly<Record<string, unknown>>;
      occurredAtMs?: number;
    }>[];
    reason: string;
  }>, signal?: AbortSignal): Promise<Readonly<{ raceResultIds: readonly string[]; tournamentRevision: number }>> {
    const value = await this.post("/v1/administrator/tournament-incoming-results/actions/accept-group", input, signal);
    const row = record(value);
    if (!Array.isArray(row["raceResultIds"]) || !row["raceResultIds"].every((id) => typeof id === "string") ||
        typeof row["tournamentRevision"] !== "number") {
      throw new Error("Invalid group-feed confirmation response.");
    }
    return { raceResultIds: row["raceResultIds"] as string[], tournamentRevision: row["tournamentRevision"] };
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const proofResponse = await this.fetchPort(TOURNAMENT_CSRF_PATH, {
      method: "GET", credentials: "same-origin", headers: { Accept: "application/json" },
      ...(signal === undefined ? {} : { signal }),
    });
    if (!proofResponse.ok) throw new Error("Request proof could not be loaded.");
    const proof = record(await proofResponse.json());
    if (typeof proof["headerName"] !== "string" || typeof proof["value"] !== "string") {
      throw new Error("Invalid request proof.");
    }
    const response = await this.fetchPort(path, {
      method: "POST", credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json", [proof["headerName"]]: proof["value"] },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null) as unknown;
      const message = errorBody === null ? "" : record(errorBody)["message"];
      throw new Error(typeof message === "string" ? message : `Request failed (${response.status}).`);
    }
    return response.json();
  }
}
