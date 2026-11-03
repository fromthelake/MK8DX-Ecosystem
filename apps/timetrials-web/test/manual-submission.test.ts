import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  WebManualSubmissionError,
  createWebManualSubmission,
  parseWebManualTimeDigits,
  type WebManualSubmissionInput,
} from "../src/manual-submission.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

function json(relativePath: string): object {
  return JSON.parse(readFileSync(`${repositoryRoot}${relativePath}`, "utf8")) as object;
}

const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
ajv.addSchema(json("packages/domain/schemas/asset-id-v1.schema.json"));
ajv.addSchema(json("packages/domain/schemas/identity-reference-v1.schema.json"));
const canonical = ajv.compile(
  json("packages/domain/schemas/time-trial-submission-v1.schema.json"),
);

function input(): WebManualSubmissionInput {
  return {
    submissionId: "user_submission.time.SYNTHETICWEBMANUAL01",
    revision: 1,
    mode: 150,
    trackId: "track.mario_kart_stadium",
    timeDigits: "134612",
    countryId: "country.nl",
    playerReference: {
      namespace: "producer_local_profile",
      value: "synthetic-local-profile-01",
    },
    observedPlayerName: "Synthetic Web Racer",
    occurredAtMs: 1_786_900_000_000,
    createdAtMs: 1_786_900_060_000,
    producerVersion: "phase4-web-manual-v1",
    localRecordId: "synthetic-local-record-01",
  };
}

describe("web manual Time Trial V1 mapper", () => {
  it("maps the preserved total-only form semantics to canonical V1", () => {
    const result = createWebManualSubmission(input());

    expect(result).toEqual({
      schemaVersion: "mk8dx.time-trial-submission.v1",
      submissionId: "user_submission.time.SYNTHETICWEBMANUAL01",
      revision: 1,
      mode: 150,
      trackId: "track.mario_kart_stadium",
      totalTimeMs: 94_612,
      laps: [],
      countryId: "country.nl",
      playerReference: {
        namespace: "producer_local_profile",
        value: "synthetic-local-profile-01",
      },
      observedPlayerName: "Synthetic Web Racer",
      source: {
        kind: "web_manual",
        producerVersion: "phase4-web-manual-v1",
        localRecordId: "synthetic-local-record-01",
      },
      timestamps: {
        occurredAtMs: 1_786_900_000_000,
        createdAtMs: 1_786_900_060_000,
      },
    });
    expect(canonical(result)).toBe(true);
    expect(canonical.errors).toBeNull();
    expect(result).not.toHaveProperty("visible");
    expect(result).not.toHaveProperty("trackIndex");
    expect(result).not.toHaveProperty("playerUid");
  });

  it("supports the exact positive M:SS.mmm display range", () => {
    expect(parseWebManualTimeDigits("000001")).toBe(1);
    expect(parseWebManualTimeDigits("059999")).toBe(59_999);
    expect(parseWebManualTimeDigits("100000")).toBe(60_000);
    expect(parseWebManualTimeDigits("959999")).toBe(599_999);
  });

  it.each([
    ["incomplete", "12345"],
    ["formatted", "1:34.612"],
    ["negative", "-00001"],
    ["zero", "000000"],
    ["seconds overflow", "160000"],
    ["too many digits", "1000000"],
  ])("rejects %s time digits with one bounded error", (_label, value) => {
    expect(() => parseWebManualTimeDigits(value)).toThrow(
      new WebManualSubmissionError("invalid_time"),
    );
  });

  it.each([
    ["extra input", { privateFirebaseUid: "private-uid" }, "invalid_shape"],
    ["submission id", { submissionId: "legacy_private_name" }, "invalid_submission_id"],
    ["revision", { revision: 0 }, "invalid_revision"],
    ["mode", { mode: 100 }, "invalid_mode"],
    ["track", { trackId: "4" }, "invalid_track"],
    ["time", { timeDigits: "160000" }, "invalid_time"],
    ["player reference", {
      playerReference: { namespace: "player", value: "Private Display Name" },
    }, "invalid_player_reference"],
    ["country", { countryId: "Netherlands" }, "invalid_country"],
    ["observed name", { observedPlayerName: "" }, "invalid_observed_name"],
    ["timestamp", { createdAtMs: -1 }, "invalid_timestamps"],
    ["source", { producerVersion: "" }, "invalid_source"],
  ])("rejects invalid %s without echoing the input", (_label, change, code) => {
    const invalid = { ...input(), ...change };
    let failure: unknown;
    try {
      createWebManualSubmission(invalid);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code });
    expect(String(failure)).not.toMatch(/private-uid|Private Display Name/);
  });

  it("does not mutate caller-owned identity input", () => {
    const source = input();
    const result = createWebManualSubmission(source);
    (source.playerReference as { value: string }).value = "changed-after-map";

    expect(result.playerReference.value).toBe("synthetic-local-profile-01");
  });

  it("contains no Firebase or network runtime dependency", () => {
    const source = readFileSync(
      `${repositoryRoot}apps/timetrials-web/src/manual-submission.ts`,
      "utf8",
    );
    expect(source).not.toMatch(
      /(?:from\s+|import\s*\()[^\n]*(?:firebase|firestore)/i,
    );
    expect(source).not.toMatch(/https?:|fetch\s*\(|XMLHttpRequest/i);
  });
});
