import { createHash } from "node:crypto";

import {
  validateTimeTrialSubmission,
  type TimeTrialSubmissionV1,
} from "../timetrials/submission-service.js";

const recordKeyPattern = /^firebase_record\.[a-f0-9]{32}$/;
const sha256HexPattern = /^[a-f0-9]{64}$/;
const resolutionIdPattern =
  /^migration_identity_resolution\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const grantIdPattern = /^administrator_grant\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const reasonCodePattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const systemReferencePattern = /^legacy_system\.[a-z0-9_]+$/;
const maxEpochMs = 253_402_300_799_999;

export const FIREBASE_IMPORT_PLAN_SCHEMA_VERSION =
  "mk8dx.firebase-timetrial-import-plan.v1";
export const FIREBASE_IMPORT_RUNNER_VERSION =
  "firebase-timetrial-batch-dry-run.v1";

export type FirebaseImportResolution = Readonly<{
  resolutionId: string;
  playerId: string;
  expectedPlayerRevision: number;
  administratorGrantId: string;
  reasonCode: string;
  reviewedAtMs: number;
}>;

export type FirebaseImportPlanRecordBase = Readonly<{
  recordKey: string;
  candidateSha256: string;
  candidate: TimeTrialSubmissionV1;
  legacyVisible: boolean | null;
}>;

export type FirebaseReviewedPlayerPlanRecord = FirebaseImportPlanRecordBase &
  Readonly<{
    recordKind: "reviewed_player";
    legacyOwner: Readonly<{ namespace: "legacy_firebase_user"; value: string }>;
    resolution: FirebaseImportResolution;
  }>;

export type FirebaseSystemReferencePlanRecord = FirebaseImportPlanRecordBase &
  Readonly<{
    recordKind: "system_reference";
    systemReference: Readonly<{
      namespace: "unresolved_observation";
      value: string;
    }>;
  }>;

export type FirebaseImportPlanRecord =
  | FirebaseReviewedPlayerPlanRecord
  | FirebaseSystemReferencePlanRecord;

export type FirebaseImportPlan = Readonly<{
  schemaVersion: typeof FIREBASE_IMPORT_PLAN_SCHEMA_VERSION;
  runnerVersion: typeof FIREBASE_IMPORT_RUNNER_VERSION;
  inputSha256: string;
  records: readonly FirebaseImportPlanRecord[];
}>;

export class FirebaseImportPlanError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "FirebaseImportPlanError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === required.length &&
    required.every((key) => Object.hasOwn(value, key));
}

function escapeNonAscii(encoded: string): string {
  let result = "";
  for (const unit of encoded) {
    const code = unit.codePointAt(0) as number;
    if (code < 0x80) {
      result += unit;
      continue;
    }
    for (let index = 0; index < unit.length; index += 1) {
      result += `\\u${unit.charCodeAt(index).toString(16).padStart(4, "0")}`;
    }
  }
  return result;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new FirebaseImportPlanError(
        "plan values must be safe integers for canonical hashing",
      );
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return escapeNonAscii(JSON.stringify(value));
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (isObject(value)) {
    const entries = Object.keys(value).sort().map((key) =>
      `${escapeNonAscii(JSON.stringify(key))}:${canonicalJson(value[key])}`
    );
    return `{${entries.join(",")}}`;
  }
  throw new FirebaseImportPlanError("plan contains an unsupported value type");
}

export function candidateCanonicalSha256(candidate: unknown): string {
  return createHash("sha256").update(canonicalJson(candidate), "utf8")
    .digest("hex");
}

function validateResolution(value: unknown): FirebaseImportResolution {
  if (!isObject(value) || !hasExactKeys(value, [
    "resolutionId",
    "playerId",
    "expectedPlayerRevision",
    "administratorGrantId",
    "reasonCode",
    "reviewedAtMs",
  ])) {
    throw new FirebaseImportPlanError("plan resolution shape is invalid");
  }
  const {
    resolutionId, playerId, expectedPlayerRevision, administratorGrantId,
    reasonCode, reviewedAtMs,
  } = value;
  if (
    typeof resolutionId !== "string" || resolutionId.length > 160 ||
    !resolutionIdPattern.test(resolutionId) ||
    typeof playerId !== "string" || playerId.length > 135 ||
    !playerIdPattern.test(playerId) ||
    !Number.isSafeInteger(expectedPlayerRevision) ||
    (expectedPlayerRevision as number) < 1 ||
    typeof administratorGrantId !== "string" ||
    administratorGrantId.length > 156 ||
    !grantIdPattern.test(administratorGrantId) ||
    typeof reasonCode !== "string" || reasonCode.length > 64 ||
    !reasonCodePattern.test(reasonCode) ||
    !Number.isSafeInteger(reviewedAtMs) ||
    (reviewedAtMs as number) < 0 || (reviewedAtMs as number) > maxEpochMs
  ) {
    throw new FirebaseImportPlanError("plan resolution value is invalid");
  }
  return {
    resolutionId,
    playerId,
    expectedPlayerRevision: expectedPlayerRevision as number,
    administratorGrantId,
    reasonCode,
    reviewedAtMs: reviewedAtMs as number,
  };
}

function validateRecordBase(
  value: Record<string, unknown>,
): FirebaseImportPlanRecordBase {
  const { recordKey, candidateSha256, candidate, legacyVisible } = value;
  if (typeof recordKey !== "string" || !recordKeyPattern.test(recordKey) ||
    typeof candidateSha256 !== "string" ||
    !sha256HexPattern.test(candidateSha256)) {
    throw new FirebaseImportPlanError("plan record identity is invalid");
  }
  if (legacyVisible !== null && typeof legacyVisible !== "boolean") {
    throw new FirebaseImportPlanError("plan legacy visibility is invalid");
  }
  validateTimeTrialSubmission(candidate);
  if (candidate.source.kind !== "web_manual" &&
    candidate.source.kind !== "android_manual") {
    throw new FirebaseImportPlanError(
      "plan candidates must use a supported legacy source kind",
    );
  }
  if (candidateCanonicalSha256(candidate) !== candidateSha256) {
    throw new FirebaseImportPlanError(
      "plan candidate hash does not match its content",
    );
  }
  return { recordKey, candidateSha256, candidate, legacyVisible };
}

