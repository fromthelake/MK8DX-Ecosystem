import {
  IMPLAUSIBLE_TIME_MESSAGE,
  isImplausiblyFast,
  type WorldRecordTimes,
} from "./world-record-plausibility.js";

const submissionIdPattern =
  /^user_submission\.time\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const assetPatterns = {
  track: /^track\.[a-z0-9]+(?:_[a-z0-9]+)*$/,
  character: /^character\.[a-z0-9]+(?:_[a-z0-9]+)*$/,
  characterVariant:
    /^character_variant\.[a-z0-9]+(?:_[a-z0-9]+)*\.[0-9]{3}_[a-z0-9]+(?:_[a-z0-9]+)*$/,
  body: /^body\.[a-z0-9]+(?:_[a-z0-9]+)*$/,
  bodyVariant:
    /^body_variant\.[a-z0-9]+(?:_[a-z0-9]+)*\.[0-9]{3}_[a-z0-9]+(?:_[a-z0-9]+)*$/,
  tire: /^tire\.[a-z0-9]+(?:_[a-z0-9]+)*$/,
  glider: /^glider\.[a-z0-9]+(?:_[a-z0-9]+)*$/,
  gliderVariant:
    /^glider_variant\.[a-z0-9]+(?:_[a-z0-9]+)*\.[0-9]{3}_[a-z0-9]+(?:_[a-z0-9]+)*$/,
  country: /^country\.[a-z]{2}$/,
} as const;
const mediaTypePattern =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const keyVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const maxEpochMs = 253_402_300_799_999;

export type TimeTrialPlayerReference = Readonly<{
  namespace:
    | "player"
    | "legacy_firebase_user"
    | "producer_local_profile"
    | "unresolved_observation";
  value: string;
}>;

export type TimeTrialLap = Readonly<{
  lapNumber: number;
  timeMs: number;
  coinsCollected?: number;
  mushroomsUsed?: number;
  confidence?: number;
}>;

export type TimeTrialLoadout = Readonly<{
  characterId?: string;
  characterVariantId?: string;
  bodyId?: string;
  bodyVariantId?: string;
  tireId?: string;
  gliderId?: string;
  gliderVariantId?: string;
}>;

export type TimeTrialEvidence = Readonly<{
  kind: "screenshot" | "video" | "capture_session" | "scan_result";
  reference: string;
  sha256?: string;
  mediaType?: string;
}>;

export type TimeTrialVerification = Readonly<{
  status:
    | "not_checked"
    | "producer_check_passed"
    | "producer_check_failed"
    | "needs_review";
  method?: string;
  lapSumMatches?: boolean;
  confidence?: number;
  fieldConfidence?: Readonly<{
    totalTime?: number;
    track?: number;
    character?: number;
    characterVariant?: number;
    body?: number;
    tire?: number;
    glider?: number;
    country?: number;
    playerName?: number;
  }>;
  correctedFields?: readonly TimeTrialCorrectedField[];
}>;

export type TimeTrialCorrectedField =
  | "track"
  | "mode"
  | "totalTime"
  | "laps"
  | "coins"
  | "mushrooms"
  | "character"
  | "characterVariant"
  | "body"
  | "bodyVariant"
  | "tire"
  | "glider"
  | "gliderVariant"
  | "country"
  | "playerName";

export const timeTrialCorrectedFields = new Set<TimeTrialCorrectedField>([
  "track", "mode", "totalTime", "laps", "coins", "mushrooms",
  "character", "characterVariant", "body", "bodyVariant", "tire",
  "glider", "gliderVariant", "country", "playerName",
]);

