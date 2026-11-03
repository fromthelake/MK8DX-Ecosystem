import type {
  TournamentSubmissionAuthorizationContext,
  TournamentSubmissionAuthorizer,
} from "./race-result-routes.js";

// Canonical Tournament race results reach the hosted platform through the
// audited administrator role (ADR-0147): the administrator imports producer
// output after explicit Player reconciliation and later publishes it. Any
// producer kind or revision is acceptable; the actor role alone decides.
export class AdministratorTournamentSubmissionAuthorizer
implements TournamentSubmissionAuthorizer {
  public async authorize(
    context: TournamentSubmissionAuthorizationContext,
  ): Promise<boolean> {
    return context.actor.role === "administrator";
  }
}
