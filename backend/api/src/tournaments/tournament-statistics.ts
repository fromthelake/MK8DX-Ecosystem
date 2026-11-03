// What the community has actually raced, counted over every finished night.
//
// The per-Player track record already exists, and the report already tells one
// night. What nobody could see is the whole of it: which tracks come up again
// and again, which have been driven once in four years, how many races that
// adds up to, and how the field grew from sixteen people to thirty-odd.
//
// It is counted here rather than in the browser because the answer is one
// small table and the evidence is 1.15 MB: reading nine finished nights over
// the wire to add them up would cost every reader that, on a page that opens
// with a list.
//
// The corrected history is the source, as it is for the published editions
// themselves (see `history-edition-projection.ts`), and nothing is written. A
// race whose track was never written down is counted in the totals and left
// out of the per-track rows, because a nameless track is not a track.

import type { Pool, RowDataPacket } from "mysql2/promise";

import { HISTORY_EDITION_NUMBERS } from "./history-edition-projection.js";
import {
  MEASURED_RATING_PARAMETERS,
  conservativeScore,
  initialRating,
  rateFreeForAllRace,
  type Rating,
} from "../rating/trueskill-engine.js";

/**
 * Sections these numbers leave out, and why.
 *
 * TN8's third qualification group was recorded on a capture card that failed:
 * `docs/provenance/TOURNAMENT_VIDEO_SOURCE_INVENTORY_2026-09-05.md` marks it
 * "verloren - Defect Capture Card". Three of its twelve races survive in the
 * history and none of them carries a track. The owner's decision is that a
 * group whose evening was lost does not count here; it is not a gap waiting
 * to be filled, and the panel does not advertise it as one.
 *
 * The rated history is deliberately untouched by this: ADR-0154's replay is
 * proven against the legacy system race for race, and rewriting what the
 * rating counted is a different decision from what a descriptive panel counts.
 */
export const EXCLUDED_HISTORY_SECTIONS: readonly Readonly<{
  editionNumber: number; stage: string; sequence: number; reason: string;
}>[] = [
  {
    editionNumber: 8, stage: "qualifier", sequence: 3,
    reason: "TN8 Kwalificatie Groep 3 - capture card defect, evening lost",
  },
];

/**
 * The `AND NOT (...)` that keeps those sections out, and the values it needs.
 * Built rather than written so the list above is the only place to change.
 */
export function excludedSectionsClause(
  sections: readonly Readonly<{ editionNumber: number; stage: string; sequence: number }>[]
  = EXCLUDED_HISTORY_SECTIONS,
): Readonly<{ sql: string; params: readonly (string | number)[] }> {
  if (sections.length === 0) { return { sql: "", params: [] }; }
  const sql = sections
    .map(() => "NOT (section.tournament_number = ? AND section.stage = ? AND section.sequence_number = ?)")
    .join(" AND ");
  return {
    sql: ` AND ${sql}`,
    params: sections.flatMap((section) => [section.editionNumber, section.stage, section.sequence]),
  };
}

/** One finished night: the field it drew and the races it took. */
export type TournamentStatisticsEdition = Readonly<{
  editionNumber: number;
  eventDate: string | null;
  heldAtMs: number | null;
  participantCount: number;
  races: number;
  /** Everybody who had raced a tournament by the end of this night. */
  cumulativePlayers: number;
}>;

/**
 * One track, over every finished night.
 *
 * `placements` is how many Players drove it, summed over its races - the
 * "track × deelnemers" the owner asked for, and what turns a race count into
 * time when it is multiplied by that track's Nintendo ghost.
 */
export type TournamentStatisticsTrack = Readonly<{
  trackId: string;
  races: number;
  placements: number;
  /** How many different nights it was raced on - counted, not inferred. */
  nights: number;
  /** The first and last night this track was raced on, as edition numbers. */
  firstEdition: number;
  lastEdition: number;
  /** Whoever tops this track's own TrueSkill, and what they hold. */
  bestPlayerId: string | null;
  bestPlayerName: string | null;
  /** ADR-0218: display names may repeat; the username tells two leaders apart. */
  bestPlayerUsername?: string;
  bestScore: number | null;
}>;

