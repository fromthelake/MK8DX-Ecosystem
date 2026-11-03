import type { Pool, RowDataPacket } from "mysql2/promise";

import {
  CORRECTED_HISTORY_SECTION_CHARACTER_USE,
  CORRECTED_HISTORY_SECTION_STANDINGS,
  CORRECTED_HISTORY_TRAJECTORY,
} from
  "../tournament-history/corrected-history-sql.js";
import { CONSOLE_NIGHT_PLACEMENTS } from "../tournaments/console-night-placements.js";

// Public read models over the imported legacy race history: the
// per-race rating trajectory and pairwise head-to-head statistics.
// Owner decision 2026-08-21: the trajectory includes per-race mu/sigma
// for the interactive graph; leaderboards stay score-only.

type PreparedQueryExecutor = Pick<Pool, "execute">;

type TournamentCharacter = Readonly<{
  characterId: string;
  characterVariantId?: string;
}>;

/** The SQL orders most-used first; keep the first valid pair per standing. */
function tournamentCharacters(
  rows: readonly RowDataPacket[],
): ReadonlyMap<string, TournamentCharacter> {
  const characters = new Map<string, TournamentCharacter>();
  for (const row of rows) {
    const tournamentNumber = Number(row["tournamentNumber"]);
    if (!Number.isSafeInteger(tournamentNumber) || tournamentNumber < 1 ||
        typeof row["sectionLabel"] !== "string" ||
        typeof row["playerId"] !== "string" ||
        typeof row["characterId"] !== "string") {
      continue;
    }
    const key = `${tournamentNumber}#${row["sectionLabel"]}#${row["playerId"]}`;
    if (characters.has(key)) { continue; }
    characters.set(key, {
      characterId: row["characterId"],
      ...(typeof row["characterVariantId"] === "string"
        ? { characterVariantId: row["characterVariantId"] }
        : {}),
    });
  }
  return characters;
}

function groupCharacter(characterKey: unknown): TournamentCharacter | undefined {
  if (typeof characterKey !== "string") { return undefined; }
  if (characterKey.startsWith("character.")) {
    return { characterId: characterKey };
  }
  const variant = /^character_variant\.([a-z0-9]+(?:_[a-z0-9]+)*)\./u.exec(
    characterKey);
  return variant === null ? undefined : {
    characterId: `character.${variant[1]}`,
    characterVariantId: characterKey,
  };
}

export type RatingHistoryPoint = Readonly<{
  sequence: number;
  tournamentNumber: number;
  sectionLabel: string;
  raceIndex: number;
  finishPosition: number;
  score: number;
  // Owner decision 2026-08-21: the interactive graph shows mu/sigma
  // per race; leaderboards keep exposing the conservative score only.
  mu?: number;
  sigma?: number;
}>;

export type HeadToHeadTournament = Readonly<{
  tournamentNumber: number;
  sharedRaces: number;
  aAhead: number;
  bAhead: number;
}>;

export type HeadToHead = Readonly<{
  sharedRaces: number;
  aAhead: number;
  bAhead: number;
  averageFinishA: number;
  averageFinishB: number;
  byTournament: readonly HeadToHeadTournament[];
}>;

export class MysqlLegacyHistoryRepository {
  public constructor(private readonly executor: PreparedQueryExecutor) {}

