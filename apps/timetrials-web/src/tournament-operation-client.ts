// Typed client for canonical Tournament operation (ADR-0160): the public
// tournament list/detail every visitor can read, and the administrator
// board (create, participants, groups, races, finalize). Writes fetch a
// fresh same-origin CSRF proof per request; responses are parsed closed.

import { type TournamentRaceMode } from "./tournament-race-class.js";

export const PUBLIC_TOURNAMENT_EVENTS_PATH = "/v1/public/tournament-events";
export const PUBLIC_TOURNAMENT_PLACEMENTS_PATH = "/v1/public/tournament-placements";
export const ADMINISTRATOR_TOURNAMENTS_PATH = "/v1/administrator/tournaments";
export const TOURNAMENT_DIRECTORS_PATH = "/v1/administrator/tournament-directors";
export const TOURNAMENTS_PATH = "/v1/tournaments";
export const TOURNAMENT_CSRF_PATH = "/v1/session/csrf";

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

const tournamentIdPattern = /^tournament\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const groupIdPattern = /^tournament_group\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const raceResultIdPattern = /^tournament_race_result\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const publicationIdPattern = /^tournament_publication\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const reasonPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const userAccountIdPattern = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const maximumResponseBytes = 524_288;

export type TournamentStage = "setup" | "qualifiers" | "finals" | "finalized";
export type TournamentGroupStage = "qualifier" | "final";
export type TournamentAttendance = "present" | "waiting" | "absent";
export type TournamentIncidentCategory =
  | "attendance"
  | "replacement"
  | "equipment"
  | "scoring"
  | "conduct"
  | "other";

/** ADR-0221: the refusal code when the installation lets Players only create themselves. */
export const PLAYER_CREATION_CLOSED = "player_creation_directors_disabled";

/** ADR-0221: community_rating is the former "ranked", random the former "random". */
export type TournamentSeedingSource = "community_rating" | "director_nights" | "manual" | "random";

/** The night's seeding source (ADR-0221: the one seeding field the server serves). */
export function seedingSourceOf(summary: Readonly<{ seedingSource: TournamentSeedingSource }>): TournamentSeedingSource {
  return summary.seedingSource;
}

export type TournamentSummary = Readonly<{
  tournamentId: string;
  name: string;
  seriesLabel?: string;
  editionNumber?: number;
  eventDate?: string;
  startAtMs?: number;
  timezone?: string;
  stage: TournamentStage;
  workflowStep: number;
  qualifierRounds: boolean;
  qualifierTieBreakMode?: "sp" | "lottery" | "manual";
  finalTieBreakMode?: "sp" | "lottery" | "manual";
  /** ADR-0221: where the qualifier draw takes its order from. */
  seedingSource: TournamentSeedingSource;
  /** ADR-0221: only Players with a verified claim count for the rating from this night. */
  verifiedOnly: boolean;
  placementStrategy?: "balanced" | "minimal_move";
  ownerSeatingMode?: "owner_strict" | "owner_soft";
  maxParticipants?: number;
  revision: number;
  participantCount: number;
  presentCount: number;
  publicResults: boolean;
  affectsRating: boolean;
  publicationId?: string;
  finalizedAtMs?: number;
  updatedAtMs: number;
}>;

export type TournamentParticipant = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
  attendance: TournamentAttendance;
  hasSwitch1: boolean;
  hasSwitch2: boolean;
  inactive?: boolean;
  isNew?: boolean;
  seedScore?: number;
  seedRank?: number;
}>;

export type TournamentStanding = Readonly<{
  rank: number;
  playerId: string;
  displayName: string;
  points: number;
  races: number;
  wins: number;
  bestRace: number;
  complete: boolean;
  /** Present only where the Director corrected the total the races add up to. */
  correctedFromRaces?: number;
}>;

export type TournamentGroup = Readonly<{
  groupId: string;
  stage: TournamentGroupStage;
  sequence: number;
  name: string;
  tierKey?: string;
  locked: boolean;
  manualScoreSegments: number;
  /** The consoles in the group's slots, in slot order; a Switch placed in an empty slot is here before anybody sits at it. */
  stations: readonly Readonly<{
    slotIndex: number;
    ownerPlayerId: string;
    ownerDisplayName: string;
    switchType: "ns1" | "ns2";
    utpCableNumber?: number;
  }>[];
  members: readonly Readonly<{
    playerId: string;
    displayName: string;
    seatOrder: number;
    /** The character this Player drove, as a score workbook recorded it. */
    character?: TournamentRecordedCharacter;
    station?: Readonly<{
      ownerPlayerId: string;
      ownerDisplayName: string;
      switchType: "ns1" | "ns2";
      seatNumber: number;
      utpCableNumber?: number;
    }>;
  }>[];
  races: readonly Readonly<{
    raceNumber: number;
    raceResultId: string;
    revision: number;
    scoringSegment: number;
    sourceKind: string;
    scoringNote?: string;
    trackId: string;
    mode?: TournamentRaceMode;
    mirror?: true;
    countsTowardStandings: boolean;
    placements: readonly Readonly<{
      finishPosition: number;
      playerId: string;
      displayName: string;
      racePoints: number;
    }>[];
  }>[];
  manualScores: readonly Readonly<{
    playerId: string;
    segmentPoints: readonly (number | null)[];
  }>[];
  standings: Readonly<{
    source: "races" | "manual" | "none";
    rows: readonly TournamentStanding[];
    tieGroups?: readonly Readonly<{
      points: number;
      resolved: boolean;
      players: readonly Readonly<{ playerId: string; displayName: string; wins: number; bestRace: number }>[];
    }>[];
  }>;
}>;

export type TournamentOverallRow = Readonly<{
  placement: number;
  playerId: string;
  displayName: string;
  groupName: string;
  groupRank: number;
  points: number;
}>;

export type TournamentDocument = Readonly<{
  summary: TournamentSummary;
  participants: readonly TournamentParticipant[];
  stations: readonly Readonly<{
    ownerPlayerId: string;
    ownerDisplayName: string;
    switchType: "ns1" | "ns2";
    utpCableNumber?: number;
  }>[];
  groups: readonly TournamentGroup[];
  overall: readonly TournamentOverallRow[];
  lifecycle: readonly Readonly<{
    sequence: number;
    eventType: string;
    detail?: string;
    occurredAtMs: number;
  }>[];
}>;

/** ADR-0218: one Player a typed name may mean, with the context to tell equal names apart. */
export type RosterPlayerCandidate = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
  matchedBy: "display_name" | "alias" | "username" | "partial";
  aliasText?: string;
  aliasScope?: "director" | "installation";
  claimed: boolean;
  inTournament: boolean;
  nights: number;
  nightsWithDirector: number;
  lastNightName?: string;
  lastNightDate?: string;
  directorNames: readonly string[];
  characterKey?: string;
  characterLabel?: string;
}>;

export type RosterNameCandidates = Readonly<{
  name: string;
  /** The name already belongs to a Player on this Director's rosters: a new one needs a confirmation. */
  sameNameInOwnNights: boolean;
  candidates: readonly RosterPlayerCandidate[];
}>;

export type FinalizationPreview = Readonly<{
  tournamentId: string;
  name: string;
  revision: number;
  presentCount: number;
  qualifierGroups: number;
  finalGroups: number;
  raceCount: number;
  rateableRaceCount: number;
  manualOnlyGroups: number;
  incompleteGroups: number;
  publicResults: boolean;
  affectsRating: boolean;
  alreadyFinalized: boolean;
  warnings: readonly string[];
  overall: readonly TournamentOverallRow[];
}>;

export type FinalizationResult = Readonly<{
  tournamentId: string;
  revision: number;
  publicationId?: string;
  publicResults: boolean;
  affectsRating: boolean;
  rating?: Readonly<{ appliedRaces: number; skippedRaces: number; alreadyApplied: boolean }>;
}>;

export type ScoreWorkbookPreview = readonly Readonly<{
  videoName: string;
  rows: readonly Readonly<{
    playerName: string;
    totalPoints: number;
    position?: number;
    pointSegments: readonly number[];
    /** The character the workbook recorded, e.g. "Pink Yoshi". */
    character?: string;
    characterRoster?: string;
  }>[];
  races: readonly Readonly<{
    raceNumber: number;
    trackName: string;
    /** ADR-0217: from the workbook's optional Class column. */
    mode?: TournamentRaceMode;
    mirror?: true;
    finishOrder: readonly string[];
  }>[];
  /** Prior totals of the first recorded race: the recording started after race 1. */
  carriedPoints?: readonly Readonly<{ playerName: string; points: number }>[];
}>[];

export type TournamentScoreWorkbookExport = Readonly<{
  fileName: string;
  mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  workbookBase64: string;
}>;

export type PublicTournamentSummary = Readonly<{
  tournamentId: string;
  name: string;
  editionNumber?: number;
  eventDate?: string;
  stage: TournamentStage;
  finalizedAtMs?: number;
  participantCount: number;
  updatedAtMs: number;
  /** When the night starts, and the clock it starts by. */
  startAtMs?: number;
  timezone?: string;
  /**
   * Which of the ten steps the night is in. A finalized night carries none:
   * there is no step left for it to be in.
   */
  workflowStep?: number;
  /** The Director's name, told to a signed-in viewer only. */
  directorDisplayName?: string;
  /** True when the signed-in viewer's own Player took part in this night. */
  viewerParticipated?: boolean;
  /** False only on a finished night the community cannot read. */
  published?: boolean;
  /** Whether that night counted toward the rating. Travels with `published`. */
  affectsRating?: boolean;
  /** True only on a night that was removed; its Director may put it back. */
  removed?: boolean;
}>;

export type PublicTournamentPlacementSnapshot = Readonly<{
  tournamentId: string;
  fieldSize: number;
  placements: readonly Readonly<{ playerId: string; placement: number }>[];
}>;

/** Which blocks of the report a published night shows. */
export type PublicTournamentReportVisibility = Readonly<{
  topTracks: boolean;
  benchmark: boolean;
  duel: boolean;
  distribution: boolean;
  /** The opening paragraphs, the Summary and every group's note (never the Player notes). */
  intro: boolean;
  summary: boolean;
  groupNotes: boolean;
}>;

