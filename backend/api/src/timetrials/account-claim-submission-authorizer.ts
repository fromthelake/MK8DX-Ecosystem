import type { TimeTrialSubmissionAuthorizer } from "./submission-routes.js";
import type { WebManualSessionRepository } from "./web-manual-session-service.js";

const nativeSources = new Set([
  "android_manual",
  "android_scan",
  "android_scan_test",
  "livetrial_capture",
  "livetrial_recorded_video",
]);

export function isAccountClaimNativeTimeTrialSource(sourceKind: string): boolean {
  return nativeSources.has(sourceKind);
}

export class AccountClaimTimeTrialSubmissionAuthorizer
  implements TimeTrialSubmissionAuthorizer
{
  public constructor(private readonly repository: WebManualSessionRepository) {}

  public async authorize(
    context: Parameters<TimeTrialSubmissionAuthorizer["authorize"]>[0],
  ): Promise<boolean> {
    if (!isAccountClaimNativeTimeTrialSource(context.sourceKind) ||
      context.playerReferenceNamespace !== "player" ||
      context.centralPlayerId === null ||
      context.actor.role === "anonymous" ||
      context.actor.role === "migration_operator") {
      return false;
    }
    const verified = await this.repository.findVerifiedPlayerForAccount(
      context.actor.userAccountId,
    );
    return verified?.playerId === context.centralPlayerId;
  }
}
