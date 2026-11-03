const resultIdPattern =
  /^tournament_race_result\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const namespacePattern = /^[a-z][a-z0-9_]{1,63}$/;
const issueCodePattern = /^[a-z][a-z0-9_.-]{1,63}$/;
const mediaTypePattern =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const trackIdPattern = /^track\.[a-z0-9]+(?:_[a-z0-9]+)*$/;
const characterIdPattern = /^character\.[a-z0-9]+(?:_[a-z0-9]+)*$/;
const characterVariantIdPattern =
  /^character_variant\.[a-z0-9]+(?:_[a-z0-9]+)*\.[0-9]{3}_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const maxEpochMs = 253_402_300_799_999;

export type TournamentContextReference = Readonly<{
  namespace: string;
  value: string;
}>;

export type TournamentParticipantReference = Readonly<{
  namespace:
    | "player"
    | "tournament_manager_player"
    | "producer_local_player"
    | "unresolved_observation";
  value: string;
}>;

export type TournamentPlacement = Readonly<{
  finishPosition: number;
  participantReference: TournamentParticipantReference;
  observedPlayerName?: string;
  characterId?: string;
  characterVariantId?: string;
  scoring: Readonly<{
    racePoints: number;
    totalBeforeRace: number;
    totalAfterRace: number;
    rankAfterRace: number;
  }>;
  confidence?: Readonly<{
    finishPosition?: number;
    playerName?: number;
    character?: number;
    racePoints?: number;
    totalAfterRace?: number;
  }>;
}>;

export type TournamentEvidence = Readonly<{
  kind:
    | "race_score_screen"
    | "total_score_screen"
    | "video"
    | "capture_session"
    | "workbook";
  reference: string;
  sha256?: string;
  mediaType?: string;
}>;

export type TournamentVerification = Readonly<{
  status:
    | "not_checked"
    | "producer_check_passed"
    | "producer_check_failed"
    | "needs_review";
  method?: string;
  confidence?: number;
  fieldConfidence?: Readonly<{
    track?: number;
    playerCount?: number;
    finishPositions?: number;
    playerNames?: number;
    characters?: number;
    racePoints?: number;
    totalScores?: number;
  }>;
  issues?: readonly Readonly<{ code: string; message: string }>[];
}>;

// ADR-0217: the LAN class read from the track-intro badge; a Mirror race is mode 150 with mirror: true.
export type TournamentRaceMode = 50 | 100 | 150 | 200;
export const TOURNAMENT_RACE_MODES: readonly TournamentRaceMode[] = [50, 100, 150, 200];

export function isTournamentRaceMode(value: unknown): value is TournamentRaceMode {
  return TOURNAMENT_RACE_MODES.includes(value as TournamentRaceMode);
}

export type TournamentRaceResultV1 = Readonly<{
  schemaVersion: "mk8dx.tournament-race-result.v1";
  raceResultId: string;
  revision: number;
  raceNumber: number;
  scoringSegment: number;
  mode?: TournamentRaceMode;
  mirror?: true;
  trackId: string;
  countsTowardStandings: boolean;
  scoringNote?: string;
  context?: Readonly<{
    tournamentReference?: TournamentContextReference;
    stageReference?: TournamentContextReference;
    groupReference?: TournamentContextReference;
    observedStageLabel?: string;
    observedGroupLabel?: string;
  }>;
  placements: readonly TournamentPlacement[];
  source: Readonly<{
    kind:
      | "tournament_recorded_video"
      | "tournament_live_capture"
      | "tournament_spreadsheet_import"
      | "tournament_manual_entry";
    transport?: "native_contract" | "excel_workbook" | "csv" | "web_form";
    producerVersion?: string;
    localRecordId?: string;
    sessionId?: string;
    streamId?: string;
    sourceMediaId?: string;
    raceOffsetMs?: number;
    frameIndex?: number;
  }>;
  timestamps: Readonly<{
    occurredAtMs?: number;
    capturedAtMs?: number;
    createdAtMs: number;
    submittedAtMs?: number;
  }>;
  evidence?: readonly TournamentEvidence[];
  verification?: TournamentVerification;
}>;

