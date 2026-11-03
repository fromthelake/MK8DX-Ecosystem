import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  parseWebManualContextDocument,
  WebManualContextDocumentError,
} from "../src/manual-context-document.js";
import {
  decodeWebManualContextJson,
  WEB_MANUAL_CONTEXT_JSON_MAX_BYTES,
} from "../src/manual-context-json.js";


const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

function completeDocument(): Record<string, unknown> {
  return {
    schemaVersion: "mk8dx.web-manual-context.v1",
    submissionId: "user_submission.time.SYNTHETICWEBCONTEXT01",
    revision: 2,
    trackId: "track.mario_kart_stadium",
    playerReference: {
      namespace: "producer_local_profile",
      value: "synthetic-local-profile-01",
    },
    countryId: "country.nl",
    observedPlayerName: "Synthetic Driver",
    producer: {
      version: "phase4-web-context-v1",
      localRecordId: "synthetic-web-local-01",
    },
    timestamps: {
      occurredAtMs: 1_786_900_050_000,
      createdAtMs: 1_786_900_060_000,
    },
  };
}

describe("web manual context document", () => {
  it("maps a complete closed V1 document to existing manual context", () => {
    expect(parseWebManualContextDocument(completeDocument())).toEqual({
      submissionId: "user_submission.time.SYNTHETICWEBCONTEXT01",
      revision: 2,
      trackId: "track.mario_kart_stadium",
      playerReference: {
        namespace: "producer_local_profile",
        value: "synthetic-local-profile-01",
      },
      countryId: "country.nl",
      observedPlayerName: "Synthetic Driver",
      occurredAtMs: 1_786_900_050_000,
      createdAtMs: 1_786_900_060_000,
      producerVersion: "phase4-web-context-v1",
      localRecordId: "synthetic-web-local-01",
    });
  });

  it("accepts the minimal context and a typed central Player", () => {
    const document = completeDocument();
    document.playerReference = {
      namespace: "player",
      value: "player.synthetic_driver",
    };
    delete document.countryId;
    delete document.observedPlayerName;
    delete (document.producer as Record<string, unknown>).localRecordId;
    delete (document.timestamps as Record<string, unknown>).occurredAtMs;
    expect(parseWebManualContextDocument(document)).toEqual({
      submissionId: "user_submission.time.SYNTHETICWEBCONTEXT01",
      revision: 2,
      trackId: "track.mario_kart_stadium",
      playerReference: {
        namespace: "player",
        value: "player.synthetic_driver",
      },
      createdAtMs: 1_786_900_060_000,
      producerVersion: "phase4-web-context-v1",
    });
  });

  it("copies nested identity rather than retaining the caller object", () => {
    const document = completeDocument();
    const context = parseWebManualContextDocument(document);
    (document.playerReference as Record<string, unknown>).value = "changed";
    expect(context.playerReference.value).toBe("synthetic-local-profile-01");
  });

  it.each([
    null,
    [],
    {},
    { ...completeDocument(), schemaVersion: "mk8dx.web-manual-context.v2" },
    { ...completeDocument(), unexpected: true },
    (() => {
      const value = completeDocument();
      delete value.submissionId;
      return value;
    })(),
    { ...completeDocument(), submissionId: "private raw id" },
    { ...completeDocument(), revision: 0 },
    { ...completeDocument(), trackId: "1" },
    { ...completeDocument(), countryId: "NL" },
    { ...completeDocument(), observedPlayerName: "" },
    { ...completeDocument(), playerReference: { namespace: "player", value: "raw" } },
    { ...completeDocument(), producer: { version: "v1", secret: true } },
    { ...completeDocument(), producer: { version: "" } },
    { ...completeDocument(), timestamps: { createdAtMs: -1 } },
    { ...completeDocument(), timestamps: { createdAtMs: 1, capturedAtMs: 2 } },
  ])("rejects malformed or semantically invalid input without detail: %#", (value) => {
    expect(() => parseWebManualContextDocument(value)).toThrow(
      WebManualContextDocumentError,
    );
    expect(() => parseWebManualContextDocument(value)).toThrow(
      "Web manual context document is invalid.",
    );
  });

  it("contains no identity default, storage, Firebase, or network primitive", () => {
    const source = readFileSync(
      `${repositoryRoot}apps/timetrials-web/src/manual-context-document.ts`,
      "utf8",
    );
    expect(source).not.toMatch(
      /firebase|firestore|fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/i,
    );
    expect(source).not.toMatch(/randomUUID|Date\.now|crypto\.|indexedDB/i);
  });
});

describe("web manual context JSON decoder", () => {
  it("returns a fresh parsed unknown value without applying document policy", () => {
    const document = completeDocument();
    const decoded = decodeWebManualContextJson(JSON.stringify(document));
    expect(decoded).toEqual(document);
    expect(decoded).not.toBe(document);
  });

  it("accepts an exact 16 KiB UTF-8 document boundary", () => {
    const json = JSON.stringify(completeDocument());
    const padded = `${" ".repeat(
      WEB_MANUAL_CONTEXT_JSON_MAX_BYTES - Buffer.byteLength(json, "utf8"),
    )}${json}`;
    expect(Buffer.byteLength(padded, "utf8")).toBe(
      WEB_MANUAL_CONTEXT_JSON_MAX_BYTES,
    );
    expect(decodeWebManualContextJson(padded)).toEqual(completeDocument());
  });

  it.each([
    null,
    new Uint8Array(),
    "{",
    `${JSON.stringify(completeDocument())}${" ".repeat(
      WEB_MANUAL_CONTEXT_JSON_MAX_BYTES,
    )}`,
    `"${"é".repeat(WEB_MANUAL_CONTEXT_JSON_MAX_BYTES / 2)}"`,
  ])("rejects non-text, malformed, or oversized UTF-8 input: %#", (value) => {
    expect(() => decodeWebManualContextJson(value)).toThrow(
      WebManualContextDocumentError,
    );
    expect(() => decodeWebManualContextJson(value)).toThrow(
      "Web manual context document is invalid.",
    );
  });

  it("leaves valid-JSON document shape enforcement to the context parser", () => {
    const decoded = decodeWebManualContextJson("null");
    expect(() => parseWebManualContextDocument(decoded)).toThrow(
      WebManualContextDocumentError,
    );
  });

  it("contains no DOM, storage, Firebase, file, or network access", () => {
    const source = readFileSync(
      `${repositoryRoot}apps/timetrials-web/src/manual-context-json.ts`,
      "utf8",
    );
    expect(source).not.toMatch(
      /document\.(?:body|create|get|query)|firebase|firestore|fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/i,
    );
    expect(source).not.toMatch(/readFile|writeFile|indexedDB|Date\.now|randomUUID/i);
  });
});