/**
 * The Director's own report, once published. The same shape as the community's
 * imported stories, so the document draws either without knowing which.
 */
/** Where every participant stood on the SP ranking when the report was published, by the name shown that night. */
export type PublicReportRatings = Readonly<{
  asOfMs: number;
  players: readonly Readonly<{ name: string; rank: number; score: number; qualifierDelta?: number; finalDelta?: number }>[];
}>;

export type PublicTournamentReport = Readonly<{
  title: string;
  intro: readonly string[];
  summary: readonly string[];
  topTracks: readonly string[];
  groups: readonly Readonly<{ name: string; paragraphs: readonly string[]; html?: readonly string[] }>[];
  players: readonly Readonly<{ name: string; paragraphs: readonly string[]; html?: readonly string[] }>[];
  /** The same blocks with the Director's formatting: sanitised class-based
   * markup, drawn instead of the plain paragraphs when present. */
  introHtml?: readonly string[];
  summaryHtml?: readonly string[];
  topTracksHtml?: readonly string[];
  /** The SP ranking of the participants when the report was published. */
  ratings?: PublicReportRatings;
  visibility: PublicTournamentReportVisibility;
  publishedAtMs: number;
  revision: number;
}>;

export type PublicTournamentEvent = Readonly<{
  tournamentId: string;
  name: string;
  report?: PublicTournamentReport;
  editionNumber?: number;
  eventDate?: string;
  stage: TournamentStage;
  startAtMs?: number;
  timezone?: string;
  finalizedAtMs?: number;
  publicationId?: string;
  publicResults: boolean;
  participantCount: number;
  /** Which of the ten steps the night is in, while it is still being run. */
  workflowStep?: number;
  groups: readonly Readonly<{
    groupId: string;
    stage: TournamentGroupStage;
    sequence: number;
    name: string;
    tierKey?: string;
    /** How an equal score in this group was ordered. */
    tieBreakMode?: "sp" | "lottery" | "manual";
    /** Who sits at which console, for the Players who have been seated. */
    seating: readonly Readonly<{
      playerId?: string;
      displayName: string;
      seatOrder: number;
      /** Whose console it is, when that Player is public. */
      stationOwnerPlayerId?: string;
      stationOwnerDisplayName: string;
      switchType: "ns1" | "ns2";
      seatNumber: number;
      seedRank?: number;
      seedScore?: number;
      character?: TournamentRecordedCharacter;
    }>[];
    standings: readonly Readonly<{
      rank: number;
      playerId?: string;
      displayName: string;
      points: number;
      races: number;
      wins: number;
      complete: boolean;
      seedRank?: number;
      seedScore?: number;
      character?: TournamentRecordedCharacter;
    }>[];
    races: readonly Readonly<{
      raceNumber: number;
      /** Absent for a race the community's own history recorded without one. */
      trackId?: string;
      mode?: TournamentRaceMode;
      mirror?: true;
      countsTowardStandings: boolean;
      placements: readonly Readonly<{
        finishPosition: number;
        playerId?: string;
        displayName: string;
        racePoints: number;
      }>[];
    }>[];
  }>[];
  overall: readonly Readonly<{
    placement: number;
    playerId?: string;
    displayName: string;
    groupName: string;
    groupRank: number;
    points: number;
  }>[];
}>;

export type TournamentOperationClientErrorCode =
  | "invalid_input"
  | "not_authorized"
  | "not_found"
  | "conflict"
  | "unavailable"
  | "invalid_response";

export class TournamentOperationClientError extends Error {
  public constructor(
    public readonly code: TournamentOperationClientErrorCode,
    public readonly detail = "",
  ) {
    super(`tournament operation client error: ${code}`);
    this.name = "TournamentOperationClientError";
  }
}

export type TournamentRosterRejection = Readonly<{
  row: number;
  displayName: string;
  reason: string;
}>;

export class TournamentRosterRejectionError extends Error {
  public constructor(public readonly rejections: readonly TournamentRosterRejection[]) {
    super("tournament roster batch rejected");
    this.name = "TournamentRosterRejectionError";
  }
}

// ADR-0177 decision 2/3: a director is a user account. The server offers
// every director to an administrator and only the acting account to anyone
// else; the Web mirrors the APK's Step 0 on top of this list.
export type TournamentDirector = Readonly<{
  userAccountId: string;
  displayName: string;
  isAdministrator: boolean;
}>;

export type TournamentDirectorList = Readonly<{
  canActForOthers: boolean;
  directors: readonly TournamentDirector[];
}>;

export interface TournamentOperationClient {
  listPublic(signal?: AbortSignal): Promise<readonly PublicTournamentSummary[]>;
  loadPublic(tournamentId: string, signal?: AbortSignal): Promise<PublicTournamentEvent>;
  loadPublicPlacements?(tournamentIds: readonly string[], signal?: AbortSignal): Promise<readonly PublicTournamentPlacementSnapshot[]>;
  listDirectors(signal?: AbortSignal): Promise<TournamentDirectorList>;
  listForAdministrator(options?: Readonly<{ directorUserAccountId?: string }>, signal?: AbortSignal): Promise<readonly TournamentSummary[]>;
  load(tournamentId: string, signal?: AbortSignal): Promise<TournamentDocument>;
  create(input: Readonly<{
    name: string; seriesLabel?: string; editionNumber?: number; eventDate?: string;
    startAtMs?: number; timezone?: string;
    seedingSource?: TournamentSeedingSource;
    placementStrategy?: "balanced" | "minimal_move";
    qualifierRounds?: boolean;
    maxParticipants?: number | null;
    directorUserAccountId?: string;
  }>, signal?: AbortSignal): Promise<TournamentSummary>;
  update(tournamentId: string, input: Readonly<{
    expectedRevision: number; name?: string; seriesLabel?: string | null;
    editionNumber?: number | null; eventDate?: string | null; startAtMs?: number; timezone?: string;
    placementStrategy?: "balanced" | "minimal_move";
    seedingSource?: TournamentSeedingSource; verifiedOnly?: boolean;
    ownerSeatingMode?: "owner_strict" | "owner_soft";
    qualifierTieBreakMode?: "sp" | "lottery" | "manual";
    finalTieBreakMode?: "sp" | "lottery" | "manual";
    qualifierRounds?: boolean; maxParticipants?: number | null;
    publicResults?: boolean; affectsRating?: boolean;
  }>, signal?: AbortSignal): Promise<TournamentSummary>;
  setWorkflowStep(tournamentId: string, input: Readonly<{
    expectedRevision: number; targetStep: number; direction?: "advance" | "rollback";
  }>, signal?: AbortSignal): Promise<TournamentDocument>;
  setParticipant(tournamentId: string, input: Readonly<{
    expectedRevision: number; playerId: string; attendance?: TournamentAttendance;
    hasSwitch1?: boolean; hasSwitch2?: boolean;
  }>, signal?: AbortSignal): Promise<TournamentDocument>;
  importParticipants(tournamentId: string, input: Readonly<{
    expectedRevision: number;
    rows: readonly Readonly<{
      playerId: string; attendance?: TournamentAttendance; hasSwitch1?: boolean; hasSwitch2?: boolean;
    }>[];
  }>, signal?: AbortSignal): Promise<TournamentDocument>;
  addHistoricalParticipants(tournamentId: string, input: Readonly<{
    expectedRevision: number;
  }>, signal?: AbortSignal): Promise<TournamentDocument>;
  addRecentParticipants(tournamentId: string, input: Readonly<{
    expectedRevision: number;
  }>, signal?: AbortSignal): Promise<TournamentDocument>;
  removeParticipant(tournamentId: string, input: Readonly<{ expectedRevision: number; playerId: string }>, signal?: AbortSignal): Promise<TournamentDocument>;
  generateGroups(tournamentId: string, input: Readonly<{ expectedRevision: number; stage: TournamentGroupStage }>, signal?: AbortSignal): Promise<TournamentDocument>;
  updateGroups(tournamentId: string, input: Readonly<{
    expectedRevision: number; stage: TournamentGroupStage;
    groups: readonly Readonly<{ groupId: string; members: readonly string[] }>[];
  }>, signal?: AbortSignal): Promise<TournamentDocument>;
  importGroupLayout(tournamentId: string, input: Readonly<{
    expectedRevision: number; stage: TournamentGroupStage;
    equipmentCorrectionReason?: string;
    groups: readonly Readonly<{ name: string; seats: readonly Readonly<{
      playerId: string; stationOwnerPlayerId: string | null;
      switchType: "ns1" | "ns2" | null; seatNumber: 1 | 2 | null;
    }>[]; stations?: readonly Readonly<{ stationOwnerPlayerId: string; switchType: "ns1" | "ns2" }>[] }>[];
  }>, signal?: AbortSignal): Promise<TournamentDocument>;
  lockGroups(tournamentId: string, input: Readonly<{ expectedRevision: number; stage: TournamentGroupStage; locked: boolean }>, signal?: AbortSignal): Promise<TournamentDocument>;
  attachRaces(tournamentId: string, input: Readonly<{ expectedRevision: number; groupId: string; raceResultIds: readonly string[]; occurredAtMs?: number }>, signal?: AbortSignal): Promise<TournamentDocument>;
  setManualScores(tournamentId: string, input: Readonly<{
    expectedRevision: number; groupId: string; segments: number;
    scores: readonly Readonly<{ playerId: string; segmentPoints: readonly (number | null)[] }>[];
  }>, signal?: AbortSignal): Promise<TournamentDocument>;
  setTieBreakOrder(tournamentId: string, input: Readonly<{
    expectedRevision: number; groupId: string; points: number; playerIds: readonly string[];
  }>, signal?: AbortSignal): Promise<TournamentDocument>;
  enterRace(tournamentId: string, input: Readonly<{
    expectedRevision: number; groupId: string; raceNumber?: number; trackId: string;
    mode?: TournamentRaceMode; mirror?: true; finishOrder: readonly string[];
  }>, signal?: AbortSignal): Promise<TournamentDocument>;
  enterRaces(tournamentId: string, input: Readonly<{
    expectedRevision: number; groupId: string;
    races: readonly Readonly<{ raceNumber?: number; trackId: string; mode?: TournamentRaceMode; mirror?: true; finishOrder: readonly string[] }>[];
    /** The character each Player drove, when the workbook named one. */
    characters?: readonly Readonly<{
      playerId: string; characterKey?: string; characterLabel: string; characterRoster?: string;
    }>[];
  }>, signal?: AbortSignal): Promise<TournamentDocument>;
  previewScoreWorkbook(tournamentId: string, workbookBase64: string, signal?: AbortSignal): Promise<ScoreWorkbookPreview>;
  exportScoreWorkbook(tournamentId: string, input: Readonly<{
    expectedRevision: number; step: 5 | 6 | 9 | 10;
    trackLabels: readonly Readonly<{ trackId: string; displayName: string; cupName?: string }>[];
  }>, signal?: AbortSignal): Promise<TournamentScoreWorkbookExport>;
  finalizationPreview(tournamentId: string, signal?: AbortSignal): Promise<FinalizationPreview>;
  finalize(tournamentId: string, input: Readonly<{ expectedRevision: number; publicResults: boolean; affectsRating: boolean; reasonCode: string }>, signal?: AbortSignal): Promise<FinalizationResult>;
  setResultsVisibility(tournamentId: string, input: Readonly<{ expectedRevision: number; publicResults: boolean; reasonCode: string }>, signal?: AbortSignal): Promise<TournamentSummary>;
  recordIncident(tournamentId: string, input: Readonly<{
    expectedRevision: number; category: TournamentIncidentCategory; note: string; playerId?: string;
  }>, signal?: AbortSignal): Promise<TournamentDocument>;
  createPlayer(input: Readonly<{ username: string; displayName: string }>, signal?: AbortSignal): Promise<Readonly<{ playerId: string; username: string; displayName: string }>>;
  /** ADR-0177 decisions 8-12: reviewed display names become canonical
   * Players in one all-or-nothing batch; a collision rejects everything
   * and surfaces as a TournamentRosterRejectionError. */
  createRosterPlayers(
    players: readonly Readonly<{ row: number; displayName: string; confirmSameName?: boolean }>[],
    signal?: AbortSignal,
    options?: Readonly<{ tournamentId?: string }>,
  ): Promise<readonly Readonly<{ playerId: string; username: string; displayName: string }>[]>;
  /** ADR-0218: the Players each name may mean, with context, for an explicit choice. */
  rosterCandidates(input: Readonly<{ names: readonly string[]; tournamentId?: string; partial?: boolean }>, signal?: AbortSignal): Promise<readonly RosterNameCandidates[]>;
  /** ADR-0218: spellings the Director chose a Player for become that Director's own aliases. */
  rememberRosterAliases(tournamentId: string, aliases: readonly Readonly<{ playerId: string; name: string }>[], signal?: AbortSignal): Promise<Readonly<{
    created: readonly Readonly<{ playerId: string; aliasText: string }>[]; existing: number;
  }>>;
  deleteDraft(tournamentId: string, input: Readonly<{ expectedRevision: number }>, signal?: AbortSignal): Promise<void>;
  removeTournament(tournamentId: string, input: Readonly<{ reason: string }>, signal?: AbortSignal): Promise<Readonly<{
    tournamentId: string; alreadyRetracted: boolean; publicationWasPublic: boolean;
    ratingWasIncluded: boolean; ratingEpochId: number | null;
  }>>;
  /** Undo a finalization: result set retracted, rating replayed without the night, report back to draft, Step 10 again. Administrator only. */
  reopenTournament(tournamentId: string, input: Readonly<{ reason: string }>, signal?: AbortSignal): Promise<Readonly<{
    tournamentId: string; wasFinalized: boolean; publicationWasPublic: boolean;
    ratingWasIncluded: boolean; ratingEpochId: number | null;
  }>>;
}

