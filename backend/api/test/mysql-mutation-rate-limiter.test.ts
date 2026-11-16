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
  it("runs the upsert again when InnoDB picks it as a deadlock victim, and counts it once", async () => {
    let upserts = 0;
    const deadlock = Object.assign(new Error("Deadlock found when trying to get lock"), { code: "ER_LOCK_DEADLOCK", errno: 1213 });
    const executor = {
      async execute(sql: string) {
        if (sql.includes("INSERT INTO")) {
          upserts += 1;
          if (upserts === 1) { throw deadlock; }
          return [{ affectedRows: 1, insertId: 1 }, []];
        }
        return [{ affectedRows: 0 }, []];
      },
    };
    const limiter = new MysqlMutationRateLimiter(executor as never, () => 61_000);
    await expect(limiter.consume("preauth-slot.7", "auth-email.address", 3_600, 1)).resolves.toBeUndefined();
    expect(upserts).toBe(2);
  });

  it("gives up after a bounded number of deadlocks and never retries other errors", async () => {
    let upserts = 0;
    const failWith = (error: Error) => ({
      async execute(sql: string) {
        if (sql.includes("INSERT INTO")) { upserts += 1; throw error; }
        return [{ affectedRows: 0 }, []];
      },
    });
    const deadlock = Object.assign(new Error("Deadlock"), { code: "ER_LOCK_DEADLOCK" });
    await expect(new MysqlMutationRateLimiter(failWith(deadlock) as never, () => 61_000)
      .consume("preauth-slot.7", "auth-email.address", 3_600, 1)).rejects.toBe(deadlock);
    expect(upserts).toBe(4);
    upserts = 0;
    const other = Object.assign(new Error("gone"), { code: "PROTOCOL_CONNECTION_LOST" });
    await expect(new MysqlMutationRateLimiter(failWith(other) as never, () => 61_000)
      .consume("preauth-slot.7", "auth-email.address", 3_600, 1)).rejects.toBe(other);
    expect(upserts).toBe(1);
  });
});
