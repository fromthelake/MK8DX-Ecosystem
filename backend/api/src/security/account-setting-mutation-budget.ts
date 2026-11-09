import type { ActorContext } from "../identity/types.js";
import {
  MutationRateLimitExceeded,
  type MutationRateLimiter,
} from "./mysql-mutation-rate-limiter.js";

// Six low-cost account writes share one durable budget across API instances.
// Normal notification acknowledgements and setting changes stay well below it.
export async function consumeAccountSettingMutationBudget(
  actor: ActorContext,
  rateLimiter: MutationRateLimiter,
): Promise<void> {
  if (actor.role === "account" || actor.role === "administrator") {
    await rateLimiter.consume(actor.userAccountId, "account-settings-hour", 3_600, 120);
  }
}

export function accountSettingRateLimitFailure(error: unknown): Readonly<{
  retryAfterSeconds: number;
  body: Readonly<{ code: string; message: string }>;
}> | null {
  if (!(error instanceof MutationRateLimitExceeded)) return null;
  return {
    retryAfterSeconds: error.retryAfterSeconds,
    body: {
      code: "account_settings_rate_limited",
      message: "Too many account setting changes were received. Wait before retrying.",
    },
  };
}
