import { describe, expect, it } from "vitest";

import {
  FirebaseImportCliError,
  parseFirebaseImportArguments,
} from "../src/migration/firebase-import-main.js";

describe("Firebase import CLI arguments", () => {
  it("requires an explicit restricted plan path", () => {
    expect(parseFirebaseImportArguments(["--plan", "C:/restricted/plan.json"]))
      .toEqual({ planPath: "C:/restricted/plan.json", reportPath: null });
    expect(() => parseFirebaseImportArguments([])).toThrow(
      FirebaseImportCliError,
    );
    expect(() => parseFirebaseImportArguments(["--plan"])).toThrow(
      FirebaseImportCliError,
    );
    expect(() => parseFirebaseImportArguments(["--report", "x", "--plan", "y"]))
      .toThrow(FirebaseImportCliError);
  });

  it("accepts one optional new report path and nothing else", () => {
    expect(parseFirebaseImportArguments([
      "--plan", "plan.json", "--report", "report.json",
    ])).toEqual({ planPath: "plan.json", reportPath: "report.json" });
    expect(() => parseFirebaseImportArguments([
      "--plan", "plan.json", "--output", "report.json",
    ])).toThrow(FirebaseImportCliError);
    expect(() => parseFirebaseImportArguments([
      "--plan", "plan.json", "--report", "report.json", "--force",
    ])).toThrow(FirebaseImportCliError);
  });
});