// ---------------------------------------------------------------------------
// Closed parsing helpers (same discipline as the other product clients).

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TournamentOperationClientError("invalid_response");
  }
  return value as Record<string, unknown>;
}

function keys(row: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  for (const key of required) {
    if (!(key in row)) { throw new TournamentOperationClientError("invalid_response", key); }
  }
  for (const key of Object.keys(row)) {
    if (!required.includes(key) && !optional.includes(key)) {
      throw new TournamentOperationClientError("invalid_response", key);
    }
  }
}

function text(value: unknown, max: number, pattern?: RegExp): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max ||
      (pattern !== undefined && !pattern.test(value))) {
    throw new TournamentOperationClientError("invalid_response");
  }
  return value;
}

function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new TournamentOperationClientError("invalid_response");
  }
  return value;
}

function bool(value: unknown): boolean {
  if (typeof value !== "boolean") { throw new TournamentOperationClientError("invalid_response"); }
  return value;
}

function list<T>(value: unknown, max: number, item: (entry: unknown) => T): readonly T[] {
  if (!Array.isArray(value) || value.length > max) {
    throw new TournamentOperationClientError("invalid_response");
  }
  return value.map(item);
}

// ADR-0217: every LAN class; a Mirror race is a 150cc race.
function raceMode(value: unknown): TournamentRaceMode {
  return Number(oneOf(String(value), ["50", "100", "150", "200"])) as TournamentRaceMode;
}

function raceMirror(value: unknown, mode: unknown): true {
  if (value !== true || mode !== 150) {
    throw new TournamentOperationClientError("invalid_response");
  }
  return true;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new TournamentOperationClientError("invalid_response");
  }
  return value as T;
}

function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TournamentOperationClientError("invalid_response", "number");
  }
  return value;
}

function optional<T>(row: Record<string, unknown>, key: string, parse: (value: unknown) => T): { [K in string]?: T } {
  return row[key] === undefined ? {} : { [key]: parse(row[key]) };
}

/** ADR-0218 `mk8dx.roster-player-candidates.v1`: one Player a typed name may mean. */
function rosterCandidate(value: unknown): RosterPlayerCandidate {
  const row = object(value);
  keys(row, ["playerId", "username", "displayName", "matchedBy", "claimed", "inTournament", "nights", "nightsWithDirector", "directorNames"],
    ["aliasText", "aliasScope", "lastNightName", "lastNightDate", "characterKey", "characterLabel"]);
  const matchedBy = row["matchedBy"];
  if (matchedBy !== "display_name" && matchedBy !== "alias" && matchedBy !== "username" && matchedBy !== "partial") {
    throw new TournamentOperationClientError("invalid_response", "matchedBy");
  }
  const aliasScope = row["aliasScope"];
  if (aliasScope !== undefined && aliasScope !== "director" && aliasScope !== "installation") {
    throw new TournamentOperationClientError("invalid_response", "aliasScope");
  }
  return {
    playerId: text(row["playerId"], 135, playerIdPattern),
    username: text(row["username"], 135),
    displayName: text(row["displayName"], 64),
    matchedBy,
    ...optional(row, "aliasText", (entry) => text(entry, 128)),
    ...(aliasScope === undefined ? {} : { aliasScope }),
    claimed: bool(row["claimed"]),
    inTournament: bool(row["inTournament"]),
    nights: integer(row["nights"], 0),
    nightsWithDirector: integer(row["nightsWithDirector"], 0),
    ...optional(row, "lastNightName", (entry) => text(entry, 160)),
    ...optional(row, "lastNightDate", (entry) => text(entry, 10, /^\d{4}-\d{2}-\d{2}$/)),
    directorNames: list(row["directorNames"], 5, (entry) => text(entry, 64)),
    ...optional(row, "characterKey", (entry) => text(entry, 96)),
    ...optional(row, "characterLabel", (entry) => text(entry, 64)),
  };
}

function rosterNameEntry(value: unknown): RosterNameCandidates {
  const row = object(value);
  keys(row, ["name", "sameNameInOwnNights", "candidates"]);
  return {
    name: text(row["name"], 64),
    sameNameInOwnNights: bool(row["sameNameInOwnNights"]),
    candidates: list(row["candidates"], 10, rosterCandidate),
  };
}

function summary(value: unknown): TournamentSummary {
  const row = object(value);
  keys(row, ["tournamentId", "name", "stage", "workflowStep", "qualifierRounds", "revision", "participantCount", "presentCount", "publicResults", "affectsRating", "updatedAtMs",
    "seedingSource", "verifiedOnly"],
    ["seriesLabel", "editionNumber", "eventDate", "startAtMs", "timezone", "maxParticipants", "publicationId", "finalizedAtMs",
      "qualifierTieBreakMode", "finalTieBreakMode", "placementStrategy", "ownerSeatingMode"]);
  return {
    tournamentId: text(row["tournamentId"], 160, tournamentIdPattern),
    name: text(row["name"], 128),
    ...optional(row, "seriesLabel", (v) => text(v, 64)),
    ...optional(row, "editionNumber", (v) => integer(v, 1, 9999)),
    ...optional(row, "eventDate", (v) => text(v, 10, datePattern)),
    ...optional(row, "startAtMs", (v) => integer(v, 0)),
    ...optional(row, "timezone", (v) => text(v, 64)),
    stage: oneOf(row["stage"], ["setup", "qualifiers", "finals", "finalized"]),
    workflowStep: integer(row["workflowStep"], 2, 10),
    qualifierRounds: bool(row["qualifierRounds"]),
    ...optional(row, "qualifierTieBreakMode", (v) => oneOf(v, ["sp", "lottery", "manual"])),
    ...optional(row, "finalTieBreakMode", (v) => oneOf(v, ["sp", "lottery", "manual"])),
    seedingSource: oneOf(row["seedingSource"], ["community_rating", "director_nights", "manual", "random"]),
    verifiedOnly: bool(row["verifiedOnly"]),
    ...optional(row, "placementStrategy", (v) => oneOf(v, ["balanced", "minimal_move"])),
    ...optional(row, "ownerSeatingMode", (v) => oneOf(v, ["owner_strict", "owner_soft"])),
    ...optional(row, "maxParticipants", (v) => integer(v, 1, 60)),
    revision: integer(row["revision"], 1),
    participantCount: integer(row["participantCount"], 0),
    presentCount: integer(row["presentCount"], 0),
    publicResults: bool(row["publicResults"]),
    affectsRating: bool(row["affectsRating"]),
    ...optional(row, "publicationId", (v) => text(v, 160, publicationIdPattern)),
    ...optional(row, "finalizedAtMs", (v) => integer(v, 0)),
    updatedAtMs: integer(row["updatedAtMs"], 0),
  } as TournamentSummary;
}

