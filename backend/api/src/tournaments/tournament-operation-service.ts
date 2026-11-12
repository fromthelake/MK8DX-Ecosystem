// Canonical Tournament operation service (ADR-0160): create and run a
// tournament night (participants, attendance, Switch seating, qualifier and
// final groups, race entry, standings) and finalize it with two independent
// owner-controlled settings - Public Results and Affects TrueSkill - on top
// of the existing audited publication (ADR-0147) and rating (ADR-0155)
// boundaries. Operational data is never thrown away because a setting is off.

import { historyEditionNumber, type HistoryEditionSource } from "./history-edition-projection.js";
import type { PublicTournamentReport } from "./tournament-report-service.js";
import type { ActorContext } from "../identity/types.js";
import type { TournamentRaceResultV1 } from "./race-result-validation.js";
import {
  assignSeating,
  buildRaceDocument,
  computeFinalGroups,
  computeStandings,
  overallPlacements,
  raceResultIdFor,
  effectiveSeedingSource,
  seedOrderForSource,
  seedQualifierGroups,
  stationsFrom,
  TOURNAMENT_GROUP_SIZE,
  TOURNAMENT_GROUP_SLOTS,
  TOURNAMENT_IMPORT_ROW_LIMIT,
  TOURNAMENT_MAX_PARTICIPANTS,
  TOURNAMENT_MAX_RACES_PER_GROUP,
  TOURNAMENT_MAX_SCORE_SEGMENTS,
  type OverallPlacement,
  type SeedParticipant,
  type StandingRow,
  type TournamentAttendance,
  type TournamentGroupStage,
  type TournamentOwnerSeatingMode,
  type TournamentPlacementStrategy,
  type TournamentRankedSeedingSource,
  type TournamentSeedingSource,
  type TournamentSeedOrder,
  type TournamentStage,
  type TournamentSwitchType,
  type TournamentTieBreakMode,
  type TournamentTieBreakOrder,
} from "./tournament-operation-domain.js";
import { type TournamentRaceMode } from "./race-result-validation.js";
import { directorNightRatings, type DirectorNightRace } from "../rating/director-night-ratings.js";
import {
  rosterCandidatesFor,
  type RosterCandidateContext,
  type RosterNameCandidates,
} from "./roster-player-candidates.js";

const tournamentIdPattern = /^tournament\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const groupIdPattern = /^tournament_group\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const trackIdPattern = /^track\.[a-z0-9]+(?:_[a-z0-9]+)*$/;
const reasonPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const controlCharacters = /[\u0000-\u001f\u007f]/;

export type TournamentOperationErrorCode =
  | "forbidden"
  | "invalid_input"
  | "not_found"
  | "conflict"
  | "unavailable";

export class TournamentOperationError extends Error {
  public constructor(
    public readonly code: TournamentOperationErrorCode,
    message = "The Tournament operation could not be completed.",
  ) {
    super(message);
    this.name = "TournamentOperationError";
  }
}

// ---------------------------------------------------------------------------
// Persistence records (what the repository returns) and views (what the
// service returns to routes).

export type TournamentRecord = Readonly<{
  internalId: number;
  tournamentId: string;
  name: string;
  seriesLabel?: string | null;
  editionNumber: number | null;
  eventDate: string | null;
  startAtMs?: number | null;
  timezone?: string | null;
  stage: TournamentStage;
  workflowStep: number;
  qualifierRounds: boolean;
  maxParticipants: number | null;
  revision: number;
  seedOrder: TournamentSeedOrder;
  /**
   * ADR-0221: the stored refinement of seed_order = "ranked" (null = the
   * community rating). Optional because a record built for a test or a
   * projection predates it; the repository always reads it.
   */
  seedingSource?: TournamentRankedSeedingSource | null;
  /** ADR-0221: only Players with a verified claim count for the rating from this night. */
  verifiedOnly?: boolean;
  placementStrategy: TournamentPlacementStrategy;
  ownerSeatingMode: TournamentOwnerSeatingMode;
  qualifierTieBreakMode: TournamentTieBreakMode;
  finalTieBreakMode: TournamentTieBreakMode;
  publicResults: boolean;
  affectsRating: boolean;
  publicationId: string | null;
  publicationVisibility: "public" | "hidden" | null;
  /**
   * 'active', or 'retracted' for a night that was removed. Optional because a
   * record built for a test or a projection is active by definition; the
   * repository always reads the real value.
   */
  lifecycleStatus?: string;
  directorInternalId: number;
  finalizedAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
}>;

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
  maxParticipants?: number;
  // ADR-0177 decision 7: clients edit the layout in Step 2, so they must be
  // able to read what it currently is.
  /** ADR-0221: where the qualifier draw takes its order from (the one seeding field clients see). */
  seedingSource: TournamentSeedingSource;
  /** ADR-0221: only verified Players count for the rating from this night. */
  verifiedOnly: boolean;
  placementStrategy: TournamentPlacementStrategy;
  ownerSeatingMode: TournamentOwnerSeatingMode;
  qualifierTieBreakMode: TournamentTieBreakMode;
  finalTieBreakMode: TournamentTieBreakMode;
  revision: number;
  participantCount: number;
  presentCount: number;
  publicResults: boolean;
  affectsRating: boolean;
  publicationId?: string;
  finalizedAtMs?: number;
  updatedAtMs: number;
}>;

/**
 * The name key both clients use when they compare a file's name with a
 * Player: accents folded away, case dropped, everything but letters and
 * digits removed. "Moss HM" and "moss hm" are the same person; "Moss HZ"
 * is not.
 */
export function rosterNameKey(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("nl").replace(/[^a-z0-9]/gu, "");
}

export type PlayerRecord = Readonly<{
  internalId: number;
  playerId: string;
  username: string;
  displayName: string;
  visibility: "public" | "private";
  active: boolean;
}>;

export type ParticipantRecord = Readonly<{
  player: PlayerRecord;
  attendance: TournamentAttendance;
  hasSwitch1: boolean;
  hasSwitch2: boolean;
  seedScore: number | null;
  seedRank: number | null;
  lastPresentAtMs: number | null;
}>;

export type HistoricalPlayerRecord = Readonly<{
  player: PlayerRecord;
  lastPresentAtMs: number;
}>;

export type ParticipantView = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
  attendance: TournamentAttendance;
  hasSwitch1: boolean;
  hasSwitch2: boolean;
  inactive: boolean;
  /** ADR-0177 decision 18: Nieuw is its own state, not a kind of Inactief. */
  isNew: boolean;
  seedScore?: number;
  seedRank?: number;
}>;

/**
 * The character a Player drove, as the score workbook recorded it. The label
 * is always what the file wrote; the key is the catalog's own identifier when
 * the client could name one, so a picture can be shown without asking the
 * server to know the roster.
 */
export type TournamentCharacterRecord = Readonly<{
  key: string | null;
  label: string;
  roster: string | null;
}>;

export type GroupMemberRecord = Readonly<{
  playerId: string;
  seatOrder: number;
  station: Readonly<{
    ownerPlayerId: string;
    switchType: TournamentSwitchType;
    seatNumber: 1 | 2;
  }> | null;
  character: TournamentCharacterRecord | null;
}>;

export type GroupRecord = Readonly<{
  internalId: number;
  groupId: string;
  stage: TournamentGroupStage;
  sequence: number;
  name: string;
  tierKey: string | null;
  locked: boolean;
  manualScoreSegments: number;
  tieBreakOrders: readonly TournamentTieBreakOrder[];
  members: readonly GroupMemberRecord[];
  /** The consoles in this group's slots, in slot order; empty for a draw written before 0060. */
  stations: readonly Readonly<{
    slotIndex: number;
    ownerPlayerId: string;
    switchType: TournamentSwitchType;
  }>[];
}>;

export type GroupRaceRecord = Readonly<{
  groupInternalId: number;
  raceNumber: number;
  raceResultId: string;
  revision: number;
  scoringSegment: number;
  sourceKind: string;
  scoringNote: string | null;
  trackId: string;
  mode: TournamentRaceMode | null;
  /** A Mirror race (ADR-0217): 150cc with the course mirrored. */
  mirror?: true | null;
  countsTowardStandings: boolean;
  placements: readonly Readonly<{
    playerId: string;
    finishPosition: number;
    racePoints: number;
  }>[];
}>;

export type ManualScoreRecord = Readonly<{
  groupInternalId: number;
  playerId: string;
  segmentNumber: number;
  points: number;
}>;

export type LifecycleRecord = Readonly<{
  sequence: number;
  eventType: string;
  detail?: string;
  occurredAtMs: number;
}>;

export type GroupView = Readonly<{
  groupId: string;
  stage: TournamentGroupStage;
  sequence: number;
  name: string;
  tierKey?: string;
  locked: boolean;
  manualScoreSegments: number;
  members: readonly Readonly<{
    playerId: string;
    displayName: string;
    seatOrder: number;
    /** The character this Player drove, as a score workbook recorded it. */
    character?: Readonly<{ key?: string; label: string; roster?: string }>;
    station?: Readonly<{
      ownerPlayerId: string;
      ownerDisplayName: string;
      switchType: TournamentSwitchType;
      seatNumber: 1 | 2;
      utpCableNumber?: number;
    }>;
  }>[];
  /**
   * The consoles in this group's slots, in slot order - a Switch placed in an
   * empty slot is here before anybody sits at it. A draw written before the
   * slots were stored lists the consoles its seated Players sit at.
   */
  stations: readonly Readonly<{
    slotIndex: number;
    ownerPlayerId: string;
    ownerDisplayName: string;
    switchType: TournamentSwitchType;
    utpCableNumber?: number;
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
    rows: readonly Readonly<StandingRow & { displayName: string }>[];
    tieGroups: readonly Readonly<{
      points: number;
      resolved: boolean;
      players: readonly Readonly<{
        playerId: string;
        displayName: string;
        wins: number;
        bestRace: number;
      }>[];
    }>[];
  }>;
}>;

export type TournamentDocument = Readonly<{
  schemaVersion: "mk8dx.tournament-operation.v1";
  summary: TournamentSummary;
  participants: readonly ParticipantView[];
  stations: readonly Readonly<{
    ownerPlayerId: string;
    ownerDisplayName: string;
    switchType: TournamentSwitchType;
    utpCableNumber?: number;
  }>[];
  groups: readonly GroupView[];
  overall: readonly Readonly<OverallPlacement & { displayName: string }>[];
  lifecycle: readonly LifecycleRecord[];
}>;

export type FinalizationPreview = Readonly<{
  schemaVersion: "mk8dx.tournament-finalization-preview.v1";
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
  overall: readonly Readonly<OverallPlacement & { displayName: string }>[];
}>;

export type FinalizationResult = Readonly<{
  tournamentId: string;
  revision: number;
  publicationId?: string;
  publicResults: boolean;
  affectsRating: boolean;
  rating?: Readonly<{
    appliedRaces: number;
    skippedRaces: number;
    alreadyApplied: boolean;
  }>;
}>;