export type TournamentStatistics = Readonly<{
  editions: readonly TournamentStatisticsEdition[];
  tracks: readonly TournamentStatisticsTrack[];
  totals: Readonly<{
    editions: number;
    races: number;
    racesWithTrack: number;
    placements: number;
    players: number;
    tracksRaced: number;
  }>;
}>;

/**
 * One Player's standing on one track: the same TrueSkill the site's Score is
 * built from, run over that track's races alone.
 */
export type TrackSkillEntry = Readonly<{
  rank: number;
  playerId: string;
  displayName: string;
  /** ADR-0218: present when the Player has one, so equal names can be told apart. */
  username?: string;
  /** mu - 3*sigma, the same Score the Ranking publishes. Starts at 0. */
  score: number;
  mu: number;
  sigma: number;
  races: number;
  wins: number;
  top3: number;
  bestFinish: number;
  averageFinish: number;
}>;

export type TrackSkill = Readonly<{
  trackId: string;
  races: number;
  /** Races left out because their finishing order was not 1..N without ties. */
  racesSkipped: number;
  players: readonly TrackSkillEntry[];
}>;

/** One race on one track, in the order it was driven. */
export type TrackRaceRow = Readonly<{
  raceKey: number;
  playerId: string;
  displayName: string;
  username?: string | null;
  finishPosition: number;
}>;

/**
 * The track's own rating, from scratch.
 *
 * The same engine and the same measured parameters the site's Score uses
 * (ADR-0189), and every Player starts at the ordinary prior - mu 25, sigma
 * 25/3, so a published Score of exactly 0. What is deliberately *not* here is
 * the inactivity decay: the community races a given track twice a year, and
 * fading everybody between visits would measure the calendar rather than the
 * track. This number answers "how good are you *here*", counted from zero.
 */
export function replayTrackSkill(
  trackId: string,
  rows: readonly TrackRaceRow[],
): TrackSkill {
  const byRace = new Map<number, TrackRaceRow[]>();
  for (const row of rows) {
    const bucket = byRace.get(row.raceKey) ?? [];
    bucket.push(row);
    byRace.set(row.raceKey, bucket);
  }
  const ratings = new Map<string, Rating>();
  const names = new Map<string, string>();
  const usernames = new Map<string, string>();
  const tally = new Map<string, { races: number; wins: number; top3: number; best: number; sum: number }>();
  let races = 0;
  let racesSkipped = 0;
  for (const key of [...byRace.keys()].sort((left, right) => left - right)) {
    const field = (byRace.get(key) ?? []).slice()
      .sort((left, right) => left.finishPosition - right.finishPosition);
    const positions = field.map((row) => row.finishPosition);
    const unique = new Set(positions);
    const complete = field.length >= 2 && unique.size === field.length &&
      positions.every((position) => position >= 1 && position <= field.length);
    if (!complete) { racesSkipped += 1; continue; }
    const before = field.map((row) => ratings.get(row.playerId) ?? initialRating());
    const after = rateFreeForAllRace(before, positions, MEASURED_RATING_PARAMETERS);
    field.forEach((row, index) => {
      ratings.set(row.playerId, after[index]!);
      names.set(row.playerId, row.displayName);
      if (typeof row.username === "string" && row.username.length > 0) { usernames.set(row.playerId, row.username); }
      const counted = tally.get(row.playerId)
        ?? { races: 0, wins: 0, top3: 0, best: Number.POSITIVE_INFINITY, sum: 0 };
      counted.races += 1;
      if (row.finishPosition === 1) { counted.wins += 1; }
      if (row.finishPosition <= 3) { counted.top3 += 1; }
      counted.best = Math.min(counted.best, row.finishPosition);
      counted.sum += row.finishPosition;
      tally.set(row.playerId, counted);
    });
    races += 1;
  }
  const players = [...ratings.entries()]
    .map(([playerId, rating]) => {
      const counted = tally.get(playerId)
        ?? { races: 0, wins: 0, top3: 0, best: 0, sum: 0 };
      return {
        playerId,
        displayName: names.get(playerId) ?? playerId,
        ...(usernames.has(playerId) ? { username: usernames.get(playerId)! } : {}),
        score: Math.round(conservativeScore(rating) * 100) / 100,
        mu: Math.round(rating.mu * 100) / 100,
        sigma: Math.round(rating.sigma * 100) / 100,
        races: counted.races,
        wins: counted.wins,
        top3: counted.top3,
        bestFinish: Number.isFinite(counted.best) ? counted.best : 0,
        averageFinish: counted.races === 0
          ? 0 : Math.round((counted.sum / counted.races) * 100) / 100,
      };
    })
    .sort((left, right) => right.score - left.score || left.displayName.localeCompare(right.displayName))
    .map((entry, index) => ({ rank: index + 1, ...entry }));
  return { trackId, races, racesSkipped, players };
}

