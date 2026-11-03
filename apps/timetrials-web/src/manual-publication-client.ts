import {
  createWebManualSubmission,
  type WebManualTimeTrialSubmissionV1,
  type WebTimeTrialVerificationV1,
} from "./manual-submission.js";
import {
  BODY_PARTS, CHARACTER_PARTS, GLIDER_PARTS, TIRE_PARTS,
} from "./loadout-manifest.js";
import { loadoutVariantById } from "./loadout-variants.js";


export const WEB_MANUAL_SUBMISSION_PATH = "/v1/time-trial-submissions";
/**
 * Asks the API to answer with the feedback block (personal best, rank,
 * players passed). It is opt-in on the wire because installed native clients
 * check the acknowledgement for exactly two keys.
 */
export const WEB_MANUAL_SUBMISSION_FEEDBACK_QUERY = "feedback=v1";
export const WEB_MANUAL_PUBLICATION_RESPONSE_MAX_BYTES = 8_192;

export type WebManualPassedPlayer = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
  bestMs: number;
  rival: boolean;
}>;

export type WebManualSubmissionFeedback = Readonly<{
  trackId: string;
  modeCc: 150 | 200;
  totalTimeMs: number;
  personalBest: Readonly<{
    previousBestMs: number | null;
    deltaMs: number | null;
    improved: boolean;
  }>;
  rank: Readonly<{
    after: number;
    before: number | null;
    passed: readonly WebManualPassedPlayer[];
    passedCount: number;
    rivalsPassed: number;
  }>;
}>;

export type WebManualCsrfProof = Readonly<{
  headerName: string;
  value: string;
}>;

export type WebManualPublicationResult = Readonly<{
  submissionId: string;
  revision: number;
  /** Absent when the API could not derive it; the publication still stands. */
  feedback?: WebManualSubmissionFeedback;
}>;

export type WebManualPublicationErrorCode =
  | "invalid_submission"
  | "invalid_session"
  | "network_unavailable"
  | "not_authenticated"
  | "not_authorized"
  | "submission_rejected"
  | "implausible_time"
  | "revision_conflict"
  | "service_unavailable"
  | "invalid_response";

export class WebManualPublicationError extends Error {
  public constructor(
    public readonly code: WebManualPublicationErrorCode,
    public readonly retryable: boolean,
  ) {
    super("The canonical Time Trial submission could not be published.");
    this.name = "WebManualPublicationError";
  }
}

export interface WebManualSameOriginPublicationClient {
  publish(
    submission: WebManualTimeTrialSubmissionV1,
    csrfProof: unknown,
    signal?: AbortSignal,
  ): Promise<WebManualPublicationResult>;
}

type FetchPort = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