  public async listRatingHistory(
    playerId: string,
  ): Promise<readonly RatingHistoryPoint[]> {
    const [rows] = await this.executor.execute<RowDataPacket[]>(
      `${CORRECTED_HISTORY_TRAJECTORY}`,
      [playerId],
    );
    // Canonical races rated on the platform (ADR-0155/ADR-0160) continue the
    // trajectory after the imported legacy history: the newest rating epoch's
    // race events, labelled by the tournament that was finalized, in the
    // order they were applied. Only publicly visible tournaments appear.
    const [canonicalRows] = await this.executor.execute<RowDataPacket[]>(
      `SELECT event.sequence_number AS eventSequence,
              COALESCE(tournament.edition_number, 0) AS tournamentNumber,
              COALESCE(grp.name, publication.event_name, 'Tournament') AS sectionLabel,
              COALESCE(link.race_number, revision.race_number) AS raceIndex,
              placement.finish_position AS finishPosition,
              (event.mu_after - 3 * event.sigma_after) AS score,
              event.mu_after AS mu, event.sigma_after AS sigma
       FROM player_rating_events AS event
       INNER JOIN players AS player ON player.player_id = event.player_id
       INNER JOIN tournament_race_result_revisions AS revision
         ON revision.tournament_race_result_revision_id = event.tournament_race_result_revision_id
       INNER JOIN tournament_race_placements AS placement
         ON placement.tournament_race_result_revision_id = revision.tournament_race_result_revision_id
        AND placement.player_id = event.player_id
       INNER JOIN tournament_publication_current_members AS member
         ON member.tournament_race_result_id = revision.tournament_race_result_id
       INNER JOIN tournament_publications AS publication
         ON publication.tournament_publication_id = member.tournament_publication_id
       LEFT JOIN tournaments AS tournament
         ON tournament.tournament_publication_id = publication.tournament_publication_id
       LEFT JOIN tournament_group_races AS link
         ON link.tournament_race_result_id = revision.tournament_race_result_id
       LEFT JOIN tournament_groups AS grp ON grp.tournament_group_id = link.tournament_group_id
       WHERE player.public_id = ? AND player.record_status = 'active'
         AND player.visibility = 'public'
         AND event.event_type = 'race_result'
         AND event.rating_epoch = (SELECT COALESCE(MAX(rating_recalculation_id), 0) FROM rating_recalculations)
         AND publication.publication_status = 'published'
         AND publication.public_visibility = 'public'
         AND tournament.edition_number IS NOT NULL
       ORDER BY event.sequence_number ASC
       LIMIT 2000`,
      [playerId],
    );
    const legacyMax = rows.reduce((max, row) => Math.max(max, Number(row["sequence"]) || 0), 0);
    const canonical = canonicalRows.flatMap((row, index) => {
      const tournamentNumber = Number(row["tournamentNumber"]);
      const raceIndex = Number(row["raceIndex"]);
      const finishPosition = Number(row["finishPosition"]);
      const score = Number(row["score"]);
      return Number.isSafeInteger(raceIndex) && Number.isSafeInteger(finishPosition) &&
        Number.isSafeInteger(tournamentNumber) && tournamentNumber >= 1 &&
        Number.isFinite(score) && typeof row["sectionLabel"] === "string"
        ? [{
            sequence: legacyMax + index + 1,
            tournamentNumber,
            sectionLabel: row["sectionLabel"].slice(0, 96),
            raceIndex,
            finishPosition,
            score: Math.round(score * 100) / 100,
            ...(Number.isFinite(Number(row["mu"])) && Number.isFinite(Number(row["sigma"]))
              ? { mu: Number(row["mu"]), sigma: Number(row["sigma"]) }
              : {}),
          }]
        : [];
    });
    // The score is derived rather than stored: mu - 3*sigma, the same figure
    // the standing shows. A race excluded from rating has no event, so its mu
    // and sigma arrive null; the trajectory carries the previous values
    // forward, because that is what "the rating did not move" looks like.
    let carriedMu: number | null = null;
    let carriedSigma: number | null = null;
    const legacy = rows.flatMap((row) => {
      const sequence = Number(row["sequence"]);
      const tournamentNumber = Number(row["tournamentNumber"]);
      const raceIndex = Number(row["raceIndex"]);
      const finishPosition = Number(row["finishPosition"]);
      const rowMu = Number(row["mu"]);
      const rowSigma = Number(row["sigma"]);
      if (Number.isFinite(rowMu) && Number.isFinite(rowSigma)) {
        carriedMu = rowMu;
        carriedSigma = rowSigma;
      }
      if (carriedMu === null || carriedSigma === null) { return []; }
      const score = Math.round((carriedMu - 3 * carriedSigma) * 100) / 100;
      return Number.isSafeInteger(sequence) &&
        Number.isSafeInteger(tournamentNumber) &&
        Number.isSafeInteger(raceIndex) &&
        Number.isSafeInteger(finishPosition) &&
        Number.isFinite(score) &&
        typeof row["sectionLabel"] === "string"
        ? [{
            sequence,
            tournamentNumber,
            sectionLabel: row["sectionLabel"],
            raceIndex,
            finishPosition,
            score,
            mu: carriedMu,
            sigma: carriedSigma,
          }]
        : [];
    });
    return [...legacy, ...canonical].slice(0, 2000);
  }