export interface TournamentStatisticsSource {
  load(): Promise<TournamentStatistics>;
  loadTrack(trackId: string): Promise<TrackSkill>;
}

/** The rows the two queries return, kept apart from the SQL so this is testable. */
export type StatisticsEditionRow = Readonly<{
  editionNumber: number;
  eventDate: string | null;
  heldAtMs: number | null;
  participantCount: number;
  races: number;
  cumulativePlayers: number;
}>;

export type StatisticsTrackRow = Readonly<{
  trackId: string;
  races: number;
  placements: number;
  nights: number;
  firstEdition: number;
  lastEdition: number;
  bestPlayerId?: string | null;
  bestPlayerName?: string | null;
  bestPlayerUsername?: string | null;
  bestScore?: number | null;
}>;

/**
 * The answer, assembled from what the two queries counted. Ordered the way it
 * is read: the editions oldest first, because that is a growth curve, and the
 * tracks most-raced first, because that is the question.
 */
export function assembleTournamentStatistics(
  editionRows: readonly StatisticsEditionRow[],
  trackRows: readonly StatisticsTrackRow[],
  distinctPlayers: number,
): TournamentStatistics {
  const editions = [...editionRows].sort((left, right) => left.editionNumber - right.editionNumber);
  const tracks = [...trackRows]
    .map(({ bestPlayerUsername, ...track }) => ({
      ...track,
      bestPlayerId: track.bestPlayerId ?? null,
      bestPlayerName: track.bestPlayerName ?? null,
      ...(typeof bestPlayerUsername === "string" && bestPlayerUsername.length > 0 ? { bestPlayerUsername } : {}),
      bestScore: track.bestScore ?? null,
    }))
    .sort((left, right) => right.races - left.races || left.trackId.localeCompare(right.trackId));
  const races = editions.reduce((sum, edition) => sum + edition.races, 0);
  const racesWithTrack = tracks.reduce((sum, track) => sum + track.races, 0);
  return {
    editions,
    tracks,
    totals: {
      editions: editions.length,
      races,
      racesWithTrack,
      placements: tracks.reduce((sum, track) => sum + track.placements, 0),
      players: distinctPlayers,
      tracksRaced: tracks.length,
    },
  };
}

function integer(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function isoDate(value: unknown): string | null {
  if (value instanceof Date) { return value.toISOString().slice(0, 10); }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) { return value.slice(0, 10); }
  return null;
}

/** Reads the corrected history; never writes. */
export class MysqlTournamentStatisticsRepository implements TournamentStatisticsSource {
  public constructor(
    private readonly pool: Pool,
    private readonly editions: readonly number[] = HISTORY_EDITION_NUMBERS,
  ) {}

  public async loadTrack(trackId: string): Promise<TrackSkill> {
    // The same rows the panel counts, narrowed to one track, so the page and
    // the panel's own row can never disagree about how often it was raced or
    // who owns it - including the nights the console ran itself.
    const { rows } = await this.placementRows(trackId);
    return trackSkillFromPlacements(trackId, rows);
  }

  public async load(): Promise<TournamentStatistics> {
    const { rows, dateOf } = await this.placementRows(null);
    return assembleFromPlacements(rows, dateOf);
  }

