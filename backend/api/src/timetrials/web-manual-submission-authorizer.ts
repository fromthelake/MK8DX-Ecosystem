import type { TimeTrialSubmissionAuthorizer } from "./submission-routes.js";
import type { WebManualSessionRepository } from
  "./web-manual-session-service.js";


export class WebManualSubmissionAuthorizer
  implements TimeTrialSubmissionAuthorizer
{
  public constructor(private readonly repository: WebManualSessionRepository) {}

  public async authorize(
    context: Parameters<TimeTrialSubmissionAuthorizer["authorize"]>[0],
  ): Promise<boolean> {
    // A web scan is the same person, the same session and the same form as a typed submission:
    // only the provenance differs (ADR-0204), so it is authorized identically.
    if ((context.sourceKind !== "web_manual" && context.sourceKind !== "web_scan") ||
      context.revision !== 1 ||
      context.playerReferenceNamespace !== "player" ||
      context.centralPlayerId === null ||
      context.actor.role === "anonymous" ||
      context.actor.role === "migration_operator") {
      return false;
    }
    const verifiedPlayer = await this.repository.findVerifiedPlayerForAccount(
      context.actor.userAccountId,
    );
    return verifiedPlayer?.playerId === context.centralPlayerId;
  }
}