export type TimeTrialSubmissionV1 = Readonly<{
  schemaVersion: "mk8dx.time-trial-submission.v1";
  submissionId: string;
  revision: number;
  mode: 150 | 200;
  trackId: string;
  totalTimeMs: number;
  laps: readonly TimeTrialLap[];
  loadout?: TimeTrialLoadout;
  countryId?: string;
  playerReference: TimeTrialPlayerReference;
  observedPlayerName?: string;
  source: Readonly<{
    kind:
      | "web_manual"
      | "web_scan"
      | "android_manual"
      | "android_scan"
      | "android_scan_test"
      | "livetrial_capture"
      | "livetrial_recorded_video";
    /** Which screen a scan was read from (ADR-0204); absent for typed submissions. */
    captureLayout?: "time_trial_result" | "ghost_details";
    producerVersion?: string;
    localRecordId?: string;
  }>;
  timestamps: Readonly<{
    occurredAtMs?: number;
    capturedAtMs?: number;
    createdAtMs: number;
    submittedAtMs?: number;
  }>;
  evidence?: readonly TimeTrialEvidence[];
  verification?: TimeTrialVerification;
}>;

export type TimeTrialAssetReferences = Readonly<{
  trackId: string;
  loadout?: TimeTrialLoadout;
  countryId?: string;
}>;

export interface TimeTrialAssetCatalog {
  validateReferences(references: TimeTrialAssetReferences): Promise<readonly unknown[]>;
}

export type ProtectedValue = Readonly<{
  ciphertext: Uint8Array;
  encryptionKeyVersion: string;
}>;

export type ProtectedLookupValue = ProtectedValue &
  Readonly<{
    lookupHmac: Uint8Array;
    lookupKeyVersion: string;
  }>;

export interface TimeTrialSensitiveValueProtector {
  protectParticipantReference(
    namespace: Exclude<TimeTrialPlayerReference["namespace"], "player">,
    value: string,
  ): Promise<ProtectedLookupValue>;
  protectEvidenceReference(reference: string): Promise<ProtectedValue>;
}

export type ProtectedTimeTrialEvidence = Readonly<{
  sequenceNumber: number;
  kind: TimeTrialEvidence["kind"];
  protectedReference: ProtectedValue;
  sha256?: Uint8Array;
  mediaType?: string;
}>;

export type TimeTrialRevisionPersistenceInput = Readonly<{
  submission: Omit<TimeTrialSubmissionV1, "playerReference" | "evidence">;
  playerId: string | null;
  restrictedParticipant:
    | (Readonly<{
        namespace: Exclude<TimeTrialPlayerReference["namespace"], "player">;
      }> & ProtectedLookupValue)
    | null;
  protectedEvidence: readonly ProtectedTimeTrialEvidence[];
  publicationEligibility?:
    | "runtime_eligible"
    | "explicit_review_required"
    | "producer_verification_withheld";
}>;

export type TimeTrialSubmissionContext = Readonly<{
  publicationIntent: "trusted_runtime" | "explicit_review_required";
}>;

export type TimeTrialSubmissionState = Readonly<{
  firstCreatedAtMs: number;
  latestRevision: number;
}>;

export interface TimeTrialWriteTransaction {
  findSubmissionForUpdate(
    submissionId: string,
  ): Promise<TimeTrialSubmissionState | null>;
  findActiveHumanPlayerForUpdate(playerId: string): Promise<boolean>;
  insertSubmission(submissionId: string, firstCreatedAtMs: number): Promise<void>;
  insertRevision(input: TimeTrialRevisionPersistenceInput): Promise<void>;
}

export interface TimeTrialWriteRepository {
  transaction<T>(
    work: (transaction: TimeTrialWriteTransaction) => Promise<T>,
  ): Promise<T>;
}

export type TimeTrialSubmissionResult = Readonly<{
  submissionId: string;
  revision: number;
}>;

export type TimeTrialSubmissionErrorCode =
  | "invalid_submission"
  | "invalid_assets"
  | "player_not_found"
  | "revision_conflict"
  | "protection_failed"
  | "implausible_time";

export class TimeTrialSubmissionError extends Error {
  public constructor(
    public readonly code: TimeTrialSubmissionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TimeTrialSubmissionError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.has(key));
}

function boundedString(value: unknown, minimum: number, maximum: number): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const length = Array.from(value).length;
  return length >= minimum && length <= maximum;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum;
}