  /**
   * Every counted placement, from both places a night can live: the imported
   * history (TN4-TN12) and the nights this product ran itself. With a track
   * given, only that track's placements - the same rows, filtered in SQL.
   */
  private async placementRows(trackId: string | null): Promise<Readonly<{
    rows: StatisticsPlacementRow[];
    dateOf: (editionNumber: number) => Readonly<{ eventDate: string | null; heldAtMs: number | null }>;
  }>> {
    const marks = this.editions.map(() => "?").join(", ");
    const excluded = excludedSectionsClause();
    // One pass over the history's placements. It is 9,832 rows and it answers
    // everything this panel asks: the nights, the tracks, who was there, when
    // each Player first appeared, and - because the rows arrive in the order
    // they were driven - each track's own TrueSkill.
    const [rows] = this.editions.length === 0
      ? [[] as RowDataPacket[]]
      : await this.pool.execute<RowDataPacket[]>(
        `SELECT section.tournament_number AS editionNumber,
                race.tournament_history_race_id AS raceKey,
                race.race_sequence AS raceSequence,
                race.track_id AS trackId,
                player.public_id AS playerId,
                player.display_name AS displayName,
                username.username_value AS username,
                placement.finish_position AS finishPosition
         FROM tournament_history_sections AS section
         INNER JOIN tournament_history_races AS race
           ON race.tournament_history_section_id = section.tournament_history_section_id
         INNER JOIN tournament_history_placements AS placement
           ON placement.tournament_history_race_id = race.tournament_history_race_id
         INNER JOIN players AS player
           ON player.player_id = placement.player_id
         LEFT JOIN player_username_history AS username
           ON username.player_id = player.player_id AND username.released_at_ms IS NULL
         WHERE section.tournament_number IN (${marks})${excluded.sql}${trackId === null ? "" : "\n           AND race.track_id = ?"}
         ORDER BY section.tournament_number, race.race_sequence`,
        [...this.editions, ...excluded.params, ...(trackId === null ? [] : [trackId])],
      );
    const [events] = this.editions.length === 0
      ? [[] as RowDataPacket[]]
      : await this.pool.execute<RowDataPacket[]>(
        `SELECT tournament_number AS editionNumber, event_date AS eventDate, held_at_ms AS heldAtMs
         FROM legacy_tournament_events WHERE tournament_number IN (${marks})`,
        [...this.editions],
      );
    // And the nights this product has run itself. A night joins these numbers
    // on the same terms the community reads it on: finished, published, and
    // not hidden. A Director who unticked "openbaar" - a test run, a night
    // that went wrong - is not in here, which is the same answer the public
    // page gives about it.
    const [canonical] = await this.pool.execute<RowDataPacket[]>(
      `SELECT t.public_id AS tournamentPublicId,
              t.edition_number AS editionNumber,
              t.event_date AS eventDate,
              t.start_at_ms AS startAtMs,
              grp.stage AS groupStage,
              grp.sequence_number AS groupSequence,
              link.race_number AS raceNumber,
              result.tournament_race_result_id AS raceKey,
              revision.track_id AS trackId,
              player.public_id AS playerId,
              player.display_name AS displayName,
              username.username_value AS username,
              placement.finish_position AS finishPosition
       FROM tournaments AS t
       INNER JOIN tournament_groups AS grp ON grp.tournament_id = t.tournament_id
       INNER JOIN tournament_group_races AS link
         ON link.tournament_group_id = grp.tournament_group_id
       INNER JOIN tournament_race_results AS result
         ON result.tournament_race_result_id = link.tournament_race_result_id
       INNER JOIN tournament_race_result_revisions AS revision
         ON revision.tournament_race_result_id = result.tournament_race_result_id
        AND revision.revision_number = (
          SELECT MAX(latest.revision_number) FROM tournament_race_result_revisions AS latest
          WHERE latest.tournament_race_result_id = result.tournament_race_result_id)
       INNER JOIN tournament_race_placements AS placement
         ON placement.tournament_race_result_revision_id
          = revision.tournament_race_result_revision_id
       INNER JOIN players AS player ON player.player_id = placement.player_id
       LEFT JOIN player_username_history AS username
         ON username.player_id = player.player_id AND username.released_at_ms IS NULL
       LEFT JOIN tournament_publications AS publication
         ON publication.tournament_publication_id = t.tournament_publication_id
       WHERE t.stage = 'finalized'
         AND t.public_results = 1
         AND revision.counts_toward_standings = 1
         AND (publication.public_visibility IS NULL OR publication.public_visibility <> 'hidden')${trackId === null ? "" : "\n         AND revision.track_id = ?"}
       ORDER BY t.event_date, grp.stage, grp.sequence_number, link.race_number`,
      trackId === null ? [] : [trackId],
    );
    const dates = new Map(events.map((row) => [integer(row["editionNumber"]), row]));
    // A night the console ran gets an edition key of its own so it cannot
    // collide with TN4-TN12: its own edition number where it has one, and
    // otherwise a number past every history edition, in date order.
    //
    // With a track given, only the nights that drove it are in these rows, so
    // an unnumbered night could be keyed differently than in the panel. The
    // key only orders nights against each other, and every numbered night -
    // TN13 and after - keeps its own number either way.
    const CANONICAL_BASE = 1000;
    const canonicalEditions = new Map<string, number>();
    for (const row of canonical) {
      const publicId = String(row["tournamentPublicId"]);
      if (canonicalEditions.has(publicId)) { continue; }
      const declared = row["editionNumber"] === null || row["editionNumber"] === undefined
        ? null : integer(row["editionNumber"]);
      canonicalEditions.set(
        publicId,
        declared !== null && !this.editions.includes(declared)
          ? declared : CANONICAL_BASE + canonicalEditions.size + 1,
      );
    }
    const canonicalDates = new Map<number, Readonly<{ eventDate: string | null; heldAtMs: number | null }>>();
    for (const row of canonical) {
      const key = canonicalEditions.get(String(row["tournamentPublicId"]));
      if (key === undefined || canonicalDates.has(key)) { continue; }
      canonicalDates.set(key, {
        eventDate: isoDate(row["eventDate"]),
        heldAtMs: row["startAtMs"] === null || row["startAtMs"] === undefined
          ? null : integer(row["startAtMs"]),
      });
    }
    return {
      rows: [
        ...rows.map((row) => ({
          editionNumber: integer(row["editionNumber"]),
          raceKey: integer(row["raceKey"]),
          raceSequence: integer(row["raceSequence"]),
          trackId: row["trackId"] === null || row["trackId"] === undefined
            ? null : String(row["trackId"]),
          playerId: String(row["playerId"]),
          displayName: String(row["displayName"] ?? row["playerId"]),
          username: typeof row["username"] === "string" ? row["username"] : null,
          finishPosition: integer(row["finishPosition"]),
        })),
        ...canonical.map((row) => ({
          editionNumber: canonicalEditions.get(String(row["tournamentPublicId"])) ?? CANONICAL_BASE,
          // Negative, so a canonical race can never be counted as a history
          // race that happens to share an id.
          raceKey: -integer(row["raceKey"]),
          // Unique within the night: a race number repeats in every group.
          raceSequence: canonicalRaceSequence(
            String(row["groupStage"] ?? ""),
            integer(row["groupSequence"]),
            integer(row["raceNumber"]),
          ),
          trackId: row["trackId"] === null || row["trackId"] === undefined
            ? null : String(row["trackId"]),
          playerId: String(row["playerId"]),
          displayName: String(row["displayName"] ?? row["playerId"]),
          username: typeof row["username"] === "string" ? row["username"] : null,
          finishPosition: integer(row["finishPosition"]),
        })),
      ],
      dateOf: (editionNumber) => canonicalDates.get(editionNumber) ?? {
        eventDate: isoDate(dates.get(editionNumber)?.["eventDate"]),
        heldAtMs: dates.get(editionNumber)?.["heldAtMs"] === null ||
          dates.get(editionNumber)?.["heldAtMs"] === undefined
          ? null : integer(dates.get(editionNumber)?.["heldAtMs"]),
      },
    };
  }
}