// Public projection for the community: finalized + public for everyone,
// in-progress for signed-in accounts. Private Players keep their placement
// with the identity redacted, following the published-tournament rule.
export type PublicTournamentEvent = Readonly<{
  schemaVersion: "mk8dx.public-tournament-event.v1";
  tournamentId: string;
  name: string;
  editionNumber?: number;
  eventDate?: string;
  stage: TournamentStage;
  startAtMs?: number;
  timezone?: string;
  finalizedAtMs?: number;
  /**
   * The Director's own report, once they published it. The community's imported
   * stories have the same shape, so the page draws either without knowing which
   * one it was handed.
   */
  report?: PublicTournamentReport;
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
    /** Who sits at which console, for the Players who have been seated. */
    seating: readonly Readonly<{
      playerId?: string;
      displayName: string;
      seatOrder: number;
      stationOwnerDisplayName: string;
      switchType: TournamentSwitchType;
      seatNumber: number;
      /** The SP seed the night was drawn with (ADR-0154), as the picture shows it. */
      seedRank?: number;
      seedScore?: number;
      /** The character this Player drove, when a score workbook recorded one. */
      character?: Readonly<{ key?: string; label: string; roster?: string }>;
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
      character?: Readonly<{ key?: string; label: string; roster?: string }>;
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

export type PublicTournamentEventSummary = Readonly<{
  tournamentId: string;
  name: string;
  editionNumber?: number;
  eventDate?: string;
  stage: TournamentStage;
  finalizedAtMs?: number;
  participantCount: number;
  updatedAtMs: number;
  /**
   * When the night starts, and the clock it starts by. A reader needs both to
   * be told "Friday at 20:00" and how long that still is; the date alone
   * cannot say either.
   */
  startAtMs?: number;
  timezone?: string;
  /**
   * Which of the ten steps the night is in, for a night still being run. A
   * finalized night has no step left to be in and carries none: the reader is
   * told the result instead.
   */
  workflowStep?: number;
  /**
   * Who runs the night, by the Director's claimed Player name; only a
   * signed-in viewer is told, and only when the account has a verified claim.
   */
  directorDisplayName?: string;
  /** True when the signed-in viewer's own Player took part in this night. */
  viewerParticipated?: boolean;
  /**
   * Present, and false, only on a finished night that was never published -
   * and only for a viewer who may see it at all.
   */
  published?: boolean;
  /** Whether that night counted toward the rating. Travels with `published`. */
  affectsRating?: boolean;
  /**
   * Present, and true, only on a night that was removed - and only for the
   * administrator who may see it. A removed night is out of every list, every
   * result and the rating; the record survives and can be restored.
   */
  removed?: boolean;
}>;

/** Compact finalized standings used by overview clients in one request. */
export type PublicTournamentPlacementSnapshot = Readonly<{
  tournamentId: string;
  fieldSize: number;
  placements: readonly Readonly<{ playerId: string; placement: number }>[];
}>;

// ---------------------------------------------------------------------------
// Repository port.

export interface TournamentOperationTransaction {
  findActiveAdministratorAccount(userAccountId: string): Promise<number | null>;
  findTournamentOperatorAccount(userAccountId: string): Promise<Readonly<{
    internalId: number; isAdministrator: boolean;
  }> | null>;
  listSelectableDirectors(): Promise<readonly Readonly<{
    userAccountId: string; internalId: number; displayName: string;
    isAdministrator: boolean; hasCapability: boolean;
  }>[]>;
  findTournamentForUpdate(tournamentId: string): Promise<TournamentRecord | null>;
  findTournament(tournamentId: string): Promise<TournamentRecord | null>;
  insertTournament(input: Readonly<{
    tournamentId: string;
    name: string;
    seriesLabel: string | null;
    editionNumber: number | null;
    eventDate: string | null;
    startAtMs: number;
    timezone: string;
    directorInternalId: number;
    seedOrder: TournamentSeedOrder;
    /** ADR-0221; absent = null (the community rating). */
    seedingSource?: TournamentRankedSeedingSource | null;
    /** ADR-0221; absent = false. */
    verifiedOnly?: boolean;
    placementStrategy: TournamentPlacementStrategy;
    ownerSeatingMode: TournamentOwnerSeatingMode;
    qualifierTieBreakMode: TournamentTieBreakMode;
    finalTieBreakMode: TournamentTieBreakMode;
    qualifierRounds: boolean;
    maxParticipants: number | null;
    nowMs: number;
  }>): Promise<number>;
  updateTournament(input: Readonly<{
    internalId: number;
    revision: number;
    nowMs: number;
    name?: string;
    seriesLabel?: string | null;
    editionNumber?: number | null;
    eventDate?: string | null;
    startAtMs?: number;
    timezone?: string;
    stage?: TournamentStage;
    seedOrder?: TournamentSeedOrder;
    seedingSource?: TournamentRankedSeedingSource | null;
    verifiedOnly?: boolean;
    placementStrategy?: TournamentPlacementStrategy;
    ownerSeatingMode?: TournamentOwnerSeatingMode;
    qualifierTieBreakMode?: TournamentTieBreakMode;
    finalTieBreakMode?: TournamentTieBreakMode;
    workflowStep?: number;
    qualifierRounds?: boolean;
    maxParticipants?: number | null;
    publicResults?: boolean;
    affectsRating?: boolean;
    publicationInternalId?: number;
    finalizedAtMs?: number;
  }>): Promise<void>;
  listTournaments(options: Readonly<{
    includeUnfinalized: boolean;
    includeHiddenResults: boolean;
    /** Removed nights as well, for an administrator's own list. */
    includeRetracted?: boolean;
    directorInternalId?: number;
  }>): Promise<readonly Readonly<{
    record: TournamentRecord;
    participantCount: number;
    presentCount: number;
  }>[]>;
  resolvePlayers(playerIds: readonly string[]): Promise<ReadonlyMap<string, PlayerRecord>>;
  /**
   * ADR-0218: every active human Player with the picker's context, seen from
   * one Director (their aliases, their nights) and one night (already on it).
   */
  listRosterCandidateContext?(
    directorInternalId: number,
    tournamentInternalId: number | null,
  ): Promise<readonly RosterCandidateContext[]>;
  /**
   * ADR-0218: a name this Director uses for a Player ("Malie" for Mal),
   * kept as that Director's own restricted alias. "exists" when the Player
   * already answers to that name, installation-wide or for this Director.
   */
  insertDirectorAlias?(input: Readonly<{
    playerInternalId: number;
    directorInternalId: number;
    actorInternalId: number;
    aliasText: string;
    nowMs: number;
  }>): Promise<"created" | "exists">;
  /** The Tournaments and past editions this account's own Player took part in. */
  listTournamentsPlayedBy(userAccountId: string): Promise<readonly string[]>;
  ratingSnapshot(playerInternalIds: readonly number[]): Promise<ReadonlyMap<number, Readonly<{
    score: number;
    rank: number;
  }>>>;
  /**
   * ADR-0221: the races of this Director's own finished, published nights
   * (current result-set members), for seeding from those nights only.
   */
  loadDirectorNightRaces?(
    directorInternalId: number,
    excludingTournamentInternalId: number,
  ): Promise<readonly DirectorNightRace[]>;
  /** ADR-0177 decisions 16 and 19: the last completed Tournament times. */
  loadCompletedTournamentTimes(limit: number): Promise<readonly number[]>;
  loadHistoricalPresentPlayers(excludingTournamentInternalId: number): Promise<readonly HistoricalPlayerRecord[]>;
  loadRecentPresentPlayers(excludingTournamentInternalId: number): Promise<readonly PlayerRecord[]>;
  loadParticipants(tournamentInternalId: number): Promise<readonly ParticipantRecord[]>;
  ensureStationCable?(ownerPlayerInternalId: number, switchType: TournamentSwitchType, nowMs: number): Promise<number>;
  loadStationCables?(ownerPlayerIds: readonly string[]): Promise<readonly Readonly<{
    ownerPlayerId: string;
    switchType: TournamentSwitchType;
    cableNumber: number;
  }>[]>;
  upsertParticipant(input: Readonly<{
    tournamentInternalId: number;
    playerInternalId: number;
    attendance: TournamentAttendance;
    hasSwitch1: boolean;
    hasSwitch2: boolean;
    seedScore: number | null;
    seedRank: number | null;
    nowMs: number;
  }>): Promise<void>;
  deleteParticipant(tournamentInternalId: number, playerInternalId: number): Promise<void>;
  loadGroups(tournamentInternalId: number): Promise<readonly GroupRecord[]>;
  deleteGroupsForStage(tournamentInternalId: number, stage: TournamentGroupStage): Promise<void>;
  clearGroupResultsForStage(
    tournamentInternalId: number,
    stage: TournamentGroupStage,
    nowMs: number,
  ): Promise<void>;
  reopenAcceptedEvidenceForStage?(
    tournamentInternalId: number,
    stage: TournamentGroupStage,
    actorInternalId: number,
    nowMs: number,
  ): Promise<number>;
  clearGroupResults(groupInternalId: number, nowMs: number): Promise<void>;
  insertGroup(input: Readonly<{
    tournamentInternalId: number;
    groupId: string;
    stage: TournamentGroupStage;
    sequence: number;
    name: string;
    tierKey: string | null;
    nowMs: number;
  }>): Promise<number>;
  replaceGroupMembers(groupInternalId: number, members: readonly Readonly<{
    playerInternalId: number;
    seatOrder: number;
    stationOwnerInternalId: number | null;
    stationSwitchType: TournamentSwitchType | null;
    seatNumber: 1 | 2 | null;
  }>[]): Promise<void>;
  /** Equipment-only correction: retain member rows, characters and result links. */
  updateGroupMemberStations(groupInternalId: number, members: readonly Readonly<{
    playerInternalId: number;
    stationOwnerInternalId: number | null;
    stationSwitchType: TournamentSwitchType | null;
    seatNumber: 1 | 2 | null;
  }>[]): Promise<void>;
  /** The character each of these Players drove in this group, from a workbook. */
  setGroupMemberCharacters(groupInternalId: number, characters: readonly Readonly<{
    playerInternalId: number;
    characterKey: string | null;
    characterLabel: string;
    characterRoster: string | null;
  }>[]): Promise<void>;
  replaceGroupStations(groupInternalId: number, stations: readonly Readonly<{
    slotIndex: number;
    ownerInternalId: number;
    switchType: TournamentSwitchType;
  }>[], nowMs: number): Promise<void>;
  updateGroup(input: Readonly<{
    groupInternalId: number;
    locked?: boolean;
    manualScoreSegments?: number;
    tieBreakOrders?: readonly TournamentTieBreakOrder[];
    nowMs: number;
  }>): Promise<void>;
  loadGroupRaces(tournamentInternalId: number): Promise<readonly GroupRaceRecord[]>;
  findRaceResultInternalId(raceResultId: string): Promise<number | null>;
  linkGroupRace(input: Readonly<{
    groupInternalId: number;
    raceNumber: number;
    raceResultInternalId: number;
    occurredAtMs?: number;
    nowMs: number;
  }>): Promise<void>;
  loadManualScores(tournamentInternalId: number): Promise<readonly ManualScoreRecord[]>;
  replaceManualScores(groupInternalId: number, rows: readonly Readonly<{
    playerInternalId: number;
    segmentNumber: number;
    points: number;
  }>[], nowMs: number): Promise<void>;
  appendLifecycle(input: Readonly<{
    tournamentInternalId: number;
    eventType: string;
    detail: string | null;
    actorInternalId: number;
    nowMs: number;
  }>): Promise<void>;
  loadLifecycle(tournamentInternalId: number, limit: number): Promise<readonly LifecycleRecord[]>;
  findPublicationInternalId(publicationId: string): Promise<number | null>;
  deleteTournament(tournamentInternalId: number): Promise<void>;
  setPublicationVisibility(publicationInternalId: number, visibility: "public" | "hidden"): Promise<void>;
}

export interface TournamentOperationRepository {
  transaction<T>(
    work: (transaction: TournamentOperationTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface TournamentOperationRaceResults {
  submit(input: TournamentRaceResultV1): Promise<Readonly<{ raceResultId: string; revision: number }>>;
  /** Validates a race document (contract and asset references) without recording it. */
  check?(input: TournamentRaceResultV1): Promise<void>;
}

/**
 * Races are recorded one by one. A race the store refuses (an unknown track, for example) must be found
 * before the first one is written: otherwise the earlier races stay behind unlinked and every retry of
 * the group fails on them (found 2026-11-12 with a misspelled track id).
 */
export async function checkRacesBeforeRecording(
  raceResults: TournamentOperationRaceResults,
  documents: readonly TournamentRaceResultV1[],
): Promise<void> {
  if (raceResults.check === undefined) { return; }
  for (const document of documents) {
    try {
      await raceResults.check(document);
    } catch {
      throw new TournamentOperationError(
        "invalid_input",
        `race ${document.raceNumber} is not valid (track, mode or players); nothing was recorded`,
      );
    }
  }
}

export interface TournamentOperationPublications {
  createPublication(actor: ActorContext, input: Readonly<{
    eventName: string;
    targets: readonly Readonly<{ raceResultId: string; revision: number }>[];
    reasonCode: string;
  }>): Promise<Readonly<{ publicationId: string }>>;
}

export interface TournamentOperationRating {
  recordDecision(input: Readonly<{
    administratorAccountId: string;
    publicationPublicId: string;
    ratingIncluded: boolean;
    reasonCode: string;
  }>): Promise<unknown>;
  applyPublication(publicationPublicId: string): Promise<Readonly<{
    appliedRaces: number;
    skippedRaces: number;
    alreadyApplied: boolean;
  }>>;
}

export type TournamentOperationDependencies = Readonly<{
  repository: TournamentOperationRepository;
  raceResults: TournamentOperationRaceResults;
  publications: TournamentOperationPublications;
  rating: TournamentOperationRating;
  ids: Readonly<{
    newTournamentId(): string;
    newGroupId(): string;
  }>;
  clock: Readonly<{ nowMs(): number }>;
  random?: () => number;
  operationalLog?: Readonly<{ log(entry: Record<string, unknown>): void }>;
  /** The community's past editions (TN7-TN12), projected from the corrected history; read-only. */
  historyEditions?: HistoryEditionSource;
  /** The published report of a night of our own, when there is one. */
  publishedReports?: Readonly<{ loadPublished(tournamentId: string): Promise<PublicTournamentReport | null> }>;
}>;

/** The consoles a seating names, in seat order, numbered as slots 1..N. */
function stationsFromSeats(
  seats: readonly Readonly<{ seatOrder: number; station: Readonly<{ ownerPlayerId: string; switchType: TournamentSwitchType }> | null }>[],
): readonly Readonly<{ slotIndex: number; ownerPlayerId: string; switchType: TournamentSwitchType }>[] {
  const ordered: { ownerPlayerId: string; switchType: TournamentSwitchType }[] = [];
  for (const seat of [...seats].sort((left, right) => left.seatOrder - right.seatOrder)) {
    if (seat.station === null) { continue; }
    if (ordered.some((entry) => entry.ownerPlayerId === seat.station!.ownerPlayerId && entry.switchType === seat.station!.switchType)) { continue; }
    ordered.push({ ownerPlayerId: seat.station.ownerPlayerId, switchType: seat.station.switchType });
  }
  return ordered.map((entry, index) => ({ slotIndex: index + 1, ...entry }));
}

// ---------------------------------------------------------------------------
// Validation helpers.

function administrator(actor: ActorContext): string {
  if (actor.role !== "administrator" && actor.role !== "account") {
    throw new TournamentOperationError("forbidden", "signed-in Tournament operator required");
  }
  return actor.userAccountId;
}

function invalid(message: string): never {
  throw new TournamentOperationError("invalid_input", message);
}

function tournamentId(value: string): string {
  return tournamentIdPattern.test(value) && value.length <= 160
    ? value
    : invalid("tournamentId is invalid");
}

function groupId(value: string): string {
  return groupIdPattern.test(value) && value.length <= 160
    ? value
    : invalid("groupId is invalid");
}

function playerId(value: string): string {
  return playerIdPattern.test(value) && value.length <= 135
    ? value
    : invalid("playerId is invalid");
}

function tournamentName(value: string): string {
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 128 && !controlCharacters.test(trimmed)
    ? trimmed
    : invalid("name must be 1-128 printable characters");
}

function optionalSeriesLabel(value: string | null | undefined): string | null | undefined {
  if (value === undefined) { return undefined; }
  if (value === null || value.trim() === "") { return null; }
  const trimmed = value.trim();
  return trimmed.length <= 64 && !controlCharacters.test(trimmed)
    ? trimmed
    : invalid("seriesLabel must be at most 64 printable characters");
}

function occurrenceTime(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 && value <= 253_402_300_799_999
    ? value
    : invalid("startAtMs must be a valid UTC epoch-millisecond timestamp");
}

/**
 * ADR-0177 decision 16: a Player is Inactive when they did not race in any of
 * the last three fully completed Tournaments. The owner rejected the earlier
 * three-calendar-month cutoff, which called a Player inactive purely because
 * time had passed rather than because events had been played.
 *
 * Expressed as a cutoff: the third most recent completed Tournament. A Player
 * whose most recent appearance is at or after it raced in one of the three.
 * With fewer than three completed Tournaments nobody is inactive yet.
 */
export const TOURNAMENT_ACTIVITY_WINDOW = 3;

/**
 * Whether a Tournament's seeds are already history.
 *
 * `seed_score` is captured when a Player is first added and is meant to be
 * the score the draw used, frozen so the draw stays reproducible. But between
 * adding somebody and drawing the groups the ratings can be rebuilt
 * underneath it - ADR-0189 did exactly that - and Step 2 then showed
 * months-old SP for a Tournament that had not started.
 *
 * The moment a group exists, the draw has happened and its seeds are the
 * record of what it used. Before that there is nothing to preserve, so the
 * live rating is the honest answer.
 */
export function tournamentSeedsAreDrawn(
  groupCount: number, finalized: boolean,
): boolean {
  return groupCount > 0 || finalized;
}

export function tournamentInactiveRosterCutoffMs(
  completedTournamentTimesDescending: readonly number[],
): number | null {
  if (completedTournamentTimesDescending.length < TOURNAMENT_ACTIVITY_WINDOW) { return null; }
  return completedTournamentTimesDescending[TOURNAMENT_ACTIVITY_WINDOW - 1] ?? null;
}


function timeZone(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 64 || controlCharacters.test(trimmed)) {
    return invalid("timezone must be a valid IANA time zone");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(0);
    return trimmed;
  } catch {
    return invalid("timezone must be a valid IANA time zone");
  }
}

function optionalEdition(value: number | null | undefined): number | null | undefined {
  if (value === undefined) { return undefined; }
  if (value === null) { return null; }
  return Number.isSafeInteger(value) && value >= 1 && value <= 9999
    ? value
    : invalid("editionNumber must be 1-9999");
}

function optionalDate(value: string | null | undefined): string | null | undefined {
  if (value === undefined) { return undefined; }
  if (value === null) { return null; }
  return datePattern.test(value) ? value : invalid("eventDate must be YYYY-MM-DD");
}

function optionalMaximumParticipants(value: number | null | undefined): number | null | undefined {
  if (value === undefined || value === null) { return value; }
  return Number.isSafeInteger(value) && value >= 1 && value <= TOURNAMENT_MAX_PARTICIPANTS
    ? value
    : invalid(`maxParticipants must be 1-${TOURNAMENT_MAX_PARTICIPANTS}`);
}

function reasonCode(value: string): string {
  return reasonPattern.test(value) && value.length <= 64
    ? value
    : invalid("reasonCode must be short lower-case dotted/dashed words");
}

function revisionMatches(record: TournamentRecord, expected: number): void {
  if (!Number.isSafeInteger(expected) || expected < 1) { invalid("expectedRevision is invalid"); }
  if (record.revision !== expected) {
    throw new TournamentOperationError("conflict", "the tournament changed; reload and retry");
  }
}

/** The preview's warning and the finalization's refusal, one wording each; the Web translates them. */
export const EDITION_NUMBER_MISSING =
  "No edition number is set; the rating graph and the statistics leave out a public night without one.";
export const EDITION_NUMBER_REQUIRED =
  "a public night needs an edition number before finalizing (Step 1, or the button at the top): without one it is missing from the rating graph and the statistics";

function notFinalized(record: TournamentRecord): void {
  if (record.stage === "finalized") {
    throw new TournamentOperationError("conflict", "the tournament is finalized");
  }
}

function seedParticipants(participants: readonly ParticipantRecord[], presentOnly = true): readonly SeedParticipant[] {
  return participants
    .filter((participant) => !presentOnly || participant.attendance === "present")
    .map((participant) => ({
      playerId: participant.player.playerId,
      displayName: participant.player.displayName,
      seedRank: participant.seedRank,
      seedScore: participant.seedScore,
      hasSwitch1: participant.hasSwitch1,
      hasSwitch2: participant.hasSwitch2,
    }));
}

// ---------------------------------------------------------------------------
// Service.

export class TournamentOperationService {
  private readonly random: () => number;

  public constructor(private readonly dependencies: TournamentOperationDependencies) {
    this.random = dependencies.random ?? Math.random;
  }

  // -- reads ---------------------------------------------------------------

  public async listForAdministrator(
    actor: ActorContext,
    options?: Readonly<{ directorUserAccountId?: string }>,
  ): Promise<readonly TournamentSummary[]> {
    const actorAccountId = administrator(actor);
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const directorInternalId = await this.directorFor(
        transaction, actorAccountId, options?.directorUserAccountId,
      );
      const rows = await transaction.listTournaments({
        includeUnfinalized: true,
        includeHiddenResults: true,
        directorInternalId,
      });
      return rows.map((row) => summary(row.record, row.participantCount, row.presentCount));
    }));
  }

  /**
   * ADR-0177 decision 3: Step 0 offers the accounts that may direct a
   * Tournament. An administrator sees every director plus the accounts that
   * could be promoted; any other operator sees only themselves.
   */
  public async listSelectableDirectors(actor: ActorContext): Promise<Readonly<{
    canActForOthers: boolean;
    directors: readonly Readonly<{
      userAccountId: string; displayName: string; isAdministrator: boolean;
    }>[];
  }>> {
    const actorAccountId = administrator(actor);
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const rows = await transaction.listSelectableDirectors();
      const visible = acting.isAdministrator
        ? rows
        : rows.filter((row) => row.internalId === acting.internalId);
      return {
        canActForOthers: acting.isAdministrator,
        directors: visible.map((row) => ({
          userAccountId: row.userAccountId,
          displayName: row.displayName,
          isAdministrator: row.isAdministrator,
        })),
      };
    }));
  }

  public async loadForAdministrator(
    actor: ActorContext,
    requestedTournamentId: string,
  ): Promise<TournamentDocument> {
    const actorAccountId = administrator(actor);
    const id = tournamentId(requestedTournamentId);
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const record = await transaction.findTournament(id);
      if (record === null) { throw new TournamentOperationError("not_found", "tournament not found"); }
      if (!acting.isAdministrator && record.directorInternalId !== acting.internalId) {
        throw new TournamentOperationError("forbidden", "this Tournament belongs to another director");
      }
      return this.document(transaction, record);
    }));
  }

  public async loadForReport(requestedTournamentId: string): Promise<TournamentDocument> {
    const id = tournamentId(requestedTournamentId);
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const record = await transaction.findTournament(id);
      if (record === null) { throw new TournamentOperationError("not_found", "tournament not found"); }
      return this.document(transaction, record);
    }));
  }

  public async listPublic(actor: ActorContext): Promise<readonly PublicTournamentEventSummary[]> {
    const signedIn = actor.role === "account" || actor.role === "administrator";
    // A night that was finished and never published is invisible to the
    // community, which is what unticking "openbaar" means. It is not invisible
    // to the administrator who ran it: they had to ask where their own evening
    // went. Those rows travel with `published: false` so the page can put them
    // on a shelf of their own rather than mixing them into the archive.
    const maySeeUnpublished = actor.role === "administrator";
    const editions = await (this.dependencies.historyEditions?.listEditions() ?? Promise.resolve([]))
      .catch(() => [] as readonly PublicTournamentEventSummary[]);
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      // A night that is coming or being raced is public reading. Whoever finds
      // the site should be able to see that there is a tournament on Friday
      // without an account; only running one needs to be someone. A finished
      // night still has to have been published, which the repository decides.
      const rows = await transaction.listTournaments({
        includeUnfinalized: true,
        includeHiddenResults: maySeeUnpublished,
        includeRetracted: maySeeUnpublished,
      });
      // "Did I race in this one?" is one question with one answer; the page
      // used to read the six newest documents to guess at it.
      const played = new Set(actor.role === "account" || actor.role === "administrator"
        ? await transaction.listTournamentsPlayedBy(actor.userAccountId)
        : []);
      // "Whose night is this?" is a question for the people who can see the
      // unfinished ones; a visitor gets the results and no names of accounts.
      const directors = new Map<number, string>();
      if (signedIn && rows.length > 0) {
        for (const director of await transaction.listSelectableDirectors()) {
          if (director.displayName.length > 0) { directors.set(director.internalId, director.displayName); }
        }
      }
      return [
        ...editions.map((edition) => played.has(edition.tournamentId)
          ? { ...edition, viewerParticipated: true }
          : edition),
        ...rows.map((row) => ({
        tournamentId: row.record.tournamentId,
        name: row.record.name,
        ...(row.record.editionNumber === null ? {} : { editionNumber: row.record.editionNumber }),
        ...(row.record.eventDate === null ? {} : { eventDate: row.record.eventDate }),
        stage: row.record.stage,
        ...(row.record.startAtMs === null || row.record.startAtMs === undefined ? {} : { startAtMs: row.record.startAtMs }),
        ...(row.record.timezone === null || row.record.timezone === undefined ? {} : { timezone: row.record.timezone }),
        ...(row.record.stage === "finalized" ? {} : { workflowStep: row.record.workflowStep }),
        ...(row.record.finalizedAtMs === null ? {} : { finalizedAtMs: row.record.finalizedAtMs }),
        participantCount: row.presentCount,
        updatedAtMs: row.record.updatedAtMs,
        ...(directors.has(row.record.directorInternalId) ? { directorDisplayName: directors.get(row.record.directorInternalId)! } : {}),
        ...(played.has(row.record.tournamentId) ? { viewerParticipated: true } : {}),
        // Said only where it is true and only to whoever may see the row at
        // all. `published: false` is the exact negation of what makes a
        // finished night readable by the community - the tick *or* a hidden
        // publication - and `removed: true` is a night that was taken out
        // altogether.
        ...(row.record.stage === "finalized" &&
          !(row.record.publicResults && row.record.publicationVisibility !== "hidden")
          ? { published: false, affectsRating: row.record.affectsRating }
          : {}),
        ...(row.record.lifecycleStatus === "retracted"
          ? { removed: true, affectsRating: row.record.affectsRating }
          : {}),
      }))];
    }));
  }

  public async loadPublic(
    // Who is reading no longer changes what a public night's document says:
    // an upcoming or running night is open to anyone, a finished one has to
    // have been published, and which Players are named is decided by their own
    // visibility. The parameter stays because every caller resolves an actor
    // and the route reads the same for all of them.
    _actor: ActorContext,
    requestedTournamentId: string,
  ): Promise<PublicTournamentEvent | null> {
    const id = tournamentId(requestedTournamentId);
    const edition = historyEditionNumber(id);
    if (edition !== null) {
      return this.dependencies.historyEditions?.loadEdition(edition) ?? null;
    }
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const record = await transaction.findTournament(id);
      if (record === null) { return null; }
      const finalizedAndPublic = record.stage === "finalized" &&
        record.publicResults && record.publicationVisibility !== "hidden";
      // A finished night is read only once its Director published it; a night
      // still to come or being raced is open to anyone, read only. The console
      // that runs it is a different door and stays shut.
      if (!finalizedAndPublic && record.stage === "finalized") { return null; }
      const document = await this.document(transaction, record);
      const participants = await transaction.loadParticipants(record.internalId);
      // Only a finished, public night shows its report; a night still being run
      // keeps whatever the Director is writing to themselves.
      const report = finalizedAndPublic
        ? await this.dependencies.publishedReports?.loadPublished(record.tournamentId) ?? null
        : null;
      const privateIds = new Set(participants
        .filter((participant) => participant.player.visibility !== "public" || !participant.player.active)
        .map((participant) => participant.player.playerId));
      const identity = (candidate: string): { playerId?: string } =>
        privateIds.has(candidate) ? {} : { playerId: candidate };
      // The SP seed is a public ranking fact (the Ranking page shows it for
      // every public Player); it travels so the page and the picture can
      // show the same "SP Rank" the operator saw.
      const seeds = new Map(document.participants.map((participant) => [participant.playerId, participant]));
      const seed = (candidate: string): Readonly<{ seedRank?: number; seedScore?: number }> => {
        const participant = seeds.get(candidate);
        return {
          ...(participant?.seedRank === undefined ? {} : { seedRank: participant.seedRank }),
          ...(participant?.seedScore === undefined ? {} : { seedScore: participant.seedScore }),
        };
      };
      // The character a workbook recorded for a Player, so the report prints
      // the same picture the community's own export does.
      const characters = new Map(document.groups.flatMap((group) =>
        group.members.flatMap((member) => member.character === undefined
          ? []
          : [[`${group.groupId}:${member.playerId}`, member.character] as const])));
      const character = (groupId_: string, candidate: string): Readonly<{ character?: { key?: string; label: string; roster?: string } }> => {
        const found = characters.get(`${groupId_}:${candidate}`);
        return found === undefined ? {} : { character: found };
      };
      return {
        schemaVersion: "mk8dx.public-tournament-event.v1",
        tournamentId: record.tournamentId,
        name: record.name,
        ...(record.editionNumber === null ? {} : { editionNumber: record.editionNumber }),
        ...(record.eventDate === null ? {} : { eventDate: record.eventDate }),
        ...(document.summary.startAtMs === undefined ? {} : { startAtMs: document.summary.startAtMs }),
        ...(document.summary.timezone === undefined ? {} : { timezone: document.summary.timezone }),
        stage: record.stage,
        ...(record.stage === "finalized" ? {} : { workflowStep: record.workflowStep }),
        ...(record.finalizedAtMs === null ? {} : { finalizedAtMs: record.finalizedAtMs }),
        ...(record.publicationId === null ? {} : { publicationId: record.publicationId }),
        ...(report === null ? {} : { report }),
        publicResults: finalizedAndPublic,
        participantCount: document.summary.presentCount,
        groups: document.groups.map((group) => ({
          groupId: group.groupId,
          stage: group.stage,
          sequence: group.sequence,
          name: group.name,
          ...(group.tierKey === undefined ? {} : { tierKey: group.tierKey }),
          // How an equal score in this group was ordered: the SP seed, a
          // lottery, or the Director's hand. The report names it beside a tie
          // that decided who went to which final group.
          tieBreakMode: group.stage === "qualifier" ? record.qualifierTieBreakMode : record.finalTieBreakMode,
          // Where each Player actually sits. A participant has always had to
          // ask the group chat which console they are on; the night's own page
          // can answer it, and it is the same fact the WhatsApp layout export
          // already publishes.
          seating: group.members
            .filter((member) => member.station !== undefined)
            .map((member) => ({
              ...identity(member.playerId),
              displayName: member.displayName,
              seatOrder: member.seatOrder,
              // Whose console it is, by name and - when that Player is public
              // - by identity, so a reader can open the profile of the person
              // whose Switch they are sitting at.
              ...(privateIds.has(member.station!.ownerPlayerId)
                ? {}
                : { stationOwnerPlayerId: member.station!.ownerPlayerId }),
              stationOwnerDisplayName: member.station!.ownerDisplayName,
              switchType: member.station!.switchType,
              seatNumber: member.station!.seatNumber,
              ...seed(member.playerId),
              ...character(group.groupId, member.playerId),
            })),
          standings: group.standings.rows.map((row) => ({
            rank: row.rank,
            ...identity(row.playerId),
            displayName: row.displayName,
            points: row.points,
            races: row.races,
            wins: row.wins,
            complete: row.complete,
            ...seed(row.playerId),
            ...character(group.groupId, row.playerId),
          })),
          races: group.races.map((race) => ({
            raceNumber: race.raceNumber,
            trackId: race.trackId,
            ...(race.mode === undefined ? {} : { mode: race.mode }),
            ...(race.mirror === true ? { mirror: true as const } : {}),
            countsTowardStandings: race.countsTowardStandings,
            placements: race.placements.map((placement) => ({
              finishPosition: placement.finishPosition,
              ...identity(placement.playerId),
              displayName: placement.displayName,
              racePoints: placement.racePoints,
            })),
          })),
        })),
        overall: document.overall.map((row) => ({
          placement: row.placement,
          ...identity(row.playerId),
          displayName: row.displayName,
          groupName: row.groupName,
          groupRank: row.groupRank,
          points: row.points,
        })),
      };
    }));
  }

  /**
   * Loads the small piece of several public nights needed by the archive.
   * One HTTP request prevents both clients from visibly filling rows one at a
   * time and keeps them well below the owner's five-requests-per-second cap.
   */
  public async loadPublicPlacements(
    actor: ActorContext,
    requestedTournamentIds: readonly string[],
  ): Promise<readonly PublicTournamentPlacementSnapshot[]> {
    const ids = [...new Set(requestedTournamentIds.map((value) => tournamentId(value)))];
    if (ids.length < 1 || ids.length > 8) {
      throw new TournamentOperationError("invalid_input", "between one and eight Tournament ids are required");
    }
    const events = await Promise.all(ids.map((id) => this.loadPublic(actor, id)));
    return events.flatMap((event, index) => event === null ? [] : [{
      tournamentId: ids[index]!,
      fieldSize: event.overall.length,
      placements: event.overall.flatMap((row) => row.playerId === undefined ? [] : [{
        playerId: row.playerId,
        placement: row.placement,
      }]),
    }]);
  }

  // -- tournament lifecycle ------------------------------------------------

  public async create(actor: ActorContext, input: Readonly<{
    name: string;
    seriesLabel?: string | null;
    editionNumber?: number | null;
    eventDate?: string | null;
    startAtMs?: number;
    timezone?: string;
    seedingSource?: TournamentSeedingSource;
    verifiedOnly?: boolean;
    placementStrategy?: TournamentPlacementStrategy;
    ownerSeatingMode?: TournamentOwnerSeatingMode;
    qualifierTieBreakMode?: TournamentTieBreakMode;
    finalTieBreakMode?: TournamentTieBreakMode;
    qualifierRounds?: boolean;
    maxParticipants?: number | null;
    directorUserAccountId?: string;
  }>): Promise<TournamentSummary> {
    const actorAccountId = administrator(actor);
    const name = tournamentName(input.name);
    const seriesLabel = optionalSeriesLabel(input.seriesLabel) ?? null;
    const editionNumber = optionalEdition(input.editionNumber) ?? null;
    const eventDate = optionalDate(input.eventDate) ?? null;
    const startAtMs = occurrenceTime(input.startAtMs ?? this.dependencies.clock.nowMs());
    const timezone = timeZone(input.timezone ?? "UTC");
    const seedingSource = seedingSourceInput(input.seedingSource) ?? "community_rating";
    const seedOrder = seedOrderForSource(seedingSource);
    const storedSeedingSource = seedingSource === "random" || seedingSource === "community_rating" ? null : seedingSource;
    const verifiedOnly = optionalFlag(input.verifiedOnly, "verifiedOnly") ?? false;
    const placementStrategy = input.placementStrategy ?? "balanced";
    const ownerSeatingMode = input.ownerSeatingMode ?? "owner_strict";
    const qualifierTieBreakMode = input.qualifierTieBreakMode ?? "sp";
    const finalTieBreakMode = input.finalTieBreakMode ?? "sp";
    if (input.qualifierRounds === false) {
      invalid("new tournaments always use the complete Step 0-10 workflow");
    }
    const qualifierRounds = true;
    const maxParticipants = optionalMaximumParticipants(input.maxParticipants) ?? null;
    const nowMs = this.dependencies.clock.nowMs();
    const id = this.dependencies.ids.newTournamentId();
    if (!tournamentIdPattern.test(id)) { throw new TournamentOperationError("unavailable"); }
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const director = await this.directorFor(
        transaction, actorAccountId, input.directorUserAccountId,
      );
      const internalId = await transaction.insertTournament({
        tournamentId: id, name, seriesLabel, editionNumber, eventDate, startAtMs, timezone,
        directorInternalId: director, seedOrder, seedingSource: storedSeedingSource, verifiedOnly,
        placementStrategy, ownerSeatingMode,
        qualifierTieBreakMode, finalTieBreakMode,
        qualifierRounds, maxParticipants, nowMs,
      });
      // Recovered Step 2 behavior: prior Tournament participation is the
      // roster. This includes both canonical finalized attendance and the
      // already reconciled TN4-TN12 legacy race history. Legacy-only evidence
      // has no trustworthy event timestamp in its bounded contract and is
      // therefore treated as old/inactive instead of inventing a date.
      const historicalPlayers = await transaction.loadHistoricalPresentPlayers(internalId);
      const snapshot = await transaction.ratingSnapshot(
        historicalPlayers.map(({ player }) => player.internalId),
      );
      const ordered = [...historicalPlayers].sort((left, right) =>
        (snapshot.get(left.player.internalId)?.rank ?? Number.MAX_SAFE_INTEGER) -
          (snapshot.get(right.player.internalId)?.rank ?? Number.MAX_SAFE_INTEGER) ||
        left.player.displayName.localeCompare(right.player.displayName) ||
        left.player.playerId.localeCompare(right.player.playerId));
      for (const { player } of ordered) {
        const rating = snapshot.get(player.internalId);
        await transaction.upsertParticipant({
          tournamentInternalId: internalId,
          playerInternalId: player.internalId,
          attendance: "absent",
          hasSwitch1: false,
          hasSwitch2: false,
          seedScore: rating?.score ?? null,
          seedRank: rating?.rank ?? null,
          nowMs,
        });
      }
      await transaction.appendLifecycle({
        tournamentInternalId: internalId, eventType: "created",
        detail: name, actorInternalId: director, nowMs,
      });
      await transaction.appendLifecycle({
        tournamentInternalId: internalId, eventType: "history_roster_initialized",
        detail: `players=${ordered.length};source=finalized_present_or_legacy_race;attendance=absent`,
        actorInternalId: director, nowMs,
      });
      const record = await transaction.findTournament(id);
      if (record === null) { throw new TournamentOperationError("unavailable"); }
      return summary(record, ordered.length, 0);
    }));
  }

  public async update(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    expectedRevision: number;
    name?: string;
    seriesLabel?: string | null;
    editionNumber?: number | null;
    eventDate?: string | null;
    startAtMs?: number;
    timezone?: string;
    seedingSource?: TournamentSeedingSource;
    verifiedOnly?: boolean;
    placementStrategy?: TournamentPlacementStrategy;
    ownerSeatingMode?: TournamentOwnerSeatingMode;
    qualifierTieBreakMode?: TournamentTieBreakMode;
    finalTieBreakMode?: TournamentTieBreakMode;
    qualifierRounds?: boolean;
    maxParticipants?: number | null;
    publicResults?: boolean;
    affectsRating?: boolean;
  }>): Promise<TournamentSummary> {
    const actorAccountId = administrator(actor);
    const id = tournamentId(requestedTournamentId);
    const name = input.name === undefined ? undefined : tournamentName(input.name);
    const seriesLabel = optionalSeriesLabel(input.seriesLabel);
    const editionNumber = optionalEdition(input.editionNumber);
    const eventDate = optionalDate(input.eventDate);
    const startAtMs = input.startAtMs === undefined ? undefined : occurrenceTime(input.startAtMs);
    const timezone = input.timezone === undefined ? undefined : timeZone(input.timezone);
    const maxParticipants = optionalMaximumParticipants(input.maxParticipants);
    const seedingSource = seedingSourceInput(input.seedingSource);
    const verifiedOnly = optionalFlag(input.verifiedOnly, "verifiedOnly");
    if (input.qualifierRounds === false) {
      invalid("the compact workflow is historical only; active tournaments use Step 0-10");
    }
    const nowMs = this.dependencies.clock.nowMs();
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const director = acting.internalId;
      const record = await this.locked(transaction, id, acting);
      revisionMatches(record, input.expectedRevision);
      // A finalized night keeps its results and its rating, but its name,
      // series, edition number and date are labels. The owner found TN13
      // finalized on production without an edition number, and therefore
      // absent from the rating graph and the statistics, with no way to add
      // it. Labels stay editable; everything else stays fixed.
      const labelsOnly = input.startAtMs === undefined && input.timezone === undefined &&
        input.placementStrategy === undefined &&
        input.ownerSeatingMode === undefined && input.qualifierTieBreakMode === undefined &&
        input.finalTieBreakMode === undefined && input.qualifierRounds === undefined &&
        input.maxParticipants === undefined && input.publicResults === undefined &&
        input.affectsRating === undefined && seedingSource === undefined && verifiedOnly === undefined;
      if (!labelsOnly) { notFinalized(record); }
      if (input.qualifierRounds !== undefined || maxParticipants !== undefined) {
        const groups = await transaction.loadGroups(record.internalId);
        if (groups.length > 0) {
          throw new TournamentOperationError("conflict", "workflow settings are fixed after groups are generated");
        }
        const presentCount = (await transaction.loadParticipants(record.internalId))
          .filter((participant) => participant.attendance === "present").length;
        if (maxParticipants !== null && maxParticipants !== undefined && presentCount > maxParticipants) {
          throw new TournamentOperationError("conflict", "maxParticipants is below the present Player count");
        }
      }
      await transaction.updateTournament({
        internalId: record.internalId,
        revision: record.revision + 1,
        nowMs,
        ...(name === undefined ? {} : { name }),
        ...(seriesLabel === undefined ? {} : { seriesLabel }),
        ...(editionNumber === undefined ? {} : { editionNumber }),
        ...(eventDate === undefined ? {} : { eventDate }),
        ...(startAtMs === undefined ? {} : { startAtMs }),
        ...(timezone === undefined ? {} : { timezone }),
        ...seedingChange(seedingSource),
        ...(verifiedOnly === undefined ? {} : { verifiedOnly }),
        ...(input.placementStrategy === undefined ? {} : { placementStrategy: input.placementStrategy }),
        ...(input.ownerSeatingMode === undefined ? {} : { ownerSeatingMode: input.ownerSeatingMode }),
        ...(input.qualifierTieBreakMode === undefined ? {} : { qualifierTieBreakMode: input.qualifierTieBreakMode }),
        ...(input.finalTieBreakMode === undefined ? {} : { finalTieBreakMode: input.finalTieBreakMode }),
        ...(input.qualifierRounds === undefined ? {} : { qualifierRounds: input.qualifierRounds }),
        ...(maxParticipants === undefined ? {} : { maxParticipants }),
        ...(input.publicResults === undefined ? {} : { publicResults: input.publicResults }),
        ...(input.affectsRating === undefined ? {} : { affectsRating: input.affectsRating }),
      });
      await transaction.appendLifecycle({
        tournamentInternalId: record.internalId, eventType: "settings_updated",
        detail: null, actorInternalId: director, nowMs,
      });
      return this.summaryOf(transaction, id);
    }));
  }

  /** Persist the recovered Step 0-10 operator checkpoint.
   * Domain mutations remain the source of readiness; clients cannot skip a
   * required layout, score or export review checkpoint. */
  public async setWorkflowStep(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    expectedRevision: number;
    targetStep: number;
  }>): Promise<TournamentDocument> {
    const actorAccountId = administrator(actor);
    const id = tournamentId(requestedTournamentId);
    if (!Number.isSafeInteger(input.targetStep) || input.targetStep < 2 || input.targetStep > 10) {
      invalid("targetStep must be 2-10");
    }
    const nowMs = this.dependencies.clock.nowMs();
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const director = acting.internalId;
      const record = await this.locked(transaction, id, acting);
      revisionMatches(record, input.expectedRevision);
      notFinalized(record);
      const maximumStep = 10;
      if (input.targetStep > maximumStep || Math.abs(input.targetStep - record.workflowStep) !== 1) {
        throw new TournamentOperationError("conflict", "move through the Tournament workflow one step at a time");
      }
      const movingForward = input.targetStep > record.workflowStep;
      const currentDocument = await this.document(transaction, record);
      const qualifierGroups = currentDocument.groups.filter((group) => group.stage === "qualifier");
      const finalGroups = currentDocument.groups.filter((group) => group.stage === "final");
      const complete = (stageGroups: typeof qualifierGroups): boolean => stageGroups.length > 0 &&
        stageGroups.every((group) => group.standings.source !== "none" &&
          group.standings.rows.length === group.members.length &&
          group.standings.rows.every((row) => row.complete));

      if (movingForward) {
        if (record.workflowStep === 2) {
          const stations = currentDocument.stations.length;
          const needed = Math.ceil(currentDocument.summary.presentCount / 2);
          if (currentDocument.summary.presentCount < 1 || stations < needed) {
            throw new TournamentOperationError("conflict", `at least one present Player and ${needed} Nintendo Switches are required`);
          }
        } else if (record.workflowStep === 3 && qualifierGroups.some((group) => !group.locked)) {
          throw new TournamentOperationError("conflict", "confirm and lock the qualifier layout first");
        } else if (record.workflowStep === 5 && !complete(qualifierGroups)) {
          throw new TournamentOperationError("conflict", "complete every qualifier score first");
        } else if (record.workflowStep === 6 && record.qualifierRounds && finalGroups.length === 0) {
          throw new TournamentOperationError("conflict", "generate the final groups first");
        } else if (record.workflowStep === 7 && finalGroups.some((group) => !group.locked)) {
          throw new TournamentOperationError("conflict", "confirm and lock the final layout first");
        } else if (record.workflowStep === 9 && !complete(finalGroups)) {
          throw new TournamentOperationError("conflict", "complete every final score first");
        }
        const unresolvedManualTies = record.workflowStep === 5
          ? qualifierGroups.flatMap((group) => group.standings.tieGroups).filter((tie) => !tie.resolved)
          : record.workflowStep === 9
            ? finalGroups.flatMap((group) => group.standings.tieGroups).filter((tie) => !tie.resolved)
            : [];
        if (unresolvedManualTies.length > 0) {
          throw new TournamentOperationError(
            "conflict",
            "resolve every equal final score with the selected manual tie-break before continuing",
          );
        }
      } else {
        if (record.workflowStep === 3) {
          await transaction.reopenAcceptedEvidenceForStage?.(record.internalId, "final", director, nowMs);
          await transaction.clearGroupResultsForStage(record.internalId, "final", nowMs);
          await transaction.deleteGroupsForStage(record.internalId, "final");
          await transaction.reopenAcceptedEvidenceForStage?.(record.internalId, "qualifier", director, nowMs);
          await transaction.clearGroupResultsForStage(record.internalId, "qualifier", nowMs);
          await transaction.deleteGroupsForStage(record.internalId, "qualifier");
        } else if (record.workflowStep === 4) {
          await transaction.reopenAcceptedEvidenceForStage?.(record.internalId, "qualifier", director, nowMs);
          await transaction.clearGroupResultsForStage(record.internalId, "qualifier", nowMs);
        } else if (record.workflowStep === 7) {
          await transaction.reopenAcceptedEvidenceForStage?.(record.internalId, "final", director, nowMs);
          await transaction.clearGroupResultsForStage(record.internalId, "final", nowMs);
          await transaction.deleteGroupsForStage(record.internalId, "final");
        } else if (record.workflowStep === 8) {
          await transaction.reopenAcceptedEvidenceForStage?.(record.internalId, "final", director, nowMs);
          await transaction.clearGroupResultsForStage(record.internalId, "final", nowMs);
        }
      }

      const stage: TournamentStage = input.targetStep <= 2 ? "setup"
        : input.targetStep <= 6 ? "qualifiers"
          : "finals";
      await transaction.updateTournament({
        internalId: record.internalId,
        revision: record.revision + 1,
        nowMs,
        workflowStep: input.targetStep,
        stage,
      });
      await transaction.appendLifecycle({
        tournamentInternalId: record.internalId,
        eventType: movingForward ? "workflow_advanced" : "workflow_rolled_back",
        detail: `step=${input.targetStep}`,
        actorInternalId: director,
        nowMs,
      });
      return this.document(transaction, (await transaction.findTournament(id))!);
    }));
  }

  public async advanceWorkflow(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    expectedRevision: number;
  }>): Promise<TournamentDocument> {
    const current = await this.loadForAdministrator(actor, requestedTournamentId);
    if (current.summary.revision !== input.expectedRevision) {
      throw new TournamentOperationError("conflict", "the tournament changed; reload and retry");
    }
    if (current.summary.workflowStep >= 10) {
      throw new TournamentOperationError("conflict", "the Tournament is already at Step 10");
    }
    return this.setWorkflowStep(actor, requestedTournamentId, {
      expectedRevision: input.expectedRevision,
      targetStep: current.summary.workflowStep + 1,
    });
  }

  public async rollbackWorkflow(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    expectedRevision: number;
  }>): Promise<TournamentDocument> {
    const current = await this.loadForAdministrator(actor, requestedTournamentId);
    if (current.summary.revision !== input.expectedRevision) {
      throw new TournamentOperationError("conflict", "the tournament changed; reload and retry");
    }
    if (current.summary.workflowStep <= 2) {
      throw new TournamentOperationError("conflict", "Step 2 is the first persisted operator step");
    }
    return this.setWorkflowStep(actor, requestedTournamentId, {
      expectedRevision: input.expectedRevision,
      targetStep: current.summary.workflowStep - 1,
    });
  }

  // -- participants --------------------------------------------------------

  public async setParticipant(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    expectedRevision: number;
    playerId: string;
    attendance?: TournamentAttendance;
    hasSwitch1?: boolean;
    hasSwitch2?: boolean;
  }>): Promise<TournamentDocument> {
    const actorAccountId = administrator(actor);
    const id = tournamentId(requestedTournamentId);
    const targetPlayerId = playerId(input.playerId);
    const nowMs = this.dependencies.clock.nowMs();
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const director = acting.internalId;
      const record = await this.locked(transaction, id, acting);
      revisionMatches(record, input.expectedRevision);
      notFinalized(record);
      const players = await transaction.resolvePlayers([targetPlayerId]);
      const player = players.get(targetPlayerId);
      if (player === undefined || !player.active) {
        throw new TournamentOperationError("not_found", "Player not found");
      }
      const participants = await transaction.loadParticipants(record.internalId);
      const existing = participants.find((participant) =>
        participant.player.playerId === targetPlayerId);
      const groups = await transaction.loadGroups(record.internalId);
      const seated = groups.some((group) => group.locked &&
        group.members.some((member) => member.playerId === targetPlayerId));
      const attendance = input.attendance ?? existing?.attendance ?? "present";
      const capacity = record.maxParticipants ?? TOURNAMENT_MAX_PARTICIPANTS;
      const becomesPresent = attendance === "present" && existing?.attendance !== "present";
      const presentCount = participants.filter((participant) => participant.attendance === "present").length;
      if (becomesPresent && presentCount >= capacity) {
        throw new TournamentOperationError("conflict", "the tournament is full");
      }
      if (seated && attendance !== "present") {
        throw new TournamentOperationError(
          "conflict", "unlock the seated group before changing this Player's attendance",
        );
      }
      let seedScore = existing?.seedScore ?? null;
      let seedRank = existing?.seedRank ?? null;
      if (existing === undefined) {
        const snapshot = await transaction.ratingSnapshot([player.internalId]);
        const rating = snapshot.get(player.internalId);
        seedScore = rating?.score ?? null;
        seedRank = rating?.rank ?? null;
      }
      const hasSwitch1 = input.hasSwitch1 ?? existing?.hasSwitch1 ?? false;
      const hasSwitch2 = input.hasSwitch2 ?? existing?.hasSwitch2 ?? false;
      await transaction.upsertParticipant({
        tournamentInternalId: record.internalId,
        playerInternalId: player.internalId,
        attendance,
        hasSwitch1,
        hasSwitch2,
        seedScore,
        seedRank,
        nowMs,
      });
      if (hasSwitch1) { await transaction.ensureStationCable?.(player.internalId, "ns1", nowMs); }
      if (hasSwitch2) { await transaction.ensureStationCable?.(player.internalId, "ns2", nowMs); }
      await transaction.updateTournament({
        internalId: record.internalId, revision: record.revision + 1, nowMs,
      });
      await transaction.appendLifecycle({
        tournamentInternalId: record.internalId,
        eventType: existing === undefined ? "participant_added" : "participant_updated",
        detail: `${targetPlayerId}:${attendance}`,
        actorInternalId: director,
        nowMs,
      });
      return this.document(transaction, (await transaction.findTournament(id))!);
    }));
  }

  /** A whole roster file in one request: the rows a CSV import wants to
   * apply, judged with the same rules as one participant at a time, written
   * in one transaction with one revision, one lifecycle event and one
   * document build. Rows that already match the roster cost nothing; when no
   * row changes anything the revision stays as it is. */
  /**
   * ADR-0218: the Players a typed name may mean, with context, for an
   * explicit choice. Seen from the Tournament's Director when a Tournament is
   * named (an administrator may act for another Director), otherwise from the
   * acting operator. Nothing is linked here.
   */
  public async rosterPlayerCandidates(actor: ActorContext, input: Readonly<{
    names: readonly string[];
    tournamentId?: string;
    partial?: boolean;
  }>): Promise<readonly RosterNameCandidates[]> {
    const actorAccountId = administrator(actor);
    if (input.names.length < 1 || input.names.length > TOURNAMENT_IMPORT_ROW_LIMIT) {
      invalid(`names must hold 1-${TOURNAMENT_IMPORT_ROW_LIMIT} entries`);
    }
    const id = input.tournamentId === undefined ? null : tournamentId(input.tournamentId);
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      let directorInternalId = acting.internalId;
      let tournamentInternalId: number | null = null;
      if (id !== null) {
        const record = await transaction.findTournament(id);
        if (record === null) { throw new TournamentOperationError("not_found", "tournament not found"); }
        if (!acting.isAdministrator && record.directorInternalId !== acting.internalId) {
          throw new TournamentOperationError("forbidden", "this Tournament belongs to another director");
        }
        directorInternalId = record.directorInternalId;
        tournamentInternalId = record.internalId;
      }
      if (transaction.listRosterCandidateContext === undefined) {
        throw new TournamentOperationError("unavailable");
      }
      const contexts = await transaction.listRosterCandidateContext(directorInternalId, tournamentInternalId);
      return rosterCandidatesFor(input.names, contexts, { partial: input.partial === true });
    }));
  }

  /**
   * ADR-0218: names the Director explicitly chose a Player for ("Malie" in
   * the file, Mal picked) become that Director's own aliases of the Player,
   * so the next file shows Mal first for "Malie". Never installation-wide,
   * never public, never a claim and never a merge (ADR-0006, ADR-0178).
   */
  public async rememberRosterAliases(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    aliases: readonly Readonly<{ playerId: string; name: string }>[];
  }>): Promise<Readonly<{ created: readonly Readonly<{ playerId: string; aliasText: string }>[]; existing: number }>> {
    const actorAccountId = administrator(actor);
    const id = tournamentId(requestedTournamentId);
    if (input.aliases.length < 1 || input.aliases.length > TOURNAMENT_IMPORT_ROW_LIMIT) {
      invalid(`aliases must hold 1-${TOURNAMENT_IMPORT_ROW_LIMIT} entries`);
    }
    const wanted = input.aliases.map((entry) => {
      const aliasText = entry.name.trim();
      if (aliasText.length < 1 || aliasText.length > 64 || controlCharacters.test(aliasText)) {
        invalid("an alias must be 1-64 printable characters");
      }
      return { playerId: playerId(entry.playerId), aliasText };
    });
    const nowMs = this.dependencies.clock.nowMs();
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const record = await transaction.findTournament(id);
      if (record === null) { throw new TournamentOperationError("not_found", "tournament not found"); }
      if (!acting.isAdministrator && record.directorInternalId !== acting.internalId) {
        throw new TournamentOperationError("forbidden", "this Tournament belongs to another director");
      }
      if (transaction.insertDirectorAlias === undefined) { throw new TournamentOperationError("unavailable"); }
      const players = await transaction.resolvePlayers(wanted.map((entry) => entry.playerId));
      const created: { playerId: string; aliasText: string }[] = [];
      let existing = 0;
      for (const entry of wanted) {
        const player = players.get(entry.playerId);
        if (player === undefined || !player.active) {
          throw new TournamentOperationError("not_found", `Player not found: ${entry.playerId}`);
        }
        // The Player's own names are not aliases of them.
        if (rosterNameKey(entry.aliasText) === rosterNameKey(player.displayName) ||
          rosterNameKey(entry.aliasText) === rosterNameKey(player.username)) {
          existing += 1;
          continue;
        }
        const outcome = await transaction.insertDirectorAlias({
          playerInternalId: player.internalId,
          directorInternalId: record.directorInternalId,
          actorInternalId: acting.internalId,
          aliasText: entry.aliasText,
          nowMs,
        });
        if (outcome === "created") { created.push(entry); } else { existing += 1; }
      }
      return { created, existing };
    }));
  }

  public async importParticipants(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    expectedRevision: number;
    rows: readonly Readonly<{
      playerId: string;
      attendance?: TournamentAttendance;
      hasSwitch1?: boolean;
      hasSwitch2?: boolean;
    }>[];
  }>): Promise<TournamentDocument> {
    const actorAccountId = administrator(actor);
    const id = tournamentId(requestedTournamentId);
    if (input.rows.length < 1 || input.rows.length > TOURNAMENT_IMPORT_ROW_LIMIT) {
      invalid(`rows must hold 1-${TOURNAMENT_IMPORT_ROW_LIMIT} entries`);
    }
    const rows = input.rows.map((row) => ({ ...row, playerId: playerId(row.playerId) }));
    if (new Set(rows.map((row) => row.playerId)).size !== rows.length) {
      invalid("a Player may appear once in an import");
    }
    const nowMs = this.dependencies.clock.nowMs();
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const director = acting.internalId;
      const record = await this.locked(transaction, id, acting);
      revisionMatches(record, input.expectedRevision);
      notFinalized(record);
      const players = await transaction.resolvePlayers(rows.map((row) => row.playerId));
      const participants = await transaction.loadParticipants(record.internalId);
      const groups = await transaction.loadGroups(record.internalId);
      const seatedLocked = new Set(groups
        .filter((group) => group.locked)
        .flatMap((group) => group.members.map((member) => member.playerId)));
      const capacity = record.maxParticipants ?? TOURNAMENT_MAX_PARTICIPANTS;
      const byPlayerId = new Map(participants.map((participant) => [participant.player.playerId, participant]));
      let presentCount = participants.filter((participant) => participant.attendance === "present").length;
      const newcomers = rows
        .filter((row) => !byPlayerId.has(row.playerId))
        .map((row) => players.get(row.playerId)?.internalId)
        .filter((internalId): internalId is number => internalId !== undefined);
      const snapshot = newcomers.length === 0
        ? new Map<number, { score: number; rank: number }>()
        : await transaction.ratingSnapshot(newcomers);
      let changed = 0;
      let added = 0;
      for (const row of rows) {
        const player = players.get(row.playerId);
        if (player === undefined || !player.active) {
          throw new TournamentOperationError("not_found", `Player not found: ${row.playerId}`);
        }
        const existing = byPlayerId.get(row.playerId);
        const attendance = row.attendance ?? existing?.attendance ?? "present";
        const hasSwitch1 = row.hasSwitch1 ?? existing?.hasSwitch1 ?? false;
        const hasSwitch2 = row.hasSwitch2 ?? existing?.hasSwitch2 ?? false;
        if (existing !== undefined && existing.attendance === attendance &&
          existing.hasSwitch1 === hasSwitch1 && existing.hasSwitch2 === hasSwitch2) {
          continue;
        }
        if (seatedLocked.has(row.playerId) && attendance !== "present") {
          throw new TournamentOperationError(
            "conflict", "unlock the seated group before changing this Player's attendance",
          );
        }
        const becomesPresent = attendance === "present" && existing?.attendance !== "present";
        if (becomesPresent && presentCount >= capacity) {
          throw new TournamentOperationError("conflict", "the tournament is full");
        }
        if (becomesPresent) { presentCount += 1; }
        if (existing?.attendance === "present" && attendance !== "present") { presentCount -= 1; }
        const rating = existing === undefined ? snapshot.get(player.internalId) : undefined;
        await transaction.upsertParticipant({
          tournamentInternalId: record.internalId,
          playerInternalId: player.internalId,
          attendance,
          hasSwitch1,
          hasSwitch2,
          seedScore: existing === undefined ? rating?.score ?? null : existing.seedScore,
          seedRank: existing === undefined ? rating?.rank ?? null : existing.seedRank,
          nowMs,
        });
        if (hasSwitch1 && !(existing?.hasSwitch1 ?? false)) { await transaction.ensureStationCable?.(player.internalId, "ns1", nowMs); }
        if (hasSwitch2 && !(existing?.hasSwitch2 ?? false)) { await transaction.ensureStationCable?.(player.internalId, "ns2", nowMs); }
        changed += 1;
        if (existing === undefined) { added += 1; }
      }
      if (changed > 0) {
        await transaction.updateTournament({
          internalId: record.internalId, revision: record.revision + 1, nowMs,
        });
        await transaction.appendLifecycle({
          tournamentInternalId: record.internalId,
          eventType: "participants_imported",
          detail: `rows=${rows.length};changed=${changed};added=${added}`,
          actorInternalId: director,
          nowMs,
        });
      }
      return this.document(transaction, (await transaction.findTournament(id))!);
    }));
  }

  /** Add the unique present Players from the latest three finalized TN4+
   * events. Existing roster status is preserved; new rows start Absent and
   * retain the current canonical TrueSkill rank/score as their seed order. */
  public async addRecentParticipants(
    actor: ActorContext,
    requestedTournamentId: string,
    input: Readonly<{ expectedRevision: number }>,
  ): Promise<TournamentDocument> {
    const actorAccountId = administrator(actor);
    const id = tournamentId(requestedTournamentId);
    const nowMs = this.dependencies.clock.nowMs();
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const director = acting.internalId;
      const record = await this.locked(transaction, id, acting);
      revisionMatches(record, input.expectedRevision);
      notFinalized(record);
      if (record.workflowStep !== 2 || (await transaction.loadGroups(record.internalId)).length > 0) {
        throw new TournamentOperationError("conflict", "recent Players can only be added during participants and consoles");
      }
      const existing = new Set((await transaction.loadParticipants(record.internalId))
        .map((participant) => participant.player.internalId));
      const recent = (await transaction.loadRecentPresentPlayers(record.internalId))
        .filter((player) => player.active && !existing.has(player.internalId));
      const snapshot = await transaction.ratingSnapshot(recent.map((player) => player.internalId));
      const ordered = [...recent].sort((left, right) =>
        (snapshot.get(left.internalId)?.rank ?? Number.MAX_SAFE_INTEGER) -
          (snapshot.get(right.internalId)?.rank ?? Number.MAX_SAFE_INTEGER) ||
        left.displayName.localeCompare(right.displayName) || left.playerId.localeCompare(right.playerId));
      for (const player of ordered) {
        const rating = snapshot.get(player.internalId);
        await transaction.upsertParticipant({
          tournamentInternalId: record.internalId,
          playerInternalId: player.internalId,
          attendance: "absent",
          hasSwitch1: false,
          hasSwitch2: false,
          seedScore: rating?.score ?? null,
          seedRank: rating?.rank ?? null,
          nowMs,
        });
      }
      await transaction.updateTournament({
        internalId: record.internalId,
        revision: record.revision + 1,
        nowMs,
      });
      await transaction.appendLifecycle({
        tournamentInternalId: record.internalId,
        eventType: "recent_participants_added",
        detail: `added=${ordered.length};source=latest_three_tn4_plus`,
        actorInternalId: director,
        nowMs,
      });
      return this.document(transaction, (await transaction.findTournament(id))!);
    }));
  }

  /** Reconcile an existing Step 2 draft with every human Player who has
   * canonical finalized attendance or a mapped TN4-TN12 legacy race. Existing
   * state is preserved; only missing historical Players are inserted Absent. */
  public async addHistoricalParticipants(
    actor: ActorContext,
    requestedTournamentId: string,
    input: Readonly<{ expectedRevision: number }>,
  ): Promise<TournamentDocument> {
    const actorAccountId = administrator(actor);
    const id = tournamentId(requestedTournamentId);
    const nowMs = this.dependencies.clock.nowMs();
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const director = acting.internalId;
      const record = await this.locked(transaction, id, acting);
      revisionMatches(record, input.expectedRevision);
      notFinalized(record);
      if (record.workflowStep !== 2 || (await transaction.loadGroups(record.internalId)).length > 0) {
        throw new TournamentOperationError("conflict", "Tournament history can only be synchronized during participants and consoles");
      }
      const existing = new Set((await transaction.loadParticipants(record.internalId))
        .map((participant) => participant.player.internalId));
      const missing = (await transaction.loadHistoricalPresentPlayers(record.internalId))
        .map(({ player }) => player)
        .filter((player) => !existing.has(player.internalId));
      const snapshot = await transaction.ratingSnapshot(missing.map((player) => player.internalId));
      const ordered = [...missing].sort((left, right) =>
        (snapshot.get(left.internalId)?.rank ?? Number.MAX_SAFE_INTEGER) -
          (snapshot.get(right.internalId)?.rank ?? Number.MAX_SAFE_INTEGER) ||
        left.displayName.localeCompare(right.displayName) || left.playerId.localeCompare(right.playerId));
      for (const player of ordered) {
        const rating = snapshot.get(player.internalId);
        await transaction.upsertParticipant({
          tournamentInternalId: record.internalId,
          playerInternalId: player.internalId,
          attendance: "absent",
          hasSwitch1: false,
          hasSwitch2: false,
          seedScore: rating?.score ?? null,
          seedRank: rating?.rank ?? null,
          nowMs,
        });
      }
      await transaction.updateTournament({
        internalId: record.internalId,
        revision: record.revision + 1,
        nowMs,
      });
      await transaction.appendLifecycle({
        tournamentInternalId: record.internalId,
        eventType: "history_participants_added",
        detail: `added=${ordered.length};source=finalized_present_or_legacy_race;attendance=absent`,
        actorInternalId: director,
        nowMs,
      });
      return this.document(transaction, (await transaction.findTournament(id))!);
    }));
  }

  public async removeParticipant(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    expectedRevision: number;
    playerId: string;
  }>): Promise<TournamentDocument> {
    const actorAccountId = administrator(actor);
    const id = tournamentId(requestedTournamentId);
    const targetPlayerId = playerId(input.playerId);
    const nowMs = this.dependencies.clock.nowMs();
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const director = acting.internalId;
      const record = await this.locked(transaction, id, acting);
      revisionMatches(record, input.expectedRevision);
      notFinalized(record);
      const participants = await transaction.loadParticipants(record.internalId);
      const existing = participants.find((participant) =>
        participant.player.playerId === targetPlayerId);
      if (existing === undefined) {
        throw new TournamentOperationError("not_found", "participant not found");
      }
      const groups = await transaction.loadGroups(record.internalId);
      if (groups.some((group) => group.members.some((member) => member.playerId === targetPlayerId))) {
        throw new TournamentOperationError("conflict", "the Player is seated in a group; regenerate or edit groups first");
      }
      await transaction.deleteParticipant(record.internalId, existing.player.internalId);
      await transaction.updateTournament({
        internalId: record.internalId, revision: record.revision + 1, nowMs,
      });
      await transaction.appendLifecycle({
        tournamentInternalId: record.internalId, eventType: "participant_removed",
        detail: targetPlayerId, actorInternalId: director, nowMs,
      });
      return this.document(transaction, (await transaction.findTournament(id))!);
    }));
  }

  // -- groups --------------------------------------------------------------

  /**
   * Applies a seating layout the operator prepared elsewhere - the source
   * Manager's Step 3 and Step 7 layout CSV: switch owner, console, the two
   * seats and the group each pair belongs to.
   *
   * This rearranges the groups that already exist; it never invents groups and
   * never changes who is taking part. The imported field must be exactly the
   * field currently seated in that stage, so an incomplete or stale file is
   * refused rather than quietly dropping somebody from the night.
   */
  public async importGroupLayout(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    expectedRevision: number;
    stage: TournamentGroupStage;
    /** Explicit equipment review never changes group membership or accepted scores. */
    equipmentCorrectionReason?: string;
    groups: readonly Readonly<{
      name: string;
      seats: readonly Readonly<{
        playerId: string;
        stationOwnerPlayerId: string | null;
        switchType: TournamentSwitchType | null;
        seatNumber: 1 | 2 | null;
      }>[];
      /**
       * The consoles in the group's slots, in slot order, including one with
       * nobody seated yet. Omitted, the slots are the consoles the seats
       * name, in seat order.
       */
      stations?: readonly Readonly<{
        stationOwnerPlayerId: string;
        switchType: TournamentSwitchType;
      }>[];
    }>[];
  }>): Promise<TournamentDocument> {
    const actorAccountId = administrator(actor);
    const id = tournamentId(requestedTournamentId);
    const nowMs = this.dependencies.clock.nowMs();
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const director = acting.internalId;
      const record = await this.locked(transaction, id, acting);
      revisionMatches(record, input.expectedRevision);
      notFinalized(record);

      const groups = await transaction.loadGroups(record.internalId);
      const stageGroups = groups.filter((group) => group.stage === input.stage);
      if (stageGroups.length === 0) {
        throw new TournamentOperationError("conflict", "generate the groups before importing a layout");
      }
      const correction = input.equipmentCorrectionReason !== undefined;
      if (correction && (input.equipmentCorrectionReason!.trim().length < 3 ||
          input.equipmentCorrectionReason!.length > 160 || controlCharacters.test(input.equipmentCorrectionReason!))) {
        invalid("equipmentCorrectionReason must contain 3-160 readable characters");
      }
      if (!correction && stageGroups.some((group) => group.locked)) {
        throw new TournamentOperationError("conflict", "unlock the layout before importing one");
      }
      const races = await transaction.loadGroupRaces(record.internalId);
      if (!correction && races.some((race) => stageGroups.some((group) => group.internalId === race.groupInternalId))) {
        throw new TournamentOperationError("conflict", "races have been recorded for this stage");
      }

      const participants = await transaction.loadParticipants(record.internalId);
      const byPlayerId = new Map(participants.map((entry) => [entry.player.playerId, entry.player]));

      // The field in the file must be the field on the board: same Players,
      // each exactly once.
      const seated = new Set<string>();
      const current = new Set<string>();
      stageGroups.forEach((group) => {
        group.members.forEach((member) => { current.add(member.playerId); });
      });
      for (const group of input.groups) {
        for (const seat of group.seats) {
          if (!byPlayerId.has(seat.playerId)) {
            throw new TournamentOperationError("conflict", `${seat.playerId} is not taking part`);
          }
          if (seated.has(seat.playerId)) {
            throw new TournamentOperationError("conflict", `${seat.playerId} is seated twice`);
          }
          seated.add(seat.playerId);
        }
      }
      if (seated.size !== current.size || [...current].some((playerId) => !seated.has(playerId))) {
        throw new TournamentOperationError(
          "conflict", "the layout must contain exactly the Players already in this stage",
        );
      }

      const byName = new Map(stageGroups.map((group) => [group.name.trim().toLowerCase(), group]));
      const requestedNames = input.groups.map((group) => group.name.trim().toLowerCase());
      if (requestedNames.length !== stageGroups.length || new Set(requestedNames).size !== stageGroups.length ||
          requestedNames.some((name) => !byName.has(name))) {
        throw new TournamentOperationError("conflict", "the layout must contain every group of this stage exactly once");
      }
      if (correction) {
        for (const group of input.groups) {
          const previous = byName.get(group.name.trim().toLowerCase())!;
          if (group.seats.length !== previous.members.length || group.seats.some((seat, index) =>
            seat.playerId !== previous.members[index]?.playerId)) {
            throw new TournamentOperationError("conflict", "equipment correction must preserve every group's Players and order; accepted results are unchanged");
          }
        }
      }
      // A console sits in one group of a stage at a time, and every console a
      // seat names is in that group's slots - appended when the file forgot it.
      const consolesSeen = new Map<string, string>();
      const slotsByGroup = new Map<string, readonly Readonly<{ ownerPlayerId: string; switchType: TournamentSwitchType }>[]>();
      for (const group of input.groups) {
        const slots: { ownerPlayerId: string; switchType: TournamentSwitchType }[] = [];
        const occupiedSeats = new Set<string>();
        for (const seat of group.seats) {
          const fields = [seat.stationOwnerPlayerId, seat.switchType, seat.seatNumber];
          if (fields.some((field) => field === undefined)) {
            invalid("a layout seat must explicitly specify its owner, Switch type and seat number, or null for all three");
          }
          if (fields.some((field) => field === null) && !fields.every((field) => field === null)) {
            throw new TournamentOperationError("invalid_input", "a seat must specify its owner, Switch type and seat number together");
          }
          if (seat.stationOwnerPlayerId !== null) {
            const key = `${seat.stationOwnerPlayerId}|${seat.switchType}|${seat.seatNumber}`;
            if (occupiedSeats.has(key)) {
              throw new TournamentOperationError("conflict", `${group.name} assigns the same Switch seat twice`);
            }
            occupiedSeats.add(key);
          }
        }
        const add = (ownerPlayerId: string, switchType: TournamentSwitchType): void => {
          if (!byPlayerId.has(ownerPlayerId)) {
            throw new TournamentOperationError("conflict", `${ownerPlayerId} is not taking part`);
          }
          const key = `${ownerPlayerId}|${switchType}`;
          if (slots.some((slot) => `${slot.ownerPlayerId}|${slot.switchType}` === key)) { return; }
          const elsewhere = consolesSeen.get(key);
          if (elsewhere !== undefined && elsewhere !== group.name) {
            throw new TournamentOperationError("conflict", `the Switch of ${ownerPlayerId} (${switchType}) is in two groups`);
          }
          consolesSeen.set(key, group.name);
          slots.push({ ownerPlayerId, switchType });
        };
        for (const station of group.stations ?? []) { add(station.stationOwnerPlayerId, station.switchType); }
        for (const seat of group.seats) {
          if (seat.stationOwnerPlayerId !== null && seat.switchType !== null) { add(seat.stationOwnerPlayerId, seat.switchType); }
        }
        if (slots.length > TOURNAMENT_GROUP_SLOTS) {
          throw new TournamentOperationError("conflict", `${group.name} holds too many Nintendo Switches`);
        }
        slotsByGroup.set(group.name, slots);
      }
      for (const group of input.groups) {
        const target = byName.get(group.name.trim().toLowerCase());
        if (target === undefined) {
          throw new TournamentOperationError("conflict", `there is no group named ${group.name}`);
        }
        if (group.seats.length > TOURNAMENT_GROUP_SIZE) {
          throw new TournamentOperationError("conflict", `${group.name} holds too many Players`);
        }
        const mappedMembers = group.seats.map((seat, index) => ({
          playerInternalId: byPlayerId.get(seat.playerId)!.internalId,
          seatOrder: index + 1,
          stationOwnerInternalId: seat.stationOwnerPlayerId === null
            ? null
            : byPlayerId.get(seat.stationOwnerPlayerId)?.internalId ?? null,
          stationSwitchType: seat.switchType,
          seatNumber: seat.seatNumber,
        }));
        if (correction) {
          // Capture every before/after reference with numeric canonical keys so
          // the existing 255-character audit detail never truncates an identity.
          for (const [index, member] of target.members.entries()) {
            const before = member.station;
            const after = mappedMembers[index]!;
            await transaction.appendLifecycle({
              tournamentInternalId: record.internalId, eventType: "groups_edited",
              detail: `equipment;g=${target.internalId};p=${after.playerInternalId};order=${member.seatOrder};before=${before === null ? "none" : `${byPlayerId.get(before.ownerPlayerId)!.internalId}/${before.switchType}/${before.seatNumber}`};after=${after.stationOwnerInternalId === null ? "none" : `${after.stationOwnerInternalId}/${after.stationSwitchType}/${after.seatNumber}`}`,
              actorInternalId: director, nowMs,
            });
          }
          for (const [version, slots] of [["before", target.stations], ["after", (slotsByGroup.get(group.name) ?? []).map((slot, index) => ({ ...slot, slotIndex: index + 1 }))]] as const) {
            for (const slot of slots) {
              await transaction.appendLifecycle({
                tournamentInternalId: record.internalId, eventType: "groups_edited",
                detail: `equipment;g=${target.internalId};${version};slot=${slot.slotIndex};owner=${byPlayerId.get(slot.ownerPlayerId)!.internalId};type=${slot.switchType}`,
                actorInternalId: director, nowMs,
              });
            }
          }
          await transaction.updateGroupMemberStations(target.internalId, mappedMembers);
        } else {
          await transaction.replaceGroupMembers(target.internalId, mappedMembers);
        }
        await transaction.replaceGroupStations(target.internalId, (slotsByGroup.get(group.name) ?? []).map((slot, index) => ({
          slotIndex: index + 1,
          ownerInternalId: byPlayerId.get(slot.ownerPlayerId)!.internalId,
          switchType: slot.switchType,
        })), nowMs);
      }

      // A submitted physical layout is also explicit equipment availability.
      // Its owner can lend a Switch without entering the Tournament. Older CSV
      // imports persisted slots without these flags, so a reviewed correction
      // repairs that mismatch without reseeding or removing qualifier evidence.
      for (const participant of participants) {
        const assigned = [...slotsByGroup.values()].flat().filter((slot) => slot.ownerPlayerId === participant.player.playerId);
        const hasSwitch1 = participant.hasSwitch1 || assigned.some((slot) => slot.switchType === "ns1");
        const hasSwitch2 = participant.hasSwitch2 || assigned.some((slot) => slot.switchType === "ns2");
        if (hasSwitch1 === participant.hasSwitch1 && hasSwitch2 === participant.hasSwitch2) { continue; }
        await transaction.appendLifecycle({
          tournamentInternalId: record.internalId, eventType: "groups_edited",
          detail: `equipment;owner=${participant.player.internalId};availability_before=${Number(participant.hasSwitch1)}/${Number(participant.hasSwitch2)};availability_after=${Number(hasSwitch1)}/${Number(hasSwitch2)};attendance=${participant.attendance}`,
          actorInternalId: director, nowMs,
        });
        await transaction.upsertParticipant({
          tournamentInternalId: record.internalId, playerInternalId: participant.player.internalId,
          attendance: participant.attendance, hasSwitch1, hasSwitch2,
          seedScore: participant.seedScore, seedRank: participant.seedRank, nowMs,
        });
      }

      await transaction.updateTournament({
        internalId: record.internalId, revision: record.revision + 1, nowMs,
      });
      await transaction.appendLifecycle({
        tournamentInternalId: record.internalId,
        eventType: "group_layout_imported",
        detail: correction
          ? `equipment_review;stage=${input.stage};results=preserved;reason=${input.equipmentCorrectionReason!.trim()}`
          : `stage=${input.stage};groups=${input.groups.length};players=${seated.size}`,
        actorInternalId: director,
        nowMs,
      });
      return this.document(transaction, (await transaction.findTournament(id))!);
    }));
  }

  public async generateGroups(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    expectedRevision: number;
    stage: TournamentGroupStage;
  }>): Promise<TournamentDocument> {
    const actorAccountId = administrator(actor);
    const id = tournamentId(requestedTournamentId);
    const nowMs = this.dependencies.clock.nowMs();
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const director = acting.internalId;
      const record = await this.locked(transaction, id, acting);
      revisionMatches(record, input.expectedRevision);
      notFinalized(record);
      if (input.stage === "final" && !record.qualifierRounds) {
        throw new TournamentOperationError("conflict", "this Tournament uses the compact no-final-groups flow");
      }
      const participants = await transaction.loadParticipants(record.internalId);
      const groups = await transaction.loadGroups(record.internalId);
      const races = await transaction.loadGroupRaces(record.internalId);
      const stageGroups = groups.filter((group) => group.stage === input.stage);
      if (stageGroups.some((group) => group.locked)) {
        throw new TournamentOperationError("conflict", "unlock the groups before regenerating them");
      }
      if (races.some((race) => stageGroups.some((group) => group.internalId === race.groupInternalId))) {
        throw new TournamentOperationError("conflict", "groups with entered races cannot be regenerated");
      }
      // Seed on what the Players are worth now, and write it down while doing
      // so, so the draw and every later reading of it agree.
      const seeded = await this.withLiveSeeds(transaction, participants);
      for (const participant of seeded) {
        await transaction.upsertParticipant({
          tournamentInternalId: record.internalId,
          playerInternalId: participant.player.internalId,
          attendance: participant.attendance,
          hasSwitch1: participant.hasSwitch1,
          hasSwitch2: participant.hasSwitch2,
          seedScore: participant.seedScore,
          seedRank: participant.seedRank,
          nowMs,
        });
      }
      const present = seedParticipants(seeded);
      if (present.length < 1) {
        throw new TournamentOperationError("conflict", "at least one present participant is required");
      }
      // ADR-0221: the qualifier draw's order comes from the night's seeding
      // source; the stored SP above (the community rating) stays the record.
      const draw = await this.drawParticipants(transaction, record, seeded, present);
      const availableStations = stationsFrom(seedParticipants(seeded, false));
      const stationCount = availableStations.length;
      const neededStations = Math.ceil(present.length / 2);
      if (stationCount < neededStations) {
        throw new TournamentOperationError(
          "conflict", `${neededStations} Nintendo Switches are required for ${present.length} present Players; ${stationCount} are available. Review equipment availability; accepted scores are preserved.`,
        );
      }
      const playerById = new Map(participants.map((participant) =>
        [participant.player.playerId, participant.player] as const));
      let generated: readonly Readonly<{ name: string; tierKey: string | null; members: readonly string[] }>[];
      if (input.stage === "qualifier") {
        generated = seedQualifierGroups(draw, {
          strategy: record.placementStrategy,
          seedOrder: record.seedOrder,
          random: this.random,
        }).map((group) => ({ name: group.name, tierKey: null, members: group.members }));
      } else {
        const qualifiers = groups.filter((group) => group.stage === "qualifier");
        if (qualifiers.length === 0) {
          generated = seedQualifierGroups(draw, {
            strategy: record.placementStrategy,
            seedOrder: record.seedOrder,
            random: this.random,
          }).map((group, index) => ({
            name: `Final ${index + 1}`,
            tierKey: null,
            members: group.members,
          }));
        } else {
          const manual = await transaction.loadManualScores(record.internalId);
          const seedLookup = this.seedLookup(participants);
          const qualifierStandings = qualifiers.map((group) => ({
            name: group.name,
            standings: computeStandings(
              group.members.map((member) => member.playerId),
              races.filter((race) => race.groupInternalId === group.internalId),
              manualScoresOf(manual, group),
              group.manualScoreSegments,
              seedLookup,
              {
                mode: record.qualifierTieBreakMode,
                orders: group.tieBreakOrders,
                lotteryKey: `${record.tournamentId}:qualifier:${group.groupId}`,
              },
            ).rows,
          }));
          try {
            generated = computeFinalGroups(qualifierStandings, seedLookup)
              .map((group) => ({ name: group.tier.name, tierKey: group.tier.key, members: group.members }));
          } catch (error) {
            throw new TournamentOperationError(
              "conflict", error instanceof Error ? error.message : "qualifier results are incomplete",
            );
          }
        }
      }
      const seating = assignSeating(
        generated.map((group) => group.members),
        availableStations,
        record.ownerSeatingMode,
      );
      if (seating.some((seats) => seats.some((seat) => seat.station === null))) {
        const required = generated.reduce((total, group) => total + Math.ceil(group.members.length / 2), 0);
        throw new TournamentOperationError("conflict", `${required} Nintendo Switches are required for these groups; ${stationCount} are available. Review equipment availability; accepted scores are preserved.`);
      }
      await transaction.deleteGroupsForStage(record.internalId, input.stage);
      for (const [index, group] of generated.entries()) {
        const newGroupId = this.dependencies.ids.newGroupId();
        if (!groupIdPattern.test(newGroupId)) { throw new TournamentOperationError("unavailable"); }
        const groupInternalId = await transaction.insertGroup({
          tournamentInternalId: record.internalId,
          groupId: newGroupId,
          stage: input.stage,
          sequence: index + 1,
          name: group.name,
          tierKey: group.tierKey,
          nowMs,
        });
        await transaction.replaceGroupMembers(groupInternalId, seating[index]!.map((seat) => ({
          playerInternalId: playerById.get(seat.playerId)!.internalId,
          seatOrder: seat.seatOrder,
          stationOwnerInternalId: seat.station === null
            ? null
            : playerById.get(seat.station.ownerPlayerId)!.internalId,
          stationSwitchType: seat.station?.switchType ?? null,
          seatNumber: seat.station?.seatNumber ?? null,
        })));
        await transaction.replaceGroupStations(groupInternalId, stationsFromSeats(seating[index]!).map((station) => ({
          slotIndex: station.slotIndex,
          ownerInternalId: playerById.get(station.ownerPlayerId)!.internalId,
          switchType: station.switchType,
        })), nowMs);
      }
      await transaction.updateTournament({
        internalId: record.internalId,
        revision: record.revision + 1,
        nowMs,
        stage: input.stage === "qualifier" ? "qualifiers" : "finals",
        workflowStep: input.stage === "qualifier" ? 3 : 7,
      });
      await transaction.appendLifecycle({
        tournamentInternalId: record.internalId,
        eventType: input.stage === "qualifier" ? "qualifier_groups_generated" : "final_groups_generated",
        detail: `${generated.length} groups`,
        actorInternalId: director,
        nowMs,
      });
      return this.document(transaction, (await transaction.findTournament(id))!);
    }));
  }

  // Manual correction of a stage's membership: the operator supplies every
  // group's member list; seating is recomputed; nothing is possible once a
  // group holds races or is locked.
  public async updateGroups(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    expectedRevision: number;
    stage: TournamentGroupStage;
    groups: readonly Readonly<{ groupId: string; members: readonly string[] }>[];
  }>): Promise<TournamentDocument> {
    const actorAccountId = administrator(actor);
    const id = tournamentId(requestedTournamentId);
    const nowMs = this.dependencies.clock.nowMs();
    const requested = input.groups.map((group) => ({
      groupId: groupId(group.groupId),
      members: group.members.map(playerId),
    }));
    const allMembers = requested.flatMap((group) => group.members);
    if (new Set(allMembers).size !== allMembers.length) { invalid("a Player can only sit in one group"); }
    if (requested.some((group) => group.members.length > TOURNAMENT_GROUP_SIZE)) {
      invalid("a group holds at most twelve Players");
    }
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const director = acting.internalId;
      const record = await this.locked(transaction, id, acting);
      revisionMatches(record, input.expectedRevision);
      notFinalized(record);
      const participants = await transaction.loadParticipants(record.internalId);
      const groups = await transaction.loadGroups(record.internalId);
      const races = await transaction.loadGroupRaces(record.internalId);
      const stageGroups = groups.filter((group) => group.stage === input.stage);
      if (stageGroups.length !== requested.length ||
        requested.some((group) => !stageGroups.some((existing) => existing.groupId === group.groupId))) {
        invalid("every group of the stage must be listed exactly once");
      }
      if (stageGroups.some((group) => group.locked)) {
        throw new TournamentOperationError("conflict", "unlock the groups before editing them");
      }
      if (races.some((race) => stageGroups.some((group) => group.internalId === race.groupInternalId))) {
        throw new TournamentOperationError("conflict", "groups with entered races cannot be edited");
      }
      const present = seedParticipants(participants);
      const presentIds = new Set(present.map((participant) => participant.playerId));
      if (allMembers.some((member) => !presentIds.has(member))) {
        invalid("only present participants can be seated");
      }
      const playerById = new Map(participants.map((participant) =>
        [participant.player.playerId, participant.player] as const));
      const seating = assignSeating(
        requested.map((group) => group.members), stationsFrom(seedParticipants(participants, false)), record.ownerSeatingMode,
      );
      for (const [index, group] of requested.entries()) {
        const existing = stageGroups.find((candidate) => candidate.groupId === group.groupId)!;
        await transaction.replaceGroupMembers(existing.internalId, seating[index]!.map((seat) => ({
          playerInternalId: playerById.get(seat.playerId)!.internalId,
          seatOrder: seat.seatOrder,
          stationOwnerInternalId: seat.station === null
            ? null
            : playerById.get(seat.station.ownerPlayerId)!.internalId,
          stationSwitchType: seat.station?.switchType ?? null,
          seatNumber: seat.station?.seatNumber ?? null,
        })));
        await transaction.replaceGroupStations(existing.internalId, stationsFromSeats(seating[index]!).map((station) => ({
          slotIndex: station.slotIndex,
          ownerInternalId: playerById.get(station.ownerPlayerId)!.internalId,
          switchType: station.switchType,
        })), nowMs);
      }
      await transaction.updateTournament({
        internalId: record.internalId, revision: record.revision + 1, nowMs,
      });
      await transaction.appendLifecycle({
        tournamentInternalId: record.internalId, eventType: "groups_edited",
        detail: input.stage, actorInternalId: director, nowMs,
      });
      return this.document(transaction, (await transaction.findTournament(id))!);
    }));
  }

  public async lockGroups(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    expectedRevision: number;
    stage: TournamentGroupStage;
    locked: boolean;
  }>): Promise<TournamentDocument> {
    const actorAccountId = administrator(actor);
    const id = tournamentId(requestedTournamentId);
    const nowMs = this.dependencies.clock.nowMs();
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const director = acting.internalId;
      const record = await this.locked(transaction, id, acting);
      revisionMatches(record, input.expectedRevision);
      notFinalized(record);
      const groups = (await transaction.loadGroups(record.internalId))
        .filter((group) => group.stage === input.stage);
      if (groups.length === 0) {
        throw new TournamentOperationError("conflict", "there are no groups to lock");
      }
      if (!input.locked) {
        const races = await transaction.loadGroupRaces(record.internalId);
        if (races.some((race) => groups.some((group) => group.internalId === race.groupInternalId))) {
          throw new TournamentOperationError("conflict", "groups with entered races stay locked");
        }
      }
      for (const group of groups) {
        await transaction.updateGroup({ groupInternalId: group.internalId, locked: input.locked, nowMs });
      }
      await transaction.updateTournament({
        internalId: record.internalId, revision: record.revision + 1, nowMs,
        workflowStep: input.stage === "qualifier"
          ? (input.locked ? 4 : 3)
          : (input.locked ? 8 : 7),
      });
      await transaction.appendLifecycle({
        tournamentInternalId: record.internalId,
        eventType: input.locked ? "groups_locked" : "groups_unlocked",
        detail: input.stage, actorInternalId: director, nowMs,
      });
      return this.document(transaction, (await transaction.findTournament(id))!);
    }));
  }

  // -- races and scores ----------------------------------------------------

  // Enter (or correct) one race of a group. The canonical race result is
  // written through the platform's own submission boundary; a correction of
  // an earlier race re-derives the running totals of every later race of the
  // group as new revisions so the canonical chain stays consistent.
  /** The races of one group in one request, as a score workbook hands them
   * over: each race is entered with the ordinary race rules in order, the
   * revision carried from one to the next, so the client pays one round trip
   * instead of one per race. A race that is refused stops the sequence; the
   * races before it stand, and the error names the race number. */
  /**
   * The characters a group's Players drove. Tournament Live and the recorded
   * Processor both write this into their workbook, and the community's report
   * prints the picture beside every name, so it is kept with the group rather
   * than dropped on import.
   */
  public async setGroupCharacters(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    expectedRevision: number;
    groupId: string;
    characters: readonly Readonly<{
      playerId: string;
      characterKey?: string;
      characterLabel: string;
      characterRoster?: string;
    }>[];
  }>): Promise<TournamentDocument> {
    const actorAccountId = administrator(actor);
    const id = tournamentId(requestedTournamentId);
    if (input.characters.length < 1 || input.characters.length > TOURNAMENT_GROUP_SIZE) {
      invalid(`characters must hold 1-${TOURNAMENT_GROUP_SIZE} entries`);
    }
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const record = await this.locked(transaction, id, acting);
      revisionMatches(record, input.expectedRevision);
      notFinalized(record);
      const groups = await transaction.loadGroups(record.internalId);
      const group = groups.find((candidate) => candidate.groupId === input.groupId);
      if (group === undefined) { throw new TournamentOperationError("not_found", "group not found"); }
      const players = await transaction.resolvePlayers(input.characters.map((entry) => entry.playerId));
      const rows = input.characters.flatMap((entry) => {
        const player = players.get(playerId(entry.playerId));
        if (player === undefined) { return []; }
        const label = entry.characterLabel.trim();
        if (label.length === 0 || label.length > 64) { return []; }
        return [{
          playerInternalId: player.internalId,
          characterKey: entry.characterKey === undefined ? null : entry.characterKey.slice(0, 96),
          characterLabel: label,
          characterRoster: entry.characterRoster === undefined ? null : entry.characterRoster.trim().slice(0, 64),
        }];
      });
      const nowMs = this.dependencies.clock.nowMs();
      if (rows.length > 0) { await transaction.setGroupMemberCharacters(group.internalId, rows); }
      await transaction.updateTournament({
        internalId: record.internalId, revision: record.revision + 1, nowMs,
      });
      await transaction.appendLifecycle({
        tournamentInternalId: record.internalId, eventType: "characters_recorded",
        detail: `${group.name}: ${rows.length}`, actorInternalId: acting.internalId, nowMs,
      });
      return this.document(transaction, (await transaction.findTournament(id))!);
    }));
  }

  public async enterRaces(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    expectedRevision: number;
    groupId: string;
    races: readonly Readonly<{
      raceNumber?: number;
      trackId: string;
      mode?: TournamentRaceMode;
      mirror?: true;
      finishOrder: readonly string[];
    }>[];
    /** The character each Player drove, when the workbook named one. */
    characters?: readonly Readonly<{
      playerId: string;
      characterKey?: string;
      characterLabel: string;
      characterRoster?: string;
    }>[];
  }>): Promise<TournamentDocument> {
    if (input.races.length < 1 || input.races.length > TOURNAMENT_MAX_RACES_PER_GROUP) {
      invalid(`races must hold 1-${TOURNAMENT_MAX_RACES_PER_GROUP} entries`);
    }
    const actorAccountId = administrator(actor);
    const id = tournamentId(requestedTournamentId);
    const targetGroupId = groupId(input.groupId);
    const incoming = input.races.map((race, index) => {
      if (!trackIdPattern.test(race.trackId)) { invalid(`race ${index + 1}: trackId is invalid`); }
      if (race.mirror !== undefined && (race.mirror !== true || race.mode !== 150)) {
        invalid(`race ${index + 1}: a Mirror race is a 150cc race`);
      }
      const finishOrder = race.finishOrder.map(playerId);
      if (finishOrder.length < 2 || finishOrder.length > TOURNAMENT_GROUP_SIZE ||
        new Set(finishOrder).size !== finishOrder.length) {
        invalid(`race ${index + 1}: finishOrder must list 2-${TOURNAMENT_GROUP_SIZE} distinct Players`);
      }
      if (race.raceNumber !== undefined &&
        (!Number.isSafeInteger(race.raceNumber) || race.raceNumber < 1 ||
          race.raceNumber > TOURNAMENT_MAX_RACES_PER_GROUP)) {
        invalid(`race ${index + 1}: raceNumber is out of range`);
      }
      return { ...race, finishOrder };
    });
    const nowMs = this.dependencies.clock.nowMs();

    // Phase 1: read and plan once for the whole group. Entering the races one
    // by one made every race its own transaction *and* re-derived every later
    // race of the group, so a 32-race workbook cost 528 canonical submissions
    // and twelve seconds (measured 2026-09-16). One pass writes each race
    // once, and the group lands whole or not at all.
    const plan = await this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const record = await this.locked(transaction, id, acting);
      revisionMatches(record, input.expectedRevision);
      notFinalized(record);
      const groups = await transaction.loadGroups(record.internalId);
      const group = groups.find((candidate) => candidate.groupId === targetGroupId);
      if (group === undefined) { throw new TournamentOperationError("not_found", "group not found"); }
      const memberIds = new Set(group.members.map((member) => member.playerId));
      for (const [index, race] of incoming.entries()) {
        if (race.finishOrder.some((candidate) => !memberIds.has(candidate))) {
          invalid(`race ${index + 1}: every finisher must be a member of the group`);
        }
      }
      const existing = (await transaction.loadGroupRaces(record.internalId))
        .filter((race) => race.groupInternalId === group.internalId)
        .sort((left, right) => left.raceNumber - right.raceNumber);
      const characters = input.characters === undefined ? [] : await (async () => {
        const players = await transaction.resolvePlayers(input.characters!.map((entry) => entry.playerId));
        return input.characters!.flatMap((entry) => {
          const player = players.get(playerId(entry.playerId));
          const label = entry.characterLabel.trim();
          if (player === undefined || label.length === 0 || label.length > 64) { return []; }
          return [{
            playerInternalId: player.internalId,
            characterKey: entry.characterKey === undefined ? null : entry.characterKey.slice(0, 96),
            characterLabel: label,
            characterRoster: entry.characterRoster === undefined ? null : entry.characterRoster.trim().slice(0, 64),
          }];
        });
      })();
      return { director: acting.internalId, record, group, existing, characters };
    }));

    // The group's races after this import: what was there, with the incoming
    // ones written over it, in race order.
    const merged = new Map<number, Readonly<{
      raceNumber: number; trackId: string; mode: TournamentRaceMode | undefined; mirror: true | undefined;
      finishOrder: readonly string[]; counts: boolean; note: string | undefined;
      revision: number; changed: boolean;
    }>>();
    for (const race of plan.existing) {
      merged.set(race.raceNumber, {
        raceNumber: race.raceNumber, trackId: race.trackId, mode: race.mode ?? undefined,
        mirror: race.mirror ?? undefined,
        finishOrder: [...race.placements].sort((left, right) => left.finishPosition - right.finishPosition)
          .map((placement) => placement.playerId),
        counts: race.countsTowardStandings, note: undefined,
        revision: race.revision, changed: false,
      });
    }
    let next = plan.existing.length === 0 ? 1 : plan.existing[plan.existing.length - 1]!.raceNumber + 1;
    for (const race of incoming) {
      const raceNumber = race.raceNumber ?? next;
      if (raceNumber > TOURNAMENT_MAX_RACES_PER_GROUP) {
        throw new TournamentOperationError("conflict", "the group has reached its race limit");
      }
      const known = merged.get(raceNumber);
      merged.set(raceNumber, {
        raceNumber, trackId: race.trackId, mode: race.mode, mirror: race.mirror, finishOrder: race.finishOrder,
        counts: true, note: undefined, revision: known?.revision ?? 0, changed: true,
      });
      next = Math.max(next, raceNumber + 1);
    }
    const ordered = [...merged.values()].sort((left, right) => left.raceNumber - right.raceNumber);
    for (const [index, race] of ordered.entries()) {
      if (race.raceNumber !== index + 1) { invalid("races must be entered in order"); }
    }

    // Phase 2: one canonical document per race, from the first race this
    // import touches - everything before it keeps the totals it already had.
    const first = Math.min(...ordered.filter((race) => race.changed).map((race) => race.raceNumber));
    const totals = new Map<string, number>();
    const documents: TournamentRaceResultV1[] = [];
    for (const race of ordered) {
      if (race.raceNumber < first) {
        if (race.counts) {
          const points = plan.existing.find((entry) => entry.raceNumber === race.raceNumber)?.placements ?? [];
          for (const placement of points) {
            totals.set(placement.playerId, (totals.get(placement.playerId) ?? 0) + placement.racePoints);
          }
        }
        continue;
      }
      const document = buildRaceDocument({
        raceResultId: raceResultIdFor(targetGroupId, race.raceNumber),
        revision: race.revision + 1,
        raceNumber: race.raceNumber,
        trackId: race.trackId,
        ...(race.mode === undefined ? {} : { mode: race.mode }),
        ...(race.mirror === undefined ? {} : { mirror: race.mirror }),
        tournamentId: plan.record.tournamentId,
        groupId: targetGroupId,
        stage: plan.group.stage,
        groupName: plan.group.name,
        finishOrder: race.finishOrder,
        totalsBefore: new Map(totals),
        countsTowardStandings: race.counts,
        ...(race.counts ? {} : { scoringNote: "re-derived after an earlier correction" }),
        nowMs,
      });
      documents.push(document);
      if (race.counts) {
        for (const placement of document.placements) {
          totals.set(placement.participantReference.value, placement.scoring.totalAfterRace);
        }
      }
    }
    await checkRacesBeforeRecording(this.dependencies.raceResults, documents);
    const submitted: Readonly<{ raceResultId: string; revision: number; raceNumber: number }>[] = [];
    for (const document of documents) {
      try {
        const result = await this.dependencies.raceResults.submit(document);
        submitted.push({ ...result, raceNumber: document.raceNumber });
      } catch (error) {
        this.dependencies.operationalLog?.log({
          event: "tournament_race_submission_failed",
          category: "tournament",
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        throw new TournamentOperationError(
          "conflict",
          `race ${document.raceNumber} could not be recorded; reload the tournament and retry`,
        );
      }
    }

    // Phase 3: link them all, record the characters, and bump the revision once.
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const record = await this.locked(transaction, id);
      const known = new Set(plan.existing.map((race) => race.raceNumber));
      for (const entry of submitted) {
        const internalId = await transaction.findRaceResultInternalId(entry.raceResultId);
        if (internalId === null) { throw new TournamentOperationError("unavailable"); }
        await transaction.linkGroupRace({
          groupInternalId: plan.group.internalId,
          raceNumber: entry.raceNumber,
          raceResultInternalId: internalId,
          nowMs,
        });
      }
      if (!plan.group.locked) {
        await transaction.updateGroup({ groupInternalId: plan.group.internalId, locked: true, nowMs });
      }
      if (plan.characters.length > 0) {
        await transaction.setGroupMemberCharacters(plan.group.internalId, plan.characters);
      }
      await transaction.updateTournament({
        internalId: record.internalId, revision: record.revision + 1, nowMs,
        workflowStep: plan.group.stage === "qualifier" ? 5 : 9,
      });
      // One line per race, as before: an absent line is how an operator tells
      // that a call never reached the server.
      for (const entry of submitted) {
        await transaction.appendLifecycle({
          tournamentInternalId: record.internalId,
          eventType: known.has(entry.raceNumber) ? "race_corrected" : "race_entered",
          detail: `${plan.group.name} race ${entry.raceNumber}`,
          actorInternalId: plan.director,
          nowMs,
        });
      }
      if (plan.characters.length > 0) {
        await transaction.appendLifecycle({
          tournamentInternalId: record.internalId, eventType: "characters_recorded",
          detail: `${plan.group.name}: ${plan.characters.length}`,
          actorInternalId: plan.director, nowMs,
        });
      }
      return this.document(transaction, (await transaction.findTournament(id))!);
    }));
  }

  public async enterRace(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    expectedRevision: number;
    groupId: string;
    raceNumber?: number;
    trackId: string;
    mode?: TournamentRaceMode;
    mirror?: true;
    finishOrder: readonly string[];
    voided?: boolean;
    scoringNote?: string;
  }>): Promise<TournamentDocument> {
    const actorAccountId = administrator(actor);
    const id = tournamentId(requestedTournamentId);
    const targetGroupId = groupId(input.groupId);
    if (!trackIdPattern.test(input.trackId)) { invalid("trackId is invalid"); }
    if (input.mirror !== undefined && (input.mirror !== true || input.mode !== 150)) {
      invalid("a Mirror race is a 150cc race");
    }
    const finishOrder = input.finishOrder.map(playerId);
    if (finishOrder.length < 2 || finishOrder.length > TOURNAMENT_GROUP_SIZE ||
      new Set(finishOrder).size !== finishOrder.length) {
      invalid("finishOrder must list 2-12 distinct Players");
    }
    if (input.raceNumber !== undefined &&
      (!Number.isSafeInteger(input.raceNumber) || input.raceNumber < 1 ||
        input.raceNumber > TOURNAMENT_MAX_RACES_PER_GROUP)) {
      invalid("raceNumber is out of range");
    }
    const voided = input.voided === true;
    const scoringNote = input.scoringNote?.trim();
    if (voided && (scoringNote === undefined || scoringNote.length < 1 || scoringNote.length > 240)) {
      invalid("a voided race needs a short scoring note");
    }
    const nowMs = this.dependencies.clock.nowMs();

    // Phase 1: read and plan inside a transaction.
    const plan = await this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const director = acting.internalId;
      const record = await this.locked(transaction, id, acting);
      revisionMatches(record, input.expectedRevision);
      notFinalized(record);
      const groups = await transaction.loadGroups(record.internalId);
      const group = groups.find((candidate) => candidate.groupId === targetGroupId);
      if (group === undefined) { throw new TournamentOperationError("not_found", "group not found"); }
      const memberIds = new Set(group.members.map((member) => member.playerId));
      if (finishOrder.some((candidate) => !memberIds.has(candidate))) {
        invalid("every finisher must be a member of the group");
      }
      const races = (await transaction.loadGroupRaces(record.internalId))
        .filter((race) => race.groupInternalId === group.internalId)
        .sort((a, b) => a.raceNumber - b.raceNumber);
      const raceNumber = input.raceNumber ??
        (races.length === 0 ? 1 : races[races.length - 1]!.raceNumber + 1);
      if (raceNumber > TOURNAMENT_MAX_RACES_PER_GROUP) {
        throw new TournamentOperationError("conflict", "the group has reached its race limit");
      }
      if (input.raceNumber !== undefined && raceNumber > races.length + 1 &&
        !races.some((race) => race.raceNumber === raceNumber)) {
        invalid("races must be entered in order");
      }
      const existing = races.find((race) => race.raceNumber === raceNumber);
      const later = races.filter((race) => race.raceNumber > raceNumber);
      return {
        director, record, group, races, raceNumber, existing, later,
        raceResultInternalIds: new Map<string, number | null>(),
      };
    }));

    // Phase 2: submit the canonical documents (the platform boundary owns
    // its own transaction; identities are deterministic per race number).
    const documents: TournamentRaceResultV1[] = [];
    const totals = new Map<string, number>();
    for (const race of plan.races) {
      if (race.raceNumber >= plan.raceNumber) { break; }
      if (!race.countsTowardStandings) { continue; }
      for (const placement of race.placements) {
        totals.set(placement.playerId, (totals.get(placement.playerId) ?? 0) + placement.racePoints);
      }
    }
    const pushDocument = (
      raceNumber: number,
      revision: number,
      order: readonly string[],
      trackId: string,
      mode: TournamentRaceMode | undefined,
      mirror: true | undefined,
      counts: boolean,
      note: string | undefined,
    ): void => {
      const document = buildRaceDocument({
        raceResultId: raceResultIdFor(targetGroupId, raceNumber),
        revision,
        raceNumber,
        trackId,
        ...(mode === undefined ? {} : { mode }),
        ...(mirror === undefined ? {} : { mirror }),
        tournamentId: plan.record.tournamentId,
        groupId: targetGroupId,
        stage: plan.group.stage,
        groupName: plan.group.name,
        finishOrder: order,
        totalsBefore: new Map(totals),
        countsTowardStandings: counts,
        ...(note === undefined ? {} : { scoringNote: note }),
        nowMs,
      });
      documents.push(document);
      if (counts) {
        for (const placement of document.placements) {
          totals.set(
            placement.participantReference.value,
            placement.scoring.totalAfterRace,
          );
        }
      }
    };
    pushDocument(
      plan.raceNumber,
      (plan.existing?.revision ?? 0) + 1,
      finishOrder,
      input.trackId,
      input.mode,
      input.mirror,
      !voided,
      voided ? scoringNote : undefined,
    );
    for (const race of plan.later) {
      pushDocument(
        race.raceNumber,
        race.revision + 1,
        [...race.placements].sort((a, b) => a.finishPosition - b.finishPosition)
          .map((placement) => placement.playerId),
        race.trackId,
        race.mode ?? undefined,
        race.mirror ?? undefined,
        race.countsTowardStandings,
        race.countsTowardStandings ? undefined : "re-derived after an earlier correction",
      );
    }
    await checkRacesBeforeRecording(this.dependencies.raceResults, documents);
    const submitted: Readonly<{ raceResultId: string; revision: number; raceNumber: number }>[] = [];
    for (const document of documents) {
      try {
        const result = await this.dependencies.raceResults.submit(document);
        submitted.push({ ...result, raceNumber: document.raceNumber });
      } catch (error) {
        this.dependencies.operationalLog?.log({
          event: "tournament_race_submission_failed",
          category: "tournament",
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        throw new TournamentOperationError(
          "conflict",
          "the race could not be recorded; reload the tournament and retry",
        );
      }
    }

    // Phase 3: link the canonical results to the group and bump the revision.
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const record = await this.locked(transaction, id);
      for (const entry of submitted) {
        const internalId = await transaction.findRaceResultInternalId(entry.raceResultId);
        if (internalId === null) { throw new TournamentOperationError("unavailable"); }
        await transaction.linkGroupRace({
          groupInternalId: plan.group.internalId,
          raceNumber: entry.raceNumber,
          raceResultInternalId: internalId,
          nowMs,
        });
      }
      if (!plan.group.locked) {
        await transaction.updateGroup({ groupInternalId: plan.group.internalId, locked: true, nowMs });
      }
      await transaction.updateTournament({
        internalId: record.internalId, revision: record.revision + 1, nowMs,
        workflowStep: plan.group.stage === "qualifier" ? 5 : 9,
      });
      await transaction.appendLifecycle({
        tournamentInternalId: record.internalId,
        eventType: plan.existing === undefined ? "race_entered" : "race_corrected",
        detail: `${plan.group.name} race ${plan.raceNumber}${voided ? " (voided)" : ""}`,
        actorInternalId: plan.director,
        nowMs,
      });
      return this.document(transaction, (await transaction.findTournament(id))!);
    }));
  }

  // Attach already-imported canonical race results (ADR-0156 surface) to a
  // group: the operator imports a Processor/Live file, then binds its races
  // to the group they were raced in. Every placement must be a group member.
  public async attachRaces(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    expectedRevision: number;
    groupId: string;
    raceResultIds: readonly string[];
    occurredAtMs?: number;
    replaceExisting?: boolean;
  }>): Promise<TournamentDocument> {
    const actorAccountId = administrator(actor);
    const id = tournamentId(requestedTournamentId);
    const targetGroupId = groupId(input.groupId);
    if (input.raceResultIds.length < 1 || input.raceResultIds.length > TOURNAMENT_MAX_RACES_PER_GROUP) {
      invalid("attach 1-64 race results");
    }
    const nowMs = this.dependencies.clock.nowMs();
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const director = acting.internalId;
      const record = await this.locked(transaction, id, acting);
      revisionMatches(record, input.expectedRevision);
      notFinalized(record);
      const group = (await transaction.loadGroups(record.internalId))
        .find((candidate) => candidate.groupId === targetGroupId);
      if (group === undefined) { throw new TournamentOperationError("not_found", "group not found"); }
      const races = (await transaction.loadGroupRaces(record.internalId))
        .filter((race) => race.groupInternalId === group.internalId);
      const previousRaceCount = races.length;
      const previousMaximumRace = races.reduce((max, race) => Math.max(max, race.raceNumber), 0);
      if (input.replaceExisting) {
        if (previousRaceCount === 0) {
          throw new TournamentOperationError("conflict", "there are no existing races to replace");
        }
        if (input.raceResultIds.length < previousMaximumRace) {
          throw new TournamentOperationError(
            "conflict",
            "a replacement feed must cover every existing race slot",
          );
        }
        await transaction.clearGroupResults(group.internalId, nowMs);
      }
      let nextNumber = input.replaceExisting ? 1 : previousMaximumRace + 1;
      for (const raceResultId of input.raceResultIds) {
        const internalId = await transaction.findRaceResultInternalId(raceResultId);
        if (internalId === null) {
          throw new TournamentOperationError("not_found", `race result ${raceResultId} not found`);
        }
        if (nextNumber > TOURNAMENT_MAX_RACES_PER_GROUP) {
          throw new TournamentOperationError("conflict", "the group has reached its race limit");
        }
        await transaction.linkGroupRace({
          groupInternalId: group.internalId,
          raceNumber: nextNumber,
          raceResultInternalId: internalId,
          ...(input.occurredAtMs === undefined ? {} : { occurredAtMs: occurrenceTime(input.occurredAtMs) }),
          nowMs,
        });
        nextNumber += 1;
      }
      const attached = (await transaction.loadGroupRaces(record.internalId))
        .filter((race) => race.groupInternalId === group.internalId);
      const memberIds = new Set(group.members.map((member) => member.playerId));
      if (attached.some((race) => race.placements.some((placement) => !memberIds.has(placement.playerId)))) {
        throw new TournamentOperationError(
          "conflict", "an imported race lists a Player who is not a member of this group",
        );
      }
      await transaction.updateGroup({
        groupInternalId: group.internalId, locked: true, tieBreakOrders: [], nowMs,
      });
      await transaction.updateTournament({
        internalId: record.internalId, revision: record.revision + 1, nowMs,
        workflowStep: group.stage === "qualifier" ? 5 : 9,
      });
      await transaction.appendLifecycle({
        tournamentInternalId: record.internalId,
        eventType: input.replaceExisting ? "races_replaced" : "races_attached",
        detail: input.replaceExisting
          ? `${group.name}: ${previousRaceCount} -> ${input.raceResultIds.length}`
          : `${group.name}: ${input.raceResultIds.length}`,
        actorInternalId: director, nowMs,
      });
      return this.document(transaction, (await transaction.findTournament(id))!);
    }));
  }

  public async setManualScores(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    expectedRevision: number;
    groupId: string;
    segments: number;
    scores: readonly Readonly<{ playerId: string; segmentPoints: readonly (number | null)[] }>[];
  }>): Promise<TournamentDocument> {
    const actorAccountId = administrator(actor);
    const id = tournamentId(requestedTournamentId);
    const targetGroupId = groupId(input.groupId);
    if (!Number.isSafeInteger(input.segments) || input.segments < 1 ||
      input.segments > TOURNAMENT_MAX_SCORE_SEGMENTS) {
      invalid("segments must be 1-6");
    }
    const scores = input.scores.map((score) => ({
      playerId: playerId(score.playerId),
      segmentPoints: score.segmentPoints.slice(0, input.segments).map((points) => {
        if (points === null) { return null; }
        return Number.isSafeInteger(points) && points >= 0 && points <= 10_000
          ? points
          : invalid("points must be 0-10000");
      }),
    }));
    const nowMs = this.dependencies.clock.nowMs();
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const director = acting.internalId;
      const record = await this.locked(transaction, id, acting);
      revisionMatches(record, input.expectedRevision);
      notFinalized(record);
      const group = (await transaction.loadGroups(record.internalId))
        .find((candidate) => candidate.groupId === targetGroupId);
      if (group === undefined) { throw new TournamentOperationError("not_found", "group not found"); }
      const memberById = new Map(group.members.map((member) => [member.playerId, member] as const));
      if (scores.some((score) => !memberById.has(score.playerId))) {
        invalid("scores can only be entered for group members");
      }
      const players = await transaction.resolvePlayers(scores.map((score) => score.playerId));
      const rows: { playerInternalId: number; segmentNumber: number; points: number }[] = [];
      for (const score of scores) {
        const player = players.get(score.playerId);
        if (player === undefined) { throw new TournamentOperationError("not_found", "Player not found"); }
        for (const [index, points] of score.segmentPoints.entries()) {
          if (points === null) { continue; }
          rows.push({ playerInternalId: player.internalId, segmentNumber: index + 1, points });
        }
      }
      await transaction.replaceManualScores(group.internalId, rows, nowMs);
      await transaction.updateGroup({
        groupInternalId: group.internalId, manualScoreSegments: input.segments,
        tieBreakOrders: [], locked: true, nowMs,
      });
      await transaction.updateTournament({
        internalId: record.internalId, revision: record.revision + 1, nowMs,
      });
      await transaction.appendLifecycle({
        tournamentInternalId: record.internalId, eventType: "manual_scores_entered",
        detail: group.name, actorInternalId: director, nowMs,
      });
      return this.document(transaction, (await transaction.findTournament(id))!);
    }));
  }

  public async setTieBreakOrder(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    expectedRevision: number;
    groupId: string;
    points: number;
    playerIds: readonly string[];
  }>): Promise<TournamentDocument> {
    const actorAccountId = administrator(actor);
    const id = tournamentId(requestedTournamentId);
    const targetGroupId = groupId(input.groupId);
    if (!Number.isSafeInteger(input.points) || input.points < 0 || input.points > 60_000) {
      invalid("tie-break points must be 0-60000");
    }
    const orderedIds = input.playerIds.map(playerId);
    if (orderedIds.length < 2 || new Set(orderedIds).size !== orderedIds.length) {
      invalid("tie-break order needs at least two unique Players");
    }
    const nowMs = this.dependencies.clock.nowMs();
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const record = await this.locked(transaction, id, acting);
      revisionMatches(record, input.expectedRevision);
      notFinalized(record);
      const groups = await transaction.loadGroups(record.internalId);
      const group = groups.find((candidate) => candidate.groupId === targetGroupId);
      if (group === undefined) { throw new TournamentOperationError("not_found", "group not found"); }
      const mode = group.stage === "qualifier" ? record.qualifierTieBreakMode : record.finalTieBreakMode;
      if (mode !== "manual") {
        throw new TournamentOperationError("conflict", "select manual tie-break for this phase first");
      }
      const participants = await transaction.loadParticipants(record.internalId);
      const standings = computeStandings(
        group.members.map((member) => member.playerId),
        (await transaction.loadGroupRaces(record.internalId)).filter((race) => race.groupInternalId === group.internalId),
        manualScoresOf(await transaction.loadManualScores(record.internalId), group),
        group.manualScoreSegments,
        this.seedLookup(participants),
        { mode: "manual", orders: group.tieBreakOrders, lotteryKey: `${record.tournamentId}:${group.stage}:${group.groupId}` },
      );
      const tie = standings.tieGroups.find((candidate) => candidate.points === input.points);
      const expected = new Set(tie?.playerIds ?? []);
      if (tie === undefined || expected.size !== orderedIds.length || orderedIds.some((player) => !expected.has(player))) {
        throw new TournamentOperationError("conflict", "the equal-score group changed; reload and choose again");
      }
      const nextOrders = group.tieBreakOrders.filter((order) => order.points !== input.points)
        .concat({ points: input.points, playerIds: orderedIds });
      await transaction.updateGroup({ groupInternalId: group.internalId, tieBreakOrders: nextOrders, nowMs });
      await transaction.updateTournament({
        internalId: record.internalId, revision: record.revision + 1, nowMs,
      });
      await transaction.appendLifecycle({
        tournamentInternalId: record.internalId,
        eventType: "tie_break_resolved",
        detail: `${group.stage}:${group.groupId}:points=${input.points}`,
        actorInternalId: acting.internalId,
        nowMs,
      });
      return this.document(transaction, (await transaction.findTournament(id))!);
    }));
  }

  // -- finalization --------------------------------------------------------

  public async finalizationPreview(
    actor: ActorContext,
    requestedTournamentId: string,
  ): Promise<FinalizationPreview> {
    administrator(actor);
    const id = tournamentId(requestedTournamentId);
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const record = await transaction.findTournament(id);
      if (record === null) { throw new TournamentOperationError("not_found", "tournament not found"); }
      return this.preview(transaction, record);
    }));
  }

  public async finalize(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    expectedRevision: number;
    publicResults: boolean;
    affectsRating: boolean;
    reasonCode: string;
  }>): Promise<FinalizationResult> {
    const actorAccountId = administrator(actor);
    const id = tournamentId(requestedTournamentId);
    const reason = reasonCode(input.reasonCode);
    const nowMs = this.dependencies.clock.nowMs();

    // Phase 1: mark the tournament finalized with its chosen settings. The
    // publication and rating steps below are idempotent, so a failure after
    // this point is recoverable by calling finalize again.
    const planned = await this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const director = acting.internalId;
      const record = await this.locked(transaction, id, acting);
      if (record.stage === "finalized" && record.publicationId !== null) {
        throw new TournamentOperationError("conflict", "the tournament is already finalized");
      }
      if (record.stage !== "finalized") {
        revisionMatches(record, input.expectedRevision);
        if (record.workflowStep !== 10) {
          throw new TournamentOperationError("conflict", "review the final result in Step 10 before finalizing");
        }
        const preview = await this.preview(transaction, record);
        if (preview.presentCount < 1) {
          throw new TournamentOperationError("conflict", "a tournament needs at least one present participant");
        }
        if (preview.qualifierGroups === 0 && preview.finalGroups === 0) {
          throw new TournamentOperationError("conflict", "generate groups and enter results before finalizing");
        }
        if (preview.incompleteGroups > 0) {
          throw new TournamentOperationError("conflict", "every group needs complete results before finalizing");
        }
        // The rating graph and the statistics name a night by its edition
        // number and leave out a night without one; a public night gets its
        // number before it is pinned, not after somebody misses it.
        if (input.publicResults && record.editionNumber === null) {
          throw new TournamentOperationError("conflict", EDITION_NUMBER_REQUIRED);
        }
        await transaction.updateTournament({
          internalId: record.internalId,
          revision: record.revision + 1,
          nowMs,
          stage: "finalized",
          workflowStep: 10,
          finalizedAtMs: nowMs,
          publicResults: input.publicResults,
          affectsRating: input.affectsRating,
        });
        await transaction.appendLifecycle({
          tournamentInternalId: record.internalId,
          eventType: "finalized",
          detail: `public_results=${input.publicResults ? "on" : "off"} affects_rating=${input.affectsRating ? "on" : "off"}`,
          actorInternalId: director,
          nowMs,
        });
      }
      const races = await transaction.loadGroupRaces(record.internalId);
      const groups = await transaction.loadGroups(record.internalId);
      const ordered = orderedRaces(groups, races);
      const fresh = (await transaction.findTournament(id))!;
      return {
        director,
        record: fresh,
        targets: ordered.map((race) => ({ raceResultId: race.raceResultId, revision: race.revision })),
      };
    }));

    let publicationId = planned.record.publicationId ?? undefined;
    let rating: FinalizationResult["rating"];
    if (publicationId === undefined && planned.targets.length > 0) {
      // Phase 2: pin the result set as a publication (ADR-0147).
      try {
        const created = await this.dependencies.publications.createPublication(actor, {
          eventName: planned.record.name,
          targets: planned.targets.slice(0, 200),
          reasonCode: reason,
        });
        publicationId = created.publicationId;
      } catch (error) {
        this.dependencies.operationalLog?.log({
          event: "tournament_publication_failed",
          category: "tournament",
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        throw new TournamentOperationError(
          "conflict", "the result set could not be pinned; call finalize again to retry",
        );
      }
      await this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
        const record = await this.locked(transaction, id);
        const publicationInternalId = await transaction.findPublicationInternalId(publicationId!);
        if (publicationInternalId === null) { throw new TournamentOperationError("unavailable"); }
        if (!planned.record.publicResults) {
          await transaction.setPublicationVisibility(publicationInternalId, "hidden");
        }
        await transaction.updateTournament({
          internalId: record.internalId,
          revision: record.revision + 1,
          nowMs,
          publicationInternalId,
        });
        await transaction.appendLifecycle({
          tournamentInternalId: record.internalId,
          eventType: "results_pinned",
          detail: publicationId!,
          actorInternalId: planned.director,
          nowMs,
        });
      }));
      // Phase 3: rating decision before any application (ADR-0155). The
      // exclusion is appended first so an excluded tournament can never be
      // rated by the publish hook or a later apply; an included one applies
      // exactly once (guarded by the existing per-revision event check).
      if (!planned.record.affectsRating) {
        await this.dependencies.rating.recordDecision({
          administratorAccountId: actorAccountId,
          publicationPublicId: publicationId,
          ratingIncluded: false,
          reasonCode: reason,
        });
      }
    }
    if (publicationId !== undefined && planned.record.affectsRating) {
      try {
        const applied = await this.dependencies.rating.applyPublication(publicationId);
        rating = {
          appliedRaces: applied.appliedRaces,
          skippedRaces: applied.skippedRaces,
          alreadyApplied: applied.alreadyApplied,
        };
      } catch (error) {
        this.dependencies.operationalLog?.log({
          event: "tournament_rating_application_failed",
          category: "tournament",
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }
    const final = await this.guard(() => this.dependencies.repository.transaction(
      async (transaction) => (await transaction.findTournament(id))!,
    ));
    return {
      tournamentId: id,
      revision: final.revision,
      ...(publicationId === undefined ? {} : { publicationId }),
      publicResults: final.publicResults,
      affectsRating: final.affectsRating,
      ...(rating === undefined ? {} : { rating }),
    };
  }

  // After finalization the owner can still change whether results are shown
  // publicly; the operational data and the pinned publication are untouched.
  // Rating inclusion changes go through the audited rating decision and
  // recalculation boundary instead (ADR-0155).
  public async setResultsVisibility(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    expectedRevision: number;
    publicResults: boolean;
    reasonCode: string;
  }>): Promise<TournamentSummary> {
    const actorAccountId = administrator(actor);
    const id = tournamentId(requestedTournamentId);
    reasonCode(input.reasonCode);
    const nowMs = this.dependencies.clock.nowMs();
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const director = acting.internalId;
      const record = await this.locked(transaction, id, acting);
      revisionMatches(record, input.expectedRevision);
      if (record.stage !== "finalized") {
        throw new TournamentOperationError("conflict", "only a finalized tournament has public results");
      }
      if (record.publicationId !== null) {
        const publicationInternalId = await transaction.findPublicationInternalId(record.publicationId);
        if (publicationInternalId !== null) {
          await transaction.setPublicationVisibility(
            publicationInternalId, input.publicResults ? "public" : "hidden",
          );
        }
      }
      await transaction.updateTournament({
        internalId: record.internalId,
        revision: record.revision + 1,
        nowMs,
        publicResults: input.publicResults,
      });
      await transaction.appendLifecycle({
        tournamentInternalId: record.internalId,
        eventType: input.publicResults ? "results_published" : "results_hidden",
        detail: input.reasonCode,
        actorInternalId: director,
        nowMs,
      });
      return this.summaryOf(transaction, id);
    }));
  }

  // Operational incidents are durable audit facts, not a second scoring
  // engine. They therefore use the existing immutable lifecycle and revision
  // boundaries while leaving standings, publication and rating untouched.
  public async recordIncident(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    expectedRevision: number;
    category: "attendance" | "replacement" | "equipment" | "scoring" | "conduct" | "other";
    note: string;
    playerId?: string;
  }>): Promise<TournamentDocument> {
    const actorAccountId = administrator(actor);
    const id = tournamentId(requestedTournamentId);
    const categories = new Set(["attendance", "replacement", "equipment", "scoring", "conduct", "other"]);
    if (!categories.has(input.category)) { throw new TournamentOperationError("invalid_input", "incident category is invalid"); }
    const note = input.note.trim();
    if (note.length < 1 || note.length > 160 || note.includes("|")) {
      throw new TournamentOperationError("invalid_input", "incident note is invalid");
    }
    const relatedPlayerId = input.playerId === undefined ? undefined : playerId(input.playerId);
    const nowMs = this.dependencies.clock.nowMs();
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const director = acting.internalId;
      const record = await this.locked(transaction, id, acting);
      revisionMatches(record, input.expectedRevision);
      await transaction.updateTournament({
        internalId: record.internalId,
        revision: record.revision + 1,
        nowMs,
      });
      await transaction.appendLifecycle({
        tournamentInternalId: record.internalId,
        eventType: "incident_recorded",
        detail: `${input.category}|${relatedPlayerId ?? "tournament"}|${note}`,
        actorInternalId: director,
        nowMs,
      });
      return this.document(transaction, (await transaction.findTournament(id))!);
    }));
  }

  // A tournament created by mistake can be removed while it is a draft:
  // not finalized and without any canonical race attached. Anything with
  // races stays - canonical results are never deleted through the product.
  public async deleteDraft(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    expectedRevision: number;
  }>): Promise<void> {
    const actorAccountId = administrator(actor);
    const id = tournamentId(requestedTournamentId);
    return this.guard(() => this.dependencies.repository.transaction(async (transaction) => {
      const acting = await this.operator(transaction, actorAccountId);
      const record = await this.locked(transaction, id, acting);
      revisionMatches(record, input.expectedRevision);
      notFinalized(record);
      const races = await transaction.loadGroupRaces(record.internalId);
      if (races.length > 0) {
        throw new TournamentOperationError("conflict", "a tournament with recorded races cannot be deleted");
      }
      await transaction.deleteTournament(record.internalId);
    }));
  }

  // -- internals -----------------------------------------------------------

  private async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof TournamentOperationError) { throw error; }
      this.dependencies.operationalLog?.log({
        event: "tournament_operation_failed",
        category: "tournament",
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      throw new TournamentOperationError("unavailable");
    }
  }

  /**
   * ADR-0177 decisions 2 and 3: a director is an account that holds either an
   * administrator grant or the tournament.operation capability. The returned
   * internal id is the acting operator, not yet the Tournament's director.
   */
  private async operator(
    transaction: TournamentOperationTransaction,
    userAccountId: string,
  ): Promise<Readonly<{ internalId: number; isAdministrator: boolean }>> {
    const account = await transaction.findTournamentOperatorAccount(userAccountId);
    if (account === null) {
      throw new TournamentOperationError("forbidden", "an active Tournament operator grant is required");
    }
    return account;
  }

  /**
   * ADR-0177 decision 2: an operator reaches their own Tournaments; only an
   * administrator may act on behalf of another director.
   */
  private async directorFor(
    transaction: TournamentOperationTransaction,
    userAccountId: string,
    requestedDirectorUserAccountId?: string,
  ): Promise<number> {
    const acting = await this.operator(transaction, userAccountId);
    if (requestedDirectorUserAccountId === undefined ||
        requestedDirectorUserAccountId === userAccountId) {
      return acting.internalId;
    }
    if (!acting.isAdministrator) {
      throw new TournamentOperationError("forbidden", "only an administrator may act for another director");
    }
    const target = await transaction.findTournamentOperatorAccount(requestedDirectorUserAccountId);
    if (target === null) {
      throw new TournamentOperationError("forbidden", "the selected director has no Tournament operator grant");
    }
    return target.internalId;
  }

  private async locked(
    transaction: TournamentOperationTransaction,
    id: string,
    operator?: Readonly<{ internalId: number; isAdministrator: boolean }>,
  ): Promise<TournamentRecord> {
    const record = await transaction.findTournamentForUpdate(id);
    if (record === null) { throw new TournamentOperationError("not_found", "tournament not found"); }
    if (operator !== undefined &&
        !operator.isAdministrator &&
        record.directorInternalId !== operator.internalId) {
      throw new TournamentOperationError("forbidden", "this Tournament belongs to another director");
    }
    return record;
  }

  private async summaryOf(
    transaction: TournamentOperationTransaction,
    id: string,
  ): Promise<TournamentSummary> {
    const record = await transaction.findTournament(id);
    if (record === null) { throw new TournamentOperationError("unavailable"); }
    const participants = await transaction.loadParticipants(record.internalId);
    return summary(
      record,
      participants.length,
      participants.filter((participant) => participant.attendance === "present").length,
    );
  }

  /**
   * ADR-0221: the present Players as the draw should see them. The community
   * rating and random use the stored seeds (today's behaviour); "director's
   * nights" ranks by a rating replayed over this Director's own published
   * nights only (Players those nights never rated come last, by name); "by
   * hand" draws without any rating (by name), and the Director then arranges
   * the groups on the board.
   */
  private async drawParticipants(
    transaction: TournamentOperationTransaction,
    record: TournamentRecord,
    seeded: readonly ParticipantRecord[],
    present: readonly SeedParticipant[],
  ): Promise<readonly SeedParticipant[]> {
    const source = effectiveSeedingSource(record.seedOrder, record.seedingSource);
    if (source === "manual") {
      return present.map((participant) => ({ ...participant, seedRank: null, seedScore: null }));
    }
    if (source !== "director_nights" || transaction.loadDirectorNightRaces === undefined) { return present; }
    const ratings = directorNightRatings(
      await transaction.loadDirectorNightRaces(record.directorInternalId, record.internalId));
    const internalIds = new Map(seeded.map((participant) =>
      [participant.player.playerId, participant.player.internalId] as const));
    return present.map((participant) => {
      const internalId = internalIds.get(participant.playerId);
      const seed = internalId === undefined ? undefined : ratings.get(internalId);
      return { ...participant, seedRank: seed?.rank ?? null, seedScore: seed?.score ?? null };
    });
  }

  private seedLookup(participants: readonly ParticipantRecord[]) {
    const byId = new Map(participants.map((participant) => [participant.player.playerId, participant] as const));
    return (candidate: string) => {
      const participant = byId.get(candidate);
      return {
        seedScore: participant?.seedScore ?? null,
        seedRank: participant?.seedRank ?? null,
        displayName: participant?.player.displayName ?? candidate,
      };
    };
  }

  /**
   * The SP a roster shows before anybody has been drawn into a group.
   *
   * `seed_score` is captured once, when a Player is first added, and it is
   * meant to be the score the draw used - frozen so the draw stays
   * reproducible. But between adding somebody and drawing the groups the
   * ratings can be rebuilt underneath it (ADR-0189 did exactly that), and
   * Step 2 then showed months-old SP for a Tournament that had not started.
   *
   * So before the draw the live rating is shown, and `generateGroups` writes
   * those same live values down as it seeds. After that the stored value
   * stands, because it is then a record of what actually happened.
   */
  private async withLiveSeeds(
    transaction: TournamentOperationTransaction,
    participants: readonly ParticipantRecord[],
  ): Promise<readonly ParticipantRecord[]> {
    if (participants.length === 0) { return participants; }
    const snapshot = await transaction.ratingSnapshot(
      participants.map((participant) => participant.player.internalId));
    return participants.map((participant) => {
      const rating = snapshot.get(participant.player.internalId);
      if (rating === undefined) { return participant; }
      return { ...participant, seedScore: rating.score, seedRank: rating.rank };
    });
  }

  private async document(
    transaction: TournamentOperationTransaction,
    record: TournamentRecord,
  ): Promise<TournamentDocument> {
    const stored = await transaction.loadParticipants(record.internalId);
    const groups = await transaction.loadGroups(record.internalId);
    // Once a group exists the draw has been made and its seeds are history.
    const participants =
      tournamentSeedsAreDrawn(groups.length, record.stage === "finalized")
        ? stored
        : await this.withLiveSeeds(transaction, stored);
    const races = await transaction.loadGroupRaces(record.internalId);
    const manual = await transaction.loadManualScores(record.internalId);
    const lifecycle = await transaction.loadLifecycle(record.internalId, 40);
    const stationCables = await transaction.loadStationCables?.(
      participants.map((participant) => participant.player.playerId),
    ) ?? [];
    const cableOf = new Map(stationCables.map((station) =>
      [`${station.ownerPlayerId}:${station.switchType}`, station.cableNumber] as const));
    const nameOf = new Map(participants.map((participant) =>
      [participant.player.playerId, participant.player.displayName] as const));
    const displayName = (candidate: string): string => nameOf.get(candidate) ?? candidate;
    const seedLookup = this.seedLookup(participants);
    const groupViews: GroupView[] = groups.map((group) => {
      const groupRaces = races
        .filter((race) => race.groupInternalId === group.internalId)
        .sort((a, b) => a.raceNumber - b.raceNumber);
      const groupManual = manualScoresOf(manual, group);
      const standings = computeStandings(
        group.members.map((member) => member.playerId),
        groupRaces,
        groupManual,
        group.manualScoreSegments,
        seedLookup,
        {
          mode: group.stage === "qualifier" ? record.qualifierTieBreakMode : record.finalTieBreakMode,
          orders: group.tieBreakOrders,
          lotteryKey: `${record.tournamentId}:${group.stage}:${group.groupId}`,
        },
      );
      return {
        groupId: group.groupId,
        stage: group.stage,
        sequence: group.sequence,
        name: group.name,
        ...(group.tierKey === null ? {} : { tierKey: group.tierKey }),
        locked: group.locked,
        manualScoreSegments: group.manualScoreSegments,
        members: group.members.map((member) => ({
          playerId: member.playerId,
          displayName: displayName(member.playerId),
          seatOrder: member.seatOrder,
          ...(member.character === null ? {} : { character: {
            ...(member.character.key === null ? {} : { key: member.character.key }),
            label: member.character.label,
            ...(member.character.roster === null ? {} : { roster: member.character.roster }),
          } }),
          ...(member.station === null ? {} : {
            station: {
              ownerPlayerId: member.station.ownerPlayerId,
              ownerDisplayName: displayName(member.station.ownerPlayerId),
              switchType: member.station.switchType,
              seatNumber: member.station.seatNumber,
              ...(cableOf.get(`${member.station.ownerPlayerId}:${member.station.switchType}`) === undefined
                ? {}
                : { utpCableNumber: cableOf.get(`${member.station.ownerPlayerId}:${member.station.switchType}`)! }),
            },
          }),
        })),
        stations: (group.stations.length > 0
          ? group.stations
          : stationsFromSeats(group.members.map((member) => ({
            seatOrder: member.seatOrder,
            station: member.station === null ? null : { ownerPlayerId: member.station.ownerPlayerId, switchType: member.station.switchType },
          })))
        ).map((station) => ({
          slotIndex: station.slotIndex,
          ownerPlayerId: station.ownerPlayerId,
          ownerDisplayName: displayName(station.ownerPlayerId),
          switchType: station.switchType,
          ...(cableOf.get(`${station.ownerPlayerId}:${station.switchType}`) === undefined
            ? {}
            : { utpCableNumber: cableOf.get(`${station.ownerPlayerId}:${station.switchType}`)! }),
        })),
        races: groupRaces.map((race) => ({
          raceNumber: race.raceNumber,
          raceResultId: race.raceResultId,
          revision: race.revision,
          scoringSegment: race.scoringSegment,
          sourceKind: race.sourceKind,
          ...(race.scoringNote === null ? {} : { scoringNote: race.scoringNote }),
          trackId: race.trackId,
          ...(race.mode === null ? {} : { mode: race.mode }),
          ...(race.mirror === true ? { mirror: true as const } : {}),
          countsTowardStandings: race.countsTowardStandings,
          placements: [...race.placements]
            .sort((a, b) => a.finishPosition - b.finishPosition)
            .map((placement) => ({
              finishPosition: placement.finishPosition,
              playerId: placement.playerId,
              displayName: displayName(placement.playerId),
              racePoints: placement.racePoints,
            })),
        })),
        manualScores: groupManual,
        standings: {
          source: standings.source,
          rows: standings.rows.map((row) => ({ ...row, displayName: displayName(row.playerId) })),
          tieGroups: standings.tieGroups.map((tie) => ({
            points: tie.points,
            resolved: tie.resolved,
            players: tie.playerIds.map((playerId) => {
              const row = standings.rows.find((candidate) => candidate.playerId === playerId)!;
              return {
                playerId,
                displayName: displayName(playerId),
                wins: row.wins,
                bestRace: row.bestRace,
              };
            }),
          })),
        },
      };
    }).sort((a, b) => a.stage === b.stage
      ? a.sequence - b.sequence
      : (a.stage === "qualifier" ? -1 : 1));
    const finals = groupViews.filter((group) => group.stage === "final");
    const overallSource = finals.length > 0 ? finals : groupViews;
    const overall = overallPlacements(overallSource.map((group) => ({
      name: group.name,
      standings: group.standings.rows,
    }))).map((row) => ({ ...row, displayName: displayName(row.playerId) }));
    const present = participants.filter((participant) => participant.attendance === "present");
    const inactiveCutoffMs = tournamentInactiveRosterCutoffMs(
      await transaction.loadCompletedTournamentTimes(TOURNAMENT_ACTIVITY_WINDOW),
    );
    return {
      schemaVersion: "mk8dx.tournament-operation.v1",
      summary: summary(record, participants.length, present.length),
      participants: participants.map((participant) => ({
        playerId: participant.player.playerId,
        username: participant.player.username,
        displayName: participant.player.displayName,
        attendance: participant.attendance,
        hasSwitch1: participant.hasSwitch1,
        hasSwitch2: participant.hasSwitch2,
        // A Player who has never raced is Nieuw, never Inactief: no Tournament
        // has been played without them yet.
        isNew: participant.lastPresentAtMs === null || participant.lastPresentAtMs === 0,
        inactive: inactiveCutoffMs !== null &&
          participant.lastPresentAtMs !== null &&
          participant.lastPresentAtMs > 0 &&
          participant.lastPresentAtMs < inactiveCutoffMs,
        ...(participant.seedScore === null ? {} : { seedScore: participant.seedScore }),
        ...(participant.seedRank === null ? {} : { seedRank: participant.seedRank }),
      })),
      stations: stationsFrom(seedParticipants(participants, false)).map((station) => ({
        ownerPlayerId: station.ownerPlayerId,
        ownerDisplayName: displayName(station.ownerPlayerId),
        switchType: station.switchType,
        ...(cableOf.get(`${station.ownerPlayerId}:${station.switchType}`) === undefined
          ? {}
          : { utpCableNumber: cableOf.get(`${station.ownerPlayerId}:${station.switchType}`)! }),
      })),
      groups: groupViews,
      overall,
      lifecycle,
    };
  }

  private async preview(
    transaction: TournamentOperationTransaction,
    record: TournamentRecord,
  ): Promise<FinalizationPreview> {
    const document = await this.document(transaction, record);
    const qualifierGroups = document.groups.filter((group) => group.stage === "qualifier");
    const finalGroups = document.groups.filter((group) => group.stage === "final");
    const raceCount = document.groups.reduce((sum, group) => sum + group.races.length, 0);
    const rateableRaceCount = document.groups.reduce((sum, group) =>
      sum + group.races.filter((race) => race.countsTowardStandings && race.placements.length >= 2).length, 0);
    const manualOnlyGroups = document.groups.filter((group) => group.standings.source === "manual").length;
    const incompleteGroups = document.groups.filter((group) =>
      group.standings.source === "none" || group.standings.rows.some((row) => !row.complete) ||
      group.standings.tieGroups.some((tie) => !tie.resolved)).length;
    const warnings: string[] = [];
    if (incompleteGroups > 0) { warnings.push(`${incompleteGroups} group(s) have no complete results yet.`); }
    if (manualOnlyGroups > 0) {
      warnings.push(`${manualOnlyGroups} group(s) hold manual totals only; those groups cannot affect TrueSkill.`);
    }
    if (rateableRaceCount === 0 && record.affectsRating) {
      warnings.push("There are no canonical races, so finalizing cannot move any rating.");
    }
    if (finalGroups.length === 0 && qualifierGroups.length > 1) {
      warnings.push("No final groups were generated; the overall result follows the qualifier groups.");
    }
    if (record.editionNumber === null) { warnings.push(EDITION_NUMBER_MISSING); }
    return {
      schemaVersion: "mk8dx.tournament-finalization-preview.v1",
      tournamentId: record.tournamentId,
      name: record.name,
      revision: record.revision,
      presentCount: document.summary.presentCount,
      qualifierGroups: qualifierGroups.length,
      finalGroups: finalGroups.length,
      raceCount,
      rateableRaceCount,
      manualOnlyGroups,
      incompleteGroups,
      publicResults: record.publicResults,
      affectsRating: record.affectsRating,
      alreadyFinalized: record.stage === "finalized",
      warnings,
      overall: document.overall,
    };
  }
}

