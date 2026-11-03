// Canonical Tournament operation domain (ADR-0160): the pure rules recovered
// from the parked PHP Tournament Manager (apps/tournament-manager,
// src/RulesEngine.php + assets/app.js) and the extraction products, so a
// tournament night can be run inside the platform without SQL, developer
// tools or the legacy application.
//
// Everything in this module is deterministic and side-effect free; the
// service composes it with persistence, canonical race results, publication
// and rating.

import type { TournamentRaceResultV1 } from "./race-result-validation.js";
import { type TournamentRaceMode } from "./race-result-validation.js";

export const TOURNAMENT_GROUP_SIZE = 12;
/** Consoles per group: two seats each, so six carry a full group. */
export const TOURNAMENT_GROUP_SLOTS = 6;
export const TOURNAMENT_MAX_GROUPS = 5;
export const TOURNAMENT_MAX_PARTICIPANTS = 60;
/** Rows one roster import may carry: a full roster plus newcomers. */
export const TOURNAMENT_IMPORT_ROW_LIMIT = 200;
export const TOURNAMENT_SEATS_PER_STATION = 2;
export const TOURNAMENT_MAX_RACES_PER_GROUP = 64;
export const TOURNAMENT_MAX_SCORE_SEGMENTS = 6;

export type TournamentStage = "setup" | "qualifiers" | "finals" | "finalized";
export type TournamentGroupStage = "qualifier" | "final";
export type TournamentAttendance = "present" | "waiting" | "absent";
export type TournamentSeedOrder = "ranked" | "random";
export type TournamentPlacementStrategy = "balanced" | "minimal_move";

/**
 * ADR-0221: where the qualifier draw takes its order from. `community_rating`
 * is today's "ranked", `random` today's "random"; `director_nights` ranks by a
 * rating replayed over this Director's own published nights only, and `manual`
 * draws without any rating so the Director arranges the groups by hand.
 * Stored as `seed_order` (ranked/random, the draw's storage column since 0029)
 * plus a nullable `seeding_source` refining "ranked"; clients only see the source.
 */
export type TournamentSeedingSource = "community_rating" | "director_nights" | "manual" | "random";
export const TOURNAMENT_SEEDING_SOURCES: readonly TournamentSeedingSource[] =
  ["community_rating", "director_nights", "manual", "random"];
export type TournamentRankedSeedingSource = Exclude<TournamentSeedingSource, "random">;

/** The source a stored night uses: `random` lives in seed_order; NULL refines nothing. */
export function effectiveSeedingSource(
  seedOrder: TournamentSeedOrder,
  storedSource: TournamentRankedSeedingSource | null | undefined,
): TournamentSeedingSource {
  if (seedOrder === "random") { return "random"; }
  return storedSource ?? "community_rating";
}

/** The stored seed_order for a source (random or ranked). */
export function seedOrderForSource(source: TournamentSeedingSource): TournamentSeedOrder {
  return source === "random" ? "random" : "ranked";
}

/**
 * ADR-0177 decision 7, mirroring the source Manager's `ownerSeatingMode`.
 * Strict pins a Nintendo Switch owner into seat 1 of their own console;
 * soft lets the seating move them when that produces a better layout.
 */
export type TournamentOwnerSeatingMode = "owner_strict" | "owner_soft";
export type TournamentSwitchType = "ns1" | "ns2";

// Recovered final-group tiers (RulesEngine::buildDynamicTierDefinitions).
// The canonical names stay Dutch internally; the English web labels live in
// the web product (tournament-tiers.ts) keyed by `key`.
export type TournamentTierDefinition = Readonly<{
  key: "champion" | "talent" | "wild" | "adventure" | "feest";
  name: string;
}>;
export const TOURNAMENT_TIER_DEFINITIONS: readonly TournamentTierDefinition[] = [
  { key: "champion", name: "Kampioen" },
  { key: "talent", name: "Talent" },
  { key: "wild", name: "Wild" },
  { key: "adventure", name: "Avontuur" },
  { key: "feest", name: "Feest" },
];