/**
 * Where a race the console ran sits within its night, as one number: the
 * qualifiers before the finals, then the group, then the race. A race number
 * alone repeats in every group - TN13 raced 1..32 in six groups at once - and
 * two different races sharing a key are replayed as one field of 24 with
 * doubled finish positions, which is not a race at all. Stays below the
 * million the edition key is multiplied by.
 */
export function canonicalRaceSequence(stage: string, groupSequence: number, raceNumber: number): number {
  const stageRank = stage === "final" ? 2 : 1;
  const group = Math.max(0, Math.min(99, Math.trunc(groupSequence)));
  const race = Math.max(0, Math.min(999, Math.trunc(raceNumber)));
  return stageRank * 100_000 + group * 1_000 + race;
}

/**
 * One track's own TrueSkill from the same placement rows the panel counts, so
 * the page and the panel's row are one computation read twice.
 */
export function trackSkillFromPlacements(
  trackId: string,
  rows: readonly StatisticsPlacementRow[],
): TrackSkill {
  return replayTrackSkill(trackId, rows
    .filter((row) => row.trackId === trackId)
    .map((row) => ({
      raceKey: row.editionNumber * 1_000_000 + row.raceSequence,
      playerId: row.playerId,
      displayName: row.displayName,
      username: row.username ?? null,
      finishPosition: row.finishPosition,
    })));
}

