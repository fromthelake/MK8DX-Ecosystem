import type { RowDataPacket } from "mysql2";

import type { PreparedQueryExecutor } from "../identity/mysql-identity-read-repository.js";
import {
  canonicalNightKey,
  DIRECTOR_NAME_SQL,
  historyEditionNight,
  lastPlayerNight,
  playerNightDirectorNames,
  PlayerNightLedger,
} from "../tournaments/player-nights.js";
import type { ClaimCandidateRepository } from "./claim-candidate-service.js";
import {
  EMPTY_CLAIM_CANDIDATE_CONTEXT,
  type ClaimCandidateContext,
  type NamedClaimPlayer,
} from "./claim-candidates.js";

type Row = RowDataPacket & Record<string, unknown>;

class ClaimCandidatePersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ClaimCandidatePersistenceError";
  }
}

function integer(value: unknown, field: string, minimum = 0): number {
  const parsed = typeof value === "string" && /^[0-9]+$/u.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new ClaimCandidatePersistenceError(`${field} is invalid`);
  }
  return parsed;
}

function nullableInteger(value: unknown, field: string, minimum = 0): number | null {
  return value === null || value === undefined ? null : integer(value, field, minimum);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ClaimCandidatePersistenceError(`${field} is invalid`);
  }
  return value;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Newline-separated public aliases: an alias is a single-line VARCHAR and may hold a comma. */
function aliasList(value: unknown): readonly string[] {
  if (typeof value !== "string" || value.length === 0) { return []; }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value.split("\n")) {
    const trimmed = entry.trim();
    if (trimmed.length === 0 || trimmed.length > 128 || seen.has(trimmed.toLowerCase())) { continue; }
    seen.add(trimmed.toLowerCase());
    result.push(trimmed);
    if (result.length >= 32) { break; }
  }
  return result;
}

function utcDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

/**
 * ADR-0219: only what the site already shows anyone. Time Trials count when
 * their publication is `published` (a private Player's are withheld by the
 * visibility cascade); nights count when the Tournament's publication is
 * published and public, plus the legacy and history editions; a private
 * Player gets no context at all, as on every public page.
 */
export class MysqlClaimCandidateRepository implements ClaimCandidateRepository {
  public constructor(private readonly executor: PreparedQueryExecutor) {}

  public async listNamedPlayers(): Promise<readonly NamedClaimPlayer[]> {
    const [rows] = await this.executor.execute<Row[]>(
      `SELECT p.player_id AS internalId, p.public_id AS playerId,
              u.username_value AS username, p.display_name AS displayName,
              (SELECT GROUP_CONCAT(a.alias_text SEPARATOR '\n')
                 FROM aliases AS a
                WHERE a.player_id = p.player_id
                  AND a.record_status = 'active'
                  AND a.visibility = 'public'
                  AND a.director_user_account_id IS NULL) AS aliasList
       FROM players AS p
       INNER JOIN player_username_history AS u
         ON u.player_id = p.player_id AND u.released_at_ms IS NULL
       WHERE p.player_kind = 'human' AND p.record_status = 'active'
       ORDER BY p.display_name ASC, u.username_value ASC
       LIMIT 5000`,
    );
    return rows.map((row) => ({
      internalId: integer(row["internalId"], "player id", 1),
      playerId: text(row["playerId"], "playerId"),
      username: text(row["username"], "username"),
      displayName: text(row["displayName"], "displayName"),
      aliases: aliasList(row["aliasList"]),
    }));
  }

