// The community's own past Tournaments, published.
//
// TN4-TN12 were run on the source Manager and live in the corrected history
// (the 0057 tables built from the frozen legacy race tables plus the owner's
// corrections). The canonical operation records only know the events run
// since the migration. A visitor opening Tournaments saw nothing of the years
// before, and a picture of TN12's final could not be made.
//
// These editions are projected, not re-entered. Re-creating them as canonical
// operation records would count every race twice - the standing already
// counts the corrected history beside the canonical placements, and the
// rating already carries the legacy placements - and every race would need a
// track the legacy tables never recorded. So the public list and detail serve
// them straight from the history tables, in the same public event shape a
// finalized canonical Tournament has: groups with standings and races, an
// overall result, and a seating the pictures can draw. Nothing is written.
//
// What the history does not know is stated rather than invented: a race whose
// track was never written down carries none; nobody recorded who brought which
// Switch, so the seating pairs the members of a group in the order they
// finished, the first of each pair the console's owner. That is enough for
// the layout picture and honest about what it is.

import type { Pool, RowDataPacket } from "mysql2/promise";

import { racePointsForPlayerCount } from "./tournament-operation-domain.js";
import type {
  PublicTournamentEvent,
  PublicTournamentEventSummary,
} from "./tournament-operation-service.js";

/**
 * The editions the owner asked for; the code takes any number the history
 * holds. TN4 joined once the community's own round reports gave every one of
 * its races a track. TN5 and TN6 had no such report - they joined when the
 * operator's own Processor workbooks turned up, whose INPUT sheet names the
 * track of every race and whose results sheet proved, race for race, that it
 * is the same night the history already recorded.
 */
export const HISTORY_EDITION_NUMBERS: readonly number[] = [4, 5, 6, 7, 8, 9, 10, 11, 12];

export const HISTORY_EDITION_ID_PREFIX = "tournament.history-tn";

export function historyEditionId(editionNumber: number): string {
  return `${HISTORY_EDITION_ID_PREFIX}${editionNumber}`;
}

/** The edition number behind a projected id, or null for any other id. */
export function historyEditionNumber(tournamentId: string): number | null {
  const match = /^tournament\.history-tn(\d{1,3})$/u.exec(tournamentId);
  if (match === null) { return null; }
  const number = Number(match[1]);
  return Number.isSafeInteger(number) && number >= 1 ? number : null;
}

export interface HistoryEditionSource {
  listEditions(): Promise<readonly PublicTournamentEventSummary[]>;
  loadEdition(editionNumber: number): Promise<PublicTournamentEvent | null>;
}

export type HistoryEditionInput = Readonly<{
  editionNumber: number;
  eventDate: string | null;
  heldAtMs: number | null;
  sections: readonly Readonly<{
    id: number;
    stage: "qualifier" | "final";
    sequence: number;
    tierKey: string | null;
    displayName: string;
  }>[];
  races: readonly Readonly<{
    id: number;
    sectionId: number;
    raceIndex: number;
    countsTowardRating: boolean;
    trackId: string | null;
  }>[];
  placements: readonly Readonly<{
    raceId: number;
    playerInternalId: number;
    finishPosition: number;
    /** What the record itself says this finish scored, where it says so. */
    racePoints?: number | null;
  }>[];
  players: ReadonlyMap<number, Readonly<{
    playerId: string;
    displayName: string;
    isPublic: boolean;
  }>>;
  /**
   * The SP rank every Player held when the edition started - their rating
   * after the last race before that night, ranked over everyone rated then.
   * A Player with no rating yet is new that night and has no rank.
   *
   * The rating ledger begins at TN4 (2023-05-19): TN1-TN3 were played but
   * their races never reached the corrected history, so they produced no
   * rating events. TN4 is therefore the one edition where nobody carries an SP
   * into the night - measured on production 2026-09-08, 0 of its 16 racers,
   * against 15 of 20 for TN5 and 24 of 24 for TN7. If TN1-TN3 ever turn up,
   * nothing here changes: the seeds are read from the events before the night,
   * not pinned to an edition.
   */
  seeds?: ReadonlyMap<number, Readonly<{ rank: number; score: number }>>;
  /**
   * The character a Player drove in a section, keyed `<sectionId>:<playerId>`.
   * The recorded history keeps it per placement; this is the one they used
   * most in that group, which is what the community's report prints.
   */
  characters?: ReadonlyMap<string, string>;
}>;

