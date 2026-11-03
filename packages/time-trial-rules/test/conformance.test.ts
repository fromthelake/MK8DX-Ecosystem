// T-CONF TypeScript runner (TESTING_STRATEGY §4.10). Runs every non-deferred
// case of conformance/cases.json and reports the deferred count explicitly.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  formatMessage,
  scanConflicts,
  submissionProvenance,
  suggestMissingLap,
  validateDraft,
  type SubmissionDraft,
  type ValidationContext,
} from "../src/index.ts";

type ExpectedError = {
  field: string;
  rule: string;
  messageKey?: string;
  params?: Record<string, number | string>;
};
type ConformanceCase = {
  id: string;
  category: string;
  deferred?: string;
  context: ValidationContext;
  draft: SubmissionDraft;
  steps?: { action: string; totalDigits?: string }[];
  expect: {
    valid: boolean;
    errors: ExpectedError[];
    payload: unknown;
    // ADR-0204 provenance. A case states only what it is about, so each key is checked when present.
    sourceKind?: string | null;
    captureLayout?: string;
    verificationStatus?: string;
    correctedFields?: string[];
    /** Field paths a re-scan must ask about instead of overwriting. */
    pendingProposal?: string[];
  };
};

const root = join(import.meta.dirname, "..");
const file = JSON.parse(readFileSync(join(root, "conformance", "cases.json"), "utf8")) as {
  cases: ConformanceCase[];
};
const active = file.cases.filter((c) => c.deferred === undefined);
const deferred = file.cases.filter((c) => c.deferred !== undefined);

describe("time-trial-rules conformance (TypeScript)", () => {
  for (const testCase of active) {
    it(`${testCase.category} / ${testCase.id}`, () => {
      const result = validateDraft(testCase.draft, testCase.context);
      assert.equal(result.valid, testCase.expect.valid, "valid");
      assert.deepEqual(
        result.errors.map((e) => ({ field: e.field, rule: e.rule })),
        testCase.expect.errors.map((e) => ({ field: e.field, rule: e.rule })),
        "errors[].field/rule",
      );
      testCase.expect.errors.forEach((expected, index) => {
        const actual = result.errors[index]!;
        if (expected.messageKey !== undefined) {
          assert.equal(actual.messageKey, expected.messageKey, `errors[${index}].messageKey`);
        }
        if (expected.params !== undefined) {
          assert.deepEqual(actual.params, expected.params, `errors[${index}].params`);
        }
      });
      assert.deepEqual(result.payload, testCase.expect.payload, "normalised payload");
      // ADR-0204: how the draft was filled in. The platform is read from the expected source kind,
      // so the one case file can state both clients' answer for the same draft.
      const expected = testCase.expect;
      if (expected.sourceKind !== undefined && expected.sourceKind !== null) {
        const provenance = submissionProvenance(
          testCase.draft,
          expected.sourceKind.startsWith("android_") ? "android" : "web",
        );
        assert.equal(provenance.sourceKind, expected.sourceKind, "source.kind");
        if (expected.captureLayout !== undefined) {
          assert.equal(provenance.captureLayout, expected.captureLayout, "source.captureLayout");
        }
        if (expected.verificationStatus !== undefined) {
          assert.equal(provenance.verificationStatus, expected.verificationStatus,
            "verification.status");
        }
        if (expected.correctedFields !== undefined) {
          assert.deepEqual(provenance.correctedFields, expected.correctedFields,
            "verification.correctedFields");
        }
      }
      if (expected.pendingProposal !== undefined) {
        const rescan = (testCase.steps ?? []).find((step) => step.action === "rescan");
        assert.ok(rescan !== undefined, "a pendingProposal case needs a rescan step");
        assert.deepEqual(
          scanConflicts(testCase.draft, {
            ...(rescan.totalDigits === undefined ? {} : { totalDigits: rescan.totalDigits }),
          }),
          expected.pendingProposal,
          "the fields a re-scan must ask about",
        );
      }
    });
  }

  it("reports deferred cases explicitly", (t) => {
    const byReason = new Map<string, number>();
    for (const c of deferred) { byReason.set(c.deferred!, (byReason.get(c.deferred!) ?? 0) + 1); }
    t.diagnostic(`ran ${active.length} cases; skipped ${deferred.length} deferred: ` +
      [...byReason].map(([reason, count]) => `${reason}=${count}`).join(", "));
    assert.ok(active.length > 0);
  });
});

describe("helpers", () => {
  it("suggests the missing lap only when it is determined", () => {
    assert.deepEqual(suggestMissingLap("145912", ["035300", "", "035220"]),
      { lap: 2, timeMs: 35392, digits: "035392" });
    assert.equal(suggestMissingLap("145912", ["035300", "", ""]), null);
    assert.equal(suggestMissingLap("", ["035300", "035220", ""]), null);
    assert.equal(suggestMissingLap("145912", ["035392", "035300", "035220"]), null);
    assert.equal(suggestMissingLap("000100", ["000100", "000001", ""]), null);
  });

  it("formats the frozen spec examples", () => {
    assert.equal(formatMessage("Your laps add up to {lapSumMs}, the total is {totalMs}.",
      { lapSumMs: 106012, totalMs: 105912 }),
    "Your laps add up to 1:46.012, the total is 1:45.912.");
    assert.equal(formatMessage("{change}", { change: -2 }), "−2");
    assert.equal(formatMessage("{change}", { change: 4 }), "+4");
  });
});
