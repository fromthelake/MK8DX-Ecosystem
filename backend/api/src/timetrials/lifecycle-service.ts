import type { ActorContext } from "../identity/types.js";
import {
  IMPLAUSIBLE_TIME_MESSAGE,
  isImplausiblyFast,
  type WorldRecordTimes,
} from "./world-record-plausibility.js";
import type { TimeTrialAssetCatalog, TimeTrialCarriedFrom } from "./submission-service.js";
import { youTubeVideoId } from "./youtube-video.js";

export const YOUTUBE_ONLY_MESSAGE =
  "Paste a link to the YouTube video, for example https://www.youtube.com/watch?v=… or https://youtu.be/….";

// Owner and administrator Time Trial lifecycle.
//
// A Player manages their own results; an administrator manages any result.
// Nothing here deletes anything: a correction is an ordinary canonical
// revision (N -> N+1) and a retirement withdraws public presence while the
// submission, every revision and the whole publication history remain.
// Restoring returns the result through the ordinary publication policy
// instead of recreating it, so history can always explain itself.

export type TimeTrialRetirementReason =
  | "incorrect_time"
  | "wrong_track_or_mode"
  | "duplicate"
  | "test_result"
  | "invalid_result"
  | "other";

export const retirementReasons: readonly TimeTrialRetirementReason[] = [
  "incorrect_time",
  "wrong_track_or_mode",
  "duplicate",
  "test_result",
  "invalid_result",
  "other",
];

export type TimeTrialLifecycleActorRole = "owner" | "administrator";

export type TimeTrialLifecycleEvent = Readonly<{
  sequenceNumber: number;
  eventType: "corrected" | "retired" | "restored";
  retirementStateAfter: "active" | "retired";
  revision: number;
  actorRole: TimeTrialLifecycleActorRole;
  reasonCode: string;
  note?: string;
  occurredAtMs: number;
}>;

/** What a lap recorded besides its time: the coin balance at its end and the mushrooms used. */
export type TimeTrialLapCounts = Readonly<{ coinsCollected?: number; mushroomsUsed?: number }>;

/** The four parts of a kart setup, by base id (a colour variant is derived from the character). */
export type TimeTrialCorrectionLoadout = Readonly<{
  characterId?: string; bodyId?: string; tireId?: string; gliderId?: string;
}>;

export type TimeTrialRevisionSummary = Readonly<{
  revision: number;
  modeCc: 150 | 200;
  trackId: string;
  totalTimeMs: number;
  laps: readonly number[];
  /** One entry per lap in `laps`, so an editor can show what is already there. */
  lapDetails?: readonly TimeTrialLapCounts[];
  loadout?: Readonly<Record<string, string>>;
  sourceKind: string;
  createdAtMs: number;
}>;

export type ManagedTimeTrial = Readonly<{
  submissionId: string;
  playerId: string;
  playerUsername: string;
  playerDisplayName: string;
  retirementState: "active" | "retired";
  publicationStatus: "published" | "withheld";
  publicationReason: string;
  current: TimeTrialRevisionSummary;
  revisions: readonly TimeTrialRevisionSummary[];
  events: readonly TimeTrialLifecycleEvent[];
  /** The Player's own YouTube video of this run (migration 0071), when one is attached. */
  videoUrl?: string;
  /** Present when the current revision was carried from another community (ADR-0225). */
  carriedFrom?: TimeTrialCarriedFrom;
}>;

// Only fields a correction may legitimately restate. Changing the Track or
// the mode changes which competition the result belongs to, so it is not a
// correction at all: retire the result and submit the right one.
//
// Since 2026-09-28 (owner: "manage / edit get the checks ... in the format of Post a Time") a
// correction can also restate each lap's coins and mushrooms and the kart setup. Both are optional:
// a correction that leaves them out (Android sends them only when they changed) keeps them as they were.
export type TimeTrialCorrection = Readonly<{
  totalTimeMs: number;
  laps: readonly number[];
  /** Present: replaces the coins and mushrooms of every lap (one entry per lap in `laps`). */
  lapDetails?: readonly TimeTrialLapCounts[];
  /** Present: replaces the kart setup (a part left out is cleared). */
  loadout?: TimeTrialCorrectionLoadout;
  reasonCode: TimeTrialRetirementReason;
  note?: string;
}>;