/** One placement, as the single pass reads it. */
export type StatisticsPlacementRow = Readonly<{
  editionNumber: number;
  raceKey: number;
  raceSequence: number;
  trackId: string | null;
  playerId: string;
  displayName: string;
  username?: string | null;
  finishPosition: number;
}>;

/**
 * Everything the panel asks, from the placements themselves.
 *
 * Counting in one place keeps the answers consistent with each other - the
 * nights, the tracks and each track's own leader are the same rows read three
 * ways, not three queries that could disagree.
 */
export function assembleFromPlacements(
  rows: readonly StatisticsPlacementRow[],
  dateOf: (editionNumber: number) => Readonly<{ eventDate: string | null; heldAtMs: number | null }>,
): TournamentStatistics {
  const editions = new Map<number, { players: Set<string>; races: Set<number> }>();
  const tracks = new Map<number, string | null>();
  const trackRows = new Map<string, {
    races: Set<number>; placements: number; nights: Set<number>;
    first: number; last: number; skill: TrackRaceRow[];
  }>();
  const seen = new Set<string>();
  const firstSeenAt = new Map<string, number>();
  for (const row of rows) {
    const edition = editions.get(row.editionNumber)
      ?? { players: new Set<string>(), races: new Set<number>() };
    edition.players.add(row.playerId);
    edition.races.add(row.raceKey);
    editions.set(row.editionNumber, edition);
    tracks.set(row.raceKey, row.trackId);
    if (!seen.has(row.playerId)) {
      seen.add(row.playerId);
      firstSeenAt.set(row.playerId, row.editionNumber);
    }
    if (row.trackId === null) { continue; }
    const track = trackRows.get(row.trackId) ?? {
      races: new Set<number>(), placements: 0, nights: new Set<number>(),
      first: row.editionNumber, last: row.editionNumber, skill: [],
    };
    track.races.add(row.raceKey);
    track.placements += 1;
    track.nights.add(row.editionNumber);
    track.first = Math.min(track.first, row.editionNumber);
    track.last = Math.max(track.last, row.editionNumber);
    track.skill.push({
      raceKey: row.editionNumber * 1_000_000 + row.raceSequence,
      playerId: row.playerId,
      displayName: row.displayName,
      username: row.username ?? null,
      finishPosition: row.finishPosition,
    });
    trackRows.set(row.trackId, track);
  }

  const newcomers = new Map<number, number>();
  for (const editionNumber of firstSeenAt.values()) {
    newcomers.set(editionNumber, (newcomers.get(editionNumber) ?? 0) + 1);
  }
  let running = 0;
  const editionRows: StatisticsEditionRow[] = [...editions.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([editionNumber, edition]) => {
      running += newcomers.get(editionNumber) ?? 0;
      return {
        editionNumber,
        ...dateOf(editionNumber),
        participantCount: edition.players.size,
        races: edition.races.size,
        cumulativePlayers: running,
      };
    });

  const trackList: StatisticsTrackRow[] = [...trackRows.entries()].map(([trackId, track]) => {
    // Each track's own rating, so the table can name the Player who owns it -
    // the same replay the track's own page shows.
    const leader = replayTrackSkill(trackId, track.skill).players[0];
    return {
      trackId,
      races: track.races.size,
      placements: track.placements,
      nights: track.nights.size,
      firstEdition: track.first,
      lastEdition: track.last,
      bestPlayerId: leader?.playerId ?? null,
      bestPlayerName: leader?.displayName ?? null,
      bestPlayerUsername: leader?.username ?? null,
      bestScore: leader?.score ?? null,
    };
  });
  return assembleTournamentStatistics(editionRows, trackList, seen.size);
}

export class TournamentStatisticsService {
  public constructor(private readonly source: TournamentStatisticsSource) {}

  public async load(): Promise<TournamentStatistics> {
    return this.source.load();
  }

  public async loadTrack(trackId: string): Promise<TrackSkill> {
    return this.source.loadTrack(trackId);
  }
}