  // Derived section standings: total points per Player per tournament
  // section using the official MK8DX finish-position scoring
  // (15/12/10/9/8/7/6/5/4/3/2/1), owner-validated against the real
  // tournament outcomes. Labeled as derived in the product.
  public async listTournamentStandings(): Promise<readonly Readonly<{
    tournamentNumber: number;
    sectionLabel: string;
    standings: readonly Readonly<{
      playerId: string;
      displayName: string;
      points: number;
      races: number;
      characterId?: string;
      characterVariantId?: string;
    }>[];
  }>[]> {
    const [[rows], [historyCharacterRows]] = await Promise.all([
      this.executor.execute<RowDataPacket[]>(`${CORRECTED_HISTORY_SECTION_STANDINGS}`),
      this.executor.execute<RowDataPacket[]>(`${CORRECTED_HISTORY_SECTION_CHARACTER_USE}`),
    ]);
    const historyCharacters = tournamentCharacters(historyCharacterRows);
    const sections = new Map<string, {
      tournamentNumber: number;
      sectionLabel: string;
      standings: {
        playerId: string;
        displayName: string;
        points: number;
        races: number;
        characterId?: string;
        characterVariantId?: string;
      }[];
    }>();
    for (const row of rows) {
      const tournamentNumber = Number(row["tournamentNumber"]);
      const points = Number(row["points"]);
      const races = Number(row["races"]);
      if (typeof row["sectionLabel"] !== "string" ||
          typeof row["playerId"] !== "string" ||
          typeof row["displayName"] !== "string" ||
          !Number.isSafeInteger(tournamentNumber) ||
          !Number.isSafeInteger(points) ||
          !Number.isSafeInteger(races) || races <= 0) {
        continue;
      }
      const key = `${tournamentNumber}#${row["sectionLabel"]}`;
      const section = sections.get(key) ?? {
        tournamentNumber,
        sectionLabel: row["sectionLabel"],
        standings: [],
      };
      section.standings.push({
        playerId: row["playerId"],
        displayName: row["displayName"],
        points,
        races,
        ...historyCharacters.get(`${key}#${row["playerId"]}`),
      });
      sections.set(key, section);
    }
    // Canonical finalized tournaments (ADR-0160) continue the derived series
    // when they carry an edition number and their results are public: one
    // section per final group (or per qualifier group when no finals were
    // played), points summed over the counted canonical races.
    const [canonicalRows] = await this.executor.execute<RowDataPacket[]>(
      `SELECT tournament.edition_number AS tournamentNumber,
              grp.name AS sectionLabel,
              player.public_id AS playerId,
              player.display_name AS displayName,
              SUM(placement.race_points) AS points,
              COUNT(*) AS races,
              grp.stage AS groupStage,
              grp.sequence_number AS groupSequence,
              member.character_key AS groupCharacterId
       FROM tournaments AS tournament
       INNER JOIN tournament_publications AS publication
         ON publication.tournament_publication_id = tournament.tournament_publication_id
        AND publication.publication_status = 'published'
        AND publication.public_visibility = 'public'
       INNER JOIN tournament_groups AS grp ON grp.tournament_id = tournament.tournament_id
       INNER JOIN tournament_group_races AS link ON link.tournament_group_id = grp.tournament_group_id
       INNER JOIN tournament_race_result_revisions AS revision
         ON revision.tournament_race_result_id = link.tournament_race_result_id
        AND revision.revision_number = (
          SELECT MAX(latest.revision_number) FROM tournament_race_result_revisions AS latest
          WHERE latest.tournament_race_result_id = revision.tournament_race_result_id)
        AND revision.counts_toward_standings = TRUE
       INNER JOIN tournament_race_placements AS placement
         ON placement.tournament_race_result_revision_id = revision.tournament_race_result_revision_id
       INNER JOIN players AS player
         ON player.player_id = placement.player_id
        AND player.record_status = 'active'
        AND player.visibility = 'public'
       LEFT JOIN tournament_group_members AS member
         ON member.tournament_group_id = grp.tournament_group_id
        AND member.player_id = player.player_id
       WHERE tournament.stage = 'finalized' AND tournament.public_results = TRUE
         AND tournament.edition_number IS NOT NULL
         AND (grp.stage = 'final' OR NOT EXISTS (
           SELECT 1 FROM tournament_groups AS finals
           WHERE finals.tournament_id = tournament.tournament_id AND finals.stage = 'final'))
       GROUP BY tournament.tournament_id, tournament.edition_number, grp.tournament_group_id,
                grp.name, grp.stage, grp.sequence_number,
                player.player_id, player.public_id, player.display_name,
                member.character_key
       ORDER BY tournament.edition_number ASC, grp.sequence_number ASC,
                points DESC, player.public_id ASC`,
    );
    const [canonicalCharacterRows] = await this.executor.execute<RowDataPacket[]>(
      `SELECT tournament.edition_number AS tournamentNumber,
              grp.name AS sectionLabel,
              player.public_id AS playerId,
              placement.character_id AS characterId,
              placement.character_variant_id AS characterVariantId,
              COUNT(*) AS uses,
              grp.sequence_number AS groupSequence
       FROM tournaments AS tournament
       INNER JOIN tournament_publications AS publication
         ON publication.tournament_publication_id = tournament.tournament_publication_id
        AND publication.publication_status = 'published'
        AND publication.public_visibility = 'public'
       INNER JOIN tournament_groups AS grp ON grp.tournament_id = tournament.tournament_id
       INNER JOIN tournament_group_races AS link ON link.tournament_group_id = grp.tournament_group_id
       INNER JOIN tournament_race_result_revisions AS revision
         ON revision.tournament_race_result_id = link.tournament_race_result_id
        AND revision.revision_number = (
          SELECT MAX(latest.revision_number) FROM tournament_race_result_revisions AS latest
          WHERE latest.tournament_race_result_id = revision.tournament_race_result_id)
        AND revision.counts_toward_standings = TRUE
       INNER JOIN tournament_race_placements AS placement
         ON placement.tournament_race_result_revision_id = revision.tournament_race_result_revision_id
       INNER JOIN players AS player
         ON player.player_id = placement.player_id
        AND player.record_status = 'active'
        AND player.visibility = 'public'
       WHERE tournament.stage = 'finalized' AND tournament.public_results = TRUE
         AND tournament.edition_number IS NOT NULL
         AND placement.character_id IS NOT NULL
         AND (grp.stage = 'final' OR NOT EXISTS (
           SELECT 1 FROM tournament_groups AS finals
           WHERE finals.tournament_id = tournament.tournament_id AND finals.stage = 'final'))
       GROUP BY tournament.tournament_id, tournament.edition_number,
                grp.tournament_group_id, grp.name, grp.sequence_number,
                player.player_id, player.public_id,
                placement.character_id, placement.character_variant_id
       ORDER BY tournament.edition_number ASC, grp.sequence_number ASC,
                player.public_id ASC, uses DESC, placement.character_id ASC,
                placement.character_variant_id ASC`,
    );
    const canonicalCharacters = tournamentCharacters(canonicalCharacterRows);
    for (const row of canonicalRows) {
      const tournamentNumber = Number(row["tournamentNumber"]);
      const points = Number(row["points"]);
      const races = Number(row["races"]);
      if (typeof row["sectionLabel"] !== "string" ||
          typeof row["playerId"] !== "string" ||
          typeof row["displayName"] !== "string" ||
          !Number.isSafeInteger(tournamentNumber) || tournamentNumber < 1 ||
          !Number.isSafeInteger(points) ||
          !Number.isSafeInteger(races) || races <= 0) {
        continue;
      }
      const key = `${tournamentNumber}#${row["sectionLabel"]}`;
      const section = sections.get(key) ?? {
        tournamentNumber,
        sectionLabel: row["sectionLabel"],
        standings: [],
      };
      if (section.standings.length >= 12) { continue; }
      const recordedCharacter = canonicalCharacters.get(
        `${key}#${row["playerId"]}`);
      const memberCharacter = groupCharacter(row["groupCharacterId"]);
      section.standings.push({
        playerId: row["playerId"],
        displayName: row["displayName"],
        points,
        races,
        ...(recordedCharacter ?? memberCharacter),
      });
      sections.set(key, section);
    }
    return [...sections.values()].slice(0, 200);
  }

