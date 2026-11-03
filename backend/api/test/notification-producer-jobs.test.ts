import { describe, expect, it } from "vitest";
import type { FieldPacket, QueryResult, ResultSetHeader } from "mysql2";

import {
  MysqlNotificationProducerJobRepository,
  NotificationProducerWorker,
  enqueueOvertakenNotificationJob,
} from "../src/notifications/notification-producer-jobs.js";

class Executor {
  readonly calls: Array<{ sql: string; values: readonly unknown[] }> = [];
  constructor(private readonly results: unknown[] = []) {}
  async execute<T extends QueryResult>(sql: string, values?: any[]) {
    this.calls.push({ sql, values: values ?? [] });
    return [this.results.shift() ?? [], [] as FieldPacket[]] as [T, FieldPacket[]];
  }
}

const header = (affectedRows = 1): ResultSetHeader =>
  ({ affectedRows } as ResultSetHeader);

describe("durable notification producer jobs", () => {
  it("enqueues an idempotent publication-revision job", async () => {
    const executor = new Executor([header()]);
    await enqueueOvertakenNotificationJob(executor as never, 12, 3, 1900);
    expect(executor.calls[0]?.sql).toContain("INSERT IGNORE");
    expect(executor.calls[0]?.values).toEqual([12, 3, 1900, 1900, 1900]);
  });

  it("leases only bounded current work and marks it complete", async () => {
    const executor = new Executor([
      header(), header(),
      [{ jobId: 7, submissionId: "user_submission.time.NOTIFY01" }],
      header(), header(),
    ]);
    const repository = new MysqlNotificationProducerJobRepository(executor as never);
    const produced: string[] = [];
    const worker = new NotificationProducerWorker(repository, {
      async produceOvertaken(id) { produced.push(id); },
    }, () => 2_000);
    await worker.tick();
    expect(produced).toEqual(["user_submission.time.NOTIFY01"]);
    expect(executor.calls.some((call) =>
      call.sql.includes("job_status = 'processing'"))).toBe(true);
    expect(executor.calls.at(-1)?.sql).toContain("job_status = 'completed'");
  });

  it("retries producer failure without throwing into the caller", async () => {
    const executor = new Executor([
      header(), header(),
      [{ jobId: 8, submissionId: "user_submission.time.NOTIFY02" }],
      header(), header(),
    ]);
    const repository = new MysqlNotificationProducerJobRepository(executor as never);
    const worker = new NotificationProducerWorker(repository, {
      async produceOvertaken() { throw new TypeError("temporary"); },
    }, () => 3_000);
    await expect(worker.tick()).resolves.toBeUndefined();
    const failure = executor.calls.at(-1);
    expect(failure?.sql).toContain("attempt_count >= 5");
    expect(failure?.values).toEqual([63_000, 3_000, "TypeError", 8]);
  });

  it("reports only aggregate backlog health and bounds terminal retention", async () => {
    const executor = new Executor([
      [{
        readyCount: 125,
        processingCount: 2,
        deadRecentCount: 1,
        oldestReadyAtMs: 1_000,
      }],
      header(17),
    ]);
    const repository = new MysqlNotificationProducerJobRepository(executor as never);
    await expect(repository.backlog(70_000)).resolves.toEqual({
      readyCount: 125,
      processingCount: 2,
      deadRecentCount: 1,
      oldestReadyAgeMs: 69_000,
    });
    await expect(repository.purgeTerminal(100_000, 10_000, 50_000))
      .resolves.toBe(17);
    expect(executor.calls[1]?.sql).toContain("LIMIT 10000");
    expect(executor.calls[1]?.values).toEqual([90_000]);
  });
});
