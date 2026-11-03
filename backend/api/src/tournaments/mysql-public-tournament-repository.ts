import { type TournamentRaceMode, isTournamentRaceMode } from "./race-result-validation.js";
import type { RowDataPacket } from "mysql2";

import type { PreparedQueryExecutor } from
  "../identity/mysql-identity-read-repository.js";
import type {
  PublicPlayerTournamentResult,
  PublicTournament,
  PublicTournamentPlacement,
  PublicTournamentRace,
  PublicTournamentRepository,
  PublicTournamentStanding,
} from "./public-tournament-service.js";

interface RaceRow extends RowDataPacket {
  publicationId: unknown;
  eventName: unknown;
  publishedAtMs: unknown;
  revisionInternalId: unknown;
  raceResultId: unknown;
  revisionValue: unknown;
  raceNumber: unknown;
  scoringSegment: unknown;
  trackId: unknown;
  modeValue: unknown;
  mirrorValue: unknown;
  countsTowardStandings: unknown;
  resultAtMs: unknown;
}

interface PlacementRow extends RowDataPacket {
  playerVisibility: unknown;
  revisionInternalId: unknown;
  finishPosition: unknown;
  playerId: unknown;
  playerUsername: unknown;
  playerDisplayName: unknown;
  racePoints: unknown;
  totalAfterRace: unknown;
  rankAfterRace: unknown;
  characterId: unknown;
  characterVariantId: unknown;
}

interface PlayerResultRow extends RowDataPacket {
  publicationId: unknown;
  eventName: unknown;
  publishedAtMs: unknown;
  raceResultId: unknown;
  revisionValue: unknown;
  raceNumber: unknown;
  scoringSegment: unknown;
  trackId: unknown;
  modeValue: unknown;
  mirrorValue: unknown;
  finishPosition: unknown;
  racePoints: unknown;
  totalAfterRace: unknown;
  rankAfterRace: unknown;
  resultAtMs: unknown;
}

export class PublicTournamentPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PublicTournamentPersistenceError";
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new PublicTournamentPersistenceError(`${field} is invalid`);
  }
  return value;
}

function integer(value: unknown, field: string, minimum = 0): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new PublicTournamentPersistenceError(`${field} is invalid`);
  }
  return parsed;
}

function mode(value: unknown): TournamentRaceMode | undefined {
  if (value === null) { return undefined; }
  const parsed = integer(value, "mode");
  if (!isTournamentRaceMode(parsed)) {
    throw new PublicTournamentPersistenceError("mode is unsupported");
  }
  return parsed;
}

function placement(row: PlacementRow): PublicTournamentPlacement &
Readonly<{ revisionInternalId: number }> {
  const characterId = row.characterId === null
    ? undefined : text(row.characterId, "character ID");
  const characterVariantId = row.characterVariantId === null
    ? undefined : text(row.characterVariantId, "character variant ID");
  // A private Player keeps their place in a published race: dropping the row
  // would leave a permanent hole in the stored finish positions and ranks,
  // so the placement stays and only the identity is withheld.
  const withheld = row.playerVisibility === "private";
  return {
    revisionInternalId: integer(row.revisionInternalId, "revision internal ID", 1),
    finishPosition: integer(row.finishPosition, "finish position", 1),
    ...(withheld ? {} : {
      playerId: text(row.playerId, "Player ID"),
      playerUsername: text(row.playerUsername, "Player username"),
    }),
    playerDisplayName: withheld
      ? "Private Player"
      : text(row.playerDisplayName, "Player display name"),
    racePoints: integer(row.racePoints, "race points"),
    totalAfterRace: integer(row.totalAfterRace, "total after race"),
    rankAfterRace: integer(row.rankAfterRace, "rank after race", 1),
    ...(characterId === undefined ? {} : { characterId }),
    ...(characterVariantId === undefined ? {} : { characterVariantId }),
  };
}

