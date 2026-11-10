import { createHash, randomUUID } from "node:crypto";

import type { ActorContext } from "../identity/types.js";
import {
  type TournamentRaceResultV1,
  validateTournamentRaceResult,
} from "./race-result-validation.js";
import {
  directTournamentAcceptUnitOfWork,
  type TournamentAcceptUnitOfWork,
} from "./tournament-accept-unit-of-work.js";
import { TournamentResultServiceError } from "./race-result-service.js";
import { TournamentOperationError } from "./tournament-operation-service.js";

export type IncomingResultStatus = "pending" | "accepted" | "rejected" | "blocked";

export interface ConnectedTournamentSummary {
  tournamentId: string;
  name: string;
  seriesLabel: string | null;
  editionNumber: number | null;
  startAtMs: number | null;
  timezone: string | null;
  stage: string;
  workflowStep: number;
  groups: readonly { groupId: string; name: string; phase: string }[];
}

export interface TournamentEvidenceGroupSummary {
  observedGroupLabel: string;
  races: number;
  connectionErrors: number;
  topThree: readonly { observedPlayer: string; points: number }[];
}

export interface TournamentEvidenceRecord {
  recordId: string;
  clientRecordId: string;
  revision: number;
  status: "uploading" | "available" | "linked" | "blocked";
  sourceKind: string;
  uploadedBy: { userAccountId: string; displayName: string };
  startedAtMs: number | null;
  stoppedAtMs: number | null;
  analysisCompletedAtMs: number | null;
  complete: boolean;
  suggestedTournamentId: string | null;
  suggestedTournamentName: string | null;
  linkedTournamentId: string | null;
  groups: readonly TournamentEvidenceGroupSummary[];
  resultCount: number;
  createdAtMs: number;
  updatedAtMs: number;
  live?: TournamentLiveAssociation;
}

export interface TournamentEvidenceEntry {
  entryKey: string;
  result: TournamentRaceResultV1;
  observedGroupLabel: string;
  suggestedPhase: string | null;
  suggestedGroupId: string | null;
  suggestedRaceNumber: number | null;
  occurredAtMs: number | null;
}

export type TournamentLiveStatus = "requested" | "active" | "stopping" | "complete" | "invalidated";

export interface TournamentLiveMapping {
  observedGroupLabel: string;
  groupId: string;
  phase: string;
}

export interface TournamentGroupMatchIdentity {
  playerId: string;
  names: readonly string[];
}

export interface TournamentLiveRosterMatch {
  matchedPlayers: number;
  comparablePlayers: number;
  confidence: number;
  sufficient: boolean;
}

export interface TournamentLiveAssociation {
  status: TournamentLiveStatus;
  mappings: readonly TournamentLiveMapping[];
  approvedAtMs: number | null;
  stoppedAtMs: number | null;
  completedAtMs: number | null;
}

export interface PublicTournamentLiveGroup {
  recordId: string;
  groupId: string;
  phase: string;
  status: "live" | "stopping" | "ready_for_final_review";
  streamRevision: number;
  countedRaces: number;
  receivedRaces: number;
  lastReceivedAtMs: number;
  controlPoints: readonly string[];
  standings: readonly {
    rank: number;
    observedPlayerName: string;
    total: number;
    participantReference: { namespace: string; value: string };
  }[];
}

export interface StoredTournamentEvidenceRecord extends TournamentEvidenceRecord {
  entries: readonly TournamentEvidenceEntry[];
}

/**
 * Project the latest immutable evidence snapshot without resolving in-game
 * names to Players. `totalAfterRace` carries opening balances, resets and
 * excluded-race semantics from the canonical producer; using the latest value
 * per stable local participant avoids re-summing either old revisions or
 * races which do not count.
 */
