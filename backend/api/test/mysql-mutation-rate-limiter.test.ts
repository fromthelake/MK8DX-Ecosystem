import { describe, expect, it } from "vitest";

import {
  MysqlMutationRateLimiter,
  MutationRateLimitExceeded,
} from "../src/security/mysql-mutation-rate-limiter.js";

describe("database-backed mutation rate limiting", () => {
  it("rejects the event after the account window reaches its maximum", async () => {
    let count = 0;
    const executor = {
      async execute(sql: string) {
        if (sql.includes("INSERT INTO")) { count += 1; return [{ affectedRows: 1 }, []]; }
        return [[{ eventCount: count }], []];
      },
    };
    const limiter = new MysqlMutationRateLimiter(executor as never, () => 61_000);
    await limiter.consume("user_account.ben", "time-trial-submit-10m", 600, 2);
    await limiter.consume("user_account.ben", "time-trial-submit-10m", 600, 2);
    await expect(limiter.consume("user_account.ben", "time-trial-submit-10m", 600, 2))
      .rejects.toBeInstanceOf(MutationRateLimitExceeded);
  });

  it("does not reject a valid mutation when opportunistic cleanup fails", async () => {
    const executor = {
      async execute(sql: string) {
        if (sql.includes("DELETE FROM")) { throw new Error("cleanup unavailable"); }
        if (sql.includes("SELECT event_count")) { return [[{ eventCount: 1 }], []]; }
        return [{ affectedRows: 1 }, []];
      },
    };
    const limiter = new MysqlMutationRateLimiter(executor as never, () => 61_000);

    await expect(limiter.consume("user_account.ben", "time-trial-submit-10m", 600, 2))
      .resolves.toBeUndefined();
  });
});