function seedingSourceInput(value: unknown): TournamentSeedingSource | undefined {
  if (value === undefined) { return undefined; }
  if (value !== "community_rating" && value !== "director_nights" && value !== "manual" && value !== "random") {
    invalid("seedingSource is community_rating, director_nights, manual or random");
  }
  return value as TournamentSeedingSource;
}

function optionalFlag(value: unknown, label: string): boolean | undefined {
  if (value === undefined) { return undefined; }
  if (typeof value !== "boolean") { invalid(`${label} must be true or false`); }
  return value as boolean;
}

/**
 * ADR-0221: the seeding source is the one field clients send. Storage keeps
 * `random` in seed_order and refines `ranked` with seeding_source (NULL = the
 * community rating).
 */
function seedingChange(
  source: TournamentSeedingSource | undefined,
): Readonly<{ seedOrder?: TournamentSeedOrder; seedingSource?: TournamentRankedSeedingSource | null }> {
  if (source === undefined) { return {}; }
  return source === "random"
    ? { seedOrder: "random", seedingSource: null }
    : { seedOrder: "ranked", seedingSource: source === "community_rating" ? null : source };
}

function summary(record: TournamentRecord, participantCount: number, presentCount: number): TournamentSummary {
  return {
    tournamentId: record.tournamentId,
    name: record.name,
    ...(record.seriesLabel == null ? {} : { seriesLabel: record.seriesLabel }),
    ...(record.editionNumber === null ? {} : { editionNumber: record.editionNumber }),
    ...(record.eventDate === null ? {} : { eventDate: record.eventDate }),
    ...(record.startAtMs == null ? {} : { startAtMs: record.startAtMs }),
    ...(record.timezone == null ? {} : { timezone: record.timezone }),
    stage: record.stage,
    workflowStep: record.workflowStep,
    qualifierRounds: record.qualifierRounds,
    ...(record.maxParticipants === null ? {} : { maxParticipants: record.maxParticipants }),
    seedingSource: effectiveSeedingSource(record.seedOrder, record.seedingSource),
    verifiedOnly: record.verifiedOnly === true,
    placementStrategy: record.placementStrategy,
    ownerSeatingMode: record.ownerSeatingMode,
    qualifierTieBreakMode: record.qualifierTieBreakMode,
    finalTieBreakMode: record.finalTieBreakMode,
    revision: record.revision,
    participantCount,
    presentCount,
    publicResults: record.publicResults,
    affectsRating: record.affectsRating,
    ...(record.publicationId === null ? {} : { publicationId: record.publicationId }),
    ...(record.finalizedAtMs === null ? {} : { finalizedAtMs: record.finalizedAtMs }),
    updatedAtMs: record.updatedAtMs,
  };
}