export type TournamentAssetReferences = Readonly<{
  trackId: string;
  placements: readonly Readonly<{
    characterId?: string;
    characterVariantId?: string;
  }>[];
}>;

export type TournamentValidationErrorCode =
  | "invalid_result"
  | "invalid_placements"
  | "invalid_scoring";

export class TournamentValidationError extends Error {
  public constructor(
    public readonly code: TournamentValidationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TournamentValidationError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
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

function validateReference(value: unknown, participant: boolean): boolean {
  if (!isObject(value) || !exactKeys(value, ["namespace", "value"]) ||
    typeof value.namespace !== "string" || typeof value.value !== "string") {
    return false;
  }
  if (!participant) {
    return namespacePattern.test(value.namespace) && boundedString(value.value, 1, 128);
  }
  if (value.namespace === "player") {
    return playerIdPattern.test(value.value);
  }
  return [
    "tournament_manager_player",
    "producer_local_player",
    "unresolved_observation",
  ].includes(value.namespace) && boundedString(value.value, 1, 128);
}

function validateContext(value: unknown): boolean {
  if (!isObject(value) || Object.keys(value).length === 0 || !exactKeys(value, [], [
    "tournamentReference",
    "stageReference",
    "groupReference",
    "observedStageLabel",
    "observedGroupLabel",
  ])) {
    return false;
  }
  return ["tournamentReference", "stageReference", "groupReference"].every(
    (key) => !Object.hasOwn(value, key) || validateReference(value[key], false),
  ) && optionalString(value, "observedStageLabel", 96) &&
    optionalString(value, "observedGroupLabel", 96);
}

function validatePlacement(value: unknown, expectedPosition: number): value is TournamentPlacement {
  if (!isObject(value) || !exactKeys(
    value,
    ["finishPosition", "participantReference", "scoring"],
    ["observedPlayerName", "characterId", "characterVariantId", "confidence"],
  ) || value.finishPosition !== expectedPosition ||
    !validateReference(value.participantReference, true) ||
    !optionalString(value, "observedPlayerName", 64)) {
    return false;
  }
  if (Object.hasOwn(value, "characterId") &&
    (typeof value.characterId !== "string" || value.characterId.length > 255 ||
      !characterIdPattern.test(value.characterId))) {
    return false;
  }
  if (Object.hasOwn(value, "characterVariantId") &&
    (typeof value.characterVariantId !== "string" || value.characterVariantId.length > 255 ||
      !characterVariantIdPattern.test(value.characterVariantId) ||
      !Object.hasOwn(value, "characterId"))) {
    return false;
  }
  const scoring = value.scoring;
  if (!isObject(scoring) || !exactKeys(
    scoring,
    ["racePoints", "totalBeforeRace", "totalAfterRace", "rankAfterRace"],
  ) || !boundedInteger(scoring.racePoints, 0, Number.MAX_SAFE_INTEGER) ||
    !boundedInteger(scoring.totalBeforeRace, 0, Number.MAX_SAFE_INTEGER) ||
    !boundedInteger(scoring.totalAfterRace, 0, Number.MAX_SAFE_INTEGER) ||
    !boundedInteger(scoring.rankAfterRace, 1, 12)) {
    return false;
  }
  if (!Object.hasOwn(value, "confidence")) {
    return true;
  }
  const placementConfidence = value.confidence;
  const keys = [
    "finishPosition", "playerName", "character", "racePoints", "totalAfterRace",
  ];
  return isObject(placementConfidence) && Object.keys(placementConfidence).length >= 1 &&
    exactKeys(placementConfidence, [], keys) &&
    keys.every((key) => optionalConfidence(placementConfidence, key));
}

function validateSource(value: unknown): boolean {
  if (!isObject(value) || !exactKeys(value, ["kind"], [
    "transport", "producerVersion", "localRecordId", "sessionId", "streamId",
    "sourceMediaId", "raceOffsetMs", "frameIndex",
  ])) {
    return false;
  }
  return [
    "tournament_recorded_video",
    "tournament_live_capture",
    "tournament_spreadsheet_import",
    "tournament_manual_entry",
  ].includes(value.kind as string) &&
    (!Object.hasOwn(value, "transport") ||
      ["native_contract", "excel_workbook", "csv", "web_form"]
        .includes(value.transport as string)) &&
    optionalString(value, "producerVersion", 64) &&
    optionalString(value, "localRecordId", 128) &&
    optionalString(value, "sessionId", 128) &&
    optionalString(value, "streamId", 128) &&
    optionalString(value, "sourceMediaId", 128) &&
    (!Object.hasOwn(value, "raceOffsetMs") ||
      boundedInteger(value.raceOffsetMs, 0, Number.MAX_SAFE_INTEGER)) &&
    (!Object.hasOwn(value, "frameIndex") ||
      boundedInteger(value.frameIndex, 0, Number.MAX_SAFE_INTEGER));
}

function validateTimestamps(value: unknown): boolean {
  if (!isObject(value) || !exactKeys(
    value,
    ["createdAtMs"],
    ["occurredAtMs", "capturedAtMs", "submittedAtMs"],
  )) {
    return false;
  }
  return ["occurredAtMs", "capturedAtMs", "createdAtMs", "submittedAtMs"].every(
    (key) => !Object.hasOwn(value, key) || boundedInteger(value[key], 0, maxEpochMs),
  );
}

function validateEvidence(value: unknown): value is TournamentEvidence {
  if (!isObject(value) || !exactKeys(
    value,
    ["kind", "reference"],
    ["sha256", "mediaType"],
  )) {
    return false;
  }
  return [
    "race_score_screen", "total_score_screen", "video", "capture_session", "workbook",
  ].includes(value.kind as string) && boundedString(value.reference, 1, 512) &&
    (!Object.hasOwn(value, "sha256") ||
      (typeof value.sha256 === "string" && sha256Pattern.test(value.sha256))) &&
    (!Object.hasOwn(value, "mediaType") ||
      (typeof value.mediaType === "string" && value.mediaType.length <= 128 &&
        mediaTypePattern.test(value.mediaType)));
}

function validateVerification(value: unknown): value is TournamentVerification {
  if (!isObject(value) || !exactKeys(
    value,
    ["status"],
    ["method", "confidence", "fieldConfidence", "issues"],
  ) || ![
    "not_checked", "producer_check_passed", "producer_check_failed", "needs_review",
  ].includes(value.status as string) || !optionalString(value, "method", 128) ||
    !optionalConfidence(value, "confidence")) {
    return false;
  }
  if (Object.hasOwn(value, "fieldConfidence")) {
    const fields = value.fieldConfidence;
    const keys = [
      "track", "playerCount", "finishPositions", "playerNames", "characters",
      "racePoints", "totalScores",
    ];
    if (!isObject(fields) || Object.keys(fields).length < 1 ||
      !exactKeys(fields, [], keys) || !keys.every((key) => optionalConfidence(fields, key))) {
      return false;
    }
  }
  const requiresIssues = value.status === "producer_check_failed" || value.status === "needs_review";
  if (!Object.hasOwn(value, "issues")) {
    return !requiresIssues;
  }
  if (!Array.isArray(value.issues) || value.issues.length < 1 || value.issues.length > 32) {
    return false;
  }
  return value.issues.every((issue) => isObject(issue) &&
    exactKeys(issue, ["code", "message"]) &&
    typeof issue.code === "string" && issueCodePattern.test(issue.code) &&
    boundedString(issue.message, 1, 240));
}

function validateScoringSemantics(result: TournamentRaceResultV1): void {
  for (const placement of result.placements) {
    const scoring = placement.scoring;
    const expectedTotal = result.countsTowardStandings
      ? scoring.totalBeforeRace + scoring.racePoints
      : scoring.totalBeforeRace;
    if (!Number.isSafeInteger(expectedTotal) || scoring.totalAfterRace !== expectedTotal) {
      throw new TournamentValidationError(
        "invalid_scoring",
        result.countsTowardStandings
          ? "counted race scoring equation is invalid"
          : "excluded race scoring equation is invalid",
      );
    }
  }
  const totals = result.placements.map((placement) => placement.scoring.totalAfterRace);
  for (const placement of result.placements) {
    const expectedRank = 1 + totals.filter(
      (total) => total > placement.scoring.totalAfterRace,
    ).length;
    if (placement.scoring.rankAfterRace !== expectedRank) {
      throw new TournamentValidationError(
        "invalid_scoring",
        "rankAfterRace is not the competition rank from totalAfterRace",
      );
    }
  }
}

export function validateTournamentRaceResult(
  input: unknown,
): asserts input is TournamentRaceResultV1 {
  if (!isObject(input) || !exactKeys(
    input,
    [
      "schemaVersion", "raceResultId", "revision", "raceNumber",
      "scoringSegment", "trackId", "countsTowardStandings", "placements",
      "source", "timestamps",
    ],
    ["mode", "mirror", "scoringNote", "context", "evidence", "verification"],
  )) {
    throw new TournamentValidationError("invalid_result", "race result shape is invalid");
  }
  if (input.schemaVersion !== "mk8dx.tournament-race-result.v1" ||
    typeof input.raceResultId !== "string" || !resultIdPattern.test(input.raceResultId) ||
    !boundedInteger(input.revision, 1, Number.MAX_SAFE_INTEGER) ||
    !boundedInteger(input.raceNumber, 1, Number.MAX_SAFE_INTEGER) ||
    !boundedInteger(input.scoringSegment, 1, Number.MAX_SAFE_INTEGER) ||
    (Object.hasOwn(input, "mode") && !isTournamentRaceMode(input.mode)) ||
    (Object.hasOwn(input, "mirror") && (input.mirror !== true || input.mode !== 150)) ||
    typeof input.trackId !== "string" || input.trackId.length > 255 ||
    !trackIdPattern.test(input.trackId) || typeof input.countsTowardStandings !== "boolean" ||
    !optionalString(input, "scoringNote", 240) ||
    (input.countsTowardStandings === false && !Object.hasOwn(input, "scoringNote"))) {
    throw new TournamentValidationError("invalid_result", "race result scalar is invalid");
  }
  if (Object.hasOwn(input, "context") && !validateContext(input.context)) {
    throw new TournamentValidationError("invalid_result", "context is invalid");
  }
  if (!Array.isArray(input.placements) || input.placements.length < 1 ||
    input.placements.length > 12 || input.placements.some(
      (placement, index) => !validatePlacement(placement, index + 1),
    )) {
    throw new TournamentValidationError("invalid_placements", "placements are invalid");
  }
  const references = (input.placements as readonly TournamentPlacement[]).map(
    (placement) => `${placement.participantReference.namespace}\0${placement.participantReference.value}`,
  );
  if (new Set(references).size !== references.length) {
    throw new TournamentValidationError(
      "invalid_placements",
      "participant references must be unique within a race",
    );
  }
  if (!validateSource(input.source) || !validateTimestamps(input.timestamps)) {
    throw new TournamentValidationError("invalid_result", "source or timestamps are invalid");
  }
  if (Object.hasOwn(input, "evidence") &&
    (!Array.isArray(input.evidence) || input.evidence.length > 16 ||
      input.evidence.some((item) => !validateEvidence(item)))) {
    throw new TournamentValidationError("invalid_result", "evidence is invalid");
  }
  if (Object.hasOwn(input, "verification") && !validateVerification(input.verification)) {
    throw new TournamentValidationError("invalid_result", "verification is invalid");
  }
  validateScoringSemantics(input as unknown as TournamentRaceResultV1);
}

export function tournamentAssetReferences(
  result: TournamentRaceResultV1,
): TournamentAssetReferences {
  return {
    trackId: result.trackId,
    placements: result.placements.map((placement) => ({
      ...(placement.characterId === undefined ? {} : { characterId: placement.characterId }),
      ...(placement.characterVariantId === undefined
        ? {}
        : { characterVariantId: placement.characterVariantId }),
    })),
  };
}