export type ManagedTimeTrialQuery = Readonly<{
  playerId?: string;
  trackId?: string;
  modeCc?: 150 | 200;
  retirementState?: "active" | "retired";
  publicationStatus?: "published" | "withheld";
  sourceKind?: string;
  limit: number;
}>;

export class TimeTrialLifecycleError extends Error {
  public constructor(
    public readonly code:
      | "invalid_input"
      | "not_authenticated"
      | "forbidden"
      | "not_found"
      | "conflict"
      | "unavailable",
    message = "The Time Trial could not be updated.",
    // The originating failure is kept for operational logs only; the message
    // that reaches a client stays bounded and free of internal detail.
    options?: Readonly<{ cause?: unknown }>,
  ) {
    super(message, options);
    this.name = "TimeTrialLifecycleError";
  }
}

export interface TimeTrialLifecycleRepository {
  // Resolves the Player the account holds a verified claim on, or null.
  findClaimedPlayer(userAccountId: string): Promise<string | null>;
  read(submissionId: string): Promise<ManagedTimeTrial | null>;
  list(query: ManagedTimeTrialQuery): Promise<readonly ManagedTimeTrial[]>;
  correct(input: Readonly<{
    submissionId: string;
    correction: TimeTrialCorrection;
    actorRole: TimeTrialLifecycleActorRole;
    actorUserAccountId: string;
  }>): Promise<ManagedTimeTrial>;
  setRetirement(input: Readonly<{
    submissionId: string;
    retire: boolean;
    reasonCode: TimeTrialRetirementReason;
    note?: string;
    actorRole: TimeTrialLifecycleActorRole;
    actorUserAccountId: string;
  }>): Promise<ManagedTimeTrial>;
  /** Attaches (videoId) or removes (null) the result's YouTube video. */
  setVideo(input: Readonly<{
    submissionId: string;
    videoId: string | null;
    actorUserAccountId: string;
  }>): Promise<ManagedTimeTrial>;
}

const submissionIdPattern =
  /^user_submission\.time\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const MAXIMUM_TOTAL_TIME_MS = 599_999;

export class TimeTrialLifecycleService {
  public constructor(
    private readonly repository: TimeTrialLifecycleRepository,
    // A correction may not set a time the submission path would refuse (world-record-plausibility.ts).
    private readonly worldRecords?: WorldRecordTimes,
    // The same asset check a submission gets, for a corrected kart setup.
    private readonly assetCatalog?: TimeTrialAssetCatalog,
  ) {}

  /**
   * Attaches the Player's YouTube video to their result, or removes it (null / empty). Only a
   * YouTube link is accepted; the stored value is the video id alone (youtube-video.ts).
   */
  public async setVideo(
    actor: ActorContext,
    submissionId: string,
    videoUrl: string | null,
  ): Promise<ManagedTimeTrial> {
    const { account } = await this.authorize(actor, submissionId);
    let videoId: string | null = null;
    if (videoUrl !== null && videoUrl.trim() !== "") {
      videoId = youTubeVideoId(videoUrl);
      if (videoId === null) {
        throw new TimeTrialLifecycleError("invalid_input", YOUTUBE_ONLY_MESSAGE);
      }
    }
    return this.guard(() => this.repository.setVideo({
      submissionId, videoId, actorUserAccountId: account,
    }));
  }

  public async readOwnedOrAdministered(
    actor: ActorContext,
    submissionId: string,
  ): Promise<ManagedTimeTrial> {
    const { result } = await this.authorize(actor, submissionId);
    return result;
  }

  // A Player must be able to find their own retired results: the public
  // views deliberately hide them, so without this a retirement could never
  // be undone after a reload.
  public async listOwn(
    actor: ActorContext,
    limit = 100,
  ): Promise<readonly ManagedTimeTrial[]> {
    if (actor.role !== "account" && actor.role !== "administrator") {
      throw new TimeTrialLifecycleError("not_authenticated");
    }
    const claimed = await this.guard(
      () => this.repository.findClaimedPlayer(actor.userAccountId),
    );
    if (claimed === null) {
      throw new TimeTrialLifecycleError("not_found");
    }
    return this.guard(() => this.repository.list({ playerId: claimed, limit }));
  }