function fail(
  code: WebManualPublicationErrorCode,
  retryable = false,
): never {
  throw new WebManualPublicationError(code, retryable);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function nullableInteger(value: unknown): value is number | null {
  return value === null ||
    (typeof value === "number" && Number.isSafeInteger(value));
}

/**
 * The feedback block is presentation only, so a malformed one is dropped
 * rather than turning an accepted publication into a failure.
 */
function feedbackOf(value: unknown): WebManualSubmissionFeedback | null {
  if (!isObject(value) ||
    !exactKeys(value, ["trackId", "modeCc", "totalTimeMs", "personalBest", "rank"], []) ||
    typeof value.trackId !== "string" ||
    (value.modeCc !== 150 && value.modeCc !== 200) ||
    !nonNegativeInteger(value.totalTimeMs)) {
    return null;
  }
  const personalBest = value.personalBest;
  const rank = value.rank;
  if (!isObject(personalBest) ||
    !exactKeys(personalBest, ["previousBestMs", "deltaMs", "improved"], []) ||
    !nullableInteger(personalBest.previousBestMs) ||
    !nullableInteger(personalBest.deltaMs) ||
    typeof personalBest.improved !== "boolean" ||
    !isObject(rank) ||
    !exactKeys(rank, ["after", "before", "passed", "passedCount", "rivalsPassed"], []) ||
    !nonNegativeInteger(rank.after) || rank.after < 1 ||
    !nullableInteger(rank.before) ||
    !Array.isArray(rank.passed) || rank.passed.length > 5 ||
    !nonNegativeInteger(rank.passedCount) ||
    !nonNegativeInteger(rank.rivalsPassed)) {
    return null;
  }
  const passed: WebManualPassedPlayer[] = [];
  for (const entry of rank.passed as unknown[]) {
    if (!isObject(entry) ||
      !exactKeys(entry, ["playerId", "username", "displayName", "bestMs", "rival"], []) ||
      typeof entry.playerId !== "string" ||
      typeof entry.username !== "string" || !/^[a-z0-9_-]{1,64}$/.test(entry.username) ||
      typeof entry.displayName !== "string" || entry.displayName.length > 128 ||
      !nonNegativeInteger(entry.bestMs) ||
      typeof entry.rival !== "boolean") {
      return null;
    }
    passed.push({
      playerId: entry.playerId,
      username: entry.username,
      displayName: entry.displayName,
      bestMs: entry.bestMs,
      rival: entry.rival,
    });
  }
  return {
    trackId: value.trackId,
    modeCc: value.modeCc,
    totalTimeMs: value.totalTimeMs,
    personalBest: {
      previousBestMs: personalBest.previousBestMs,
      deltaMs: personalBest.deltaMs,
      improved: personalBest.improved,
    },
    rank: {
      after: rank.after,
      before: rank.before,
      passed,
      passedCount: rank.passedCount,
      rivalsPassed: rank.rivalsPassed,
    },
  };
}

function canonicalWebManualSubmission(
  value: unknown,
): WebManualTimeTrialSubmissionV1 {
  if (!isObject(value) || !exactKeys(value, [
    "schemaVersion",
    "submissionId",
    "revision",
    "mode",
    "trackId",
    "totalTimeMs",
    "laps",
    "playerReference",
    "source",
    "timestamps",
  ], ["loadout", "countryId", "observedPlayerName", "verification"]) ||
    value.schemaVersion !== "mk8dx.time-trial-submission.v1" ||
    !Array.isArray(value.laps) || ![0, 3, 7].includes(value.laps.length) ||
    !Number.isSafeInteger(value.totalTimeMs) ||
    (value.totalTimeMs as number) < 1 ||
    (value.totalTimeMs as number) > 599_999 ||
    !isObject(value.source) ||
    !exactKeys(value.source, ["kind", "producerVersion"], ["captureLayout", "localRecordId"]) ||
    (value.source.kind !== "web_manual" && value.source.kind !== "web_scan") ||
    !isObject(value.timestamps) ||
    !exactKeys(value.timestamps, ["createdAtMs"], ["occurredAtMs"])) {
    fail("invalid_submission");
  }
  // ADR-0204 provenance, re-derived rather than trusted. The wire guard keeps its job: only what
  // this application can account for goes out, and nothing here can widen publication eligibility.
  const sourceKind = value.source.kind as "web_manual" | "web_scan";
  const captureLayout = Object.hasOwn(value.source, "captureLayout")
    ? value.source.captureLayout
    : undefined;
  if (captureLayout !== undefined &&
    (sourceKind !== "web_scan" ||
      (captureLayout !== "time_trial_result" && captureLayout !== "ghost_details"))) {
    fail("invalid_submission");
  }
  const verification = canonicalVerification(
    Object.hasOwn(value, "verification") ? value.verification : undefined,
    sourceKind,
  );

  const totalTimeMs = value.totalTimeMs as number;
  const minutes = Math.floor(totalTimeMs / 60_000);
  const seconds = Math.floor((totalTimeMs % 60_000) / 1_000);
  const milliseconds = totalTimeMs % 1_000;
  const timeDigits = `${minutes}${seconds.toString().padStart(2, "0")}` +
    milliseconds.toString().padStart(3, "0");

  try {
    const base = createWebManualSubmission({
      submissionId: value.submissionId,
      revision: value.revision,
      mode: value.mode,
      trackId: value.trackId,
      timeDigits,
      playerReference: value.playerReference,
      ...(Object.hasOwn(value, "countryId")
        ? { countryId: value.countryId }
        : {}),
      ...(Object.hasOwn(value, "observedPlayerName")
        ? { observedPlayerName: value.observedPlayerName }
        : {}),
      ...(Object.hasOwn(value.timestamps, "occurredAtMs")
        ? { occurredAtMs: value.timestamps.occurredAtMs }
        : {}),
      createdAtMs: value.timestamps.createdAtMs,
      producerVersion: value.source.producerVersion,
      ...(Object.hasOwn(value.source, "localRecordId")
        ? { localRecordId: value.source.localRecordId }
        : {}),
    });
    const laps = value.laps.map((lap, index) => {
      if (!isObject(lap) ||
        !exactKeys(lap, ["lapNumber", "timeMs"], [
          "coinsCollected", "mushroomsUsed",
        ]) ||
        lap.lapNumber !== index + 1 ||
        !Number.isSafeInteger(lap.timeMs) ||
        (lap.timeMs as number) < 1 || (lap.timeMs as number) > 599_999 ||
        (Object.hasOwn(lap, "coinsCollected") &&
          (!Number.isSafeInteger(lap.coinsCollected) ||
           (lap.coinsCollected as number) < 0 ||
           (lap.coinsCollected as number) > 10))) {
        fail("invalid_submission");
      }
      if (Object.hasOwn(lap, "mushroomsUsed") &&
          (!Number.isSafeInteger(lap.mushroomsUsed) ||
           (lap.mushroomsUsed as number) < 0 ||
           (lap.mushroomsUsed as number) > 3)) {
        fail("invalid_submission");
      }
      return {
        lapNumber: index + 1,
        timeMs: lap.timeMs as number,
        ...(Object.hasOwn(lap, "coinsCollected")
          ? { coinsCollected: lap.coinsCollected as number }
          : {}),
        ...(Object.hasOwn(lap, "mushroomsUsed")
          ? { mushroomsUsed: lap.mushroomsUsed as number }
          : {}),
      };
    });
    // The lap semantics the server also holds: the laps add up to the total, and a race carries at
    // most three mushrooms. `coinsCollected` is the stored balance per lap, 0-10, independent
    // between laps - the payload meaning, which the canonical form's signed entry maps onto
    // (POST_A_TIME §3, SPEC §7 D2/D3). This guard re-derives the payload from the object about to
    // go on the wire; it is not a second form validator.
    if (laps.length > 0) {
      if (laps.reduce((sum, lap) => sum + lap.timeMs, 0) !== totalTimeMs) {
        fail("invalid_submission");
      }
      if (laps.reduce((sum, lap) => sum + (lap.mushroomsUsed ?? 0), 0) > 3) {
        fail("invalid_submission");
      }
    }
    const loadout: Record<string, string> = {};
    if (Object.hasOwn(value, "loadout")) {
      if (!isObject(value.loadout) || Object.keys(value.loadout).length === 0 ||
        !exactKeys(value.loadout, [], [
          "characterId", "bodyId", "tireId", "gliderId",
          "characterVariantId", "bodyVariantId", "gliderVariantId",
        ])) {
        fail("invalid_submission");
      }
      // A scanned colour variant (ADR-0215) travels only beside the base part it is a colour of.
      for (const [variantField, baseField] of [["characterVariantId", "characterId"],
        ["bodyVariantId", "bodyId"], ["gliderVariantId", "gliderId"]] as const) {
        if (!Object.hasOwn(value.loadout, variantField)) { continue; }
        const variantValue = value.loadout[variantField];
        if (typeof variantValue !== "string" ||
          loadoutVariantById(variantValue)?.baseId !== value.loadout[baseField]) {
          fail("invalid_submission");
        }
        loadout[variantField] = variantValue;
      }
      for (const field of [
        "characterId", "bodyId", "tireId", "gliderId",
      ] as const) {
        if (!Object.hasOwn(value.loadout, field)) { continue; }
        const fieldValue = value.loadout[field];
        if (typeof fieldValue !== "string" || !CATALOGUE_PART_IDS.has(fieldValue)) {
          fail("invalid_submission");
        }
        loadout[field] = fieldValue;
      }
    }
    return {
      ...base,
      laps,
      ...(Object.keys(loadout).length === 0 ? {} : { loadout }),
      source: {
        ...base.source,
        kind: sourceKind,
        ...(captureLayout === undefined
          ? {} : { captureLayout: captureLayout as "time_trial_result" | "ghost_details" }),
      },
      ...(verification === null ? {} : { verification }),
    };
  } catch {
    fail("invalid_submission");
  }
}

/**
 * The verification a web submission may carry (ADR-0204 §4). Only a scan may carry one, and only
 * the two states the form can honestly report: it never sends `producer_check_failed` or
 * `needs_review` for a submission it considers valid, so publication eligibility is untouched.
 */
function canonicalVerification(
  value: unknown,
  sourceKind: "web_manual" | "web_scan",
): WebTimeTrialVerificationV1 | null {
  if (value === undefined) { return null; }
  if (sourceKind !== "web_scan" || !isObject(value) ||
    !exactKeys(value, ["status"], ["method", "lapSumMatches", "fieldConfidence", "correctedFields"]) ||
    (value.status !== "producer_check_passed" && value.status !== "not_checked") ||
    (Object.hasOwn(value, "method") &&
      (typeof value.method !== "string" || value.method.length < 1 || value.method.length > 128)) ||
    (Object.hasOwn(value, "lapSumMatches") && typeof value.lapSumMatches !== "boolean")) {
    fail("invalid_submission");
  }
  const fieldConfidence: Record<string, number> = {};
  if (Object.hasOwn(value, "fieldConfidence")) {
    if (!isObject(value.fieldConfidence) ||
      !exactKeys(value.fieldConfidence, [], [...CONFIDENCE_FIELDS])) {
      fail("invalid_submission");
    }
    for (const [key, confidence] of Object.entries(value.fieldConfidence)) {
      if (typeof confidence !== "number" || !Number.isFinite(confidence) ||
        confidence < 0 || confidence > 1) {
        fail("invalid_submission");
      }
      fieldConfidence[key] = confidence;
    }
  }
  const correctedFields: string[] = [];
  if (Object.hasOwn(value, "correctedFields")) {
    if (!Array.isArray(value.correctedFields) || value.correctedFields.length < 1 ||
      value.correctedFields.length > CORRECTED_FIELDS.length ||
      new Set(value.correctedFields).size !== value.correctedFields.length ||
      value.correctedFields.some((group) =>
        typeof group !== "string" || !(CORRECTED_FIELDS as readonly string[]).includes(group))) {
      fail("invalid_submission");
    }
    correctedFields.push(...value.correctedFields as string[]);
  }
  return {
    status: value.status,
    ...(Object.hasOwn(value, "method") ? { method: value.method as string } : {}),
    ...(Object.hasOwn(value, "lapSumMatches")
      ? { lapSumMatches: value.lapSumMatches as boolean } : {}),
    ...(Object.keys(fieldConfidence).length === 0 ? {} : { fieldConfidence }),
    ...(correctedFields.length === 0 ? {} : { correctedFields }),
  };
}

const CONFIDENCE_FIELDS = [
  "totalTime", "track", "character", "characterVariant", "body", "tire", "glider",
  "country", "playerName",
] as const;

const CORRECTED_FIELDS = [
  "track", "mode", "totalTime", "laps", "coins", "mushrooms", "character",
  "characterVariant", "body", "bodyVariant", "tire", "glider", "gliderVariant",
  "country", "playerName",
] as const;

const CATALOGUE_PART_IDS: ReadonlySet<string> = new Set(
  [...CHARACTER_PARTS, ...BODY_PARTS, ...TIRE_PARTS, ...GLIDER_PARTS]
    .map((part) => part.id),
);

const forbiddenCsrfHeaders = new Set([
  "accept",
  "authorization",
  "connection",
  "content-length",
  "content-type",
  "cookie",
  "host",
  "origin",
  "referer",
]);

function csrfHeader(value: unknown): readonly [string, string] {
  if (!isObject(value) ||
    !exactKeys(value, ["headerName", "value"], []) ||
    typeof value.headerName !== "string" ||
    !/^x-[a-z0-9-]{1,62}$/i.test(value.headerName) ||
    forbiddenCsrfHeaders.has(value.headerName.toLowerCase()) ||
    typeof value.value !== "string" ||
    value.value.length < 1 || value.value.length > 4_096 ||
    !/^[\x21-\x7e]+$/.test(value.value)) {
    fail("invalid_session");
  }
  return [value.headerName, value.value];
}

/**
 * The API refuses a time more than 12 % faster than the World Record with its own code (owner
 * 2026-09-28); the page then says so in those words instead of "the server did not accept".
 * Only a small JSON body is read; anything else is an ordinary rejection.
 */
async function isImplausibleTimeRefusal(response: Response): Promise<boolean> {
  try {
    const length = response.headers.get("content-length");
    if (length !== null && Number(length) > 1_024) { return false; }
    const text = await response.text();
    if (text.length > 1_024) { return false; }
    const document = JSON.parse(text) as unknown;
    return isObject(document) && document["code"] === "time_trial_time_implausible";
  } catch {
    return false;
  }
}

function mapStatus(status: number): never {
  if (status === 401) { fail("not_authenticated"); }
  if (status === 403) { fail("not_authorized"); }
  if (status === 409) { fail("revision_conflict"); }
  if (status === 400 || status === 404 || status === 413 || status === 415) {
    fail("submission_rejected");
  }
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    fail("service_unavailable", true);
  }
  fail("invalid_response");
}

