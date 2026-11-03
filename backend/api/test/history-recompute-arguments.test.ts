import { describe, expect, it } from "vitest";

import { parseArguments } from "../src/rating/history-recompute-main.js";

// A recompute rewrites what the product says about everybody's level, so the
// argument parsing is the safety gate: it has to be awkward to run by accident
// and impossible to run anonymously.

describe("history recompute arguments", () => {
  it("accepts a fully specified run", () => {
    expect(parseArguments([
      "--confirm-database", "mk8dx", "--parameters", "measured",
      "--operator", "user_account.ben",
    ])).toEqual({
      confirmDatabase: "mk8dx", parameters: "measured",
      operator: "user_account.ben", decay: true, dryRun: false,
    });
  });

  it("requires an operator for a run that writes", () => {
    expect(() => parseArguments([
      "--confirm-database", "mk8dx", "--parameters", "measured",
    ])).toThrow(/--operator/);
  });

  it("lets a dry run go unsigned, because it changes nothing", () => {
    const options = parseArguments([
      "--confirm-database", "mk8dx", "--parameters", "legacy", "--dry-run",
    ]);
    expect(options.dryRun).toBe(true);
    expect(options.operator).toBe("");
  });

  it("will not guess which parameter set was meant", () => {
    expect(() => parseArguments([
      "--confirm-database", "mk8dx", "--parameters", "the new ones",
      "--operator", "user_account.ben",
    ])).toThrow(/'legacy' or 'measured'/);
    expect(() => parseArguments([
      "--confirm-database", "mk8dx", "--operator", "user_account.ben",
    ])).toThrow(/--parameters/);
  });

  it("requires the database name to be retyped", () => {
    expect(() => parseArguments([
      "--parameters", "measured", "--operator", "user_account.ben",
    ])).toThrow(/--confirm-database/);
  });

  it("can turn decay off, which is how the legacy timeline is reproduced", () => {
    expect(parseArguments([
      "--confirm-database", "mk8dx", "--parameters", "legacy",
      "--operator", "user_account.ben", "--no-decay",
    ]).decay).toBe(false);
  });

  it("refuses an argument it does not recognise", () => {
    expect(() => parseArguments([
      "--confirm-database", "mk8dx", "--parameters", "measured",
      "--operator", "user_account.ben", "--force",
    ])).toThrow(/unexpected argument/);
  });
});
