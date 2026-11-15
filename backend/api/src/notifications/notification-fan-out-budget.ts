import type { AbuseBudgets } from "../security/abuse-budgets.js";
import { MutationRateLimitExceeded } from "../security/mysql-mutation-rate-limiter.js";

/**
 * An installation-wide budget on notifications written for other people (H1).
 *
 * Every `produce*` call of the wrapped repository first takes one unit of the shared
 * `notificationsPerHour` / `notificationsPerDay` budget. When it is spent the notification is not
 * written: producers are best effort and never fail the action that caused them, so the causing
 * write (a submission, a claim, a sign-up) still succeeds. Refusals are counted per scope by the
 * limiter and reported in the operational log without identifiers. The same wrapper is used by the
 * request path and by the background producer worker, so neither can bypass it.
 */
export function withNotificationFanOutBudget<T extends object>(repository: T, budgets: AbuseBudgets): T {
  return new Proxy(repository, {
    get(target, property, receiver): unknown {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof property !== "string" || !property.startsWith("produce") || typeof value !== "function") {
        return value;
      }
      const produce = value as (...arguments_: unknown[]) => Promise<unknown>;
      return async (...arguments_: unknown[]): Promise<unknown> => {
        try {
          await budgets.installation("notifications", "notificationsPerHour", "notificationsPerDay");
        } catch (error) {
          if (error instanceof MutationRateLimitExceeded) { return undefined; }
          throw error;
        }
        return produce.apply(target, arguments_);
      };
    },
  });
}