/** The starting ranks of an edition, from the rating events before its night. */
export function historyEditionSeeds(
  ratedBefore: readonly Readonly<{ playerInternalId: number; score: number }>[],
): ReadonlyMap<number, Readonly<{ rank: number; score: number }>> {
  const ordered = [...ratedBefore].sort((left, right) => right.score - left.score || left.playerInternalId - right.playerInternalId);
  return new Map(ordered.map((entry, index) => [entry.playerInternalId, { rank: index + 1, score: Math.round(entry.score * 100) / 100 }]));
}

type Standing = {
  playerInternalId: number;
  points: number;
  races: number;
  wins: number;
};

/** The public event for one edition, from what the history holds. */
export function buildHistoryEdition(input: HistoryEditionInput): PublicTournamentEvent {
  const tournamentId = historyEditionId(input.editionNumber);
  const player = (internalId: number): Readonly<{ playerId?: string; displayName: string }> => {
    const known = input.players.get(internalId);
    if (known === undefined) { return { displayName: `Speler ${internalId}` }; }
    return known.isPublic ? { playerId: known.playerId, displayName: known.displayName } : { displayName: known.displayName };
  };
  const seed = (internalId: number): Readonly<{ seedRank?: number; seedScore?: number }> => {
    const known = input.seeds?.get(internalId);
    return known === undefined ? {} : { seedRank: known.rank, seedScore: known.score };
  };
  /** `character.tanooki_mario` reads as "Tanooki Mario" for anyone without the catalog. */
  const characterLabel = (key: string): string => {
    // A workbook writes "Mii" and nothing more: the recording cannot tell the
    // weight class, so the picture is the medium one and the name stays "Mii".
    if (key.startsWith("character.mii")) { return "Mii"; }
    return key.replace(/^character\./u, "").split("_")
      .map((word) => word.length === 0 ? word : `${word[0]!.toUpperCase()}${word.slice(1)}`).join(" ");
  };
  const character = (sectionId: number, internalId: number): Readonly<{ character?: { key: string; label: string } }> => {
    // The group's own record first; failing that, the character this Player
    // drove elsewhere on the same night. A group whose rows carry none is a
    // gap in the recording, not evidence that they drove nobody.
    const key = input.characters?.get(`${sectionId}:${internalId}`) ?? input.characters?.get(`${internalId}`);
    return key === undefined ? {} : { character: { key, label: characterLabel(key) } };
  };
  const collator = new Intl.Collator("nl");
  const everyone = new Set<number>();

  const groups = [...input.sections]
    .sort((left, right) => (left.stage === right.stage
      ? left.sequence - right.sequence
      : left.stage === "qualifier" ? -1 : 1))
    .map((section) => {
      const races = input.races
        .filter((race) => race.sectionId === section.id)
        .sort((left, right) => left.raceIndex - right.raceIndex)
        .map((race) => {
          const placements = input.placements
            .filter((placement) => placement.raceId === race.id)
            .sort((left, right) => left.finishPosition - right.finishPosition);
          // A race scores on its own size: ten racers is not the twelve-Player
          // table. Where the record kept the points it scored, they are the
          // truth and the table is not consulted at all.
          const points = racePointsForPlayerCount(Math.min(12, Math.max(2, placements.length)));
          return {
            raceNumber: race.raceIndex,
            ...(race.trackId === null ? {} : { trackId: race.trackId }),
            countsTowardStandings: race.countsTowardRating,
            placements: placements.map((placement) => ({
              finishPosition: placement.finishPosition,
              ...player(placement.playerInternalId),
              racePoints: placement.racePoints ?? points[placement.finishPosition - 1] ?? 0,
              playerInternalId: placement.playerInternalId,
            })),
          };
        });
      const standings = new Map<number, Standing>();
      for (const race of races) {
        for (const placement of race.placements) {
          everyone.add(placement.playerInternalId);
          const row = standings.get(placement.playerInternalId) ??
            { playerInternalId: placement.playerInternalId, points: 0, races: 0, wins: 0 };
          row.races += 1;
          if (race.countsTowardStandings) {
            row.points += placement.racePoints;
            if (placement.finishPosition === 1) { row.wins += 1; }
          }
          standings.set(placement.playerInternalId, row);
        }
      }
      const ranked = [...standings.values()].sort((left, right) =>
        right.points - left.points || right.wins - left.wins ||
        collator.compare(player(left.playerInternalId).displayName, player(right.playerInternalId).displayName));
      // Nobody wrote down who brought which Switch: the members pair up in
      // finishing order, the first of each pair owning the console.
      const seating = ranked.map((row, index) => {
        const owner = ranked[index - (index % 2)]!;
        return {
          ...player(row.playerInternalId),
          seatOrder: index + 1,
          stationOwnerDisplayName: player(owner.playerInternalId).displayName,
          switchType: "ns1" as const,
          seatNumber: (index % 2) + 1,
          ...seed(row.playerInternalId),
          ...character(section.id, row.playerInternalId),
        };
      });
      return {
        groupId: `tournament_group.history-tn${input.editionNumber}-s${section.id}`,
        stage: section.stage,
        sequence: section.sequence,
        name: section.displayName,
        ...(section.tierKey === null ? {} : { tierKey: section.tierKey }),
        seating,
        standings: ranked.map((row, index) => ({
          rank: index + 1,
          ...player(row.playerInternalId),
          points: row.points,
          races: row.races,
          wins: row.wins,
          complete: true,
          ...seed(row.playerInternalId),
          ...character(section.id, row.playerInternalId),
        })),
        races: races.map((race) => ({
          ...race,
          placements: race.placements.map(({ playerInternalId: _internal, ...placement }) => placement),
        })),
        rankedInternalIds: ranked.map((row) => row.playerInternalId),
      };
    });

  // The overall result reads the final groups top to bottom in their order
  // (Kampioen before Talent before Wild); a night without finals reads its
  // qualifier groups the same way.
  const overallGroups = groups.some((group) => group.stage === "final")
    ? groups.filter((group) => group.stage === "final")
    : groups;
  let placement = 0;
  const overall = overallGroups.flatMap((group) => group.standings.map((row) => {
    placement += 1;
    return {
      placement,
      ...(row.playerId === undefined ? {} : { playerId: row.playerId }),
      displayName: row.displayName,
      groupName: group.name,
      groupRank: row.rank,
      points: row.points,
    };
  }));

  return {
    schemaVersion: "mk8dx.public-tournament-event.v1",
    tournamentId,
    name: `Toernooi ${input.editionNumber}`,
    editionNumber: input.editionNumber,
    ...(input.eventDate === null ? {} : { eventDate: input.eventDate }),
    stage: "finalized",
    ...(input.heldAtMs === null ? {} : { finalizedAtMs: input.heldAtMs }),
    publicResults: true,
    participantCount: everyone.size,
    groups: groups.map(({ rankedInternalIds: _ranked, ...group }) => group),
    overall,
  };
}