export function projectTournamentLiveGroups(
  record: StoredTournamentEvidenceRecord,
): readonly PublicTournamentLiveGroup[] {
  const live = record.live;
  if (live === undefined || !["active", "stopping", "complete"].includes(live.status)) return [];
  const status = live.status === "active" ? "live"
    : live.status === "stopping" ? "stopping" : "ready_for_final_review";
  return live.mappings.map((mapping) => {
    const currentByRace = new Map<string, TournamentEvidenceEntry>();
    for (const entry of record.entries.filter((item) => item.observedGroupLabel === mapping.observedGroupLabel)) {
      const key = entry.result.raceResultId;
      const current = currentByRace.get(key);
      if (current === undefined || entry.result.revision > current.result.revision || (
        entry.result.revision === current.result.revision && entry.entryKey.localeCompare(current.entryKey) > 0
      )) currentByRace.set(key, entry);
    }
    const races = [...currentByRace.values()].sort((left, right) =>
      left.result.raceNumber - right.result.raceNumber ||
      left.result.scoringSegment - right.result.scoringSegment ||
      left.entryKey.localeCompare(right.entryKey));
    const latest = new Map<string, {
      observedPlayerName: string;
      total: number;
      participantReference: { namespace: string; value: string };
    }>();
    let resets = 0;
    let excluded = 0;
    let uncertain = 0;
    let lastReceivedAtMs = record.updatedAtMs;
    for (const entry of races) {
      resets = Math.max(resets, entry.result.scoringSegment - 1);
      if (!entry.result.countsTowardStandings) excluded += 1;
      if (entry.result.verification?.status !== "producer_check_passed") uncertain += 1;
      lastReceivedAtMs = Math.max(
        lastReceivedAtMs,
        entry.occurredAtMs ?? entry.result.timestamps.capturedAtMs ??
          entry.result.timestamps.occurredAtMs ?? entry.result.timestamps.createdAtMs,
      );
      for (const placement of entry.result.placements) {
        const reference = placement.participantReference;
        // An unresolved observation is one sighting (race + position), not a participant
        // (TournamentRaceResultV1); Live sends a new one every race. Within one group's
        // stream the observed name is what stays stable until the director resolves it.
        const observedName = placement.observedPlayerName?.trim();
        const key = reference.namespace === "unresolved_observation" && observedName
          ? `observed:${observedName.toLocaleLowerCase("en")}`
          : `${reference.namespace}:${reference.value}`;
        latest.set(key, {
          observedPlayerName: placement.observedPlayerName?.trim() || reference.value,
          total: placement.scoring.totalAfterRace,
          participantReference: { namespace: reference.namespace, value: reference.value },
        });
      }
    }
    const ordered = [...latest.values()].sort((left, right) =>
      right.total - left.total || left.observedPlayerName.localeCompare(right.observedPlayerName));
    let previousTotal: number | null = null;
    let previousRank = 0;
    const standings = ordered.map((row, index) => {
      const rank = previousTotal === row.total ? previousRank : index + 1;
      previousTotal = row.total;
      previousRank = rank;
      return { rank, ...row };
    });
    const controlPoints = [
      ...(resets > 0 ? [`${resets} connection reset${resets === 1 ? "" : "s"}`] : []),
      ...(excluded > 0 ? [`${excluded} excluded race${excluded === 1 ? "" : "s"}`] : []),
      ...(uncertain > 0 ? [`${uncertain} race${uncertain === 1 ? "" : "s"} awaiting recognition review`] : []),
    ];
    return {
      recordId: record.recordId,
      groupId: mapping.groupId,
      phase: mapping.phase,
      status,
      streamRevision: record.revision,
      countedRaces: races.filter((entry) => entry.result.countsTowardStandings).length,
      receivedRaces: races.length,
      lastReceivedAtMs,
      controlPoints,
      standings,
    };
  });
}

export interface IncomingTournamentResult {
  incomingResultId: string;
  tournamentId: string;
  sourceKind: string;
  status: IncomingResultStatus;
  revision: number;
  result: TournamentRaceResultV1;
  semanticFingerprint: string;
  suggestedPhase: string | null;
  suggestedGroupId: string | null;
  suggestedRaceNumber: number | null;
  occurredAtMs: number | null;
  capturedAtMs: number | null;
  duplicateWarning: boolean;
  evidenceRecordId: string | null;
  submittedByDisplayName: string | null;
  createdAtMs: number;
}

export interface TournamentConnectedRepository {
  listEligibleTournaments(userAccountId: string): Promise<readonly ConnectedTournamentSummary[]>;
  findActiveTournamentInternalId(tournamentId: string): Promise<number | null>;
  canReviewTournament(tournamentId: string, userAccountId: string, administrator: boolean): Promise<boolean>;
  upsertEvidenceRecord(input: {
    recordId: string;
    clientRecordId: string;
    sourceKind: string;
    entries: readonly TournamentEvidenceEntry[];
    summary: readonly TournamentEvidenceGroupSummary[];
    contentSha256: string;
    suggestedTournamentId: string | null;
    uploadedByUserAccountId: string;
    startedAtMs: number | null;
    stoppedAtMs: number | null;
    analysisCompletedAtMs: number | null;
    complete: boolean;
    liveRegistration: {
      mappings: readonly TournamentLiveMapping[];
    } | null;
    nowMs: number;
  }): Promise<TournamentEvidenceRecord>;
  listOwnEvidenceRecords(userAccountId: string): Promise<readonly TournamentEvidenceRecord[]>;
  listEvidenceRecordsForTournament(tournamentId: string): Promise<readonly TournamentEvidenceRecord[]>;
  findEvidenceRecord(recordId: string): Promise<StoredTournamentEvidenceRecord | null>;
  approveLiveAssociation(input: {
    recordId: string;
    expectedRevision: number;
    tournamentId: string;
    reviewedByUserAccountId: string;
    mappings: readonly TournamentLiveMapping[];
    reason: string;
    authorization?: "director" | "roster_match";
    nowMs: number;
  }): Promise<TournamentEvidenceRecord>;
  markOwnEvidenceStopping(input: {
    recordId: string;
    uploadedByUserAccountId: string;
    nowMs: number;
  }): Promise<TournamentEvidenceRecord>;
  listPublicLiveRecords(tournamentId: string): Promise<readonly StoredTournamentEvidenceRecord[]>;
  materializeEvidenceRecord(input: {
    recordId: string;
    expectedRevision: number;
    tournamentId: string;
    reviewedByUserAccountId: string;
    mappings: readonly { observedGroupLabel: string; groupId: string; phase: string }[];
    entries: readonly (TournamentEvidenceEntry & { semanticFingerprint: string })[];
    reason: string;
    nowMs: number;
  }): Promise<readonly IncomingTournamentResult[]>;
  insertIncomingResult(input: {
    incomingResultId: string;
    tournamentInternalId: number;
    sourceKind: string;
    result: TournamentRaceResultV1;
    semanticFingerprint: string;
    suggestedPhase: string | null;
    suggestedGroupId: string | null;
    suggestedRaceNumber: number | null;
    occurredAtMs: number | null;
    capturedAtMs: number | null;
    submittedByUserAccountId: string;
    nowMs: number;
  }): Promise<IncomingTournamentResult>;
  listIncomingResults(tournamentId: string): Promise<readonly IncomingTournamentResult[]>;
  findIncomingResult(incomingResultId: string): Promise<IncomingTournamentResult | null>;
  findIncomingByFingerprint(tournamentId: string, fingerprint: string): Promise<IncomingTournamentResult | null>;
  hasAcceptedFingerprint(tournamentId: string, fingerprint: string, excludingId: string): Promise<boolean>;
  hasGroupRace(tournamentId: string, groupId: string, raceNumber: number): Promise<boolean>;
  /**
   * The Players seated in a group. Accept refuses a race listing anyone else,
   * and knowing that before the first canonical write turns a rollback into
   * never having written at all.
   */
  groupMemberPlayerIds(tournamentId: string, groupId: string): Promise<readonly string[]>;
  groupMemberMatchNames?(
    tournamentId: string,
    groupId: string,
  ): Promise<readonly TournamentGroupMatchIdentity[]>;
  markAccepted(input: {
    incomingResultId: string;
    expectedRevision: number;
    raceResultId: string;
    reviewReason: string;
    reviewedByUserAccountId: string;
    nowMs: number;
  }): Promise<void>;
  markRejected(input: {
    incomingResultId: string;
    expectedRevision: number;
    reviewReason: string;
    reviewedByUserAccountId: string;
    nowMs: number;
  }): Promise<void>;
}