function standing(value: unknown): TournamentStanding {
  const row = object(value);
  // `correctedFromRaces` is *optional*: the server sends it only where a
  // Director corrected the total the races add up to. Listing it as required
  // made every ordinary standings row fail to parse, and with it the whole
  // console - "Het toernooi kon niet worden geladen" on every night.
  keys(row, ["rank", "playerId", "displayName", "points", "races", "wins", "bestRace", "complete"], ["correctedFromRaces"]);
  return {
    rank: integer(row["rank"], 1),
    playerId: text(row["playerId"], 135, playerIdPattern),
    displayName: text(row["displayName"], 128),
    points: integer(row["points"], 0),
    races: integer(row["races"], 0),
    wins: integer(row["wins"], 0),
    bestRace: integer(row["bestRace"], 0),
    complete: bool(row["complete"]),
    ...(row["correctedFromRaces"] === undefined
      ? {}
      : { correctedFromRaces: integer(row["correctedFromRaces"], 0) }),
  };
}

function overallRow(value: unknown): TournamentOverallRow {
  const row = object(value);
  keys(row, ["placement", "playerId", "displayName", "groupName", "groupRank", "points"]);
  return {
    placement: integer(row["placement"], 1),
    playerId: text(row["playerId"], 135, playerIdPattern),
    displayName: text(row["displayName"], 128),
    groupName: text(row["groupName"], 64),
    groupRank: integer(row["groupRank"], 1),
    points: integer(row["points"], 0),
  };
}

function group(value: unknown): TournamentGroup {
  const row = object(value);
  keys(row, ["groupId", "stage", "sequence", "name", "locked", "manualScoreSegments", "members", "races", "manualScores", "standings"], ["tierKey", "stations"]);
  const standings = object(row["standings"]);
  keys(standings, ["source", "rows", "tieGroups"]);
  return {
    groupId: text(row["groupId"], 160, groupIdPattern),
    stage: oneOf(row["stage"], ["qualifier", "final"]),
    sequence: integer(row["sequence"], 1, 5),
    name: text(row["name"], 64),
    ...optional(row, "tierKey", (v) => text(v, 16)),
    locked: bool(row["locked"]),
    manualScoreSegments: integer(row["manualScoreSegments"], 1, 6),
    stations: row["stations"] === undefined ? [] : list(row["stations"], 6, (entry) => {
      const station = object(entry);
      keys(station, ["slotIndex", "ownerPlayerId", "ownerDisplayName", "switchType"], ["utpCableNumber"]);
      return {
        slotIndex: integer(station["slotIndex"], 1, 6),
        ownerPlayerId: text(station["ownerPlayerId"], 135, playerIdPattern),
        ownerDisplayName: text(station["ownerDisplayName"], 128),
        switchType: oneOf(station["switchType"], ["ns1", "ns2"]),
        ...optional(station, "utpCableNumber", (v) => integer(v, 1)),
      };
    }),
    members: list(row["members"], 12, (entry) => {
      const member = object(entry);
      keys(member, ["playerId", "displayName", "seatOrder"], ["station", "character"]);
      const station = member["station"] === undefined ? undefined : object(member["station"]);
      if (station !== undefined) { keys(station, ["ownerPlayerId", "ownerDisplayName", "switchType", "seatNumber"], ["utpCableNumber"]); }
      return {
        playerId: text(member["playerId"], 135, playerIdPattern),
        displayName: text(member["displayName"], 128),
        seatOrder: integer(member["seatOrder"], 1, 12),
        ...optional(member, "character", (value) => recordedCharacter(value)),
        ...(station === undefined ? {} : { station: {
          ownerPlayerId: text(station["ownerPlayerId"], 135, playerIdPattern),
          ownerDisplayName: text(station["ownerDisplayName"], 128),
          switchType: oneOf(station["switchType"], ["ns1", "ns2"]),
          seatNumber: integer(station["seatNumber"], 1, 2),
          ...optional(station, "utpCableNumber", (v) => integer(v, 1)),
        } }),
      };
    }),
    races: list(row["races"], 64, (entry) => {
      const race = object(entry);
      keys(race, ["raceNumber", "raceResultId", "revision", "scoringSegment", "sourceKind", "trackId", "countsTowardStandings", "placements"], ["mode", "mirror", "scoringNote"]);
      return {
        raceNumber: integer(race["raceNumber"], 1, 64),
        raceResultId: text(race["raceResultId"], 151, raceResultIdPattern),
        revision: integer(race["revision"], 1),
        scoringSegment: integer(race["scoringSegment"], 1),
        sourceKind: text(race["sourceKind"], 64),
        ...optional(race, "scoringNote", (v) => text(v, 240)),
        trackId: text(race["trackId"], 255),
        ...optional(race, "mode", raceMode),
        ...optional(race, "mirror", (v) => raceMirror(v, race["mode"])),
        countsTowardStandings: bool(race["countsTowardStandings"]),
        placements: list(race["placements"], 12, (placementEntry) => {
          const placement = object(placementEntry);
          keys(placement, ["finishPosition", "playerId", "displayName", "racePoints"]);
          return {
            finishPosition: integer(placement["finishPosition"], 1, 12),
            playerId: text(placement["playerId"], 135),
            displayName: text(placement["displayName"], 128),
            racePoints: integer(placement["racePoints"], 0),
          };
        }),
      } as TournamentGroup["races"][number];
    }),
    manualScores: list(row["manualScores"], 12, (entry) => {
      const score = object(entry);
      keys(score, ["playerId", "segmentPoints"]);
      return {
        playerId: text(score["playerId"], 135, playerIdPattern),
        segmentPoints: list(score["segmentPoints"], 6, (points) =>
          points === null ? null : integer(points, 0)),
      };
    }),
    standings: {
      source: oneOf(standings["source"], ["races", "manual", "none"]),
      rows: list(standings["rows"], 12, standing),
      tieGroups: list(standings["tieGroups"], 12, (entry) => {
        const tie = object(entry);
        keys(tie, ["points", "resolved", "players"]);
        return {
          points: integer(tie["points"], 0),
          resolved: bool(tie["resolved"]),
          players: list(tie["players"], 12, (playerEntry) => {
            const player = object(playerEntry);
            keys(player, ["playerId", "displayName", "wins", "bestRace"]);
            return {
              playerId: text(player["playerId"], 135, playerIdPattern),
              displayName: text(player["displayName"], 128),
              wins: integer(player["wins"], 0),
              bestRace: integer(player["bestRace"], 0),
            };
          }),
        };
      }),
    },
  } as TournamentGroup;
}

function scoreWorkbookPreview(value: unknown): ScoreWorkbookPreview {
  const row = object(value);
  keys(row, ["schemaVersion", "videos"]);
  if (row["schemaVersion"] !== "mk8dx.score-workbook-preview.v1") {
    throw new TournamentOperationClientError("invalid_response", "score workbook schema");
  }
  return list(row["videos"], 100, (videoEntry) => {
    const video = object(videoEntry);
    keys(video, ["videoName", "rows", "races"], ["carriedPoints"]);
    return {
      videoName: text(video["videoName"], 255),
      rows: list(video["rows"], 60, (scoreEntry) => {
        const score = object(scoreEntry);
        keys(score, ["playerName", "totalPoints", "pointSegments"], ["position", "character", "characterRoster"]);
        return {
          playerName: text(score["playerName"], 128),
          totalPoints: integer(score["totalPoints"], 0, 10000),
          ...optional(score, "position", (position) => integer(position, 0, 60)),
          pointSegments: list(score["pointSegments"], 4, (points) => integer(points, 0, 10000)),
          ...optional(score, "character", (value) => text(value, 64)),
          ...optional(score, "characterRoster", (value) => text(value, 64)),
        };
      }),
      races: list(video["races"], 64, (raceEntry) => {
        const race = object(raceEntry);
        keys(race, ["raceNumber", "trackName", "finishOrder"], ["mode", "mirror"]);
        return {
          raceNumber: integer(race["raceNumber"], 1, 64),
          trackName: text(race["trackName"], 128),
          ...optional(race, "mode", raceMode),
          ...optional(race, "mirror", (v) => raceMirror(v, race["mode"])),
          finishOrder: list(race["finishOrder"], 12, (name) => text(name, 128)),
        };
      }),
      ...optional(video, "carriedPoints", (value) => list(value, 12, (entry) => {
        const carried = object(entry);
        keys(carried, ["playerName", "points"]);
        return { playerName: text(carried["playerName"], 128), points: integer(carried["points"], 1, 10000) };
      })),
    };
  });
}

function scoreWorkbookExport(value: unknown): TournamentScoreWorkbookExport {
  const row = object(value);
  keys(row, ["schemaVersion", "fileName", "mediaType", "workbookBase64"]);
  if (row["schemaVersion"] !== "mk8dx.score-workbook-export.v1" ||
      row["mediaType"] !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    throw new TournamentOperationClientError("invalid_response", "score workbook export schema");
  }
  return {
    fileName: text(row["fileName"], 160),
    mediaType: row["mediaType"],
    workbookBase64: text(row["workbookBase64"], 14_000_000, /^[A-Za-z0-9+/=]+$/),
  };
}