async function boundedResult(
  response: Response,
  expected: WebManualTimeTrialSubmissionV1,
): Promise<WebManualPublicationResult> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const declaredLength = response.headers.get("content-length");
  if (!/^application\/json(?:\s*;|$)/.test(contentType) ||
    (declaredLength !== null &&
      (!/^[0-9]+$/.test(declaredLength) ||
        Number(declaredLength) > WEB_MANUAL_PUBLICATION_RESPONSE_MAX_BYTES))) {
    fail("invalid_response");
  }

  if (response.body === null) { fail("invalid_response"); }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let received = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) { break; }
      received += chunk.value.byteLength;
      if (received > WEB_MANUAL_PUBLICATION_RESPONSE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        fail("invalid_response");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    fail("invalid_response");
  }

  let document: unknown;
  try {
    document = JSON.parse(text) as unknown;
  } catch {
    fail("invalid_response");
  }
  if (!isObject(document) ||
    !exactKeys(document, ["submissionId", "revision"], ["feedback"]) ||
    document.submissionId !== expected.submissionId ||
    document.revision !== expected.revision) {
    fail("invalid_response");
  }
  const feedback = Object.hasOwn(document, "feedback")
    ? feedbackOf(document.feedback)
    : null;
  return {
    submissionId: expected.submissionId,
    revision: expected.revision,
    ...(feedback === null ? {} : { feedback }),
  };
}

export function createWebManualSameOriginPublicationClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): WebManualSameOriginPublicationClient {
  return {
    async publish(submission, csrfProof, signal) {
      const canonical = canonicalWebManualSubmission(submission);
      const [csrfName, csrfValue] = csrfHeader(csrfProof);
      const body = JSON.stringify(canonical);
      if (new TextEncoder().encode(body).byteLength > 65_536) {
        fail("invalid_submission");
      }

      let response: Response;
      try {
        response = await fetchPort(
          `${WEB_MANUAL_SUBMISSION_PATH}?${WEB_MANUAL_SUBMISSION_FEEDBACK_QUERY}`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            [csrfName]: csrfValue,
          },
          body,
          credentials: "same-origin",
          mode: "same-origin",
          redirect: "error",
          referrerPolicy: "same-origin",
          cache: "no-store",
          ...(signal === undefined ? {} : { signal }),
        });
      } catch (error) {
        if (error instanceof WebManualPublicationError) { throw error; }
        fail("network_unavailable", true);
      }

      if (response.status === 400 && await isImplausibleTimeRefusal(response)) {
        fail("implausible_time");
      }
      if (response.status !== 201) { mapStatus(response.status); }
      return boundedResult(response, canonical);
    },
  };
}