export interface ConnectedRaceResultService {
  submit(result: TournamentRaceResultV1): Promise<{ raceResultId: string }>;
}

export interface ConnectedTournamentOperationService {
  attachRaces(
    actor: ActorContext,
    tournamentId: string,
    input: { expectedRevision: number; groupId: string; raceResultIds: readonly string[]; occurredAtMs?: number; replaceExisting?: boolean },
  ): Promise<{ summary: { revision: number } }>;
}

/**
 * Accept composes the race-result service, which speaks its own error
 * vocabulary. Left alone, a `revision_conflict` - which is what a race result
 * id that is already taken looks like - escaped the Tournament error contract
 * entirely and reached the client as an unexplained 500. These are ordinary
 * review conflicts and are reported as such; anything genuinely unexpected
 * still travels untouched, because turning infrastructure failures into 4xx
 * would be a different lie.
 */
async function acceptConflicts<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof TournamentResultServiceError) {
      if (error.code === "revision_conflict") {
        throw new TournamentOperationError(
          "conflict",
          "This contribution's race result already exists. Review or revise the existing race instead.",
        );
      }
      if (error.code === "player_not_found") {
        throw new TournamentOperationError(
          "conflict",
          "an imported race lists a Player who is not a member of this group",
        );
      }
      if (error.code === "invalid_assets") {
        throw new TournamentOperationError(
          "invalid_input",
          "The reviewed race references assets this installation does not know.",
        );
      }
    }
    throw error;
  }
}

function requireSignedIn(actor: ActorContext): string {
  if (actor.role !== "administrator" && actor.role !== "account") {
    throw new TournamentOperationError("forbidden", "A signed-in account is required.");
  }
  return actor.userAccountId;
}

function normalizedParticipantIdentity(result: TournamentRaceResultV1): readonly string[] {
  return [...result.placements]
    .sort((left, right) => left.finishPosition - right.finishPosition)
    .map((placement) => {
      const reference = placement.participantReference;
      return `${placement.finishPosition}:${reference.namespace}:${reference.value.trim().toLocaleLowerCase("en-US")}`;
    });
}

export function semanticFingerprint(result: TournamentRaceResultV1, phase: string | null, groupId: string | null, raceNumber: number | null): string {
  return createHash("sha256")
    .update(JSON.stringify({
      phase: phase?.trim().toLocaleLowerCase("en-US") ?? null,
      groupId: groupId?.trim().toLocaleLowerCase("en-US") ?? null,
      raceNumber: raceNumber ?? result.raceNumber,
      trackId: result.trackId,
      placements: normalizedParticipantIdentity(result),
    }))
    .digest("hex");
}

function optionalTimestamp(value: number | null | undefined, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > 253_402_300_799_999) {
    throw new TournamentOperationError("invalid_input", `${name} is not a valid timestamp.`);
  }
  return value;
}

function boundedText(value: unknown, name: string, maximum: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < 1 || text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new TournamentOperationError("invalid_input", `${name} is invalid.`);
  }
  return text;
}

