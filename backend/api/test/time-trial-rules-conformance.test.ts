// T-CONF server runner (TESTING_STRATEGY §4.10). The server stays the
// authority: every valid case's normalised payload must be accepted by the
// existing validateTimeTrialSubmission, and every payload-level invalid case
// (one that carries a serverProbe) must be rejected with the matching reason.
// Probes the server accepts although the rules refuse them are the open
// discrepancies recorded in packages/time-trial-rules/SPEC.md.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  TimeTrialSubmissionError,
  validateTimeTrialSubmission,
} from "../src/timetrials/submission-service.js";

type ServerExpectation = Readonly<{ accepts: boolean; reason?: string; discrepancy?: string }>;
type ConformanceCase = Readonly<{
  id: string;
  category: string;
  deferred?: string;
  serverProbe?: Record<string, unknown>;
  expect: Readonly<{
    valid: boolean;
    errors: readonly Readonly<{ rule: string }>[];
    payload: Record<string, unknown> | null;
    server?: ServerExpectation;
    // ADR-0204 provenance; the server has to accept exactly what the clients state.
    sourceKind?: string | null;
    captureLayout?: string;
    verificationStatus?: string;
    correctedFields?: readonly string[];
  }>;
}>;

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..",
  "packages", "time-trial-rules");
const file = JSON.parse(readFileSync(join(packageDir, "conformance", "cases.json"), "utf8")) as {
  cases: readonly ConformanceCase[];
};
const rules = JSON.parse(readFileSync(join(packageDir, "rules.json"), "utf8")) as {
  rules: readonly Readonly<{ id: string; serverReason: string | null }>[];
};
const serverReason = new Map(rules.rules.map((rule) => [rule.id, rule.serverReason]));

/**
 * The provenance a case states, put on the envelope (ADR-0204). A case that says nothing about it
 * keeps the historical `web_manual` envelope, so the existing cases are unchanged.
 */
function provenance(testCase: ConformanceCase): Record<string, unknown> {
  const stated = testCase.expect;
  if (stated.sourceKind === undefined || stated.sourceKind === null) {
    return { source: { kind: "web_manual", producerVersion: "time-trial-rules-conformance" } };
  }
  return {
    source: {
      kind: stated.sourceKind,
      ...(stated.captureLayout === undefined ? {} : { captureLayout: stated.captureLayout }),
      producerVersion: "time-trial-rules-conformance",
    },
    ...(stated.verificationStatus === undefined ? {} : {
      verification: {
        status: stated.verificationStatus,
        ...(stated.correctedFields === undefined ? {} : { correctedFields: stated.correctedFields }),
      },
    }),
  };
}

function envelope(
  fragment: Record<string, unknown>,
  index: number,
  source: Record<string, unknown> = {
    source: { kind: "web_manual", producerVersion: "time-trial-rules-conformance" },
  },
): Record<string, unknown> {
  return {
    schemaVersion: "mk8dx.time-trial-submission.v1",
    submissionId: `user_submission.time.CONFORMANCE${String(index).padStart(3, "0")}`,
    revision: 1,
    ...fragment,
    playerReference: { namespace: "player", value: "player.conformance_runner" },
    ...source,
    timestamps: { createdAtMs: 1_786_901_020_000 },
  };
}

function outcome(submission: unknown): { accepts: true } | { accepts: false; code: string; reason: string } {
  try {
    validateTimeTrialSubmission(submission);
    return { accepts: true };
  } catch (error) {
    if (!(error instanceof TimeTrialSubmissionError)) { throw error; }
    return { accepts: false, code: error.code, reason: error.message };
  }
}

const active = file.cases.filter((c) => c.deferred === undefined);
const validCases = active.filter((c) => c.expect.valid);
const probedCases = active.filter((c) => !c.expect.valid && c.serverProbe !== undefined);
const clientOnly = active.filter((c) => !c.expect.valid && c.serverProbe === undefined);

describe("time-trial-rules conformance (server payload subset)", () => {
  it.each(validCases.map((c) => [c.id, c] as const))(
    "accepts the normalised payload of %s",
    (_id, testCase) => {
      const index = file.cases.indexOf(testCase);
      expect(outcome(envelope(testCase.expect.payload!, index, provenance(testCase))))
        .toEqual({ accepts: true });
    },
  );

  it("refuses a capture layout on a submission that was not scanned", () => {
    expect(outcome(envelope(
      { mode: 150, trackId: "track.mario_kart_stadium", totalTimeMs: 105_912, laps: [] },
      0,
      {
        source: {
          kind: "web_manual", captureLayout: "time_trial_result",
          producerVersion: "time-trial-rules-conformance",
        },
      },
    ))).toEqual({
      accepts: false, code: "invalid_submission", reason: "source captureLayout is invalid",
    });
  });

  it.each(["livetrial_capture", "livetrial_recorded_video"])(
    "accepts a %s result read from the Select-a-Ghost panel (ADR-0210)",
    (kind) => {
      const panel = {
        mode: 200, trackId: "track.sunshine_airport", totalTimeMs: 105_437,
        laps: [
          { lapNumber: 1, timeMs: 36_149 }, { lapNumber: 2, timeMs: 34_868 },
          { lapNumber: 3, timeMs: 34_420 },
        ],
      };
      const source = { source: { kind, captureLayout: "ghost_details", producerVersion: "3.25.0" } };
      expect(outcome(envelope(panel, 1, source))).toEqual({ accepts: true });
      // collapsed panel: a total without splits
      expect(outcome(envelope({ ...panel, laps: [] }, 2, source))).toEqual({ accepts: true });
      expect(outcome(envelope(panel, 3, { source: { ...source.source, captureLayout: "ghost" } })))
        .toEqual({ accepts: false, code: "invalid_submission", reason: "source captureLayout is invalid" });
    },
  );

  it.each(probedCases.map((c) => [c.id, c] as const))(
    "answers the payload probe of %s as recorded",
    (_id, testCase) => {
      const index = file.cases.indexOf(testCase);
      const server = testCase.expect.server;
      expect(server, "a probed case states the server expectation").toBeDefined();
      const actual = outcome(envelope(testCase.serverProbe!, index));
      if (server!.accepts) {
        expect(server!.discrepancy, "a refused-but-accepted probe names its discrepancy").toMatch(/^D[0-9]+$/);
        expect(actual).toEqual({ accepts: true });
        return;
      }
      expect(actual).toEqual({ accepts: false, code: "invalid_submission", reason: server!.reason });
      expect(serverReason.get(testCase.expect.errors[0]!.rule),
        "rules.json serverReason of the first expected rule").toBe(server!.reason);
    },
  );

  it("reports what it ran and what is client-only or deferred", () => {
    const deferred = file.cases.length - active.length;
    console.info(
      `time-trial-rules server runner: ${validCases.length} valid payloads, ` +
      `${probedCases.length} payload probes, ${clientOnly.length} client-only invalid cases ` +
      `(not expressible as a payload), ${deferred} deferred`,
    );
    expect(validCases.length).toBeGreaterThan(0);
    expect(probedCases.length).toBeGreaterThan(0);
  });
});