export function historyEditionSummary(
  input: Readonly<{ editionNumber: number; eventDate: string | null; heldAtMs: number | null; participantCount: number }>,
): PublicTournamentEventSummary {
  return {
    tournamentId: historyEditionId(input.editionNumber),
    name: `Toernooi ${input.editionNumber}`,
    editionNumber: input.editionNumber,
    ...(input.eventDate === null ? {} : { eventDate: input.eventDate }),
    stage: "finalized",
    ...(input.heldAtMs === null ? {} : { finalizedAtMs: input.heldAtMs }),
    participantCount: input.participantCount,
    updatedAtMs: input.heldAtMs ?? 0,
  };
}

function isoDate(value: unknown): string | null {
  if (value instanceof Date) { return value.toISOString().slice(0, 10); }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/u.test(value)) { return value.slice(0, 10); }
  return null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) { return null; }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Reads the corrected history; never writes. */
export class MysqlHistoryEditionRepository implements HistoryEditionSource {
  public constructor(
    private readonly pool: Pool,
    private readonly editions: readonly number[] = HISTORY_EDITION_NUMBERS,
  ) {}

  public async listEditions(): Promise<readonly PublicTournamentEventSummary[]> {
    if (this.editions.length === 0) { return []; }
    const marks = this.editions.map(() => "?").join(", ");
    const [events] = await this.pool.execute<RowDataPacket[]>(
      `SELECT tournament_number AS editionNumber, event_date AS eventDate, held_at_ms AS heldAtMs
       FROM legacy_tournament_events WHERE tournament_number IN (${marks})`,
      [...this.editions],
    );
    const [counts] = await this.pool.execute<RowDataPacket[]>(
      `SELECT section.tournament_number AS editionNumber, COUNT(DISTINCT placement.player_id) AS participants
       FROM tournament_history_sections AS section
       INNER JOIN tournament_history_races AS race ON race.tournament_history_section_id = section.tournament_history_section_id
       INNER JOIN tournament_history_placements AS placement ON placement.tournament_history_race_id = race.tournament_history_race_id
       WHERE section.tournament_number IN (${marks})
       GROUP BY section.tournament_number`,
      [...this.editions],
    );
    const participants = new Map(counts.map((row) => [Number(row["editionNumber"]), Number(row["participants"])]));
    const dates = new Map(events.map((row) => [Number(row["editionNumber"]), row]));
    return this.editions
      .filter((editionNumber) => (participants.get(editionNumber) ?? 0) > 0)
      .map((editionNumber) => {
        const event = dates.get(editionNumber);
        return historyEditionSummary({
          editionNumber,
          eventDate: isoDate(event?.["eventDate"]),
          heldAtMs: numberOrNull(event?.["heldAtMs"]),
          participantCount: participants.get(editionNumber) ?? 0,
        });
      });
  }