  public async loadContexts(playerInternalIds: readonly number[]): Promise<ReadonlyMap<number, ClaimCandidateContext>> {
    const ids = [...new Set(playerInternalIds)].filter((id) => Number.isSafeInteger(id) && id > 0);
    const contexts = new Map<number, ClaimCandidateContext>();
    if (ids.length === 0) { return contexts; }
    const list = placeholders(ids.length);

    const [visibilityRows] = await this.executor.execute<Row[]>(
      `SELECT p.player_id AS internalId, p.visibility AS visibility,
              EXISTS (SELECT 1 FROM player_claims AS claim
                       WHERE claim.player_id = p.player_id AND claim.claim_status = 'verified') AS claimed
       FROM players AS p WHERE p.player_id IN (${list})`,
      ids,
    );
    const [trialRows] = await this.executor.execute<Row[]>(
      `SELECT revision.player_id AS internalId, COUNT(*) AS times,
              MAX(COALESCE(revision.occurred_at_ms, revision.captured_at_ms,
                           revision.submitted_at_ms, revision.created_at_ms)) AS lastAtMs,
              SUM(revision.mode_cc = 150) AS times150, SUM(revision.mode_cc = 200) AS times200
       FROM time_trial_publications AS publication
       INNER JOIN time_trial_submission_revisions AS revision
         ON revision.time_trial_submission_revision_id = publication.current_revision_id
       WHERE publication.publication_status = 'published' AND revision.player_id IN (${list})
       GROUP BY revision.player_id`,
      ids,
    );
    const [nightRows] = await this.executor.execute<Row[]>(
      `SELECT participant.player_id AS internalId, t.tournament_id AS tournamentInternalId,
              t.name AS name, t.event_date AS eventDate, t.start_at_ms AS startAtMs,
              t.edition_number AS editionNumber, t.director_user_account_id AS directorInternalId,
              ${DIRECTOR_NAME_SQL("t.director_user_account_id")} AS directorName
       FROM tournament_participants AS participant
       INNER JOIN tournaments AS t
         ON t.tournament_id = participant.tournament_id AND t.lifecycle_status = 'active'
       INNER JOIN tournament_publications AS publication
         ON publication.tournament_publication_id = t.tournament_publication_id
        AND publication.publication_status = 'published'
        AND publication.public_visibility = 'public'
       WHERE participant.attendance = 'present' AND participant.player_id IN (${list})`,
      ids,
    );
    const [editionRows] = await this.executor.execute<Row[]>(
      `SELECT DISTINCT placement.player_id AS internalId, race.tournament_number AS editionNumber
       FROM legacy_race_placements AS placement
       INNER JOIN legacy_tournament_races AS race
         ON race.legacy_tournament_race_id = placement.legacy_tournament_race_id
       WHERE placement.player_id IN (${list})
       UNION
       SELECT DISTINCT placement.player_id, section.tournament_number
       FROM tournament_history_placements AS placement
       INNER JOIN tournament_history_races AS race
         ON race.tournament_history_race_id = placement.tournament_history_race_id
       INNER JOIN tournament_history_sections AS section
         ON section.tournament_history_section_id = race.tournament_history_section_id
       WHERE placement.player_id IN (${list})`,
      [...ids, ...ids],
    );

    const directorNames = new Map<number, string>();
    const nights = new PlayerNightLedger();
    for (const row of nightRows) {
      const director = integer(row["directorInternalId"], "tournament director", 1);
      const name = nullableText(row["directorName"]);
      if (name !== null) { directorNames.set(director, name); }
      nights.add(integer(row["internalId"], "participant player", 1), {
        key: canonicalNightKey(
          integer(row["tournamentInternalId"], "tournament", 1),
          nullableInteger(row["editionNumber"], "edition", 1),
        ),
        name: nullableText(row["name"]),
        date: nullableText(row["eventDate"]),
        at: nullableInteger(row["startAtMs"], "start", 0) ?? 0,
        director,
      });
    }
    for (const row of editionRows) {
      nights.add(integer(row["internalId"], "edition player", 1), historyEditionNight(integer(row["editionNumber"], "edition", 1)));
    }
    const trials = new Map<number, Row>();
    for (const row of trialRows) { trials.set(integer(row["internalId"], "time trial player", 1), row); }

    for (const row of visibilityRows) {
      const id = integer(row["internalId"], "player id", 1);
      const claimed = Number(row["claimed"] ?? 0) === 1;
      if (row["visibility"] === "private") {
        contexts.set(id, { ...EMPTY_CLAIM_CANDIDATE_CONTEXT, claimed });
        continue;
      }
      const trial = trials.get(id);
      const lastAtMs = trial === undefined ? null : nullableInteger(trial["lastAtMs"], "last time", 0);
      const classes: (150 | 200)[] = [];
      if (trial !== undefined && Number(trial["times150"] ?? 0) > 0) { classes.push(150); }
      if (trial !== undefined && Number(trial["times200"] ?? 0) > 0) { classes.push(200); }
      const own = nights.of(id);
      const last = lastPlayerNight(own);
      contexts.set(id, {
        claimed,
        timeTrials: {
          times: trial === undefined ? 0 : integer(trial["times"], "time trial count", 0),
          lastAt: lastAtMs === null ? null : utcDate(lastAtMs),
          classes,
        },
        tournaments: {
          nights: own.length,
          directorNames: playerNightDirectorNames(own, directorNames),
          lastNight: last === null ? null : { name: last.name ?? last.key, date: last.date },
        },
      });
    }
    return contexts;
  }
}
