import type { ActorContext } from "../identity/types.js";
import type { WebManualSessionRepository } from "./web-manual-session-service.js";

const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export class NativeTimeTrialSessionError extends Error {
  public constructor(
    public readonly code: "not_authenticated" | "not_authorized" | "invalid_dependency",
  ) {
    super("The native Time Trial session could not be established.");
    this.name = "NativeTimeTrialSessionError";
  }
}

export type NativeTimeTrialBootstrapDocument = Readonly<{
  schemaVersion: "mk8dx.native-time-trial-bootstrap.v1";
  playerId: string;
}>;

/**
 * The v2 bootstrap adds the Player's public identity so a native client can
 * name the signed-in Player instead of showing a raw identifier. The v1 route
 * keeps serving already-installed clients, whose parsers reject unknown keys
 * by design.
 */
export type NativeTimeTrialBootstrapV2Document = Readonly<{
  schemaVersion: "mk8dx.native-time-trial-bootstrap.v2";
  playerId: string;
  username: string;
  displayName: string;
}>;

export class NativeTimeTrialSessionService {
  public constructor(
    private readonly repository: WebManualSessionRepository,
  ) {}

  public async bootstrap(actor: ActorContext): Promise<NativeTimeTrialBootstrapDocument> {
    const verified = await this.verifiedPlayer(actor);
    return {
      schemaVersion: "mk8dx.native-time-trial-bootstrap.v1",
      playerId: verified.playerId,
    };
  }

  public async bootstrapV2(
    actor: ActorContext,
  ): Promise<NativeTimeTrialBootstrapV2Document> {
    const verified = await this.verifiedPlayer(actor);
    return {
      schemaVersion: "mk8dx.native-time-trial-bootstrap.v2",
      playerId: verified.playerId,
      username: verified.username,
      displayName: verified.displayName,
    };
  }

  private async verifiedPlayer(actor: ActorContext) {
    if (actor.role === "anonymous") {
      throw new NativeTimeTrialSessionError("not_authenticated");
    }
    if (actor.role === "migration_operator") {
      throw new NativeTimeTrialSessionError("not_authorized");
    }
    let verified;
    try {
      verified = await this.repository.findVerifiedPlayerForAccount(actor.userAccountId);
    } catch {
      throw new NativeTimeTrialSessionError("invalid_dependency");
    }
    if (verified === null) {
      throw new NativeTimeTrialSessionError("not_authorized");
    }
    if (!playerIdPattern.test(verified.playerId) || verified.playerId.length > 135) {
      throw new NativeTimeTrialSessionError("invalid_dependency");
    }
    return verified;
  }
}
