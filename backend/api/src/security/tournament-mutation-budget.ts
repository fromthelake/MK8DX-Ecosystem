import type { ActorContext } from "../identity/types.js";
import type { MutationRateLimiter } from "./mysql-mutation-rate-limiter.js";

// Tournament race intake has a higher ceiling than the rarer, audited
// publication actions. Both counters are durable across API instances.
export async function consumeTournamentMutationBudget(
  actor: ActorContext,
  rateLimiter: MutationRateLimiter,
  operation: "race-result" | "publication",
): Promise<void> {
  const owner = actor.role === "account" || actor.role === "administrator"
    ? actor.userAccountId : "global";
  if (operation === "race-result") {
    await rateLimiter.consume(owner, "tournament-race-results-hour", 3_600, 240);
  } else {
    await rateLimiter.consume(owner, "tournament-publications-hour", 3_600, 20);
  }
}