function confidence(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function optionalString(
  value: Record<string, unknown>,
  key: string,
  maximum: number,
): boolean {
  return !Object.hasOwn(value, key) || boundedString(value[key], 1, maximum);
}

function optionalConfidence(value: Record<string, unknown>, key: string): boolean {
  return !Object.hasOwn(value, key) || confidence(value[key]);
}

export function validateLoadout(value: unknown): value is TimeTrialLoadout {
  if (!isObject(value)) {
    return false;
  }
  const keys = [
    "characterId",
    "characterVariantId",
    "bodyId",
    "bodyVariantId",
    "tireId",
    "gliderId",
    "gliderVariantId",
  ];
  if (Object.keys(value).length === 0 || !hasExactKeys(value, [], keys)) {
    return false;
  }
  const checks: readonly [string, RegExp][] = [
    ["characterId", assetPatterns.character],
    ["characterVariantId", assetPatterns.characterVariant],
    ["bodyId", assetPatterns.body],
    ["bodyVariantId", assetPatterns.bodyVariant],
    ["tireId", assetPatterns.tire],
    ["gliderId", assetPatterns.glider],
    ["gliderVariantId", assetPatterns.gliderVariant],
  ];
  if (
    checks.some(
      ([key, pattern]) => Object.hasOwn(value, key) &&
        (typeof value[key] !== "string" ||
          (value[key] as string).length > 255 ||
          !pattern.test(value[key] as string)),
    )
  ) {
    return false;
  }
  return (!Object.hasOwn(value, "characterVariantId") || Object.hasOwn(value, "characterId")) &&
    (!Object.hasOwn(value, "bodyVariantId") || Object.hasOwn(value, "bodyId")) &&
    (!Object.hasOwn(value, "gliderVariantId") || Object.hasOwn(value, "gliderId"));
}

export function validateLap(value: unknown, expectedNumber: number): value is TimeTrialLap {
  if (!isObject(value) || !hasExactKeys(
    value,
    ["lapNumber", "timeMs"],
    ["coinsCollected", "mushroomsUsed", "confidence"],
  )) {
    return false;
  }
  return value.lapNumber === expectedNumber &&
    boundedInteger(value.timeMs, 1, 599_999) &&
    (!Object.hasOwn(value, "coinsCollected") || boundedInteger(value.coinsCollected, 0, 10)) &&
    (!Object.hasOwn(value, "mushroomsUsed") || boundedInteger(value.mushroomsUsed, 0, 3)) &&
    (!Object.hasOwn(value, "confidence") || confidence(value.confidence));
}

export function validateEvidence(value: unknown): value is TimeTrialEvidence {
  if (!isObject(value) || !hasExactKeys(
    value,
    ["kind", "reference"],
    ["sha256", "mediaType"],
  )) {
    return false;
  }
  return ["screenshot", "video", "capture_session", "scan_result"].includes(value.kind as string) &&
    boundedString(value.reference, 1, 512) &&
    (!Object.hasOwn(value, "sha256") ||
      (typeof value.sha256 === "string" && sha256Pattern.test(value.sha256))) &&
    (!Object.hasOwn(value, "mediaType") ||
      (typeof value.mediaType === "string" && value.mediaType.length <= 128 &&
        mediaTypePattern.test(value.mediaType)));
}

function validateVerification(value: unknown): value is TimeTrialVerification {
  if (!isObject(value) || !hasExactKeys(
    value,
    ["status"],
    ["method", "lapSumMatches", "confidence", "fieldConfidence", "correctedFields"],
  )) {
    return false;
  }
  if (![
    "not_checked",
    "producer_check_passed",
    "producer_check_failed",
    "needs_review",
  ].includes(value.status as string) ||
    !optionalString(value, "method", 128) ||
    (Object.hasOwn(value, "lapSumMatches") && typeof value.lapSumMatches !== "boolean") ||
    !optionalConfidence(value, "confidence")) {
    return false;
  }
  if (Object.hasOwn(value, "correctedFields")) {
    const corrected = value.correctedFields;
    if (!Array.isArray(corrected) || corrected.length < 1 || corrected.length > 15 ||
        new Set(corrected).size !== corrected.length ||
        corrected.some((field) => typeof field !== "string" ||
          !timeTrialCorrectedFields.has(field as TimeTrialCorrectedField))) {
      return false;
    }
  }
  if (!Object.hasOwn(value, "fieldConfidence")) { return true; }
  const fields = value.fieldConfidence;
  const keys = [
    "totalTime", "track", "character", "characterVariant", "body", "tire",
    "glider", "country", "playerName",
  ];
  return isObject(fields) && hasExactKeys(fields, [], keys) &&
    keys.every((key) => optionalConfidence(fields, key));
}

export function validateTimeTrialSubmission(
  input: unknown,
): asserts input is TimeTrialSubmissionV1 {
  if (!isObject(input) || !hasExactKeys(
    input,
    [
      "schemaVersion", "submissionId", "revision", "mode", "trackId",
      "totalTimeMs", "laps", "playerReference", "source", "timestamps",
    ],
    ["loadout", "countryId", "observedPlayerName", "evidence", "verification"],
  )) {
    throw new TimeTrialSubmissionError("invalid_submission", "submission shape is invalid");
  }
  if (
    input.schemaVersion !== "mk8dx.time-trial-submission.v1" ||
    typeof input.submissionId !== "string" || !submissionIdPattern.test(input.submissionId) ||
    !boundedInteger(input.revision, 1, Number.MAX_SAFE_INTEGER) ||
    (input.mode !== 150 && input.mode !== 200) ||
    typeof input.trackId !== "string" || input.trackId.length > 255 ||
    !assetPatterns.track.test(input.trackId) ||
    !boundedInteger(input.totalTimeMs, 1, 599_999)
  ) {
    throw new TimeTrialSubmissionError("invalid_submission", "submission scalar is invalid");
  }
  if (!Array.isArray(input.laps) || ![0, 3, 7].includes(input.laps.length) ||
    input.laps.some((lap, index) => !validateLap(lap, index + 1))) {
    throw new TimeTrialSubmissionError("invalid_submission", "laps are invalid");
  }
  if (input.laps.length > 0) {
    const lapSum = input.laps.reduce((sum, lap) => sum + (lap as TimeTrialLap).timeMs, 0);
    const mushroomSum = input.laps.reduce(
      (sum, lap) => sum + ((lap as TimeTrialLap).mushroomsUsed ?? 0), 0,
    );
    if (lapSum !== input.totalTimeMs || mushroomSum > 3) {
      throw new TimeTrialSubmissionError("invalid_submission", "lap semantics are invalid");
    }
  }
  if (Object.hasOwn(input, "loadout") && !validateLoadout(input.loadout)) {
    throw new TimeTrialSubmissionError("invalid_submission", "loadout is invalid");
  }
  if (Object.hasOwn(input, "countryId") &&
    (typeof input.countryId !== "string" || input.countryId.length > 10 ||
      !assetPatterns.country.test(input.countryId))) {
    throw new TimeTrialSubmissionError("invalid_submission", "countryId is invalid");
  }
  if (Object.hasOwn(input, "observedPlayerName") &&
    !boundedString(input.observedPlayerName, 1, 64)) {
    throw new TimeTrialSubmissionError("invalid_submission", "observedPlayerName is invalid");
  }
  const participant = input.playerReference;
  if (!isObject(participant) || !hasExactKeys(participant, ["namespace", "value"]) ||
    !["player", "legacy_firebase_user", "producer_local_profile", "unresolved_observation"]
      .includes(participant.namespace as string) ||
    typeof participant.value !== "string" ||
    (participant.namespace === "player"
      ? !playerIdPattern.test(participant.value)
      : !boundedString(participant.value, 1, 128))) {
    throw new TimeTrialSubmissionError("invalid_submission", "playerReference is invalid");
  }
  const source = input.source;
  if (!isObject(source) ||
    !hasExactKeys(source, ["kind"], ["captureLayout", "producerVersion", "localRecordId"]) ||
    !["web_manual", "web_scan", "android_manual", "android_scan", "android_scan_test", "livetrial_capture", "livetrial_recorded_video"]
      .includes(source.kind as string) ||
    !optionalString(source, "producerVersion", 64) || !optionalString(source, "localRecordId", 128)) {
    throw new TimeTrialSubmissionError("invalid_submission", "source is invalid");
  }
  // The capture layout is a screen fact (ADR-0204): only a producer that read a screen may state it,
  // and only the two screens the producers can read. LiveTrial reads the same screens off the
  // capture card or a recording, including the Select-a-Ghost panel (ADR-0210); a typed entry never.
  if (Object.hasOwn(source, "captureLayout") &&
    (!["time_trial_result", "ghost_details"].includes(source.captureLayout as string) ||
      !["web_scan", "android_scan", "android_scan_test", "livetrial_capture", "livetrial_recorded_video"]
        .includes(source.kind as string))) {
    throw new TimeTrialSubmissionError("invalid_submission", "source captureLayout is invalid");
  }
  const timestamps = input.timestamps;
  if (!isObject(timestamps) || !hasExactKeys(
    timestamps,
    ["createdAtMs"],
    ["occurredAtMs", "capturedAtMs", "submittedAtMs"],
  ) || ["occurredAtMs", "capturedAtMs", "createdAtMs", "submittedAtMs"].some(
    (key) => Object.hasOwn(timestamps, key) && !boundedInteger(timestamps[key], 0, maxEpochMs),
  )) {
    throw new TimeTrialSubmissionError("invalid_submission", "timestamps are invalid");
  }
  if (Object.hasOwn(input, "evidence") &&
    (!Array.isArray(input.evidence) || input.evidence.length > 8 ||
      input.evidence.some((item) => !validateEvidence(item)))) {
    throw new TimeTrialSubmissionError("invalid_submission", "evidence is invalid");
  }
  if (Object.hasOwn(input, "verification") && !validateVerification(input.verification)) {
    throw new TimeTrialSubmissionError("invalid_submission", "verification is invalid");
  }
  const validatedVerification = input.verification as TimeTrialVerification | undefined;
  const validatedSource = input.source as TimeTrialSubmissionV1["source"];
  if (validatedVerification?.correctedFields !== undefined &&
      !["web_scan", "android_scan", "android_scan_test", "livetrial_capture", "livetrial_recorded_video"]
        .includes(validatedSource.kind)) {
    throw new TimeTrialSubmissionError(
      "invalid_submission",
      "manual sources cannot carry recognition correction provenance",
    );
  }
}

function validateProtectedValue(
  value: ProtectedValue,
  maximumCiphertextBytes: number,
): void {
  if (!(value.ciphertext instanceof Uint8Array) || value.ciphertext.length < 1 ||
    value.ciphertext.length > maximumCiphertextBytes ||
    !keyVersionPattern.test(value.encryptionKeyVersion)) {
    throw new TimeTrialSubmissionError("protection_failed", "protected value is invalid");
  }
}

function sha256Bytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "hex"));
}