function document(value: unknown): TournamentDocument {
  const row = object(value);
  keys(row, ["schemaVersion", "summary", "participants", "stations", "groups", "overall", "lifecycle"]);
  if (row["schemaVersion"] !== "mk8dx.tournament-operation.v1") {
    throw new TournamentOperationClientError("invalid_response", "schemaVersion");
  }
  return {
    summary: summary(row["summary"]),
    participants: list(row["participants"], 5000, (entry) => {
      const participant = object(entry);
      keys(participant, ["playerId", "username", "displayName", "attendance", "hasSwitch1", "hasSwitch2", "inactive"], ["seedScore", "seedRank", "isNew"]);
      return {
        playerId: text(participant["playerId"], 135, playerIdPattern),
        username: text(participant["username"], 135),
        displayName: text(participant["displayName"], 128),
        attendance: oneOf(participant["attendance"], ["present", "waiting", "absent"]),
        hasSwitch1: bool(participant["hasSwitch1"]),
        hasSwitch2: bool(participant["hasSwitch2"]),
        inactive: bool(participant["inactive"]),
        ...optional(participant, "isNew", bool),
        ...optional(participant, "seedScore", (v) => {
          if (typeof v !== "number" || !Number.isFinite(v)) { throw new TournamentOperationClientError("invalid_response"); }
          return v;
        }),
        ...optional(participant, "seedRank", (v) => integer(v, 1)),
      } as TournamentParticipant;
    }),
    stations: list(row["stations"], 120, (entry) => {
      const station = object(entry);
      keys(station, ["ownerPlayerId", "ownerDisplayName", "switchType"], ["utpCableNumber"]);
      return {
        ownerPlayerId: text(station["ownerPlayerId"], 135, playerIdPattern),
        ownerDisplayName: text(station["ownerDisplayName"], 128),
        switchType: oneOf(station["switchType"], ["ns1", "ns2"]),
        ...optional(station, "utpCableNumber", (v) => integer(v, 1)),
      };
    }),
    groups: list(row["groups"], 10, group),
    overall: list(row["overall"], 60, overallRow),
    lifecycle: list(row["lifecycle"], 200, (entry) => {
      const event = object(entry);
      keys(event, ["sequence", "eventType", "occurredAtMs"], ["detail"]);
      return {
        sequence: integer(event["sequence"], 1),
        eventType: text(event["eventType"], 32),
        ...optional(event, "detail", (v) => text(v, 255)),
        occurredAtMs: integer(event["occurredAtMs"], 0),
      } as TournamentDocument["lifecycle"][number];
    }),
  };
}

function preview(value: unknown): FinalizationPreview {
  const row = object(value);
  keys(row, ["schemaVersion", "tournamentId", "name", "revision", "presentCount", "qualifierGroups", "finalGroups", "raceCount", "rateableRaceCount", "manualOnlyGroups", "incompleteGroups", "publicResults", "affectsRating", "alreadyFinalized", "warnings", "overall"]);
  return {
    tournamentId: text(row["tournamentId"], 160, tournamentIdPattern),
    name: text(row["name"], 128),
    revision: integer(row["revision"], 1),
    presentCount: integer(row["presentCount"], 0),
    qualifierGroups: integer(row["qualifierGroups"], 0),
    finalGroups: integer(row["finalGroups"], 0),
    raceCount: integer(row["raceCount"], 0),
    rateableRaceCount: integer(row["rateableRaceCount"], 0),
    manualOnlyGroups: integer(row["manualOnlyGroups"], 0),
    incompleteGroups: integer(row["incompleteGroups"], 0),
    publicResults: bool(row["publicResults"]),
    affectsRating: bool(row["affectsRating"]),
    alreadyFinalized: bool(row["alreadyFinalized"]),
    warnings: list(row["warnings"], 10, (entry) => text(entry, 240)),
    overall: list(row["overall"], 60, overallRow),
  };
}

function finalization(value: unknown): FinalizationResult {
  const row = object(value);
  keys(row, ["tournamentId", "revision", "publicResults", "affectsRating"], ["publicationId", "rating"]);
  const rating = row["rating"] === undefined ? undefined : object(row["rating"]);
  if (rating !== undefined) { keys(rating, ["appliedRaces", "skippedRaces", "alreadyApplied"]); }
  return {
    tournamentId: text(row["tournamentId"], 160, tournamentIdPattern),
    revision: integer(row["revision"], 1),
    ...optional(row, "publicationId", (v) => text(v, 160, publicationIdPattern)),
    publicResults: bool(row["publicResults"]),
    affectsRating: bool(row["affectsRating"]),
    ...(rating === undefined ? {} : { rating: {
      appliedRaces: integer(rating["appliedRaces"], 0),
      skippedRaces: integer(rating["skippedRaces"], 0),
      alreadyApplied: bool(rating["alreadyApplied"]),
    } }),
  } as FinalizationResult;
}

/** The character a workbook recorded, as the server hands it over. */
export type TournamentRecordedCharacter = Readonly<{ key?: string; label: string; roster?: string }>;

function recordedCharacter(value: unknown): TournamentRecordedCharacter {
  const row = object(value);
  keys(row, ["label"], ["key", "roster"]);
  return {
    ...optional(row, "key", (candidate) => text(candidate, 96)),
    label: text(row["label"], 64),
    ...optional(row, "roster", (candidate) => text(candidate, 64)),
  };
}

function publicSummary(value: unknown): PublicTournamentSummary {
  const row = object(value);
  keys(row, ["tournamentId", "name", "stage", "participantCount", "updatedAtMs"], ["editionNumber", "eventDate", "finalizedAtMs", "startAtMs", "timezone", "workflowStep", "directorDisplayName", "viewerParticipated", "published", "affectsRating", "removed"]);
  return {
    tournamentId: text(row["tournamentId"], 160, tournamentIdPattern),
    name: text(row["name"], 128),
    ...optional(row, "editionNumber", (v) => integer(v, 1, 9999)),
    ...optional(row, "eventDate", (v) => text(v, 10, datePattern)),
    stage: oneOf(row["stage"], ["setup", "qualifiers", "finals", "finalized"]),
    ...optional(row, "startAtMs", (v) => integer(v, 0)),
    ...optional(row, "timezone", (v) => text(v, 64)),
    ...optional(row, "finalizedAtMs", (v) => integer(v, 0)),
    participantCount: integer(row["participantCount"], 0),
    updatedAtMs: integer(row["updatedAtMs"], 0),
    ...optional(row, "workflowStep", (v) => integer(v, 0, 10)),
    ...optional(row, "directorDisplayName", (v) => text(v, 128)),
    ...optional(row, "viewerParticipated", (v) => bool(v)),
    ...optional(row, "published", (v) => bool(v)),
    ...optional(row, "affectsRating", (v) => bool(v)),
    ...optional(row, "removed", (v) => bool(v)),
  } as PublicTournamentSummary;
}

function publicPlacementSnapshot(value: unknown): PublicTournamentPlacementSnapshot {
  const row = object(value);
  keys(row, ["tournamentId", "fieldSize", "placements"]);
  return {
    tournamentId: text(row["tournamentId"], 160, tournamentIdPattern),
    fieldSize: integer(row["fieldSize"], 0, 200),
    placements: list(row["placements"], 200, (entry) => {
      const placement = object(entry);
      keys(placement, ["playerId", "placement"]);
      return {
        playerId: text(placement["playerId"], 135, playerIdPattern),
        placement: integer(placement["placement"], 1, 200),
      };
    }),
  };
}

function paragraphList(value: unknown, maximum: number): readonly string[] {
  return list(value, 40, (entry) => text(entry, maximum));
}

export function publicReportRatings(value: unknown): PublicReportRatings {
  const row = object(value);
  keys(row, ["asOfMs", "players"]);
  return {
    asOfMs: integer(row["asOfMs"], 0),
    players: list(row["players"], 200, (entry) => {
      const item = object(entry);
      keys(item, ["name", "rank", "score"], ["qualifierDelta", "finalDelta"]);
      return {
        name: text(item["name"], 64), rank: integer(item["rank"], 1), score: finite(item["score"]),
        ...optional(item, "qualifierDelta", finite), ...optional(item, "finalDelta", finite),
      };
    }),
  };
}

function publicReport(value: unknown): PublicTournamentReport {
  const row = object(value);
  keys(row, ["title", "intro", "summary", "topTracks", "groups", "players", "visibility", "publishedAtMs", "revision"],
    ["introHtml", "summaryHtml", "topTracksHtml", "ratings"]);
  const flags = object(row["visibility"]);
  keys(flags, ["topTracks", "benchmark", "duel", "distribution"], ["intro", "summary", "groupNotes"]);
  // A report published before these three switches existed showed those blocks.
  const shownUnlessSaid = (key: string): boolean => flags[key] === undefined ? true : bool(flags[key]);
  const named = (entry: unknown, maximum: number): Readonly<{ name: string; paragraphs: readonly string[]; html?: readonly string[] }> => {
    const item = object(entry);
    keys(item, ["name", "paragraphs"], ["html"]);
    return {
      name: text(item["name"], 64), paragraphs: paragraphList(item["paragraphs"], maximum),
      ...optional(item, "html", (value) => paragraphList(value, maximum)),
    };
  };
  return {
    title: text(row["title"], 160),
    intro: paragraphList(row["intro"], 8000),
    summary: paragraphList(row["summary"], 8000),
    topTracks: paragraphList(row["topTracks"], 8000),
    ...optional(row, "introHtml", (value) => paragraphList(value, 8000)),
    ...optional(row, "summaryHtml", (value) => paragraphList(value, 8000)),
    ...optional(row, "topTracksHtml", (value) => paragraphList(value, 8000)),
    ...optional(row, "ratings", publicReportRatings),
    groups: list(row["groups"], 12, (entry) => named(entry, 4000)),
    players: list(row["players"], 60, (entry) => named(entry, 2000)),
    visibility: {
      topTracks: bool(flags["topTracks"]), benchmark: bool(flags["benchmark"]),
      duel: bool(flags["duel"]), distribution: bool(flags["distribution"]),
      intro: shownUnlessSaid("intro"), summary: shownUnlessSaid("summary"), groupNotes: shownUnlessSaid("groupNotes"),
    },
    publishedAtMs: integer(row["publishedAtMs"], 0),
    revision: integer(row["revision"], 1),
  };
}