  // Every opponent this Player shared races with - the imported legacy races
  // and the nights the console ran itself: how often each finished ahead (the
  // "toughest opponent" source) and how often the Player finished ahead of
  // them.
  public async listOpponents(
    playerId: string,
  ): Promise<readonly Readonly<{
    playerId: string;
    displayName: string;
    sharedRaces: number;
    aheadOfMe: number;
    meAhead: number;
  }>[]> {
    const [rows] = await this.executor.execute<RowDataPacket[]>(
      `SELECT other.public_id AS playerId,
              other.display_name AS displayName,
              COUNT(*) AS sharedRaces,
              SUM(pair.other_finish < pair.my_finish) AS aheadOfMe,
              SUM(pair.my_finish < pair.other_finish) AS meAhead
       FROM (
         SELECT pm.player_id AS my_id, po.player_id AS other_id,
                pm.finish_position AS my_finish, po.finish_position AS other_finish
         FROM legacy_race_placements AS pm
         INNER JOIN legacy_race_placements AS po
           ON po.legacy_tournament_race_id = pm.legacy_tournament_race_id
          AND po.player_id <> pm.player_id
         UNION ALL
         SELECT pm.player_id, po.player_id, pm.finish_position, po.finish_position
         FROM (${CONSOLE_NIGHT_PLACEMENTS}) AS pm
         INNER JOIN (${CONSOLE_NIGHT_PLACEMENTS}) AS po
           ON po.race_key = pm.race_key
          AND po.player_id <> pm.player_id
       ) AS pair
       INNER JOIN players AS me
         ON me.player_id = pair.my_id
        AND me.public_id = ? AND me.record_status = 'active'
        AND me.visibility = 'public'
       INNER JOIN players AS other
         ON other.player_id = pair.other_id
        AND other.record_status = 'active'
        AND other.visibility = 'public'
       GROUP BY other.player_id, other.public_id, other.display_name
       ORDER BY sharedRaces DESC, other.public_id ASC
       LIMIT 100`,
      [playerId],
    );
    return rows.flatMap((row) => {
      const sharedRaces = Number(row["sharedRaces"]);
      const aheadOfMe = Number(row["aheadOfMe"]);
      const meAhead = Number(row["meAhead"]);
      return typeof row["playerId"] === "string" &&
        typeof row["displayName"] === "string" &&
        Number.isSafeInteger(sharedRaces) && sharedRaces > 0 &&
        Number.isSafeInteger(aheadOfMe) && Number.isSafeInteger(meAhead)
        ? [{
            playerId: row["playerId"],
            displayName: row["displayName"],
            sharedRaces,
            aheadOfMe,
            meAhead,
          }]
        : [];
    });
  }