export class TimeTrialSubmissionService {
  public constructor(
    private readonly repository: TimeTrialWriteRepository,
    private readonly assetCatalog: TimeTrialAssetCatalog,
    private readonly protector: TimeTrialSensitiveValueProtector,
    // Optional so every existing composition and test keeps working; the runtime passes the
    // daily World Records (world-record-plausibility.ts).
    private readonly worldRecords?: WorldRecordTimes,
  ) {}

  public async submit(
    input: TimeTrialSubmissionV1,
    context: TimeTrialSubmissionContext = {
      publicationIntent: "explicit_review_required",
    },
  ): Promise<TimeTrialSubmissionResult> {
    validateTimeTrialSubmission(input);
    if (input.source.kind === "android_scan_test") {
      throw new TimeTrialSubmissionError(
        "invalid_submission",
        "ephemeral Android scan tests require the dedicated retention service",
      );
    }
    const assetIssues = await this.assetCatalog.validateReferences({
      trackId: input.trackId,
      ...(input.loadout === undefined ? {} : { loadout: input.loadout }),
      ...(input.countryId === undefined ? {} : { countryId: input.countryId }),
    });
    if (assetIssues.length > 0) {
      throw new TimeTrialSubmissionError("invalid_assets", "asset references are invalid");
    }
    if (this.worldRecords !== undefined &&
      isImplausiblyFast(input.totalTimeMs, await this.worldRecords.timeMs(input.trackId, input.mode))) {
      throw new TimeTrialSubmissionError("implausible_time", IMPLAUSIBLE_TIME_MESSAGE);
    }

    let restrictedParticipant: TimeTrialRevisionPersistenceInput["restrictedParticipant"] = null;
    if (input.playerReference.namespace !== "player") {
      let protectedValue: ProtectedLookupValue;
      try {
        protectedValue = await this.protector.protectParticipantReference(
          input.playerReference.namespace,
          input.playerReference.value,
        );
      } catch {
        throw new TimeTrialSubmissionError(
          "protection_failed",
          "participant reference protection failed",
        );
      }
      validateProtectedValue(protectedValue, 1024);
      if (!(protectedValue.lookupHmac instanceof Uint8Array) ||
        protectedValue.lookupHmac.length !== 32 ||
        !keyVersionPattern.test(protectedValue.lookupKeyVersion)) {
        throw new TimeTrialSubmissionError("protection_failed", "participant lookup is invalid");
      }
      restrictedParticipant = {
        namespace: input.playerReference.namespace,
        ...protectedValue,
      };
    }

    const protectedEvidence: ProtectedTimeTrialEvidence[] = [];
    for (const [index, evidence] of (input.evidence ?? []).entries()) {
      let protectedReference: ProtectedValue;
      try {
        protectedReference = await this.protector.protectEvidenceReference(
          evidence.reference,
        );
      } catch {
        throw new TimeTrialSubmissionError(
          "protection_failed",
          "evidence reference protection failed",
        );
      }
      validateProtectedValue(protectedReference, 2048);
      protectedEvidence.push({
        sequenceNumber: index + 1,
        kind: evidence.kind,
        protectedReference,
        ...(evidence.sha256 === undefined ? {} : { sha256: sha256Bytes(evidence.sha256) }),
        ...(evidence.mediaType === undefined ? {} : { mediaType: evidence.mediaType }),
      });
    }

    return this.repository.transaction(async (transaction) => {
      const current = await transaction.findSubmissionForUpdate(input.submissionId);
      if (current === null) {
        if (input.revision !== 1) {
          throw new TimeTrialSubmissionError(
            "revision_conflict",
            "a new submission must begin at revision 1",
          );
        }
      } else if (input.revision !== current.latestRevision + 1) {
        throw new TimeTrialSubmissionError(
          "revision_conflict",
          "submission revision is not the next revision",
        );
      }

      const playerId = input.playerReference.namespace === "player"
        ? input.playerReference.value
        : null;
      if (playerId !== null &&
        !(await transaction.findActiveHumanPlayerForUpdate(playerId))) {
        throw new TimeTrialSubmissionError("player_not_found", "active Player was not found");
      }
      if (current === null) {
        await transaction.insertSubmission(input.submissionId, input.timestamps.createdAtMs);
      }
      const { playerReference: _playerReference, evidence: _evidence, ...publicFields } = input;
      await transaction.insertRevision({
        submission: publicFields,
        playerId,
        restrictedParticipant,
        protectedEvidence,
        publicationEligibility:
          context.publicationIntent === "explicit_review_required"
            ? "explicit_review_required"
            : input.verification?.status === "producer_check_failed" ||
                input.verification?.status === "needs_review"
              ? "producer_verification_withheld"
              : "runtime_eligible",
      });
      return { submissionId: input.submissionId, revision: input.revision };
    });
  }
}
