import { describe, expect, it } from "vitest";

import {
  FirebaseBackoutCliError,
  parseFirebaseBackoutArguments,
} from "../src/migration/firebase-backout-main.js";

describe("Firebase backout CLI arguments", () => {
  it("accepts exactly one import run or explicit record keys", () => {
    expect(parseFirebaseBackoutArguments(["--run", "migration_import_run.x1"]))
      .toEqual({
        request: { importRunId: "migration_import_run.x1" },
        reportPath: null,
      });
    expect(parseFirebaseBackoutArguments([
      "--record-key", `firebase_record.${"a".repeat(32)}`,
      "--record-key", `firebase_record.${"b".repeat(32)}`,
      "--report", "backout-report.json",
    ])).toEqual({
      request: {
        recordKeys: [
          `firebase_record.${"a".repeat(32)}`,
          `firebase_record.${"b".repeat(32)}`,
        ],
      },
      reportPath: "backout-report.json",
    });
  });

  it("rejects missing, mixed, duplicate, and unknown flags", () => {
    expect(() => parseFirebaseBackoutArguments([])).toThrow(
      FirebaseBackoutCliError,
    );
    expect(() => parseFirebaseBackoutArguments([
      "--run", "migration_import_run.x1",
      "--record-key", `firebase_record.${"a".repeat(32)}`,
    ])).toThrow(FirebaseBackoutCliError);
    expect(() => parseFirebaseBackoutArguments([
      "--run", "migration_import_run.x1", "--run", "migration_import_run.x2",
    ])).toThrow(FirebaseBackoutCliError);
    expect(() => parseFirebaseBackoutArguments([
      "--plan", "plan.json",
    ])).toThrow(FirebaseBackoutCliError);
    expect(() => parseFirebaseBackoutArguments(["--run"])).toThrow(
      FirebaseBackoutCliError,
    );
  });
});