  public async listForAdministrator(
    actor: ActorContext,
    query: ManagedTimeTrialQuery,
  ): Promise<readonly ManagedTimeTrial[]> {
    if (actor.role !== "administrator") {
      throw new TimeTrialLifecycleError(
        actor.role === "anonymous" ? "not_authenticated" : "forbidden",
      );
    }
    if (query.playerId !== undefined && !playerIdPattern.test(query.playerId)) {
      throw new TimeTrialLifecycleError("invalid_input");
    }
    return this.guard(() => this.repository.list(query));
  }

  public async correct(
    actor: ActorContext,
    submissionId: string,
    correction: TimeTrialCorrection,
  ): Promise<ManagedTimeTrial> {
    const { role, account, result } = await this.authorize(actor, submissionId);
    this.requireCorrection(correction);
    if (correction.loadout !== undefined && this.assetCatalog !== undefined) {
      const issues = await this.guard(() => this.assetCatalog!.validateReferences({
        trackId: result.current.trackId, loadout: correction.loadout!,
      }));
      if (issues.length > 0) {
        throw new TimeTrialLifecycleError("invalid_input", "One of the kart parts is not known.");
      }
    }
    if (result.retirementState === "retired") {
      throw new TimeTrialLifecycleError(
        "conflict",
        "A retired Time Trial must be restored before it is corrected.",
      );
    }
    if (this.worldRecords !== undefined) {
      const worldRecordMs = await this.guard(
        () => this.worldRecords!.timeMs(result.current.trackId, result.current.modeCc),
      );
      if (isImplausiblyFast(correction.totalTimeMs, worldRecordMs)) {
        throw new TimeTrialLifecycleError("invalid_input", IMPLAUSIBLE_TIME_MESSAGE);
      }
    }
    return this.guard(() => this.repository.correct({
      submissionId,
      correction,
      actorRole: role,
      actorUserAccountId: account,
    }));
  }

  public async retire(
    actor: ActorContext,
    submissionId: string,
    reasonCode: string,
    note?: string,
  ): Promise<ManagedTimeTrial> {
    return this.setRetirement(actor, submissionId, true, reasonCode, note);
  }

  public async restore(
    actor: ActorContext,
    submissionId: string,
    reasonCode: string,
    note?: string,
  ): Promise<ManagedTimeTrial> {
    return this.setRetirement(actor, submissionId, false, reasonCode, note);
  }

  private async setRetirement(
    actor: ActorContext,
    submissionId: string,
    retire: boolean,
    reasonCode: string,
    note?: string,
  ): Promise<ManagedTimeTrial> {
    const { role, account, result } = await this.authorize(actor, submissionId);
    const reason = this.requireReason(reasonCode);
    this.requireNote(note);
    if (result.retirementState === (retire ? "retired" : "active")) {
      throw new TimeTrialLifecycleError(
        "conflict",
        retire
          ? "That Time Trial is already retired."
          : "That Time Trial is not retired.",
      );
    }
    return this.guard(() => this.repository.setRetirement({
      submissionId,
      retire,
      reasonCode: reason,
      ...(note === undefined ? {} : { note }),
      actorRole: role,
      actorUserAccountId: account,
    }));
  }

  // Ownership is decided by the server from the account's verified claim.
  // A hidden button is not a permission: every action re-resolves it.
  private async authorize(
    actor: ActorContext,
    submissionId: string,
  ): Promise<Readonly<{
    role: TimeTrialLifecycleActorRole;
    account: string;
    result: ManagedTimeTrial;
  }>> {
    if (actor.role !== "account" && actor.role !== "administrator") {
      throw new TimeTrialLifecycleError("not_authenticated");
    }
    if (!submissionIdPattern.test(submissionId)) {
      throw new TimeTrialLifecycleError("invalid_input");
    }
    const result = await this.guard(() => this.repository.read(submissionId));
    if (result === null) { throw new TimeTrialLifecycleError("not_found"); }
    if (actor.role === "administrator") {
      return { role: "administrator", account: actor.userAccountId, result };
    }
    const claimed = await this.guard(
      () => this.repository.findClaimedPlayer(actor.userAccountId),
    );
    if (claimed === null || claimed !== result.playerId) {
      // Not found rather than forbidden: an ordinary account should not be
      // able to probe which submission ids exist for other Players.
      throw new TimeTrialLifecycleError("not_found");
    }
    return { role: "owner", account: actor.userAccountId, result };
  }