// Race points by human participant count, recovered from the live product
// (apps/tournament-live/src/live_processor/baseline_consensus.py). Rows for
// 12..6 players are the recovered tables; 2..5 players fall back to N..1,
// which is not a recovered table and is labelled as such in the product.
export const RACE_POINTS_BY_PLAYER_COUNT: Readonly<Record<number, readonly number[]>> = {
  12: [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  11: [13, 11, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  10: [12, 10, 8, 7, 6, 5, 4, 3, 2, 1],
  9: [11, 9, 7, 6, 5, 4, 3, 2, 1],
  8: [10, 8, 6, 5, 4, 3, 2, 1],
  7: [9, 7, 5, 4, 3, 2, 1],
  6: [7, 5, 4, 3, 2, 1],
};

export function racePointsForPlayerCount(playerCount: number): readonly number[] {
  const recovered = RACE_POINTS_BY_PLAYER_COUNT[playerCount];
  if (recovered !== undefined) { return recovered; }
  if (playerCount >= 2 && playerCount <= 5) {
    return Array.from({ length: playerCount }, (_, index) => playerCount - index);
  }
  throw new RangeError("a race needs 2 to 12 participants");
}

export type SeedParticipant = Readonly<{
  playerId: string;
  displayName: string;
  seedRank: number | null;
  seedScore: number | null;
  hasSwitch1: boolean;
  hasSwitch2: boolean;
}>;

function ownsConsole(participant: SeedParticipant): boolean {
  return participant.hasSwitch1 || participant.hasSwitch2;
}

function consoleCount(participant: SeedParticipant): number {
  return (participant.hasSwitch1 ? 1 : 0) + (participant.hasSwitch2 ? 1 : 0);
}

export function qualifierGroupCount(presentCount: number): number {
  if (presentCount <= 0) { return 1; }
  return Math.max(1, Math.min(
    TOURNAMENT_MAX_GROUPS,
    Math.ceil(presentCount / TOURNAMENT_GROUP_SIZE),
  ));
}

export function qualifierGroupName(sequence: number): string {
  return `Groep ${sequence}`;
}

function byRank(a: SeedParticipant, b: SeedParticipant): number {
  const rankA = a.seedRank ?? Number.MAX_SAFE_INTEGER;
  const rankB = b.seedRank ?? Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) { return rankA - rankB; }
  const name = a.displayName.localeCompare(b.displayName, "en");
  return name !== 0 ? name : a.playerId.localeCompare(b.playerId, "en");
}

export type SeededGroup = Readonly<{
  name: string;
  members: readonly string[];
}>;

// Recovered from RulesEngine::buildQualifierPlan (strategy "balanced"):
// top-half anchors dealt round-robin with a cap on top-12 players per group,
// then the tail woven in while balancing console owners, then a fallback
// fill. "minimal_move" fills groups sequentially in rank order.
export function seedQualifierGroups(
  participants: readonly SeedParticipant[],
  options: Readonly<{
    strategy: TournamentPlacementStrategy;
    seedOrder: TournamentSeedOrder;
    random: () => number;
  }>,
): readonly SeededGroup[] {
  if (participants.length > TOURNAMENT_MAX_PARTICIPANTS) {
    throw new RangeError("too many present participants");
  }
  const groupCount = qualifierGroupCount(participants.length);
  const ordered = [...participants].sort(byRank);
  if (options.seedOrder === "random") {
    for (let index = ordered.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(options.random() * (index + 1));
      [ordered[index], ordered[swap]] = [ordered[swap]!, ordered[index]!];
    }
  }
  const groups: SeedParticipant[][] = Array.from({ length: groupCount }, () => []);
  if (options.strategy === "minimal_move") {
    for (const [index, participant] of ordered.entries()) {
      groups[Math.min(groupCount - 1, Math.floor(index / TOURNAMENT_GROUP_SIZE))]!
        .push(participant);
    }
    return groups.map((members, index) => ({
      name: qualifierGroupName(index + 1),
      members: members.map((member) => member.playerId),
    }));
  }
  const maxTopPerGroup = Math.ceil(TOURNAMENT_GROUP_SIZE / groupCount);
  const isTop = (participant: SeedParticipant): boolean =>
    participant.seedRank !== null && participant.seedRank <= TOURNAMENT_GROUP_SIZE;
  const topCount = (group: SeedParticipant[]): number =>
    group.filter(isTop).length;
  const consoles = (group: SeedParticipant[]): number =>
    group.reduce((sum, member) => sum + consoleCount(member), 0);
  const accepts = (group: SeedParticipant[], participant: SeedParticipant): boolean =>
    group.length < TOURNAMENT_GROUP_SIZE &&
    (!isTop(participant) || topCount(group) < maxTopPerGroup);

  const anchorCount = Math.ceil(ordered.length / 2);
  const anchors = ordered.slice(0, anchorCount);
  const tail = ordered.slice(anchorCount);
  const unplaced: SeedParticipant[] = [];
  for (const [index, anchor] of anchors.entries()) {
    let placed = false;
    for (let offset = 0; offset < groupCount; offset += 1) {
      const group = groups[(index + offset) % groupCount]!;
      if (accepts(group, anchor)) { group.push(anchor); placed = true; break; }
    }
    if (!placed) { unplaced.push(anchor); }
  }
  const remaining = [...tail];
  let cursor = 0;
  let guard = 0;
  while (remaining.length > 0 && guard < 5000) {
    guard += 1;
    const group = groups[cursor % groupCount]!;
    cursor += 1;
    if (group.length >= TOURNAMENT_GROUP_SIZE) {
      if (groups.every((candidate) => candidate.length >= TOURNAMENT_GROUP_SIZE)) { break; }
      continue;
    }
    const needsConsole = consoles(group) <
      Math.ceil(Math.min(TOURNAMENT_GROUP_SIZE, group.length + 1) / TOURNAMENT_SEATS_PER_STATION);
    let pick = remaining.findIndex((candidate) =>
      accepts(group, candidate) && (needsConsole ? ownsConsole(candidate) : !ownsConsole(candidate)));
    if (pick < 0) { pick = remaining.findIndex((candidate) => accepts(group, candidate)); }
    if (pick < 0) { continue; }
    group.push(remaining.splice(pick, 1)[0]!);
  }
  for (const participant of [...remaining, ...unplaced]) {
    const target = groups.find((group) => group.length < TOURNAMENT_GROUP_SIZE &&
      (!isTop(participant) || topCount(group) < maxTopPerGroup)) ??
      groups.find((group) => group.length < TOURNAMENT_GROUP_SIZE);
    if (target === undefined) { throw new RangeError("no group has room left"); }
    target.push(participant);
  }
  return groups.map((members, index) => ({
    name: qualifierGroupName(index + 1),
    members: [...members].sort(byRank).map((member) => member.playerId),
  }));
}

export type Station = Readonly<{
  ownerPlayerId: string;
  switchType: TournamentSwitchType;
}>;

export type SeatAssignment = Readonly<{
  playerId: string;
  seatOrder: number;
  station: Readonly<{
    ownerPlayerId: string;
    switchType: TournamentSwitchType;
    seatNumber: 1 | 2;
  }> | null;
}>;

export function stationsFrom(participants: readonly SeedParticipant[]): readonly Station[] {
  const stations: Station[] = [];
  for (const participant of [...participants].sort(byRank)) {
    if (participant.hasSwitch1) {
      stations.push({ ownerPlayerId: participant.playerId, switchType: "ns1" });
    }
    if (participant.hasSwitch2) {
      stations.push({ ownerPlayerId: participant.playerId, switchType: "ns2" });
    }
  }
  return stations;
}

// Recovered from RulesEngine::seedQualifierSeating and the final-group
// station assignment: a station follows its owner into the owner's group,
// surplus stations are pooled and dealt to groups that are short, the
// owner is pinned to seat 1 of their own station, and the rest fill seat 1
// then seat 2 in station order. Members beyond the seats available stay
// unseated so the shortage is visible instead of silently hidden.
export function assignSeating(
  groups: readonly (readonly string[])[],
  stations: readonly Station[],
  ownerSeatingMode: TournamentOwnerSeatingMode = "owner_strict",
): readonly (readonly SeatAssignment[])[] {
  const groupOf = new Map<string, number>();
  for (const [index, group] of groups.entries()) {
    for (const member of group) { groupOf.set(member, index); }
  }
  const assigned: Station[][] = groups.map(() => []);
  const pool: Station[] = [];
  for (const station of stations) {
    const index = groupOf.get(station.ownerPlayerId);
    if (index === undefined) { pool.push(station); continue; }
    const need = Math.ceil(groups[index]!.length / TOURNAMENT_SEATS_PER_STATION);
    if (assigned[index]!.length < need) {
      assigned[index]!.push(station);
    } else {
      pool.push(station);
    }
  }
  let guard = 0;
  while (pool.length > 0 && guard < 1000) {
    guard += 1;
    const index = assigned.findIndex((stationsOfGroup, groupIndex) =>
      stationsOfGroup.length <
        Math.ceil(groups[groupIndex]!.length / TOURNAMENT_SEATS_PER_STATION));
    if (index < 0) { break; }
    assigned[index]!.push(pool.shift()!);
  }
  return groups.map((group, index) => {
    const groupStations = assigned[index]!;
    const seats = new Map<string, SeatAssignment["station"]>();
    const seatTaken = new Set<string>();
    const key = (station: Station, seat: number): string =>
      `${station.ownerPlayerId}|${station.switchType}|${seat}`;
    // Strict seating claims the owner seat first; soft skips this so the
    // owner is filled in with everyone else.
    for (const station of ownerSeatingMode === "owner_strict" ? groupStations : []) {
      if (group.includes(station.ownerPlayerId) && !seats.has(station.ownerPlayerId)) {
        seats.set(station.ownerPlayerId, {
          ownerPlayerId: station.ownerPlayerId,
          switchType: station.switchType,
          seatNumber: 1,
        });
        seatTaken.add(key(station, 1));
      }
    }
    for (const seatNumber of [1, 2] as const) {
      for (const station of groupStations) {
        if (seatTaken.has(key(station, seatNumber))) { continue; }
        const member = group.find((candidate) => !seats.has(candidate));
        if (member === undefined) { break; }
        seats.set(member, {
          ownerPlayerId: station.ownerPlayerId,
          switchType: station.switchType,
          seatNumber,
        });
        seatTaken.add(key(station, seatNumber));
      }
    }
    return group.map((playerId, order) => ({
      playerId,
      seatOrder: order + 1,
      station: seats.get(playerId) ?? null,
    }));
  });
}

export type RaceForStandings = Readonly<{
  raceNumber: number;
  countsTowardStandings: boolean;
  placements: readonly Readonly<{
    playerId: string;
    finishPosition: number;
    racePoints: number;
  }>[];
}>;

export type ManualScore = Readonly<{
  playerId: string;
  segmentPoints: readonly (number | null)[];
}>;

export type StandingRow = Readonly<{
  rank: number;
  playerId: string;
  points: number;
  races: number;
  wins: number;
  bestRace: number;
  complete: boolean;
  /**
   * The Director entered this total by hand over the one the races add up to.
   *
   * A scored night is not always a correct one: a race gets missed, a capture
   * drops a lap, somebody is scored under the wrong name. The races stay
   * exactly as they were imported - the report, the charts and the rating all
   * still read them - and this says the standing was corrected, and by how
   * much, rather than quietly disagreeing with the races underneath it.
   */
  correctedFromRaces?: number;
}>;

export type StandingsResult = Readonly<{
  /** `races` even when some rows were corrected; the races are still the source. */
  source: "races" | "manual" | "none";
  rows: readonly StandingRow[];
  tieGroups: readonly TournamentTieGroup[];
}>;

export type SeedLookup = (playerId: string) => Readonly<{
  seedScore: number | null;
  seedRank: number | null;
  displayName: string;
}>;

export type TournamentTieBreakMode = "sp" | "lottery" | "manual";

export type TournamentTieBreakOrder = Readonly<{
  points: number;
  playerIds: readonly string[];
}>;

export type TournamentTieGroup = Readonly<{
  points: number;
  playerIds: readonly string[];
  resolved: boolean;
}>;

export type TournamentTieBreakPolicy = Readonly<{
  mode: TournamentTieBreakMode;
  orders?: readonly TournamentTieBreakOrder[];
  /** Stable per Tournament, phase and group; never regenerated on refresh. */
  lotteryKey?: string;
}>;

function stableTieRoll(key: string, playerId: string): number {
  // FNV-1a gives a compact deterministic lottery without storing mutable RNG
  // state. The public Tournament/group identity makes the draw stable and
  // auditable while a different Tournament receives a different draw.
  let hash = 0x811c9dc5;
  for (const character of `${key}:${playerId}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// Recovered tie-break ladder (RulesEngine::computeQualifierResults), with
// the reserved `wins` slot now meaningful because races are canonical:
// total desc, wins desc, best race desc, seed score desc, seed rank asc,
// then a deterministic name/id order.
export function computeStandings(
  members: readonly string[],
  races: readonly RaceForStandings[],
  manual: readonly ManualScore[],
  segments: number,
  seed: SeedLookup,
  tieBreak: TournamentTieBreakPolicy = { mode: "sp" },
): StandingsResult {
  const counted = races.filter((race) => race.countsTowardStandings);
  let source: StandingsResult["source"] = "none";
  const rows = new Map<string, {
    points: number; races: number; wins: number; bestRace: number; complete: boolean;
    correctedFromRaces?: number;
  }>();
  for (const member of members) {
    rows.set(member, { points: 0, races: 0, wins: 0, bestRace: 0, complete: false });
  }
  if (counted.length > 0) {
    source = "races";
    for (const race of counted) {
      for (const placement of race.placements) {
        const row = rows.get(placement.playerId);
        if (row === undefined) { continue; }
        row.points += placement.racePoints;
        row.races += 1;
        row.complete = true;
        if (placement.finishPosition === 1) { row.wins += 1; }
        row.bestRace = Math.max(row.bestRace, placement.racePoints);
      }
    }
    // A total entered by hand after the races were imported is a correction,
    // and the Director's correction is what the standing uses. The race total
    // it replaces travels with the row so the page can say so; a total equal
    // to the races is not a correction at all.
    for (const score of manual) {
      const row = rows.get(score.playerId);
      if (row === undefined) { continue; }
      const parts = score.segmentPoints.slice(0, segments);
      if (parts.length === 0 || parts.some((part) => part === null)) { continue; }
      const corrected = parts.reduce<number>((sum, part) => sum + (part ?? 0), 0);
      if (corrected === row.points) { continue; }
      row.correctedFromRaces = row.points;
      row.points = corrected;
    }
  } else if (manual.length > 0) {
    source = "manual";
    for (const score of manual) {
      const row = rows.get(score.playerId);
      if (row === undefined) { continue; }
      const parts = score.segmentPoints.slice(0, segments);
      const complete = parts.length === segments &&
        parts.every((part) => part !== null);
      row.points = parts.reduce<number>((sum, part) => sum + (part ?? 0), 0);
      row.races = 0;
      row.complete = complete;
    }
  }
  const manualOrders = new Map((tieBreak.orders ?? []).map((order) => [order.points, order.playerIds] as const));
  const validManualOrder = (points: number, tiedIds: readonly string[]): readonly string[] | null => {
    const saved = manualOrders.get(points);
    if (saved === undefined || saved.length !== tiedIds.length) { return null; }
    const expected = new Set(tiedIds);
    return new Set(saved).size === saved.length && saved.every((id) => expected.has(id)) ? saved : null;
  };
  const completeTieIds = new Map<number, string[]>();
  for (const [playerId, row] of rows) {
    if (!row.complete) { continue; }
    const bucket = completeTieIds.get(row.points) ?? [];
    bucket.push(playerId);
    completeTieIds.set(row.points, bucket);
  }
  const compareTie = (idA: string, idB: string, points: number): number => {
    if (tieBreak.mode === "manual") {
      const tiedIds = completeTieIds.get(points) ?? [];
      const order = validManualOrder(points, tiedIds);
      if (order !== null) { return order.indexOf(idA) - order.indexOf(idB); }
    } else if (tieBreak.mode === "lottery") {
      const key = tieBreak.lotteryKey ?? "mk8dx-tournament-tie";
      const rollA = stableTieRoll(key, idA);
      const rollB = stableTieRoll(key, idB);
      if (rollA !== rollB) { return rollA - rollB; }
    } else {
      const seedA = seed(idA);
      const seedB = seed(idB);
      const scoreA = seedA.seedScore ?? Number.NEGATIVE_INFINITY;
      const scoreB = seedB.seedScore ?? Number.NEGATIVE_INFINITY;
      if (scoreA !== scoreB) { return scoreB - scoreA; }
      const rankA = seedA.seedRank ?? Number.MAX_SAFE_INTEGER;
      const rankB = seedB.seedRank ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) { return rankA - rankB; }
    }
    const name = seed(idA).displayName.localeCompare(seed(idB).displayName, "en");
    return name !== 0 ? name : idA.localeCompare(idB, "en");
  };
  const ordered = [...rows.entries()].sort(([idA, a], [idB, b]) => {
    if (a.points !== b.points) { return b.points - a.points; }
    // Wins and best race remain evidence shown to the director, but the owner-
    // selected phase policy is the actual decision for an equal final score.
    return compareTie(idA, idB, a.points);
  });
  const tieGroups: TournamentTieGroup[] = [...completeTieIds.entries()]
    .filter(([, playerIds]) => playerIds.length > 1)
    .sort(([left], [right]) => right - left)
    .map(([points, playerIds]) => ({
      points,
      playerIds: [...playerIds].sort((a, b) => compareTie(a, b, points)),
      resolved: tieBreak.mode !== "manual" || validManualOrder(points, playerIds) !== null,
    }));
  return {
    source,
    rows: ordered.map(([playerId, row], index) => ({
      rank: index + 1,
      playerId,
      points: row.points,
      races: row.races,
      wins: row.wins,
      bestRace: row.bestRace,
      complete: row.complete,
      ...(row.correctedFromRaces === undefined ? {} : { correctedFromRaces: row.correctedFromRaces }),
    })),
    tieGroups,
  };
}

// Recovered from RulesEngine::computeTiers: one final group per qualifier
// group; every qualifier group is sliced horizontally into as-equal-as-
// possible bands (the first `size % tierCount` bands get one extra seat),
// and a player's band follows their standing inside their own group. Inside
// a band players are ordered by standing, then points, then seed.
export function computeFinalGroups(
  qualifierGroups: readonly Readonly<{
    name: string;
    standings: readonly StandingRow[];
  }>[],
  seed: SeedLookup,
): readonly Readonly<{
  tier: TournamentTierDefinition;
  members: readonly string[];
}>[] {
  const tierCount = Math.max(1, Math.min(qualifierGroups.length, TOURNAMENT_MAX_GROUPS));
  const tiers = TOURNAMENT_TIER_DEFINITIONS.slice(0, tierCount);
  const buckets: { playerId: string; standing: number; points: number; groupIndex: number }[][] =
    tiers.map(() => []);
  for (const [groupIndex, group] of qualifierGroups.entries()) {
    if (group.standings.some((row) => !row.complete)) {
      throw new RangeError(`group ${group.name} has incomplete results`);
    }
    const size = group.standings.length;
    const base = Math.floor(size / tierCount);
    const extra = size % tierCount;
    const slots = tiers.map((_, index) => base + (index < extra ? 1 : 0));
    let cursor = 0;
    for (const [tierIndex, slotCount] of slots.entries()) {
      for (let seat = 0; seat < slotCount; seat += 1) {
        const row = group.standings[cursor];
        cursor += 1;
        if (row === undefined) { break; }
        buckets[tierIndex]!.push({
          playerId: row.playerId,
          standing: row.rank,
          points: row.points,
          groupIndex,
        });
      }
    }
  }
  return tiers.map((tier, index) => ({
    tier,
    members: buckets[index]!.sort((a, b) => {
      if (a.standing !== b.standing) { return a.standing - b.standing; }
      if (a.points !== b.points) { return b.points - a.points; }
      const seedA = seed(a.playerId);
      const seedB = seed(b.playerId);
      const scoreA = seedA.seedScore ?? Number.NEGATIVE_INFINITY;
      const scoreB = seedB.seedScore ?? Number.NEGATIVE_INFINITY;
      if (scoreA !== scoreB) { return scoreB - scoreA; }
      if (a.groupIndex !== b.groupIndex) { return a.groupIndex - b.groupIndex; }
      return a.playerId.localeCompare(b.playerId, "en");
    }).map((entry) => entry.playerId),
  }));
}

export type OverallPlacement = Readonly<{
  placement: number;
  playerId: string;
  groupName: string;
  groupRank: number;
  points: number;
}>;

// Overall tournament result: final groups in tier order (Kampioen first),
// each group's standings in rank order, so the overall placement matches
// the recovered "overall placement across division tiers" presentation.
export function overallPlacements(
  groups: readonly Readonly<{ name: string; standings: readonly StandingRow[] }>[],
): readonly OverallPlacement[] {
  const placements: OverallPlacement[] = [];
  for (const group of groups) {
    for (const row of group.standings) {
      placements.push({
        placement: placements.length + 1,
        playerId: row.playerId,
        groupName: group.name,
        groupRank: row.rank,
        points: row.points,
      });
    }
  }
  return placements;
}

export type RaceDocumentInput = Readonly<{
  raceResultId: string;
  revision: number;
  raceNumber: number;
  trackId: string;
  mode?: TournamentRaceMode;
  mirror?: true;
  tournamentId: string;
  groupId: string;
  stage: TournamentGroupStage;
  groupName: string;
  finishOrder: readonly string[];
  totalsBefore: ReadonlyMap<string, number>;
  countsTowardStandings: boolean;
  scoringNote?: string;
  nowMs: number;
}>;

// Builds the canonical TournamentRaceResultV1 for an operator-entered race.
// Points follow the recovered table for the race's participant count; the
// running totals are the group's counted totals before this race, and the
// rank after the race is the competition rank among this race's
// participants, exactly as the V1 validator requires.
export function buildRaceDocument(input: RaceDocumentInput): TournamentRaceResultV1 {
  const points = racePointsForPlayerCount(input.finishOrder.length);
  const totalsAfter = input.finishOrder.map((playerId, index) => {
    const before = input.totalsBefore.get(playerId) ?? 0;
    const earned = input.countsTowardStandings ? points[index]! : 0;
    return { playerId, before, earned, after: before + earned };
  });
  const sortedTotals = [...totalsAfter.map((entry) => entry.after)].sort((a, b) => b - a);
  const rankAfter = (total: number): number => sortedTotals.indexOf(total) + 1;
  return {
    schemaVersion: "mk8dx.tournament-race-result.v1",
    raceResultId: input.raceResultId,
    revision: input.revision,
    raceNumber: input.raceNumber,
    scoringSegment: 1,
    ...(input.mode === undefined ? {} : { mode: input.mode }),
    ...(input.mirror === true && input.mode === 150 ? { mirror: true as const } : {}),
    trackId: input.trackId,
    countsTowardStandings: input.countsTowardStandings,
    ...(input.scoringNote === undefined ? {} : { scoringNote: input.scoringNote }),
    context: {
      tournamentReference: { namespace: "tournament", value: input.tournamentId },
      stageReference: { namespace: "tournament_stage", value: input.stage },
      groupReference: { namespace: "tournament_group", value: input.groupId },
      observedStageLabel: input.stage === "qualifier" ? "Qualifiers" : "Finals",
      observedGroupLabel: input.groupName,
    },
    placements: totalsAfter.map((entry, index) => ({
      finishPosition: index + 1,
      participantReference: { namespace: "player", value: entry.playerId },
      scoring: {
        racePoints: points[index]!,
        totalBeforeRace: entry.before,
        totalAfterRace: entry.after,
        rankAfterRace: rankAfter(entry.after),
      },
    })),
    source: {
      kind: "tournament_manual_entry",
      transport: "web_form",
      producerVersion: "mk8dx-web-tournament-operation.v1",
    },
    timestamps: { createdAtMs: input.nowMs, occurredAtMs: input.nowMs },
    verification: { status: "not_checked" },
  };
}

// Deterministic race result identity per (group, race number): a correction
// of the same race is a new revision of the same canonical result, never a
// second result, and a retried entry cannot duplicate a race.
export function raceResultIdFor(groupId: string, raceNumber: number): string {
  const suffix = groupId.replace(/^tournament_group\./, "");
  return `tournament_race_result.${suffix}_r${String(raceNumber).padStart(2, "0")}`;
}