function publicEvent(value: unknown): PublicTournamentEvent {
  const row = object(value);
  keys(row, ["schemaVersion", "tournamentId", "name", "stage", "publicResults", "participantCount", "groups", "overall"],
    ["editionNumber", "eventDate", "finalizedAtMs", "publicationId", "startAtMs", "timezone", "report", "workflowStep"]);
  if (row["schemaVersion"] !== "mk8dx.public-tournament-event.v1") {
    throw new TournamentOperationClientError("invalid_response", "schemaVersion");
  }
  return {
    tournamentId: text(row["tournamentId"], 160, tournamentIdPattern),
    name: text(row["name"], 128),
    ...optional(row, "editionNumber", (v) => integer(v, 1, 9999)),
    ...optional(row, "eventDate", (v) => text(v, 10, datePattern)),
    stage: oneOf(row["stage"], ["setup", "qualifiers", "finals", "finalized"]),
    // Allowed through the key check since the schema carried them, but never
    // read: the type promised a start time the page could not see.
    ...optional(row, "startAtMs", (v) => integer(v, 0)),
    ...optional(row, "timezone", (v) => text(v, 64)),
    ...optional(row, "finalizedAtMs", (v) => integer(v, 0)),
    ...optional(row, "publicationId", (v) => text(v, 160, publicationIdPattern)),
    ...optional(row, "report", publicReport),
    publicResults: bool(row["publicResults"]),
    participantCount: integer(row["participantCount"], 0),
    ...optional(row, "workflowStep", (v) => integer(v, 0, 10)),
    groups: list(row["groups"], 10, (entry) => {
      const groupRow = object(entry);
      // The seating is read as optional: a deployment whose API has not caught
      // up simply has nobody seated, rather than a page that will not render.
      keys(groupRow, ["groupId", "stage", "sequence", "name", "standings", "races"],
        ["tierKey", "tieBreakMode", "seating"]);
      return {
        groupId: text(groupRow["groupId"], 160, groupIdPattern),
        stage: oneOf(groupRow["stage"], ["qualifier", "final"]),
        sequence: integer(groupRow["sequence"], 1, 5),
        name: text(groupRow["name"], 64),
        ...optional(groupRow, "tierKey", (v) => text(v, 16)),
        ...optional(groupRow, "tieBreakMode", (v) => { const mode = text(v, 8); if (mode !== "sp" && mode !== "lottery" && mode !== "manual") { throw new TournamentOperationClientError("invalid_response", "tieBreakMode"); } return mode; }),
        seating: groupRow["seating"] === undefined ? [] : list(groupRow["seating"], 12, (seatEntry) => {
          const seat = object(seatEntry);
          keys(seat, ["displayName", "seatOrder", "stationOwnerDisplayName", "switchType", "seatNumber"], ["playerId", "stationOwnerPlayerId", "seedRank", "seedScore", "character"]);
          return {
            ...optional(seat, "playerId", (v) => text(v, 135, playerIdPattern)),
            displayName: text(seat["displayName"], 128),
            seatOrder: integer(seat["seatOrder"], 0, 12),
            ...optional(seat, "stationOwnerPlayerId", (v) => text(v, 135, playerIdPattern)),
            stationOwnerDisplayName: text(seat["stationOwnerDisplayName"], 128),
            switchType: oneOf(seat["switchType"], ["ns1", "ns2"]),
            seatNumber: integer(seat["seatNumber"], 1, 2),
            ...optional(seat, "seedRank", (v) => integer(v, 1)),
            ...optional(seat, "seedScore", (v) => finite(v)),
            ...optional(seat, "character", (v) => recordedCharacter(v)),
          } as PublicTournamentEvent["groups"][number]["seating"][number];
        }),
        standings: list(groupRow["standings"], 12, (standingEntry) => {
          const standingRow = object(standingEntry);
          keys(standingRow, ["rank", "displayName", "points", "races", "wins", "complete"], ["playerId", "seedRank", "seedScore", "character"]);
          return {
            rank: integer(standingRow["rank"], 1),
            ...optional(standingRow, "playerId", (v) => text(v, 135, playerIdPattern)),
            displayName: text(standingRow["displayName"], 128),
            points: integer(standingRow["points"], 0),
            races: integer(standingRow["races"], 0),
            wins: integer(standingRow["wins"], 0),
            complete: bool(standingRow["complete"]),
            ...optional(standingRow, "seedRank", (v) => integer(v, 1)),
            ...optional(standingRow, "seedScore", (v) => finite(v)),
            ...optional(standingRow, "character", (v) => recordedCharacter(v)),
          } as PublicTournamentEvent["groups"][number]["standings"][number];
        }),
        races: list(groupRow["races"], 64, (raceEntry) => {
          const race = object(raceEntry);
          keys(race, ["raceNumber", "countsTowardStandings", "placements"], ["mode", "mirror", "trackId"]);
          return {
            raceNumber: integer(race["raceNumber"], 1, 64),
            ...optional(race, "trackId", (v) => text(v, 255)),
            ...optional(race, "mode", raceMode),
            ...optional(race, "mirror", (v) => raceMirror(v, race["mode"])),
            countsTowardStandings: bool(race["countsTowardStandings"]),
            placements: list(race["placements"], 12, (placementEntry) => {
              const placement = object(placementEntry);
              keys(placement, ["finishPosition", "displayName", "racePoints"], ["playerId"]);
              return {
                finishPosition: integer(placement["finishPosition"], 1, 12),
                ...optional(placement, "playerId", (v) => text(v, 135, playerIdPattern)),
                displayName: text(placement["displayName"], 128),
                racePoints: integer(placement["racePoints"], 0),
              } as PublicTournamentEvent["groups"][number]["races"][number]["placements"][number];
            }),
          } as PublicTournamentEvent["groups"][number]["races"][number];
        }),
      } as PublicTournamentEvent["groups"][number];
    }),
    overall: list(row["overall"], 60, (entry) => {
      const overall = object(entry);
      keys(overall, ["placement", "displayName", "groupName", "groupRank", "points"], ["playerId"]);
      return {
        placement: integer(overall["placement"], 1),
        ...optional(overall, "playerId", (v) => text(v, 135, playerIdPattern)),
        displayName: text(overall["displayName"], 128),
        groupName: text(overall["groupName"], 64),
        groupRank: integer(overall["groupRank"], 1),
        points: integer(overall["points"], 0),
      } as PublicTournamentEvent["overall"][number];
    }),
  } as PublicTournamentEvent;
}

// ---------------------------------------------------------------------------
// Transport.

async function bounded(response: Response, maximumBytes = maximumResponseBytes): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new TournamentOperationClientError("invalid_response", "content-type");
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maximumBytes) {
    throw new TournamentOperationClientError("invalid_response", "content-length");
  }
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return JSON.parse(await response.text()) as unknown;
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let received = 0;
  let body = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) { break; }
    received += value.byteLength;
    if (received > maximumBytes) {
      await reader.cancel();
      throw new TournamentOperationClientError("invalid_response", "too-large");
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new TournamentOperationClientError("invalid_response", "json");
  }
}

function send(fetchPort: FetchPort, path: string, init: RequestInit): Promise<Response> {
  return fetchPort(path, {
    credentials: "same-origin",
    mode: "same-origin",
    redirect: "error",
    referrerPolicy: "same-origin",
    cache: "no-store",
    ...init,
  });
}

async function failure(response: Response): Promise<never> {
  let detail = "";
  try {
    const body = object(await bounded(response));
    if (typeof body["message"] === "string") { detail = body["message"].slice(0, 240); }
  } catch { /* the status decides */ }
  if (response.status === 400) { throw new TournamentOperationClientError("invalid_input", detail); }
  if (response.status === 401 || response.status === 403) { throw new TournamentOperationClientError("not_authorized", detail); }
  if (response.status === 404) { throw new TournamentOperationClientError("not_found", detail); }
  if (response.status === 409) { throw new TournamentOperationClientError("conflict", detail); }
  throw new TournamentOperationClientError("unavailable", detail);
}

