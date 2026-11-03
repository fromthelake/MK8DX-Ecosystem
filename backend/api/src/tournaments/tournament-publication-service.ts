import type { ActorContext } from "../identity/types.js";
import { type TournamentRaceMode } from "./race-result-validation.js";

const publicationIdPattern =
  /^tournament_publication\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const raceResultIdPattern =
  /^tournament_race_result\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const reasonPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export type TournamentPublicationStatus = "published" | "retracted";

export type TournamentPublicationTarget = Readonly<{
  raceResultId: string;
  revision: number;
}>;

export type TournamentPublicationSnapshot = Readonly<{
  publicationId: string;
  eventName: string;
  status: TournamentPublicationStatus;
  revision: number;
  resultCount: number;
  publishedAtMs?: number;
  updatedAtMs: number;
}>;

export type TournamentPublicationCandidate = Readonly<{
  raceResultId: string;
  currentRevision: number;
  raceNumber: number;
  scoringSegment: number;
  trackId: string;
  mode?: TournamentRaceMode;
  mirror?: true;
  occurredAtMs?: number;
  placementCount: number;
  publishable: boolean;
  currentPublicationId?: string;
}>;

export type TournamentPublicationReview = Readonly<{
  publications: readonly TournamentPublicationSnapshot[];
  candidates: readonly TournamentPublicationCandidate[];
}>;

export type CreateTournamentPublicationInput = Readonly<{
  publicationId: string;
  eventName: string;
  targets: readonly TournamentPublicationTarget[];
  actorUserAccountId: string;
  reasonCode: string;
  occurredAtMs: number;
}>;

export type RepublishTournamentPublicationInput = Readonly<{
  publicationId: string;
  expectedRevision: number;
  eventName: string;
  targets: readonly TournamentPublicationTarget[];
  actorUserAccountId: string;
  reasonCode: string;
  occurredAtMs: number;
}>;

export type RetractTournamentPublicationInput = Readonly<{
  publicationId: string;
  expectedRevision: number;
  actorUserAccountId: string;
  reasonCode: string;
  occurredAtMs: number;
}>;

export interface TournamentPublicationRepository {
  listReview(): Promise<TournamentPublicationReview>;
  create(input: CreateTournamentPublicationInput): Promise<TournamentPublicationSnapshot>;
  republish(
    input: RepublishTournamentPublicationInput,
  ): Promise<TournamentPublicationSnapshot>;
  retract(input: RetractTournamentPublicationInput): Promise<TournamentPublicationSnapshot>;
}

export type TournamentPublicationServiceErrorCode =
  | "forbidden"
  | "invalid_input"
  | "not_found"
  | "conflict"
  | "unavailable";

export class TournamentPublicationServiceError extends Error {
  public constructor(
    public readonly code: TournamentPublicationServiceErrorCode,
    message = "The Tournament publication operation could not be completed.",
  ) {
    super(message);
    this.name = "TournamentPublicationServiceError";
  }
}

function administrator(actor: ActorContext): string {
  if (actor.role !== "administrator") {
    throw new TournamentPublicationServiceError(
      "forbidden",
      "active administrator actor required",
    );
  }
  return actor.userAccountId;
}

function publicationId(value: string): string {
  if (!publicationIdPattern.test(value) || value.length > 151) {
    throw new TournamentPublicationServiceError("invalid_input");
  }
  return value;
}

function eventName(value: string): string {
  if (value.length < 1 || value.length > 128 || value.trim() !== value) {
    throw new TournamentPublicationServiceError("invalid_input");
  }
  return value;
}

function reasonCode(value: string): string {
  if (!reasonPattern.test(value) || value.length > 64) {
    throw new TournamentPublicationServiceError("invalid_input");
  }
  return value;
}

function revision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TournamentPublicationServiceError("invalid_input");
  }
  return value;
}

function targets(
  values: readonly TournamentPublicationTarget[],
): readonly TournamentPublicationTarget[] {
  if (values.length < 1 || values.length > 200) {
    throw new TournamentPublicationServiceError("invalid_input");
  }
  const seen = new Set<string>();
  return values.map((value) => {
    if (!raceResultIdPattern.test(value.raceResultId) ||
        value.raceResultId.length > 151 || seen.has(value.raceResultId)) {
      throw new TournamentPublicationServiceError("invalid_input");
    }
    seen.add(value.raceResultId);
    return { raceResultId: value.raceResultId, revision: revision(value.revision) };
  });
}

function time(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 253_402_300_799_999) {
    throw new TournamentPublicationServiceError("unavailable");
  }
  return value;
}

export class TournamentPublicationService {
  public constructor(
    private readonly repository: TournamentPublicationRepository,
    private readonly ids: Readonly<{ newPublicationId(): string }>,
    private readonly clock: Readonly<{ nowMs(): number }>,
  ) {}

  public async listReview(actor: ActorContext): Promise<TournamentPublicationReview> {
    administrator(actor);
    try {
      return await this.repository.listReview();
    } catch (error) {
      if (error instanceof TournamentPublicationServiceError) { throw error; }
      throw new TournamentPublicationServiceError("unavailable");
    }
  }

  public async createPublication(
    actor: ActorContext,
    input: Readonly<{
      eventName: string;
      targets: readonly TournamentPublicationTarget[];
      reasonCode: string;
    }>,
  ): Promise<TournamentPublicationSnapshot> {
    const command: CreateTournamentPublicationInput = {
      publicationId: publicationId(this.ids.newPublicationId()),
      eventName: eventName(input.eventName),
      targets: targets(input.targets),
      actorUserAccountId: administrator(actor),
      reasonCode: reasonCode(input.reasonCode),
      occurredAtMs: time(this.clock.nowMs()),
    };
    try {
      return await this.repository.create(command);
    } catch (error) {
      if (error instanceof TournamentPublicationServiceError) { throw error; }
      throw new TournamentPublicationServiceError("unavailable");
    }
  }

  public async republish(
    actor: ActorContext,
    requestedPublicationId: string,
    input: Readonly<{
      expectedRevision: number;
      eventName: string;
      targets: readonly TournamentPublicationTarget[];
      reasonCode: string;
    }>,
  ): Promise<TournamentPublicationSnapshot> {
    const command: RepublishTournamentPublicationInput = {
      publicationId: publicationId(requestedPublicationId),
      expectedRevision: revision(input.expectedRevision),
      eventName: eventName(input.eventName),
      targets: targets(input.targets),
      actorUserAccountId: administrator(actor),
      reasonCode: reasonCode(input.reasonCode),
      occurredAtMs: time(this.clock.nowMs()),
    };
    try {
      return await this.repository.republish(command);
    } catch (error) {
      if (error instanceof TournamentPublicationServiceError) { throw error; }
      throw new TournamentPublicationServiceError("unavailable");
    }
  }

  public async retract(
    actor: ActorContext,
    requestedPublicationId: string,
    input: Readonly<{ expectedRevision: number; reasonCode: string }>,
  ): Promise<TournamentPublicationSnapshot> {
    const command: RetractTournamentPublicationInput = {
      publicationId: publicationId(requestedPublicationId),
      expectedRevision: revision(input.expectedRevision),
      actorUserAccountId: administrator(actor),
      reasonCode: reasonCode(input.reasonCode),
      occurredAtMs: time(this.clock.nowMs()),
    };
    try {
      return await this.repository.retract(command);
    } catch (error) {
      if (error instanceof TournamentPublicationServiceError) { throw error; }
      throw new TournamentPublicationServiceError("unavailable");
    }
  }
}