  public async loadEdition(editionNumber: number): Promise<PublicTournamentEvent | null> {
    if (!this.editions.includes(editionNumber)) { return null; }
    const [sections] = await this.pool.execute<RowDataPacket[]>(
      `SELECT tournament_history_section_id AS id, stage, sequence_number AS sequence, tier_key AS tierKey, display_name AS displayName
       FROM tournament_history_sections WHERE tournament_number = ?`,
      [editionNumber],
    );
    if (sections.length === 0) { return null; }
    const sectionIds = sections.map((row) => Number(row["id"]));
    const sectionMarks = sectionIds.map(() => "?").join(", ");
    const [races] = await this.pool.execute<RowDataPacket[]>(
      `SELECT tournament_history_race_id AS id, tournament_history_section_id AS sectionId, race_index AS raceIndex,
              counts_toward_rating AS countsTowardRating, track_id AS trackId
       FROM tournament_history_races WHERE tournament_history_section_id IN (${sectionMarks})`,
      sectionIds,
    );
    const raceIds = races.map((row) => Number(row["id"]));
    const placements = raceIds.length === 0 ? [] : (await this.pool.execute<RowDataPacket[]>(
      `SELECT tournament_history_race_id AS raceId, player_id AS playerInternalId,
              finish_position AS finishPosition, race_points AS racePoints
       FROM tournament_history_placements WHERE tournament_history_race_id IN (${raceIds.map(() => "?").join(", ")})`,
      raceIds,
    ))[0];
    // The character each Player drove in a section: the one their placements
    // name most often. The recorded history kept it; the report prints it.
    const characterRows = raceIds.length === 0 ? [] : (await this.pool.execute<RowDataPacket[]>(
      `SELECT race.tournament_history_section_id AS sectionId, placement.player_id AS playerInternalId,
              placement.character_id AS characterId, COUNT(*) AS races
         FROM tournament_history_placements AS placement
         INNER JOIN tournament_history_races AS race
            ON race.tournament_history_race_id = placement.tournament_history_race_id
        WHERE placement.tournament_history_race_id IN (${raceIds.map(() => "?").join(", ")})
          AND placement.character_id IS NOT NULL
        GROUP BY race.tournament_history_section_id, placement.player_id, placement.character_id
        ORDER BY races DESC`,
      raceIds,
    ))[0];
    const characters = new Map<string, string>();
    for (const row of characterRows) {
      const playerInternalId = Number(row["playerInternalId"]);
      const key = `${Number(row["sectionId"])}:${playerInternalId}`;
      const characterId = typeof row["characterId"] === "string" ? row["characterId"] : null;
      if (characterId === null) { continue; }
      if (!characters.has(key)) { characters.set(key, characterId); }
      // The night's own fallback, keyed by the Player alone: the rows are
      // ordered by how often a character appears, so the first wins.
      if (!characters.has(`${playerInternalId}`)) { characters.set(`${playerInternalId}`, characterId); }
    }
    const playerIds = [...new Set(placements.map((row) => Number(row["playerInternalId"])))];
    const players = playerIds.length === 0 ? [] : (await this.pool.execute<RowDataPacket[]>(
      `SELECT player_id AS internalId, public_id AS playerId, display_name AS displayName,
              (player_kind = 'human' AND record_status = 'active' AND visibility = 'public') AS isPublic
       FROM players WHERE player_id IN (${playerIds.map(() => "?").join(", ")})`,
      playerIds,
    ))[0];
    const [events] = await this.pool.execute<RowDataPacket[]>(
      "SELECT event_date AS eventDate, held_at_ms AS heldAtMs FROM legacy_tournament_events WHERE tournament_number = ? LIMIT 1",
      [editionNumber],
    );
    const heldAtMs = numberOrNull(events[0]?.["heldAtMs"]);
    // Every history race of a night carries that night's timestamp, so the
    // rating before the night is the last event strictly before it.
    const ratedBefore = heldAtMs === null ? [] : (await this.pool.execute<RowDataPacket[]>(
      `SELECT event.player_id AS playerInternalId, (event.mu_after - 3 * event.sigma_after) AS score
       FROM player_rating_events AS event
       INNER JOIN (
         SELECT player_id, MAX(sequence_number) AS sequenceNumber
         FROM player_rating_events WHERE occurred_at_ms < ? GROUP BY player_id
       ) AS latest ON latest.player_id = event.player_id AND latest.sequenceNumber = event.sequence_number
       INNER JOIN players AS player ON player.player_id = event.player_id
         AND player.player_kind = 'human' AND player.record_status = 'active'`,
      [heldAtMs],
    ))[0];
    return buildHistoryEdition({
      editionNumber,
      eventDate: isoDate(events[0]?.["eventDate"]),
      heldAtMs,
      characters,
      seeds: historyEditionSeeds(ratedBefore.map((row) => ({
        playerInternalId: Number(row["playerInternalId"]), score: Number(row["score"]),
      })).filter((row) => Number.isFinite(row.score))),
      sections: sections.map((row) => ({
        id: Number(row["id"]),
        stage: String(row["stage"]) === "final" ? "final" : "qualifier",
        sequence: Number(row["sequence"]),
        tierKey: row["tierKey"] === null || row["tierKey"] === undefined ? null : String(row["tierKey"]),
        displayName: String(row["displayName"]),
      })),
      races: races.map((row) => ({
        id: Number(row["id"]),
        sectionId: Number(row["sectionId"]),
        raceIndex: Number(row["raceIndex"]),
        countsTowardRating: Number(row["countsTowardRating"]) === 1,
        trackId: row["trackId"] === null || row["trackId"] === undefined ? null : String(row["trackId"]),
      })),
      placements: placements.map((row) => ({
        raceId: Number(row["raceId"]),
        playerInternalId: Number(row["playerInternalId"]),
        finishPosition: Number(row["finishPosition"]),
        racePoints: row["racePoints"] === null || row["racePoints"] === undefined
          ? null
          : Number(row["racePoints"]),
      })),
      players: new Map(players.map((row) => [Number(row["internalId"]), {
        playerId: String(row["playerId"]),
        displayName: String(row["displayName"]),
        isPublic: Number(row["isPublic"]) === 1,
      }])),
    });
  }
}
