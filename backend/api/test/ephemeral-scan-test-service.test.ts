import { describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";

import {
  ANDROID_SCAN_TEST_RETENTION_MS,
  EphemeralAndroidScanTestService,
} from "../src/timetrials/ephemeral-scan-test-service.js";
import type { TimeTrialSubmissionV1 } from
  "../src/timetrials/submission-service.js";

function submission(): TimeTrialSubmissionV1 {
  return {
    schemaVersion: "mk8dx.time-trial-submission.v1",
    submissionId: "user_submission.time.TESTSCAN001",
    revision: 1,
    mode: 150,
    trackId: "track.mario_kart_stadium",
    totalTimeMs: 90_000,
    laps: [
      { lapNumber: 1, timeMs: 30_000 },
      { lapNumber: 2, timeMs: 30_000 },
      { lapNumber: 3, timeMs: 30_000 },
    ],
    playerReference: { namespace: "player", value: "player.ben" },
    source: { kind: "android_scan_test", producerVersion: "android-2.2" },
    timestamps: { createdAtMs: 123 },
  };
}

describe("ephemeral Android scan tests", () => {
  it("stores outside competitive tables with server-owned 24-hour expiry", async () => {
    const nowMs = 1_787_472_000_000;
    const execute = vi.fn()
      .mockResolvedValueOnce([{ affectedRows: 2 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const service = new EphemeralAndroidScanTestService(
      { execute } as unknown as Pool,
      { validateReferences: vi.fn(async () => []) },
      { nowMs: () => nowMs },
    );
    await expect(service.submit(submission(), "user_account.ben")).resolves.toEqual({
      submissionId: "user_submission.time.TESTSCAN001",
      revision: 1,
    });
    expect(execute.mock.calls[0]?.[0]).toContain("DELETE FROM ephemeral_time_trial_scan_tests");
    const parameters = execute.mock.calls[1]?.[1] as readonly unknown[];
    expect(parameters).toContain(nowMs);
    expect(parameters).toContain(nowMs + ANDROID_SCAN_TEST_RETENTION_MS);
    expect(execute.mock.calls[1]?.[0]).not.toContain("time_trial_submission_revisions");
    expect(execute.mock.calls[1]?.[0]).not.toContain("CAST(? AS JSON)");
    expect(parameters).toContain(JSON.stringify(submission()));
  });

  it("purges before listing and returns only active account-owned summaries", async () => {
    const nowMs = 1_787_472_000_000;
    const execute = vi.fn()
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ submissionId: "user_submission.time.TESTSCAN001",
        revision: 1, playerId: "player.ben", mode: 150,
        trackId: "track.mario_kart_stadium", totalTimeMs: 90_000,
        createdAtMs: nowMs - 1_000, expiresAtMs: nowMs + 86_399_000 }]]);
    const service = new EphemeralAndroidScanTestService(
      { execute } as unknown as Pool,
      { validateReferences: vi.fn(async () => []) },
      { nowMs: () => nowMs },
    );
    const results = await service.listForAccount("user_account.ben");
    expect(results).toHaveLength(1);
    expect(results[0]?.expiresAtMs).toBe(nowMs + 86_399_000);
    expect(execute.mock.calls[1]?.[1]).toEqual(["user_account.ben", nowMs]);
  });
});