function standings(races: readonly PublicTournamentRace[]): readonly PublicTournamentStanding[] {
  const latest = new Map<number, PublicTournamentRace>();
  for (const race of races) {
    const current = latest.get(race.scoringSegment);
    if (current === undefined || race.raceNumber > current.raceNumber) {
      latest.set(race.scoringSegment, race);
    }
  }
  return [...latest.values()]
    .sort((left, right) => left.scoringSegment - right.scoringSegment)
    .flatMap((race) => race.placements.map((item) => ({
      scoringSegment: race.scoringSegment,
      ...(item.playerId === undefined ? {} : { playerId: item.playerId }),
      ...(item.playerUsername === undefined
        ? {}
        : { playerUsername: item.playerUsername }),
      playerDisplayName: item.playerDisplayName,
      totalPoints: item.totalAfterRace,
      rank: item.rankAfterRace,
    })))
    .sort((left, right) => left.scoringSegment - right.scoringSegment ||
      left.rank - right.rank ||
      (left.playerId ?? "").localeCompare(right.playerId ?? ""));
}

export class MysqlPublicTournamentRepository implements PublicTournamentRepository {
  public constructor(private readonly executor: PreparedQueryExecutor) {}

  public async loadPublication(publicationId: string): Promise<PublicTournament | null> {
    const [rows] = await this.executor.execute<RaceRow[]>(
      `SELECT publication.public_id AS publicationId,
              publication.event_name AS eventName,
              publication.published_at_ms AS publishedAtMs,
              revision.tournament_race_result_revision_id AS revisionInternalId,
              result.public_id AS raceResultId,
              revision.revision_number AS revisionValue,
              revision.race_number AS raceNumber,
              revision.scoring_segment AS scoringSegment,
              revision.track_id AS trackId, revision.mode_cc AS modeValue,
              revision.mirror AS mirrorValue,
              revision.counts_toward_standings AS countsTowardStandings,
              COALESCE(revision.occurred_at_ms, revision.captured_at_ms,
                       revision.created_at_ms) AS resultAtMs
       FROM tournament_publications AS publication
       INNER JOIN tournament_publication_current_members AS current_member
         ON current_member.tournament_publication_id = publication.tournament_publication_id
       INNER JOIN tournament_race_results AS result
         ON result.tournament_race_result_id = current_member.tournament_race_result_id
       INNER JOIN tournament_race_result_revisions AS revision
         ON revision.tournament_race_result_revision_id =
            current_member.tournament_race_result_revision_id
        AND revision.tournament_race_result_id = result.tournament_race_result_id
       WHERE publication.public_id = ? AND publication.publication_status = 'published'
         AND publication.public_visibility = 'public'
       ORDER BY revision.scoring_segment, revision.race_number,
                current_member.sequence_number LIMIT 200`,
      [publicationId],
    );
    if (rows.length === 0) { return null; }
    const revisionIds = rows.map((row) => integer(
      row.revisionInternalId,
      "revision internal ID",
      1,
    ));
    const [placementRows] = await this.executor.execute<PlacementRow[]>(
      `SELECT placement.tournament_race_result_revision_id AS revisionInternalId,
              placement.finish_position AS finishPosition,
              player.visibility AS playerVisibility,
              player.public_id AS playerId,
              username.username_value AS playerUsername,
              player.display_name AS playerDisplayName,
              placement.race_points AS racePoints,
              placement.total_after_race AS totalAfterRace,
              placement.rank_after_race AS rankAfterRace,
              placement.character_id AS characterId,
              placement.character_variant_id AS characterVariantId
       FROM tournament_race_placements AS placement
       INNER JOIN players AS player ON player.player_id = placement.player_id
         AND player.player_kind = 'human' AND player.record_status = 'active'
       INNER JOIN player_username_history AS username
         ON username.player_id = player.player_id AND username.released_at_ms IS NULL
       WHERE placement.tournament_race_result_revision_id IN (
         ${revisionIds.map(() => "?").join(", ")}
       ) ORDER BY placement.tournament_race_result_revision_id,
                  placement.finish_position`,
      revisionIds,
    );
    const placements = new Map<number, PublicTournamentPlacement[]>();
    for (const row of placementRows) {
      const mapped = placement(row);
      const values = placements.get(mapped.revisionInternalId) ?? [];
      const { revisionInternalId: _internal, ...publicPlacement } = mapped;
      values.push(publicPlacement);
      placements.set(mapped.revisionInternalId, values);
    }
    const races = rows.map((row): PublicTournamentRace => {
      const revisionInternalId = integer(row.revisionInternalId, "revision internal ID", 1);
      const parsedMode = mode(row.modeValue);
      return {
        raceResultId: text(row.raceResultId, "race result ID"),
        revision: integer(row.revisionValue, "revision", 1),
        raceNumber: integer(row.raceNumber, "race number", 1),
        scoringSegment: integer(row.scoringSegment, "scoring segment", 1),
        trackId: text(row.trackId, "track ID"),
        ...(parsedMode === undefined ? {} : { mode: parsedMode }),
        ...(Number(row.mirrorValue ?? 0) === 1 ? { mirror: true as const } : {}),
        countsTowardStandings: integer(row.countsTowardStandings, "counts flag") === 1,
        resultAtMs: integer(row.resultAtMs, "result timestamp"),
        placements: placements.get(revisionInternalId) ?? [],
      };
    });
    if (races.some((race) => race.placements.length === 0)) {
      throw new PublicTournamentPersistenceError("published race has no public placements");
    }
    const first = rows[0]!;
    return {
      publicationId: text(first.publicationId, "publication ID"),
      eventName: text(first.eventName, "event name"),
      publishedAtMs: integer(first.publishedAtMs, "published timestamp"),
      races,
      standings: standings(races),
    };
  }