  public async headToHead(
    playerAId: string,
    playerBId: string,
  ): Promise<HeadToHead> {
    const [rows] = await this.executor.execute<RowDataPacket[]>(
      // The imported legacy races and the nights the console ran itself; a
      // console night is filed under its own edition number, which a public
      // night can no longer be finalized without.
      `SELECT pair.tournament_number AS tournamentNumber,
              COUNT(*) AS sharedRaces,
              SUM(pair.a_finish < pair.b_finish) AS aAhead,
              SUM(pair.b_finish < pair.a_finish) AS bAhead,
              AVG(pair.a_finish) AS averageFinishA,
              AVG(pair.b_finish) AS averageFinishB
       FROM (
         SELECT race.tournament_number AS tournament_number,
                pa.player_id AS a_id, pb.player_id AS b_id,
                pa.finish_position AS a_finish, pb.finish_position AS b_finish
         FROM legacy_race_placements AS pa
         INNER JOIN legacy_race_placements AS pb
           ON pb.legacy_tournament_race_id = pa.legacy_tournament_race_id
         INNER JOIN legacy_tournament_races AS race
           ON race.legacy_tournament_race_id = pa.legacy_tournament_race_id
         UNION ALL
         SELECT pa.edition_number, pa.player_id, pb.player_id,
                pa.finish_position, pb.finish_position
         FROM (${CONSOLE_NIGHT_PLACEMENTS}) AS pa
         INNER JOIN (${CONSOLE_NIGHT_PLACEMENTS}) AS pb
           ON pb.race_key = pa.race_key
         WHERE pa.edition_number IS NOT NULL
       ) AS pair
       INNER JOIN players AS a
         ON a.player_id = pair.a_id
        AND a.public_id = ? AND a.record_status = 'active'
        AND a.visibility = 'public'
       INNER JOIN players AS b
         ON b.player_id = pair.b_id
        AND b.public_id = ? AND b.record_status = 'active'
        AND b.visibility = 'public'
       GROUP BY pair.tournament_number
       ORDER BY pair.tournament_number ASC`,
      [playerAId, playerBId],
    );
    let sharedRaces = 0;
    let aAhead = 0;
    let bAhead = 0;
    let finishSumA = 0;
    let finishSumB = 0;
    const byTournament: HeadToHeadTournament[] = [];
    for (const row of rows) {
      const tournamentNumber = Number(row["tournamentNumber"]);
      const shared = Number(row["sharedRaces"]);
      const a = Number(row["aAhead"]);
      const b = Number(row["bAhead"]);
      const avgA = Number(row["averageFinishA"]);
      const avgB = Number(row["averageFinishB"]);
      if (!Number.isSafeInteger(tournamentNumber) ||
          !Number.isSafeInteger(shared) || shared <= 0 ||
          !Number.isSafeInteger(a) || !Number.isSafeInteger(b) ||
          !Number.isFinite(avgA) || !Number.isFinite(avgB)) {
        continue;
      }
      sharedRaces += shared;
      aAhead += a;
      bAhead += b;
      finishSumA += avgA * shared;
      finishSumB += avgB * shared;
      byTournament.push({
        tournamentNumber,
        sharedRaces: shared,
        aAhead: a,
        bAhead: b,
      });
    }
    return {
      sharedRaces,
      aAhead,
      bAhead,
      averageFinishA: sharedRaces > 0 ? finishSumA / sharedRaces : 0,
      averageFinishB: sharedRaces > 0 ? finishSumB / sharedRaces : 0,
      byTournament,
    };
  }
}
