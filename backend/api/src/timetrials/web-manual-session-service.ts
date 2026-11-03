import type { ActorContext } from "../identity/types.js";


const trackIdPattern = /^track\.[a-z0-9]+(?:_[a-z0-9]+)*$/;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const producerVersionPattern = /^[\x20-\x7e]{1,64}$/;
const maxEpochMs = 253_402_300_799_999;

export type WebManualSessionErrorCode =
  | "invalid_track"
  | "not_authenticated"
  | "not_authorized"
  | "invalid_dependency";

export class WebManualSessionError extends Error {
  public constructor(public readonly code: WebManualSessionErrorCode) {
    super("The web manual session could not be established.");
    this.name = "WebManualSessionError";
  }
}

export type VerifiedPlayerForAccount = Readonly<{
  playerId: string;
  /** Current public handle (ADR-0151 syntax). */
  username: string;
  /** Presentation name shown wherever the Player is named. */
  displayName: string;
}>;

export interface WebManualSessionRepository {
  findVerifiedPlayerForAccount(
    userAccountId: string,
  ): Promise<VerifiedPlayerForAccount | null>;
}

export interface WebManualTrackCatalog {
  containsTrack(trackId: string): Promise<boolean>;
}

export interface WebManualSessionClock { nowMs(): number; }
export interface WebManualSessionIdGenerator { newOpaqueId(): string; }

export type WebManualContextDocument = Readonly<{
  schemaVersion: "mk8dx.web-manual-context.v1";
  submissionId: string;
  revision: 1;
  trackId: string;
  playerReference: Readonly<{
    namespace: "player";
    value: string;
  }>;
  producer: Readonly<{
    version: string;
    localRecordId: string;
  }>;
  timestamps: Readonly<{ createdAtMs: number }>;
}>;

export type WebManualBootstrapDocument = Readonly<{
  schemaVersion: "mk8dx.web-manual-bootstrap.v1";
  context: WebManualContextDocument;
}>;

function fail(code: WebManualSessionErrorCode): never {
  throw new WebManualSessionError(code);
}

export class WebManualSessionService {
  public constructor(
    private readonly repository: WebManualSessionRepository,
    private readonly catalog: WebManualTrackCatalog,
    private readonly idGenerator: WebManualSessionIdGenerator,
    private readonly clock: WebManualSessionClock,
    private readonly producerVersion: string,
  ) {
    if (!producerVersionPattern.test(producerVersion)) {
      throw new WebManualSessionError("invalid_dependency");
    }
  }

  public async bootstrap(
    actor: ActorContext,
    trackId: string,
  ): Promise<WebManualBootstrapDocument> {
    if (!trackIdPattern.test(trackId) || trackId.length > 255) {
      fail("invalid_track");
    }
    if (actor.role === "anonymous") { fail("not_authenticated"); }
    if (actor.role === "migration_operator") { fail("not_authorized"); }

    let verifiedPlayer: VerifiedPlayerForAccount | null;
    let knownTrack: boolean;
    try {
      [verifiedPlayer, knownTrack] = await Promise.all([
        this.repository.findVerifiedPlayerForAccount(actor.userAccountId),
        this.catalog.containsTrack(trackId),
      ]);
    } catch {
      fail("invalid_dependency");
    }
    if (!knownTrack) { fail("invalid_track"); }
    if (verifiedPlayer === null) { fail("not_authorized"); }
    if (!playerIdPattern.test(verifiedPlayer.playerId) ||
      verifiedPlayer.playerId.length > 135) {
      fail("invalid_dependency");
    }

    const opaqueId = this.idGenerator.newOpaqueId();
    const createdAtMs = this.clock.nowMs();
    if (!opaqueIdPattern.test(opaqueId) ||
      !Number.isSafeInteger(createdAtMs) ||
      createdAtMs < 0 || createdAtMs > maxEpochMs) {
      fail("invalid_dependency");
    }
    return {
      schemaVersion: "mk8dx.web-manual-bootstrap.v1",
      context: {
        schemaVersion: "mk8dx.web-manual-context.v1",
        submissionId: `user_submission.time.${opaqueId}`,
        revision: 1,
        trackId,
        playerReference: {
          namespace: "player",
          value: verifiedPlayer.playerId,
        },
        producer: {
          version: this.producerVersion,
          localRecordId: opaqueId,
        },
        timestamps: { createdAtMs },
      },
    };
  }
}