  public async listPlayerResults(
    playerId: string,
  ): Promise<readonly PublicPlayerTournamentResult[]> {
    const [rows] = await this.executor.execute<PlayerResultRow[]>(
      `SELECT publication.public_id AS publicationId,
              publication.event_name AS eventName,
              publication.published_at_ms AS publishedAtMs,
              result.public_id AS raceResultId,
              revision.revision_number AS revisionValue,
              revision.race_number AS raceNumber,
              revision.scoring_segment AS scoringSegment,
              revision.track_id AS trackId, revision.mode_cc AS modeValue,
              revision.mirror AS mirrorValue,
              placement.finish_position AS finishPosition,
              placement.race_points AS racePoints,
              placement.total_after_race AS totalAfterRace,
              placement.rank_after_race AS rankAfterRace,
              COALESCE(revision.occurred_at_ms, revision.captured_at_ms,
                       revision.created_at_ms) AS resultAtMs
       FROM tournament_publications AS publication
       INNER JOIN tournament_publication_current_members AS current_member
         ON current_member.tournament_publication_id = publication.tournament_publication_id
       INNER JOIN tournament_race_results AS result
         ON result.tournament_race_result_id = current_member.tournament_race_result_id
       INNER JOIN tournament_race_result_revisions AS revision
         ON revision.tournament_race_result_revision_id =
            current_member.tournament_race_result_revision_id
        AND revision.tournament_race_result_id = result.tournament_race_result_id
       INNER JOIN tournament_race_placements AS placement
         ON placement.tournament_race_result_revision_id =
            revision.tournament_race_result_revision_id
       INNER JOIN players AS player ON player.player_id = placement.player_id
       WHERE publication.publication_status = 'published'
         AND publication.public_visibility = 'public'
         AND player.public_id = ? AND player.player_kind = 'human'
         AND player.record_status = 'active'
         AND player.visibility = 'public'
       ORDER BY publication.published_at_ms DESC, revision.scoring_segment,
                revision.race_number, result.public_id LIMIT 100`,
      [playerId],
    );
    return rows.map((row) => {
      const parsedMode = mode(row.modeValue);
      return {
        publicationId: text(row.publicationId, "publication ID"),
        eventName: text(row.eventName, "event name"),
        publishedAtMs: integer(row.publishedAtMs, "published timestamp"),
        raceResultId: text(row.raceResultId, "race result ID"),
        revision: integer(row.revisionValue, "revision", 1),
        raceNumber: integer(row.raceNumber, "race number", 1),
        scoringSegment: integer(row.scoringSegment, "scoring segment", 1),
        trackId: text(row.trackId, "track ID"),
        ...(parsedMode === undefined ? {} : { mode: parsedMode }),
        ...(Number(row.mirrorValue ?? 0) === 1 ? { mirror: true as const } : {}),
        finishPosition: integer(row.finishPosition, "finish position", 1),
        racePoints: integer(row.racePoints, "race points"),
        totalAfterRace: integer(row.totalAfterRace, "total after race"),
        rankAfterRace: integer(row.rankAfterRace, "rank after race", 1),
        resultAtMs: integer(row.resultAtMs, "result timestamp"),
      };
    });
  }
}