function validatePlanRecord(value: unknown): FirebaseImportPlanRecord {
  if (!isObject(value)) {
    throw new FirebaseImportPlanError("plan record shape is invalid");
  }
  if (value["recordKind"] === "reviewed_player") {
    if (!hasExactKeys(value, [
      "recordKind",
      "recordKey",
      "candidateSha256",
      "candidate",
      "legacyVisible",
      "legacyOwner",
      "resolution",
    ])) {
      throw new FirebaseImportPlanError("plan record shape is invalid");
    }
    const base = validateRecordBase(value);
    if (base.candidate.playerReference.namespace !== "player") {
      throw new FirebaseImportPlanError(
        "reviewed plan candidates must target one central Player",
      );
    }
    const legacyOwner = value["legacyOwner"];
    if (!isObject(legacyOwner) ||
      !hasExactKeys(legacyOwner, ["namespace", "value"]) ||
      legacyOwner["namespace"] !== "legacy_firebase_user" ||
      typeof legacyOwner["value"] !== "string" ||
      legacyOwner["value"].length < 1 || legacyOwner["value"].length > 128) {
      throw new FirebaseImportPlanError("plan legacy owner is invalid");
    }
    const resolution = validateResolution(value["resolution"]);
    if (base.candidate.playerReference.value !== resolution.playerId) {
      throw new FirebaseImportPlanError(
        "plan candidate Player must match its reviewed resolution",
      );
    }
    return {
      ...base,
      recordKind: "reviewed_player",
      legacyOwner: {
        namespace: "legacy_firebase_user",
        value: legacyOwner["value"],
      },
      resolution,
    };
  }
  if (value["recordKind"] === "system_reference") {
    if (!hasExactKeys(value, [
      "recordKind",
      "recordKey",
      "candidateSha256",
      "candidate",
      "legacyVisible",
      "systemReference",
    ])) {
      throw new FirebaseImportPlanError("plan record shape is invalid");
    }
    const base = validateRecordBase(value);
    const systemReference = value["systemReference"];
    // P7-C: system identities stay exact non-human unresolved-observation
    // references and never become an account, claim, or Player.
    if (!isObject(systemReference) ||
      !hasExactKeys(systemReference, ["namespace", "value"]) ||
      systemReference["namespace"] !== "unresolved_observation" ||
      typeof systemReference["value"] !== "string" ||
      systemReference["value"].length > 128 ||
      !systemReferencePattern.test(systemReference["value"]) ||
      base.candidate.playerReference.namespace !== "unresolved_observation" ||
      base.candidate.playerReference.value !== systemReference["value"]) {
      throw new FirebaseImportPlanError("plan system reference is invalid");
    }
    return {
      ...base,
      recordKind: "system_reference",
      systemReference: {
        namespace: "unresolved_observation",
        value: systemReference["value"],
      },
    };
  }
  throw new FirebaseImportPlanError("plan record kind is invalid");
}

export function validateFirebaseImportPlan(input: unknown): FirebaseImportPlan {
  if (!isObject(input) || !hasExactKeys(input, [
    "schemaVersion",
    "runnerVersion",
    "inputSha256",
    "records",
  ])) {
    throw new FirebaseImportPlanError("import plan shape is invalid");
  }
  if (input.schemaVersion !== FIREBASE_IMPORT_PLAN_SCHEMA_VERSION ||
    input.runnerVersion !== FIREBASE_IMPORT_RUNNER_VERSION ||
    typeof input.inputSha256 !== "string" ||
    !sha256HexPattern.test(input.inputSha256) ||
    !Array.isArray(input.records) || input.records.length > 10_000) {
    throw new FirebaseImportPlanError("import plan header is invalid");
  }
  const records = input.records.map((record) => validatePlanRecord(record));
  const recordKeys = new Set(records.map((record) => record.recordKey));
  if (recordKeys.size !== records.length) {
    throw new FirebaseImportPlanError("import plan record keys must be unique");
  }
  const coordinates = records.map((record) =>
    `${record.candidate.submissionId}#${record.candidate.revision}`
  );
  if (new Set(coordinates).size !== records.length) {
    throw new FirebaseImportPlanError(
      "import plan submission revisions must be unique",
    );
  }
  for (let index = 1; index < records.length; index += 1) {
    const previous = records[index - 1] as FirebaseImportPlanRecord;
    const current = records[index] as FirebaseImportPlanRecord;
    const previousKey: readonly [string, number] =
      [previous.candidate.submissionId, previous.candidate.revision];
    const currentKey: readonly [string, number] =
      [current.candidate.submissionId, current.candidate.revision];
    if (previousKey[0] > currentKey[0] ||
      (previousKey[0] === currentKey[0] && previousKey[1] >= currentKey[1])) {
      throw new FirebaseImportPlanError(
        "import plan records must be ordered by submission and revision",
      );
    }
  }
  return {
    schemaVersion: FIREBASE_IMPORT_PLAN_SCHEMA_VERSION,
    runnerVersion: FIREBASE_IMPORT_RUNNER_VERSION,
    inputSha256: input.inputSha256,
    records,
  };
}

export function planCanonicalSha256(plan: FirebaseImportPlan): string {
  return candidateCanonicalSha256(plan);
}