function manualScoresOf(
  manual: readonly ManualScoreRecord[],
  group: GroupRecord,
): readonly Readonly<{ playerId: string; segmentPoints: readonly (number | null)[] }>[] {
  const byPlayer = new Map<string, (number | null)[]>();
  for (const row of manual) {
    if (row.groupInternalId !== group.internalId) { continue; }
    const parts = byPlayer.get(row.playerId) ??
      Array.from({ length: group.manualScoreSegments }, () => null);
    if (row.segmentNumber >= 1 && row.segmentNumber <= group.manualScoreSegments) {
      parts[row.segmentNumber - 1] = row.points;
    }
    byPlayer.set(row.playerId, parts);
  }
  return [...byPlayer.entries()].map(([playerId, segmentPoints]) => ({ playerId, segmentPoints }));
}

// Publication member order: qualifier groups before final groups (recovered
// event ordering, ADR-0154), groups by sequence, races by number.
function orderedRaces(
  groups: readonly GroupRecord[],
  races: readonly GroupRaceRecord[],
): readonly GroupRaceRecord[] {
  const order = new Map(groups
    .slice()
    .sort((a, b) => a.stage === b.stage
      ? a.sequence - b.sequence
      : (a.stage === "qualifier" ? -1 : 1))
    .map((group, index) => [group.internalId, index] as const));
  return [...races].sort((a, b) => {
    const groupA = order.get(a.groupInternalId) ?? 0;
    const groupB = order.get(b.groupInternalId) ?? 0;
    return groupA !== groupB ? groupA - groupB : a.raceNumber - b.raceNumber;
  });
}
