const submissionIdPattern =
  /^user_submission\.time\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const trackIdPattern = /^track\.[a-z0-9]+(?:_[a-z0-9]+)*$/;
const countryIdPattern = /^country\.[a-z]{2}$/;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const maxEpochMs = 253_402_300_799_999;

export type WebManualPlayerReference = Readonly<{
  namespace:
    | "player"
    | "legacy_firebase_user"
    | "producer_local_profile"
    | "unresolved_observation";
  value: string;
}>;

export type WebManualSubmissionInput = Readonly<{
  submissionId: string;
  revision: number;
  mode: 150 | 200;
  trackId: string;
  /** Exactly the six digits displayed as M:SS.mmm by the preserved web form. */
  timeDigits: string;
  playerReference: WebManualPlayerReference;
  countryId?: string;
  observedPlayerName?: string;
  occurredAtMs?: number;
  createdAtMs: number;
  producerVersion: string;
  localRecordId?: string;
}>;

export type WebManualLapV1 = Readonly<{
  lapNumber: number;
  timeMs: number;
  coinsCollected?: number;
  mushroomsUsed?: number;
}>;

export type WebManualLoadoutV1 = Readonly<{
  characterId?: string;
  characterVariantId?: string;
  bodyId?: string;
  bodyVariantId?: string;
  tireId?: string;
  gliderId?: string;
  gliderVariantId?: string;
}>;

/**
 * How a web submission was filled in (ADR-0204). `web_manual` was the only answer until Phase 8;
 * `web_scan` says the browser scanner filled at least one field. Both are the same platform, the
 * same session, the same form and the same publication rules: the kind records the input method,
 * nothing else.
 */
export type WebTimeTrialSourceKind = "web_manual" | "web_scan";

/** Which screen the producer read; only a scan may state it. */
export type WebTimeTrialCaptureLayout = "time_trial_result" | "ghost_details";

/**
 * What the producer checked. The web form never sends `producer_check_failed` or `needs_review`
 * for a submission it considers valid, so nothing here withholds automatic publication (ADR-0147).
 */
export type WebTimeTrialVerificationV1 = Readonly<{
  status: "producer_check_passed" | "not_checked";
  method?: string;
  lapSumMatches?: boolean;
  fieldConfidence?: Readonly<Record<string, number>>;
  correctedFields?: readonly string[];
}>;

export type WebManualTimeTrialSubmissionV1 = Readonly<{
  schemaVersion: "mk8dx.time-trial-submission.v1";
  submissionId: string;
  revision: number;
  mode: 150 | 200;
  trackId: string;
  totalTimeMs: number;
  laps: readonly WebManualLapV1[];
  loadout?: WebManualLoadoutV1;
  countryId?: string;
  playerReference: WebManualPlayerReference;
  observedPlayerName?: string;
  source: Readonly<{
    kind: WebTimeTrialSourceKind;
    captureLayout?: WebTimeTrialCaptureLayout;
    producerVersion: string;
    localRecordId?: string;
  }>;
  timestamps: Readonly<{
    occurredAtMs?: number;
    createdAtMs: number;
  }>;
  verification?: WebTimeTrialVerificationV1;
}>;

export type WebManualSubmissionErrorCode =
  | "invalid_shape"
  | "invalid_submission_id"
  | "invalid_revision"
  | "invalid_mode"
  | "invalid_track"
  | "invalid_time"
  | "invalid_player_reference"
  | "invalid_country"
  | "invalid_observed_name"
  | "invalid_timestamps"
  | "invalid_source";

export class WebManualSubmissionError extends Error {
  public constructor(public readonly code: WebManualSubmissionErrorCode) {
    super("Web manual Time Trial input is invalid.");
    this.name = "WebManualSubmissionError";
  }
}

function fail(code: WebManualSubmissionErrorCode): never {
  throw new WebManualSubmissionError(code);
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

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" &&
    Array.from(value).length >= 1 && Array.from(value).length <= maximum;
}

function epoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 &&
    (value as number) <= maxEpochMs;
}

function playerReference(value: unknown): value is WebManualPlayerReference {
  if (!isObject(value) || !exactKeys(value, ["namespace", "value"], []) ||
    typeof value.namespace !== "string" || typeof value.value !== "string") {
    return false;
  }
  if (value.namespace === "player") {
    return playerIdPattern.test(value.value);
  }
  return [
    "legacy_firebase_user",
    "producer_local_profile",
    "unresolved_observation",
  ].includes(value.namespace) && boundedString(value.value, 128);
}

export function parseWebManualTimeDigits(value: unknown): number {
  if (typeof value !== "string" || !/^[0-9]{6}$/.test(value)) {
    fail("invalid_time");
  }
  const minutes = Number(value[0]);
  const seconds = Number(value.slice(1, 3));
  const milliseconds = Number(value.slice(3, 6));
  const total = minutes * 60_000 + seconds * 1_000 + milliseconds;
  if (seconds > 59 || total < 1 || total > 599_999) {
    fail("invalid_time");
  }
  return total;
}

export function createWebManualSubmission(
  input: unknown,
): WebManualTimeTrialSubmissionV1 {
  if (!isObject(input) || !exactKeys(input, [
    "submissionId", "revision", "mode", "trackId", "timeDigits",
    "playerReference", "createdAtMs", "producerVersion",
  ], [
    "countryId", "observedPlayerName", "occurredAtMs", "localRecordId",
  ])) {
    fail("invalid_shape");
  }
  if (typeof input.submissionId !== "string" ||
    !submissionIdPattern.test(input.submissionId)) {
    fail("invalid_submission_id");
  }
  if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 1) {
    fail("invalid_revision");
  }
  if (input.mode !== 150 && input.mode !== 200) {
    fail("invalid_mode");
  }
  if (typeof input.trackId !== "string" || input.trackId.length > 255 ||
    !trackIdPattern.test(input.trackId)) {
    fail("invalid_track");
  }
  const totalTimeMs = parseWebManualTimeDigits(input.timeDigits);
  if (!playerReference(input.playerReference)) {
    fail("invalid_player_reference");
  }
  const countryId = input.countryId;
  if (countryId !== undefined &&
    (typeof countryId !== "string" || !countryIdPattern.test(countryId))) {
    fail("invalid_country");
  }
  const observedPlayerName = input.observedPlayerName;
  if (observedPlayerName !== undefined &&
    !boundedString(observedPlayerName, 64)) {
    fail("invalid_observed_name");
  }
  const occurredAtMs = input.occurredAtMs;
  if (!epoch(input.createdAtMs) ||
    (occurredAtMs !== undefined && !epoch(occurredAtMs))) {
    fail("invalid_timestamps");
  }
  const localRecordId = input.localRecordId;
  if (!boundedString(input.producerVersion, 64) ||
    (localRecordId !== undefined && !boundedString(localRecordId, 128))) {
    fail("invalid_source");
  }

  return {
    schemaVersion: "mk8dx.time-trial-submission.v1",
    submissionId: input.submissionId,
    revision: input.revision as number,
    mode: input.mode,
    trackId: input.trackId,
    totalTimeMs,
    laps: [],
    ...(countryId === undefined ? {} : { countryId }),
    playerReference: { ...input.playerReference },
    ...(observedPlayerName === undefined
      ? {}
      : { observedPlayerName }),
    source: {
      kind: "web_manual",
      producerVersion: input.producerVersion,
      ...(localRecordId === undefined
        ? {}
        : { localRecordId }),
    },
    timestamps: {
      ...(occurredAtMs === undefined
        ? {}
        : { occurredAtMs }),
      createdAtMs: input.createdAtMs,
    },
  };
}