  private requireCorrection(correction: TimeTrialCorrection): void {
    const { totalTimeMs, laps } = correction;
    if (!Number.isSafeInteger(totalTimeMs) || totalTimeMs < 1 ||
      totalTimeMs > MAXIMUM_TOTAL_TIME_MS) {
      throw new TimeTrialLifecycleError("invalid_input");
    }
    if (!Array.isArray(laps) ||
      (laps.length !== 0 && laps.length !== 3 && laps.length !== 7)) {
      throw new TimeTrialLifecycleError("invalid_input");
    }
    if (laps.some((lap) => !Number.isSafeInteger(lap) || lap < 1 ||
      lap > MAXIMUM_TOTAL_TIME_MS)) {
      throw new TimeTrialLifecycleError("invalid_input");
    }
    if (laps.length > 0 &&
      laps.reduce((sum, lap) => sum + lap, 0) !== totalTimeMs) {
      throw new TimeTrialLifecycleError(
        "invalid_input",
        "The lap times must add up to the total time.",
      );
    }
    // The same bounds a submission has (TimeTrialSubmissionV1): a lap's coin balance 0-10, its
    // mushrooms 0-3, and at most three mushrooms in the whole race.
    if (correction.lapDetails !== undefined) {
      const details = correction.lapDetails;
      if (!Array.isArray(details) || details.length !== laps.length ||
        details.some((lap) =>
          (lap.coinsCollected !== undefined &&
            (!Number.isSafeInteger(lap.coinsCollected) || lap.coinsCollected < 0 || lap.coinsCollected > 10)) ||
          (lap.mushroomsUsed !== undefined &&
            (!Number.isSafeInteger(lap.mushroomsUsed) || lap.mushroomsUsed < 0 || lap.mushroomsUsed > 3)))) {
        throw new TimeTrialLifecycleError("invalid_input", "The coins or mushrooms of a lap are not valid.");
      }
      if (details.reduce((sum, lap) => sum + (lap.mushroomsUsed ?? 0), 0) > 3) {
        throw new TimeTrialLifecycleError("invalid_input", "A race has at most three mushrooms.");
      }
    }
    if (correction.loadout !== undefined) {
      const patterns: Readonly<Record<string, RegExp>> = {
        characterId: /^character\.[a-z0-9]+(?:_[a-z0-9]+)*$/,
        bodyId: /^body\.[a-z0-9]+(?:_[a-z0-9]+)*$/,
        tireId: /^tire\.[a-z0-9]+(?:_[a-z0-9]+)*$/,
        gliderId: /^glider\.[a-z0-9]+(?:_[a-z0-9]+)*$/,
      };
      const entries = Object.entries(correction.loadout);
      if (entries.some(([key, value]) =>
        patterns[key] === undefined || typeof value !== "string" || value.length > 255 || !patterns[key]!.test(value))) {
        throw new TimeTrialLifecycleError("invalid_input", "One of the kart parts is not known.");
      }
    }
    this.requireReason(correction.reasonCode);
    this.requireNote(correction.note);
  }

  private requireReason(reasonCode: string): TimeTrialRetirementReason {
    const found = retirementReasons.find((value) => value === reasonCode);
    if (found === undefined) {
      throw new TimeTrialLifecycleError("invalid_input");
    }
    return found;
  }

  private requireNote(note: string | undefined): void {
    if (note === undefined) { return; }
    // Control characters never belong in an audit note.
    if (typeof note !== "string" || note.length > 256 ||
      [...note].some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code < 0x20 || code === 0x7f;
      })) {
      throw new TimeTrialLifecycleError("invalid_input");
    }
  }

  private async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof TimeTrialLifecycleError) { throw error; }
      throw new TimeTrialLifecycleError(
        "unavailable", "The Time Trial could not be updated.", { cause: error },
      );
    }
  }
}