function normalizedRosterName(value: string): string {
  return value.normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase("nl-NL")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

export function liveRosterMatch(
  entries: readonly TournamentEvidenceEntry[],
  identities: readonly TournamentGroupMatchIdentity[],
): TournamentLiveRosterMatch {
  const ownersByName = new Map<string, Set<string>>();
  for (const identity of identities) {
    for (const name of identity.names) {
      const key = normalizedRosterName(name);
      if (!key) continue;
      const owners = ownersByName.get(key) ?? new Set<string>();
      owners.add(identity.playerId);
      ownersByName.set(key, owners);
    }
  }
  const observedNames = new Set<string>();
  const matchedPlayers = new Set<string>();
  for (const entry of entries) {
    for (const placement of entry.result.placements) {
      const observed = placement.observedPlayerName?.trim();
      const key = observed ? normalizedRosterName(observed) : "";
      if (!key) continue;
      observedNames.add(key);
      const owners = ownersByName.get(key);
      if (owners?.size === 1) matchedPlayers.add([...owners][0]!);
    }
  }
  const comparablePlayers = Math.min(identities.length, observedNames.size);
  const confidence = comparablePlayers > 0 ? matchedPlayers.size / comparablePlayers : 0;
  return {
    matchedPlayers: matchedPlayers.size,
    comparablePlayers,
    confidence,
    sufficient: matchedPlayers.size >= 3 && comparablePlayers >= 3 && confidence >= 0.6,
  };
}

function evidenceSummary(entries: readonly TournamentEvidenceEntry[]): readonly TournamentEvidenceGroupSummary[] {
  const groups = new Map<string, { races: Set<string>; resets: number; totals: Map<string, number> }>();
  for (const entry of entries) {
    const summary = groups.get(entry.observedGroupLabel) ?? { races: new Set<string>(), resets: 0, totals: new Map<string, number>() };
    summary.races.add(entry.entryKey);
    summary.resets = Math.max(summary.resets, Math.max(0, entry.result.scoringSegment - 1));
    for (const placement of entry.result.placements) {
      const observedName = (placement as typeof placement & { observedPlayerName?: string }).observedPlayerName;
      const observed = observedName?.trim() || placement.participantReference.value.trim() || "Unknown Player";
      summary.totals.set(observed, (summary.totals.get(observed) ?? 0) + placement.scoring.racePoints);
    }
    groups.set(entry.observedGroupLabel, summary);
  }
  return [...groups.entries()].map(([observedGroupLabel, value]) => ({
    observedGroupLabel,
    races: value.races.size,
    connectionErrors: value.resets,
    topThree: [...value.totals.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 3)
      .map(([observedPlayer, points]) => ({ observedPlayer, points })),
  })).sort((left, right) => left.observedGroupLabel.localeCompare(right.observedGroupLabel));
}

export class TournamentConnectedService {
  /**
   * Every canonical write an Accept performs runs inside `acceptUnitOfWork`.
   * Production wires the MySQL implementation, which is what makes Accept
   * all-or-nothing; the default is the direct scope, which is honest about
   * holding no transaction and exists for tests built on synthetic doubles.
   */
  private readonly acceptUnitOfWork: TournamentAcceptUnitOfWork;

  public constructor(
    private readonly repository: TournamentConnectedRepository,
    raceResults: ConnectedRaceResultService,
    operations: ConnectedTournamentOperationService,
    private readonly now: () => number = Date.now,
    acceptUnitOfWork?: TournamentAcceptUnitOfWork,
    private readonly hasOperatorCapability: (userAccountId: string) => Promise<boolean> = async () => false,
  ) {
    this.acceptUnitOfWork = acceptUnitOfWork ?? directTournamentAcceptUnitOfWork({
      repository, raceResults, operations,
    });
  }

  /**
   * The refusal that used to arrive only after the race result had been
   * written: a race may list only Players seated in the group it is attached
   * to. Checking it here means a mistaken mapping never reaches a canonical
   * write at all. The transaction still protects everything that follows.
   */
  private async assertPlacementsAreMembers(
    tournamentId: string,
    groupId: string,
    results: readonly TournamentRaceResultV1[],
  ): Promise<void> {
    const members = new Set(
      await this.repository.groupMemberPlayerIds(tournamentId, groupId),
    );
    for (const result of results) {
      for (const placement of result.placements) {
        const reference = placement.participantReference;
        if (reference.namespace !== "player" || !members.has(reference.value)) {
          throw new TournamentOperationError(
            "conflict",
            "an imported race lists a Player who is not a member of this group",
          );
        }
      }
    }
  }

  public async listEligible(actor: ActorContext): Promise<readonly ConnectedTournamentSummary[]> {
    const userAccountId = requireSignedIn(actor);
    return this.repository.listEligibleTournaments(userAccountId);
  }

  public async uploadEvidenceRecord(actor: ActorContext, input: {
    clientRecordId: string;
    sourceKind?: TournamentRaceResultV1["source"]["kind"];
    liveMappings?: readonly {
      observedGroupLabel: string;
      groupId: string;
      phase: string;
    }[];
    suggestedTournamentId?: string;
    startedAtMs?: number;
    stoppedAtMs?: number;
    analysisCompletedAtMs?: number;
    complete: boolean;
    entries: readonly {
      entryKey: string;
      result: unknown;
      observedGroupLabel: string;
      suggestedPhase?: string;
      suggestedGroupId?: string;
      suggestedRaceNumber?: number;
      occurredAtMs?: number;
    }[];
  }): Promise<TournamentEvidenceRecord> {
    const userAccountId = requireSignedIn(actor);
    const clientRecordId = boundedText(input.clientRecordId, "clientRecordId", 160);
    const liveMappings = (input.liveMappings ?? []).map((mapping) => ({
      observedGroupLabel: boundedText(mapping.observedGroupLabel, "observedGroupLabel", 128),
      groupId: boundedText(mapping.groupId, "groupId", 160),
      phase: boundedText(mapping.phase, "phase", 64),
    }));
    const registeringLive = liveMappings.length > 0;
    if (typeof input.complete !== "boolean" || input.entries.length > 200 || (input.entries.length < 1 && !registeringLive)) {
      throw new TournamentOperationError("invalid_input", "Upload 1 to 200 evidence results, or register a mapped live run.");
    }
    if (registeringLive && input.sourceKind !== "tournament_live_capture") {
      throw new TournamentOperationError("invalid_input", "Only Tournament Live capture may register a live run.");
    }
    if (registeringLive && (!input.suggestedTournamentId?.trim() || (input.entries.length === 0 && input.complete))) {
      throw new TournamentOperationError("invalid_input", "A live run needs an active Tournament and an open first registration.");
    }
    if (new Set(liveMappings.map((mapping) => mapping.observedGroupLabel)).size !== liveMappings.length) {
      throw new TournamentOperationError("invalid_input", "Every observed live feed may be mapped once.");
    }
    if (new Set(liveMappings.map((mapping) => mapping.groupId)).size !== liveMappings.length) {
      throw new TournamentOperationError("invalid_input", "One Tournament group cannot use two live feeds.");
    }
    const startedAtMs = optionalTimestamp(input.startedAtMs, "startedAtMs");
    const stoppedAtMs = optionalTimestamp(input.stoppedAtMs, "stoppedAtMs");
    const analysisCompletedAtMs = optionalTimestamp(input.analysisCompletedAtMs, "analysisCompletedAtMs");
    if (startedAtMs !== null && stoppedAtMs !== null && stoppedAtMs < startedAtMs) {
      throw new TournamentOperationError("invalid_input", "stoppedAtMs must be at or after startedAtMs.");
    }
    const entries: TournamentEvidenceEntry[] = input.entries.map((entry) => {
      validateTournamentRaceResult(entry.result);
      const suggestedRaceNumber = entry.suggestedRaceNumber ?? entry.result.raceNumber;
      if (!Number.isSafeInteger(suggestedRaceNumber) || suggestedRaceNumber < 1) {
        throw new TournamentOperationError("invalid_input", "suggestedRaceNumber must be positive.");
      }
      return {
        entryKey: boundedText(entry.entryKey, "entryKey", 160),
        result: entry.result,
        observedGroupLabel: boundedText(entry.observedGroupLabel, "observedGroupLabel", 128),
        suggestedPhase: entry.suggestedPhase?.trim() || null,
        suggestedGroupId: entry.suggestedGroupId?.trim() || null,
        suggestedRaceNumber,
        occurredAtMs: optionalTimestamp(entry.occurredAtMs, "occurredAtMs"),
      };
    });
    if (new Set(entries.map((entry) => entry.entryKey)).size !== entries.length) {
      throw new TournamentOperationError("invalid_input", "Evidence entry keys must be unique within one record.");
    }
    const sourceKinds = new Set(entries.map((entry) => entry.result.source.kind));
    if (input.sourceKind !== undefined) sourceKinds.add(input.sourceKind);
    if (sourceKinds.size !== 1) {
      throw new TournamentOperationError("invalid_input", "One evidence record cannot mix producer source kinds.");
    }
    const summary = evidenceSummary(entries);
    const contentSha256 = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
    const record = await this.repository.upsertEvidenceRecord({
      recordId: randomUUID(),
      clientRecordId,
      sourceKind: [...sourceKinds][0]!,
      entries,
      summary,
      contentSha256,
      suggestedTournamentId: input.suggestedTournamentId?.trim() || null,
      uploadedByUserAccountId: userAccountId,
      startedAtMs,
      stoppedAtMs,
      analysisCompletedAtMs,
      complete: input.complete,
      liveRegistration: registeringLive ? { mappings: liveMappings } : null,
      nowMs: this.now(),
    });
    if (record.live?.status !== "requested" || entries.length === 0 ||
      record.suggestedTournamentId === null || this.repository.groupMemberMatchNames === undefined) {
      return record;
    }
    const stored = await this.repository.findEvidenceRecord(record.recordId);
    if (stored === null || stored.live?.status !== "requested") return record;
    const matches = await Promise.all(stored.live.mappings.map(async (mapping) => liveRosterMatch(
      stored.entries.filter((entry) => entry.observedGroupLabel === mapping.observedGroupLabel),
      await this.repository.groupMemberMatchNames!(record.suggestedTournamentId!, mapping.groupId),
    )));
    if (matches.length !== stored.live.mappings.length || matches.some((match) => !match.sufficient)) {
      return record;
    }
    try {
      return await this.repository.approveLiveAssociation({
        recordId: record.recordId,
        expectedRevision: stored.revision,
        tournamentId: record.suggestedTournamentId,
        reviewedByUserAccountId: userAccountId,
        mappings: stored.live.mappings,
        reason: `Automatically activated after exact roster match (${matches.map((match) => `${match.matchedPlayers}/${match.comparablePlayers}`).join(", ")})`,
        authorization: "roster_match",
        nowMs: this.now(),
      });
    } catch (error) {
      if (error instanceof TournamentOperationError && ["conflict", "forbidden", "not_found"].includes(error.code)) {
        return record;
      }
      throw error;
    }
  }

  public async approveLiveAssociation(actor: ActorContext, input: {
    tournamentId: string;
    recordId: string;
    expectedRevision: number;
    mappings: readonly TournamentLiveMapping[];
    reason: string;
  }): Promise<TournamentEvidenceRecord> {
    const reviewer = await this.assertReviewer(actor, input.tournamentId);
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new TournamentOperationError("invalid_input", "expectedRevision is invalid.");
    }
    const mappings = input.mappings.map((mapping) => ({
      observedGroupLabel: boundedText(mapping.observedGroupLabel, "observedGroupLabel", 128),
      groupId: boundedText(mapping.groupId, "groupId", 160),
      phase: boundedText(mapping.phase, "phase", 64),
    }));
    if (mappings.length < 1 || new Set(mappings.map((mapping) => mapping.observedGroupLabel)).size !== mappings.length) {
      throw new TournamentOperationError("invalid_input", "Map every observed live feed once.");
    }
    if (new Set(mappings.map((mapping) => mapping.groupId)).size !== mappings.length) {
      throw new TournamentOperationError("invalid_input", "One Tournament group cannot use two live feeds.");
    }
    return this.repository.approveLiveAssociation({
      recordId: input.recordId,
      expectedRevision: input.expectedRevision,
      tournamentId: input.tournamentId,
      reviewedByUserAccountId: reviewer,
      mappings,
      reason: input.reason.trim() || "Live feed mapping confirmed by Tournament director",
      nowMs: this.now(),
    });
  }

  public async markLiveStopping(actor: ActorContext, recordId: string): Promise<TournamentEvidenceRecord> {
    return this.repository.markOwnEvidenceStopping({
      recordId: boundedText(recordId, "recordId", 160),
      uploadedByUserAccountId: requireSignedIn(actor),
      nowMs: this.now(),
    });
  }

  public async publicLiveGroups(tournamentId: string): Promise<readonly PublicTournamentLiveGroup[]> {
    const records = await this.repository.listPublicLiveRecords(boundedText(tournamentId, "tournamentId", 160));
    return records.flatMap(projectTournamentLiveGroups);
  }

  public async listOwnEvidenceRecords(actor: ActorContext): Promise<readonly TournamentEvidenceRecord[]> {
    return this.repository.listOwnEvidenceRecords(requireSignedIn(actor));
  }

  public async listEvidenceRecords(actor: ActorContext, tournamentId: string): Promise<readonly TournamentEvidenceRecord[]> {
    await this.assertReviewer(actor, tournamentId);
    return this.repository.listEvidenceRecordsForTournament(tournamentId);
  }

  public async linkEvidenceRecord(actor: ActorContext, input: {
    tournamentId: string;
    recordId: string;
    expectedRevision: number;
    mappings: readonly { observedGroupLabel: string; groupId: string; phase: string }[];
    reason: string;
  }): Promise<readonly IncomingTournamentResult[]> {
    const reviewer = await this.assertReviewer(actor, input.tournamentId);
    const record = await this.repository.findEvidenceRecord(input.recordId);
    if (record === null) throw new TournamentOperationError("not_found", "The evidence record was not found.");
    if (!record.complete || record.status === "uploading") {
      throw new TournamentOperationError("conflict", "The evidence record is still being analysed or uploaded.");
    }
    if (record.status === "blocked") throw new TournamentOperationError("conflict", "The evidence record is blocked.");
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new TournamentOperationError("invalid_input", "expectedRevision is invalid.");
    }
    const mappings = input.mappings.map((mapping) => ({
      observedGroupLabel: boundedText(mapping.observedGroupLabel, "observedGroupLabel", 128),
      groupId: boundedText(mapping.groupId, "groupId", 160),
      phase: boundedText(mapping.phase, "phase", 64),
    }));
    if (new Set(mappings.map((mapping) => mapping.observedGroupLabel)).size !== mappings.length) {
      throw new TournamentOperationError("invalid_input", "Every observed group may be mapped once.");
    }
    const byLabel = new Map(mappings.map((mapping) => [mapping.observedGroupLabel, mapping] as const));
    const entries = record.entries.map((entry) => {
      const mapping = byLabel.get(entry.observedGroupLabel);
      if (mapping === undefined) {
        throw new TournamentOperationError("invalid_input", `Map observed group ${entry.observedGroupLabel} before linking.`);
      }
      return {
        ...entry,
        suggestedPhase: mapping.phase,
        suggestedGroupId: mapping.groupId,
        semanticFingerprint: semanticFingerprint(entry.result, mapping.phase, mapping.groupId, entry.suggestedRaceNumber),
      };
    });
    return this.repository.materializeEvidenceRecord({
      recordId: record.recordId,
      expectedRevision: input.expectedRevision,
      tournamentId: input.tournamentId,
      reviewedByUserAccountId: reviewer,
      mappings,
      entries,
      reason: input.reason.trim() || "Evidence record linked by Tournament director",
      nowMs: this.now(),
    });
  }

  public async upload(actor: ActorContext, input: {
    tournamentId: string;
    entries: readonly {
      result: unknown;
      suggestedPhase?: string;
      suggestedGroupId?: string;
      suggestedRaceNumber?: number;
      occurredAtMs?: number;
    }[];
  }): Promise<readonly IncomingTournamentResult[]> {
    const userAccountId = requireSignedIn(actor);
    if (actor.role !== "administrator" && !(await this.hasOperatorCapability(userAccountId))) {
      throw new TournamentOperationError("forbidden", "Tournament operation authority is required.");
    }
    const tournamentInternalId = await this.repository.findActiveTournamentInternalId(input.tournamentId);
    if (tournamentInternalId === null) {
      throw new TournamentOperationError("not_found", "The active Tournament was not found.");
    }
    if (input.entries.length === 0 || input.entries.length > 100) {
      throw new TournamentOperationError("invalid_input", "Upload between 1 and 100 results.");
    }

    const inserted: IncomingTournamentResult[] = [];
    for (const entry of input.entries) {
      validateTournamentRaceResult(entry.result);
      const result = entry.result;
      const nowMs = this.now();
      const fingerprint = semanticFingerprint(
        result,
        entry.suggestedPhase?.trim() || null,
        entry.suggestedGroupId?.trim() || null,
        entry.suggestedRaceNumber ?? null,
      );
      const existing = await this.repository.findIncomingByFingerprint(input.tournamentId, fingerprint);
      if (existing !== null) {
        inserted.push(existing);
        continue;
      }
      // A stable public ID also makes concurrent retries meet the database's
      // existing unique key instead of creating two pending review rows.
      const digest = createHash("sha256").update(`${tournamentInternalId}:${fingerprint}`).digest("hex");
      inserted.push(await this.repository.insertIncomingResult({
        incomingResultId: `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`,
        tournamentInternalId,
        sourceKind: result.source.kind,
        result,
        semanticFingerprint: fingerprint,
        suggestedPhase: entry.suggestedPhase?.trim() || null,
        suggestedGroupId: entry.suggestedGroupId?.trim() || null,
        suggestedRaceNumber: entry.suggestedRaceNumber ?? null,
        occurredAtMs: entry.occurredAtMs ?? null,
        capturedAtMs: result.timestamps.capturedAtMs ?? result.timestamps.createdAtMs,
        submittedByUserAccountId: userAccountId,
        nowMs,
      }));
    }
    return inserted;
  }

  public async listIncoming(actor: ActorContext, tournamentId: string): Promise<readonly IncomingTournamentResult[]> {
    await this.assertReviewer(actor, tournamentId);
    return this.repository.listIncomingResults(tournamentId);
  }

  public async accept(actor: ActorContext, input: {
    incomingResultId: string;
    expectedRevision: number;
    tournamentRevision: number;
    groupId: string;
    raceNumber: number;
    correctedResult: unknown;
    occurredAtMs?: number;
    reason: string;
  }): Promise<{ raceResultId: string; tournamentRevision: number }> {
    const incoming = await this.repository.findIncomingResult(input.incomingResultId);
    if (incoming === null) {
      throw new TournamentOperationError("not_found", "The pending result was not found.");
    }
    const reviewer = await this.assertReviewer(actor, incoming.tournamentId);
    if (incoming.status !== "pending") {
      throw new TournamentOperationError("conflict", "The pending result has already been reviewed.");
    }
    validateTournamentRaceResult(input.correctedResult);
    const correctedResult = input.correctedResult;
    const correctedFingerprint = semanticFingerprint(correctedResult, incoming.suggestedPhase, input.groupId, input.raceNumber);
    if (
      await this.repository.hasAcceptedFingerprint(incoming.tournamentId, correctedFingerprint, incoming.incomingResultId)
      || await this.repository.hasGroupRace(incoming.tournamentId, input.groupId, input.raceNumber)
    ) {
      throw new TournamentOperationError("conflict", "This race already has an accepted contribution. Review or revise the existing race instead.");
    }

    await this.assertPlacementsAreMembers(
      incoming.tournamentId, input.groupId, [correctedResult as TournamentRaceResultV1],
    );

    // One transaction: the race result, its group attachment, the Tournament
    // revision and the pending record's state change all commit together, or
    // none of them do.
    return acceptConflicts(() => this.acceptUnitOfWork.run(async (scope) => {
      const submitted = await scope.raceResults.submit(correctedResult);
      const tournament = await scope.operations.attachRaces(actor, incoming.tournamentId, {
        expectedRevision: input.tournamentRevision,
        groupId: input.groupId,
        raceResultIds: [submitted.raceResultId],
        ...((input.occurredAtMs ?? incoming.occurredAtMs) === null
          ? {}
          : { occurredAtMs: input.occurredAtMs ?? incoming.occurredAtMs! }),
      });
      await scope.repository.markAccepted({
        incomingResultId: incoming.incomingResultId,
        expectedRevision: input.expectedRevision,
        raceResultId: submitted.raceResultId,
        reviewReason: input.reason.trim() || "Confirmed by Tournament operator",
        reviewedByUserAccountId: reviewer,
        nowMs: this.now(),
      });
      return {
        raceResultId: submitted.raceResultId,
        tournamentRevision: tournament.summary.revision,
      };
    }));
  }

  /** Confirm one complete desktop feed contribution for a group. Every item is
   * validated before canonical writes start, and the Tournament operation is
   * revised once with the complete ordered race set. */
  public async acceptGroup(actor: ActorContext, input: {
    tournamentRevision: number;
    groupId: string;
    replaceExisting?: boolean;
    entries: readonly {
      incomingResultId: string;
      expectedRevision: number;
      raceNumber: number;
      correctedResult: unknown;
      occurredAtMs?: number;
    }[];
    reason: string;
  }): Promise<{ raceResultIds: readonly string[]; tournamentRevision: number }> {
    if (input.entries.length === 0 || input.entries.length > 64) {
      throw new TournamentOperationError("invalid_input", "Confirm between 1 and 64 races for one group.");
    }
    if (new Set(input.entries.map((entry) => entry.incomingResultId)).size !== input.entries.length ||
        new Set(input.entries.map((entry) => entry.raceNumber)).size !== input.entries.length) {
      throw new TournamentOperationError("invalid_input", "The group feed contains duplicate evidence or race numbers.");
    }
    if (input.replaceExisting) {
      const orderedRaceNumbers = input.entries.map((entry) => entry.raceNumber).sort((left, right) => left - right);
      if (orderedRaceNumbers.some((raceNumber, index) => raceNumber !== index + 1)) {
        throw new TournamentOperationError(
          "invalid_input",
          "A replacement group feed must contain every race from race 1 without gaps.",
        );
      }
    }
    const reviewed: { incoming: IncomingTournamentResult; entry: typeof input.entries[number]; result: TournamentRaceResultV1 }[] = [];
    for (const entry of input.entries) {
      const incoming = await this.repository.findIncomingResult(entry.incomingResultId);
      if (incoming === null) throw new TournamentOperationError("not_found", "A pending group result was not found.");
      if (incoming.status !== "pending" || incoming.revision !== entry.expectedRevision) {
        throw new TournamentOperationError("conflict", "The group feed changed before confirmation. Reload and review it again.");
      }
      validateTournamentRaceResult(entry.correctedResult);
      const result = entry.correctedResult;
      const resetCount = result.scoringSegment - 1;
      if (resetCount > 3) {
        throw new TournamentOperationError("conflict", "More than three connection resets require correction in the desktop session; no segments were truncated.");
      }
      const fingerprint = semanticFingerprint(result, incoming.suggestedPhase, input.groupId, entry.raceNumber);
      if (!input.replaceExisting && (
        await this.repository.hasAcceptedFingerprint(incoming.tournamentId, fingerprint, incoming.incomingResultId) ||
        await this.repository.hasGroupRace(incoming.tournamentId, input.groupId, entry.raceNumber)
      )) {
        throw new TournamentOperationError("conflict", "The group feed overlaps an already accepted race.");
      }
      reviewed.push({ incoming, entry, result });
    }
    const tournamentIds = new Set(reviewed.map(({ incoming }) => incoming.tournamentId));
    if (tournamentIds.size !== 1) {
      throw new TournamentOperationError("invalid_input", "A group confirmation cannot cross Tournaments.");
    }
    const reviewer = await this.assertReviewer(actor, reviewed[0]!.incoming.tournamentId);
    await this.assertPlacementsAreMembers(
      reviewed[0]!.incoming.tournamentId, input.groupId, reviewed.map((item) => item.result),
    );

    // The group contract is all-or-nothing and always was - "the Tournament
    // operation is revised once with the complete ordered race set" - so the
    // whole feed commits together. A refusal on the last race leaves the first
    // one unwritten too.
    return acceptConflicts(() => this.acceptUnitOfWork.run(async (scope) => {
      const submitted = [] as { raceResultId: string }[];
      for (const item of reviewed) submitted.push(await scope.raceResults.submit(item.result));
      const tournament = await scope.operations.attachRaces(
        actor, reviewed[0]!.incoming.tournamentId, {
          expectedRevision: input.tournamentRevision,
          groupId: input.groupId,
          raceResultIds: submitted.map((result) => result.raceResultId),
          ...(input.replaceExisting ? { replaceExisting: true } : {}),
        },
      );
      for (const [index, item] of reviewed.entries()) {
        await scope.repository.markAccepted({
          incomingResultId: item.incoming.incomingResultId,
          expectedRevision: item.entry.expectedRevision,
          raceResultId: submitted[index]!.raceResultId,
          reviewReason: input.reason.trim() || "Confirmed as one Tournament group feed",
          reviewedByUserAccountId: reviewer,
          nowMs: this.now(),
        });
      }
      return {
        raceResultIds: submitted.map((result) => result.raceResultId),
        tournamentRevision: tournament.summary.revision,
      };
    }));
  }

  public async reject(actor: ActorContext, input: {
    incomingResultId: string;
    expectedRevision: number;
    reason: string;
  }): Promise<void> {
    if (!input.reason.trim()) {
      throw new TournamentOperationError("invalid_input", "A reason is required.");
    }
    const incoming = await this.repository.findIncomingResult(input.incomingResultId);
    if (incoming === null) throw new TournamentOperationError("not_found", "The pending result was not found.");
    const reviewer = await this.assertReviewer(actor, incoming.tournamentId);
    await this.repository.markRejected({
      incomingResultId: input.incomingResultId,
      expectedRevision: input.expectedRevision,
      reviewReason: input.reason.trim(),
      reviewedByUserAccountId: reviewer,
      nowMs: this.now(),
    });
  }

  private async assertReviewer(actor: ActorContext, tournamentId: string): Promise<string> {
    const userAccountId = requireSignedIn(actor);
    if (!await this.repository.canReviewTournament(tournamentId, userAccountId, actor.role === "administrator")) {
      throw new TournamentOperationError("forbidden", "This account cannot review the selected Tournament.");
    }
    return userAccountId;
  }
}