async function csrf(fetchPort: FetchPort, signal?: AbortSignal): Promise<Readonly<{ name: string; value: string }>> {
  const response = await send(fetchPort, TOURNAMENT_CSRF_PATH, {
    method: "GET", headers: { Accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) { await failure(response); }
  const row = object(await bounded(response));
  keys(row, ["schemaVersion", "headerName", "value"]);
  if (row["schemaVersion"] !== "mk8dx.web-csrf.v1") {
    throw new TournamentOperationClientError("invalid_response", "csrf");
  }
  return {
    name: text(row["headerName"], 64, /^x-[a-z0-9-]+$/i),
    value: text(row["value"], 4096, /^[\x21-\x7e]+$/),
  };
}

export function createTournamentOperationClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): TournamentOperationClient {
  const get = async <T>(path: string, parse: (value: unknown) => T, signal?: AbortSignal): Promise<T> => {
    const response = await send(fetchPort, path, {
      method: "GET", headers: { Accept: "application/json" },
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) { await failure(response); }
    return parse(await bounded(response));
  };
  // The CSRF proof is per session, not per request. Fetching one before every
  // mutation doubled the round trips of every operator action: a Step 2 roster
  // import of 62 participants made 62 token calls beside its 62 writes and
  // took about three minutes. The token is kept and only re-fetched when the
  // server actually rejects it, which it answers with 403 before applying
  // anything - so the single retry cannot double-apply a write.
  let proof: Readonly<{ name: string; value: string }> | null = null;
  const proofFor = async (signal?: AbortSignal, refresh = false): Promise<Readonly<{ name: string; value: string }>> => {
    if (refresh || proof === null) { proof = await csrf(fetchPort, signal); }
    return proof;
  };
  const post = async <T>(
    path: string,
    body: unknown,
    parse: (value: unknown) => T,
    signal?: AbortSignal,
    maximumBytes = maximumResponseBytes,
  ): Promise<T> => {
    const payload = JSON.stringify(body);
    const attempt = async (current: Readonly<{ name: string; value: string }>): Promise<Response> =>
      send(fetchPort, path, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", [current.name]: current.value },
        body: payload,
        ...(signal === undefined ? {} : { signal }),
      });
    let response = await attempt(await proofFor(signal));
    if (response.status === 403) {
      response = await attempt(await proofFor(signal, true));
    }
    if (!response.ok) { await failure(response); }
    return parse(await bounded(response, maximumBytes));
  };
  const id = (value: string): string => {
    if (!tournamentIdPattern.test(value)) { throw new TournamentOperationClientError("invalid_input", "tournamentId"); }
    return value;
  };
  const check = (condition: boolean, detail: string): void => {
    if (!condition) { throw new TournamentOperationClientError("invalid_input", detail); }
  };
  return {
    listPublic: (signal) => get(PUBLIC_TOURNAMENT_EVENTS_PATH, (value) => {
      const row = object(value);
      keys(row, ["schemaVersion", "tournaments"]);
      return list(row["tournaments"], 200, publicSummary);
    }, signal),
    loadPublic: (tournamentId, signal) =>
      get(`${PUBLIC_TOURNAMENT_EVENTS_PATH}/${encodeURIComponent(id(tournamentId))}`, publicEvent, signal),
    loadPublicPlacements: (tournamentIds, signal) => {
      const ids = [...new Set(tournamentIds.map(id))];
      check(ids.length >= 1 && ids.length <= 8, "tournamentIds");
      return get(`${PUBLIC_TOURNAMENT_PLACEMENTS_PATH}?ids=${ids.map(encodeURIComponent).join(",")}`, (value) => {
        const row = object(value);
        keys(row, ["schemaVersion", "tournaments"]);
        if (row["schemaVersion"] !== "mk8dx.public-tournament-placements.v1") {
          throw new TournamentOperationClientError("invalid_response", "schemaVersion");
        }
        return list(row["tournaments"], 8, publicPlacementSnapshot);
      }, signal);
    },
    listDirectors: (signal) => get(TOURNAMENT_DIRECTORS_PATH, (value) => {
      const row = object(value);
      keys(row, ["schemaVersion", "canActForOthers", "directors"]);
      if (row["schemaVersion"] !== "mk8dx.administrator-tournament-directors.v1"
        || typeof row["canActForOthers"] !== "boolean") {
        throw new TournamentOperationClientError("invalid_response", "directors");
      }
      return {
        canActForOthers: row["canActForOthers"],
        directors: list(row["directors"], 200, (entry) => {
          const director = object(entry);
          keys(director, ["userAccountId", "displayName", "isAdministrator"]);
          if (typeof director["isAdministrator"] !== "boolean") {
            throw new TournamentOperationClientError("invalid_response", "director");
          }
          return {
            userAccountId: text(director["userAccountId"], 141, userAccountIdPattern),
            displayName: text(director["displayName"], 141),
            isAdministrator: director["isAdministrator"],
          };
        }),
      };
    }, signal),
    listForAdministrator: (options, signal) => {
      const director = options?.directorUserAccountId;
      if (director !== undefined && !userAccountIdPattern.test(director)) {
        throw new TournamentOperationClientError("invalid_input", "director");
      }
      const query = director === undefined ? "" : `?director=${encodeURIComponent(director)}`;
      return get(`${ADMINISTRATOR_TOURNAMENTS_PATH}${query}`, (value) => {
        const row = object(value);
        keys(row, ["schemaVersion", "tournaments"]);
        return list(row["tournaments"], 200, summary);
      }, signal);
    },
    load: (tournamentId, signal) =>
      get(`${ADMINISTRATOR_TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}`, document, signal),
    create: async (input, signal) => {
      const name = input.name.trim();
      check(name.length >= 1 && name.length <= 128, "name");
      check(input.seriesLabel === undefined || (input.seriesLabel.trim().length >= 1 && input.seriesLabel.trim().length <= 64), "seriesLabel");
      check(input.editionNumber === undefined || (Number.isSafeInteger(input.editionNumber) && input.editionNumber >= 1 && input.editionNumber <= 9999), "editionNumber");
      check(input.eventDate === undefined || datePattern.test(input.eventDate), "eventDate");
      check(input.startAtMs === undefined || (Number.isSafeInteger(input.startAtMs) && input.startAtMs >= 0), "startAtMs");
      check(input.timezone === undefined || (input.timezone.trim().length >= 1 && input.timezone.trim().length <= 64), "timezone");
      check(input.directorUserAccountId === undefined || userAccountIdPattern.test(input.directorUserAccountId), "directorUserAccountId");
      return post(TOURNAMENTS_PATH, {
        name,
        ...(input.seriesLabel === undefined ? {} : { seriesLabel: input.seriesLabel.trim() }),
        ...(input.editionNumber === undefined ? {} : { editionNumber: input.editionNumber }),
        ...(input.eventDate === undefined ? {} : { eventDate: input.eventDate }),
        ...(input.startAtMs === undefined ? {} : { startAtMs: input.startAtMs }),
        ...(input.timezone === undefined ? {} : { timezone: input.timezone.trim() }),
        ...(input.seedingSource === undefined ? {} : { seedingSource: input.seedingSource }),
        ...(input.placementStrategy === undefined ? {} : { placementStrategy: input.placementStrategy }),
        ...(input.qualifierRounds === undefined ? {} : { qualifierRounds: input.qualifierRounds }),
        ...(input.maxParticipants === undefined ? {} : { maxParticipants: input.maxParticipants }),
        ...(input.directorUserAccountId === undefined ? {} : { directorUserAccountId: input.directorUserAccountId }),
      }, summary, signal);
    },
    update: (tournamentId, input, signal) =>
      post(`${TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/actions/update`, input, summary, signal),
    setWorkflowStep: (tournamentId, input, signal) => {
      const action = input.direction === "advance" ? "advance-current-step"
        : input.direction === "rollback" ? "rollback-current-step"
          : "set-workflow-step";
      const body = input.direction === undefined
        ? input
        : { expectedRevision: input.expectedRevision };
      return post(`${TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/actions/${action}`, body, document, signal);
    },
    setParticipant: async (tournamentId, input, signal) => {
      check(playerIdPattern.test(input.playerId), "playerId");
      return post(`${TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/participants`, input, document, signal);
    },
    importParticipants: async (tournamentId, input, signal) => {
      check(input.rows.length >= 1 && input.rows.length <= 200 &&
        input.rows.every((row) => playerIdPattern.test(row.playerId)) &&
        new Set(input.rows.map((row) => row.playerId)).size === input.rows.length, "rows");
      return post(`${TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/participants/actions/import`, input, document, signal);
    },
    addHistoricalParticipants: (tournamentId, input, signal) =>
      post(`${TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/participants/actions/add-historical`, input, document, signal),
    addRecentParticipants: (tournamentId, input, signal) =>
      post(`${TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/participants/actions/add-recent`, input, document, signal),
    removeParticipant: async (tournamentId, input, signal) => {
      check(playerIdPattern.test(input.playerId), "playerId");
      return post(`${TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/participants/actions/remove`, input, document, signal);
    },
    generateGroups: (tournamentId, input, signal) =>
      post(`${TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/actions/generate-groups`, input, document, signal),
    updateGroups: async (tournamentId, input, signal) => {
      check(input.groups.every((group) => groupIdPattern.test(group.groupId) && group.members.every((member) => playerIdPattern.test(member))), "groups");
      return post(`${TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/actions/update-groups`, input, document, signal);
    },
    importGroupLayout: async (tournamentId, input, signal) => {
      check(input.groups.length >= 1 && input.groups.every((group) =>
        group.name.trim().length >= 1 && group.name.length <= 64 &&
        group.seats.every((seat) => playerIdPattern.test(seat.playerId) &&
          (seat.stationOwnerPlayerId === null || playerIdPattern.test(seat.stationOwnerPlayerId)))), "groups");
      return post(`${TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/actions/import-group-layout`, input, document, signal);
    },
    lockGroups: (tournamentId, input, signal) =>
      post(`${TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/actions/lock-groups`, input, document, signal),
    attachRaces: async (tournamentId, input, signal) => {
      check(groupIdPattern.test(input.groupId), "groupId");
      check(input.raceResultIds.length >= 1 && input.raceResultIds.every((value) => raceResultIdPattern.test(value)), "raceResultIds");
      return post(`${TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/actions/attach-races`, input, document, signal);
    },
    setManualScores: async (tournamentId, input, signal) => {
      check(groupIdPattern.test(input.groupId), "groupId");
      check(Number.isSafeInteger(input.segments) && input.segments >= 1 && input.segments <= 6, "segments");
      return post(`${TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/manual-scores`, input, document, signal);
    },
    setTieBreakOrder: async (tournamentId, input, signal) => {
      check(groupIdPattern.test(input.groupId), "groupId");
      check(Number.isSafeInteger(input.points) && input.points >= 0 && input.points <= 60000, "points");
      check(input.playerIds.length >= 2 && input.playerIds.length <= 12 &&
        new Set(input.playerIds).size === input.playerIds.length &&
        input.playerIds.every((playerId) => playerIdPattern.test(playerId)), "playerIds");
      return post(`${TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/tie-breaks`, input, document, signal);
    },
    enterRace: async (tournamentId, input, signal) => {
      check(groupIdPattern.test(input.groupId), "groupId");
      check(input.raceNumber === undefined ||
        (Number.isSafeInteger(input.raceNumber) && input.raceNumber >= 1 && input.raceNumber <= 64), "raceNumber");
      check(/^track\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(input.trackId), "trackId");
      check(input.finishOrder.length >= 2 && input.finishOrder.length <= 12 &&
        new Set(input.finishOrder).size === input.finishOrder.length &&
        input.finishOrder.every((playerId) => playerIdPattern.test(playerId)), "finishOrder");
      return post(`${TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/actions/enter-race`, input, document, signal);
    },
    enterRaces: async (tournamentId, input, signal) => {
      check(groupIdPattern.test(input.groupId), "groupId");
      check(input.races.length >= 1 && input.races.length <= 64 && input.races.every((race) =>
        (race.raceNumber === undefined ||
          (Number.isSafeInteger(race.raceNumber) && race.raceNumber >= 1 && race.raceNumber <= 64)) &&
        /^track\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(race.trackId) &&
        race.finishOrder.length >= 2 && race.finishOrder.length <= 12 &&
        new Set(race.finishOrder).size === race.finishOrder.length &&
        race.finishOrder.every((playerId) => playerIdPattern.test(playerId))), "races");
      check((input.characters ?? []).length <= 12 && (input.characters ?? []).every((entry) =>
        playerIdPattern.test(entry.playerId) &&
        entry.characterLabel.trim().length >= 1 && entry.characterLabel.trim().length <= 64), "characters");
      return post(`${TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/actions/enter-races`, input, document, signal);
    },
    previewScoreWorkbook: (tournamentId, workbookBase64, signal) => {
      check(workbookBase64.length >= 1 && workbookBase64.length <= 14_000_000, "workbookBase64");
      return post(`${TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/score-workbook-preview`, { workbookBase64 }, scoreWorkbookPreview, signal, 15_000_000);
    },
    exportScoreWorkbook: (tournamentId, input, signal) => {
      check([5, 6, 9, 10].includes(input.step), "step");
      check(input.trackLabels.length <= 96 && input.trackLabels.every((track) =>
        /^track\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(track.trackId) &&
        track.displayName.trim().length >= 1 && track.displayName.trim().length <= 128 &&
        (track.cupName === undefined || (track.cupName.trim().length >= 1 && track.cupName.trim().length <= 64))), "trackLabels");
      return post(`${TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/score-workbook-export`, input, scoreWorkbookExport, signal, 15_000_000);
    },
    finalizationPreview: (tournamentId, signal) =>
      get(`${ADMINISTRATOR_TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/finalization-preview`, preview, signal),
    finalize: async (tournamentId, input, signal) => {
      check(reasonPattern.test(input.reasonCode) && input.reasonCode.length <= 64, "reasonCode");
      return post(`${TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/actions/finalize`, input, finalization, signal);
    },
    setResultsVisibility: async (tournamentId, input, signal) => {
      check(reasonPattern.test(input.reasonCode) && input.reasonCode.length <= 64, "reasonCode");
      return post(`${TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/actions/set-results-visibility`, input, summary, signal);
    },
    recordIncident: async (tournamentId, input, signal) => {
      check(["attendance", "replacement", "equipment", "scoring", "conduct", "other"].includes(input.category), "category");
      check(input.note.trim().length >= 1 && input.note.trim().length <= 160, "note");
      check(input.playerId === undefined || playerIdPattern.test(input.playerId), "playerId");
      return post(`${TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/incidents`, {
        ...input,
        note: input.note.trim(),
      }, document, signal);
    },
    deleteDraft: async (tournamentId, input, signal) => {
      await post(`${TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/actions/delete`, input, (value) => {
        const row = object(value);
        keys(row, ["deleted"]);
        return bool(row["deleted"]);
      }, signal);
    },
    reopenTournament: async (tournamentId, input, signal) => {
      const reason = input.reason.trim();
      check(reason.length >= 3 && reason.length <= 512, "reason");
      return post(`${ADMINISTRATOR_TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/actions/reopen`, { reason }, (value) => {
        const row = object(value);
        keys(row, ["tournamentId", "wasFinalized", "publicationWasPublic", "ratingWasIncluded", "ratingEpochId"],
          ["publicationId", "publicationRevision", "publicationStatus"]);
        return {
          tournamentId: text(row["tournamentId"], 160, tournamentIdPattern),
          wasFinalized: bool(row["wasFinalized"]),
          publicationWasPublic: bool(row["publicationWasPublic"]),
          ratingWasIncluded: bool(row["ratingWasIncluded"]),
          ratingEpochId: row["ratingEpochId"] === null ? null : integer(row["ratingEpochId"], 0),
        };
      }, signal);
    },
    removeTournament: async (tournamentId, input, signal) => {
      const reason = input.reason.trim();
      check(reason.length >= 3 && reason.length <= 512, "reason");
      return post(`${ADMINISTRATOR_TOURNAMENTS_PATH}/${encodeURIComponent(id(tournamentId))}/actions/remove`, { reason }, (value) => {
        const row = object(value);
        keys(row, ["tournamentId", "alreadyRetracted", "publicationWasPublic", "ratingWasIncluded", "ratingEpochId"],
          ["publicationId", "publicationRevision", "publicationStatus"]);
        return {
          tournamentId: text(row["tournamentId"], 160, tournamentIdPattern),
          alreadyRetracted: bool(row["alreadyRetracted"]),
          publicationWasPublic: bool(row["publicationWasPublic"]),
          ratingWasIncluded: bool(row["ratingWasIncluded"]),
          ratingEpochId: row["ratingEpochId"] === null ? null : integer(row["ratingEpochId"], 1),
        };
      }, signal);
    },
    createPlayer: async (input, signal) => {
      check(/^[a-z0-9_-]{3,16}$/.test(input.username), "username");
      const displayName = input.displayName.trim();
      check(displayName.length >= 1 && displayName.length <= 64, "displayName");
      const proof = await proofFor(signal);
      const response = await send(fetchPort, "/v1/administrator/players", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", [proof.name]: proof.value },
        body: JSON.stringify({ username: input.username, displayName }),
        ...(signal === undefined ? {} : { signal }),
      });
      if (response.status !== 201) { await failure(response); }
      const row = object(await bounded(response));
      keys(row, ["schemaVersion", "playerId", "username", "displayName"]);
      return {
        playerId: text(row["playerId"], 135, playerIdPattern),
        username: text(row["username"], 16),
        displayName: text(row["displayName"], 64),
      };
    },
    rosterCandidates: async (input, signal) => {
      // One entry comes back per name, in order, so names are checked, never dropped.
      const names = input.names.map((name) => name.trim());
      check(names.length >= 1 && names.length <= 200 && names.every((name) => name.length >= 1 && name.length <= 64), "names");
      check(input.tournamentId === undefined || tournamentIdPattern.test(input.tournamentId), "tournamentId");
      const proof = await proofFor(signal);
      const response = await send(fetchPort, "/v1/administrator/roster-player-candidates", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", [proof.name]: proof.value },
        body: JSON.stringify({
          names,
          ...(input.tournamentId === undefined ? {} : { tournamentId: input.tournamentId }),
          ...(input.partial === undefined ? {} : { partial: input.partial }),
        }),
        ...(signal === undefined ? {} : { signal }),
      });
      if (response.status !== 200) { await failure(response); }
      const row = object(await bounded(response));
      keys(row, ["schemaVersion", "entries"]);
      if (row["schemaVersion"] !== "mk8dx.roster-player-candidates.v1") {
        throw new TournamentOperationClientError("invalid_response", "roster");
      }
      return list(row["entries"], 200, rosterNameEntry);
    },
    rememberRosterAliases: async (tournamentId, aliases, signal) => {
      check(tournamentIdPattern.test(tournamentId), "tournamentId");
      check(aliases.length >= 1 && aliases.length <= 200 && aliases.every((entry) =>
        playerIdPattern.test(entry.playerId) && entry.name.trim().length >= 1 && entry.name.trim().length <= 64), "aliases");
      const proof = await proofFor(signal);
      const response = await send(fetchPort, `/v1/tournaments/${encodeURIComponent(tournamentId)}/roster-aliases`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", [proof.name]: proof.value },
        body: JSON.stringify({ aliases: aliases.map((entry) => ({ playerId: entry.playerId, name: entry.name.trim() })) }),
        ...(signal === undefined ? {} : { signal }),
      });
      if (response.status !== 200) { await failure(response); }
      const row = object(await bounded(response));
      keys(row, ["schemaVersion", "created", "existing"]);
      if (row["schemaVersion"] !== "mk8dx.roster-aliases.v1") {
        throw new TournamentOperationClientError("invalid_response", "roster");
      }
      return {
        created: list(row["created"], 200, (entry) => {
          const created = object(entry);
          keys(created, ["playerId", "aliasText"]);
          return { playerId: text(created["playerId"], 135, playerIdPattern), aliasText: text(created["aliasText"], 64) };
        }),
        existing: integer(row["existing"], 0),
      };
    },
    createRosterPlayers: async (playersInput, signal, options) => {
      check(playersInput.length >= 1 && playersInput.length <= 512, "players");
      check(playersInput.every((entry) =>
        Number.isSafeInteger(entry.row) && entry.row >= 1 &&
        entry.displayName.trim().length >= 1 && entry.displayName.trim().length <= 64), "players");
      check(options?.tournamentId === undefined || tournamentIdPattern.test(options.tournamentId), "tournamentId");
      const proof = await proofFor(signal);
      const response = await send(fetchPort, "/v1/administrator/roster-players", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", [proof.name]: proof.value },
        body: JSON.stringify({
          ...(options?.tournamentId === undefined ? {} : { tournamentId: options.tournamentId }),
          players: playersInput.map((entry) => ({
            row: entry.row, displayName: entry.displayName.trim(),
            ...(entry.confirmSameName === true ? { confirmSameName: true } : {}),
          })),
        }),
        ...(signal === undefined ? {} : { signal }),
      });
      if (response.status === 409) {
        const body = object(await bounded(response));
        if (body["schemaVersion"] === "mk8dx.native-roster-players-rejected.v1" &&
          Array.isArray(body["rejections"])) {
          throw new TournamentRosterRejectionError(list(body["rejections"], 512, (entry) => {
            const rejection = object(entry);
            keys(rejection, ["row", "displayName", "reason"]);
            return {
              row: integer(rejection["row"], 1),
              displayName: text(rejection["displayName"], 64),
              reason: text(rejection["reason"], 64),
            };
          }));
        }
        throw new TournamentOperationClientError("conflict");
      }
      if (response.status === 403) {
        // ADR-0221: the installation lets Players only create themselves.
        let code = "";
        try {
          const body = object(await bounded(response));
          if (typeof body["code"] === "string") { code = body["code"]; }
        } catch { /* the status decides */ }
        throw new TournamentOperationClientError("not_authorized", code === PLAYER_CREATION_CLOSED ? PLAYER_CREATION_CLOSED : "");
      }
      if (response.status !== 201) { await failure(response); }
      const row = object(await bounded(response));
      keys(row, ["schemaVersion", "created"]);
      if (row["schemaVersion"] !== "mk8dx.native-roster-players.v1") {
        throw new TournamentOperationClientError("invalid_response", "roster");
      }
      return list(row["created"], 512, (entry) => {
        const created = object(entry);
        keys(created, ["playerId", "username", "displayName"]);
        return {
          playerId: text(created["playerId"], 135, playerIdPattern),
          username: text(created["username"], 16),
          displayName: text(created["displayName"], 64),
        };
      });
    },
  };
}
