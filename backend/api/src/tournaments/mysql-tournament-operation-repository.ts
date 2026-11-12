import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import type {
  GroupRaceRecord,
  GroupRecord,
  HistoricalPlayerRecord,
  LifecycleRecord,
  ManualScoreRecord,
  ParticipantRecord,
  PlayerRecord,
  TournamentOperationRepository,
  TournamentOperationTransaction,
  TournamentRecord,
} from "./tournament-operation-service.js";
import type {
  TournamentAttendance,
  TournamentGroupStage,
  TournamentOwnerSeatingMode,
  TournamentPlacementStrategy,
  TournamentRankedSeedingSource,
  TournamentSeedOrder,
  TournamentStage,
  TournamentSwitchType,
  TournamentTieBreakMode,
  TournamentTieBreakOrder,
} from "./tournament-operation-domain.js";
import { type TournamentRaceMode, isTournamentRaceMode } from "./race-result-validation.js";
import { randomBytes } from "node:crypto";
import { rosterNameKey } from "./tournament-operation-service.js";
import type { RosterCandidateContext } from "./roster-player-candidates.js";
import {
  canonicalNightKey,
  DIRECTOR_NAME_SQL,
  historyEditionNight,
  lastPlayerNight,
  playerNightDirectorNames,
  PlayerNightLedger,
} from "./player-nights.js";

export class TournamentOperationPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TournamentOperationPersistenceError";
  }
}

function integer(value: unknown, label: string, minimum = 0): number {
  const parsed = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new TournamentOperationPersistenceError(`${label} is invalid`);
  }
  return parsed;
}

function nullableInteger(value: unknown, label: string, minimum = 0): number | null {
  return value === null || value === undefined ? null : integer(value, label, minimum);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 1) {
    throw new TournamentOperationPersistenceError(`${label} is invalid`);
  }
  return value;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function flag(value: unknown): boolean {
  return integer(value, "flag") === 1;
}

function tieBreakOrders(value: unknown): readonly TournamentTieBreakOrder[] {
  if (value === null || value === undefined) { return []; }
  let parsed: unknown = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { throw new TournamentOperationPersistenceError("tie-break orders are invalid"); }
  }
  if (!Array.isArray(parsed)) { throw new TournamentOperationPersistenceError("tie-break orders are invalid"); }
  return parsed.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new TournamentOperationPersistenceError("tie-break order is invalid");
    }
    const candidate = entry as Record<string, unknown>;
    const points = integer(candidate["points"], "tie-break points");
    const playerIds = candidate["playerIds"];
    if (!Array.isArray(playerIds) || !playerIds.every((id) => typeof id === "string" && id.length > 0)) {
      throw new TournamentOperationPersistenceError("tie-break Players are invalid");
    }
    return { points, playerIds: playerIds as string[] };
  });
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new TournamentOperationPersistenceError(`${label} is invalid`);
  }
  return value as T;
}

function assertAffected(result: ResultSetHeader, minimum: number, operation: string): void {
  if (result.affectedRows < minimum) {
    throw new TournamentOperationPersistenceError(`${operation} did not persist`);
  }
}

const tournamentProjection = `SELECT t.tournament_id AS internalId, t.public_id AS tournamentId,
       t.name AS name, t.series_label AS seriesLabel, t.edition_number AS editionNumber,
       t.event_date AS eventDate, t.start_at_ms AS startAtMs, t.timezone_name AS timezone,
       t.stage AS stage, t.workflow_step AS workflowStep,
       t.qualifier_rounds AS qualifierRounds, t.max_participants AS maxParticipants,
       t.revision AS revision, t.seed_order AS seedOrder,
       t.seeding_source AS seedingSource, t.verified_only AS verifiedOnly,
       t.placement_strategy AS placementStrategy,
       t.owner_seating_mode AS ownerSeatingMode,
       t.qualifier_tie_break_mode AS qualifierTieBreakMode,
       t.final_tie_break_mode AS finalTieBreakMode, t.public_results AS publicResults,
       t.affects_rating AS affectsRating, publication.public_id AS publicationId,
       publication.public_visibility AS publicationVisibility,
       t.director_user_account_id AS directorInternalId,
       t.lifecycle_status AS lifecycleStatus,
       t.finalized_at_ms AS finalizedAtMs, t.created_at_ms AS createdAtMs,
       t.updated_at_ms AS updatedAtMs
FROM tournaments AS t
LEFT JOIN tournament_publications AS publication
  ON publication.tournament_publication_id = t.tournament_publication_id`;

function tournamentRecord(row: RowDataPacket): TournamentRecord {
  const visibility = row["publicationVisibility"];
  return {
    internalId: integer(row["internalId"], "tournament id", 1),
    tournamentId: text(row["tournamentId"], "tournament public id"),
    name: text(row["name"], "tournament name"),
    seriesLabel: nullableText(row["seriesLabel"]),
    editionNumber: nullableInteger(row["editionNumber"], "edition", 1),
    eventDate: nullableText(row["eventDate"]),
    startAtMs: nullableInteger(row["startAtMs"], "start timestamp"),
    timezone: nullableText(row["timezone"]),
    stage: oneOf<TournamentStage>(row["stage"], ["setup", "qualifiers", "finals", "finalized"], "stage"),
    workflowStep: integer(row["workflowStep"], "workflow step", 2),
    qualifierRounds: flag(row["qualifierRounds"]),
    maxParticipants: nullableInteger(row["maxParticipants"], "max participants", 1),
    revision: integer(row["revision"], "revision", 1),
    seedOrder: oneOf<TournamentSeedOrder>(row["seedOrder"], ["ranked", "random"], "seed order"),
    seedingSource: row["seedingSource"] === null || row["seedingSource"] === undefined
      ? null
      : oneOf<TournamentRankedSeedingSource>(
        row["seedingSource"], ["community_rating", "director_nights", "manual"], "seeding source",
      ),
    verifiedOnly: row["verifiedOnly"] === undefined ? false : flag(row["verifiedOnly"]),
    placementStrategy: oneOf<TournamentPlacementStrategy>(
      row["placementStrategy"], ["balanced", "minimal_move"], "placement strategy",
    ),
    ownerSeatingMode: oneOf<TournamentOwnerSeatingMode>(
      row["ownerSeatingMode"], ["owner_strict", "owner_soft"], "owner seating mode",
    ),
    qualifierTieBreakMode: oneOf<TournamentTieBreakMode>(
      row["qualifierTieBreakMode"], ["sp", "lottery", "manual"], "qualifier tie-break mode",
    ),
    finalTieBreakMode: oneOf<TournamentTieBreakMode>(
      row["finalTieBreakMode"], ["sp", "lottery", "manual"], "final tie-break mode",
    ),
    publicResults: flag(row["publicResults"]),
    affectsRating: flag(row["affectsRating"]),
    publicationId: nullableText(row["publicationId"]),
    publicationVisibility: visibility === "public" || visibility === "hidden" ? visibility : null,
    lifecycleStatus: typeof row["lifecycleStatus"] === "string" ? row["lifecycleStatus"] : "active",
    directorInternalId: integer(row["directorInternalId"], "director account id", 1),
    finalizedAtMs: nullableInteger(row["finalizedAtMs"], "finalized timestamp"),
    createdAtMs: integer(row["createdAtMs"], "created timestamp"),
    updatedAtMs: integer(row["updatedAtMs"], "updated timestamp"),
  };
}

function playerRecord(row: RowDataPacket): PlayerRecord {
  return {
    internalId: integer(row["playerInternalId"], "player id", 1),
    playerId: text(row["playerId"], "player public id"),
    username: typeof row["username"] === "string" && row["username"].length > 0
      ? row["username"]
      : text(row["playerId"], "player public id"),
    displayName: text(row["displayName"], "display name"),
    visibility: row["visibility"] === "private" ? "private" : "public",
    active: row["recordStatus"] === "active" && row["playerKind"] === "human",
  };
}

const playerProjection = `SELECT player.player_id AS playerInternalId, player.public_id AS playerId,
       username.username_value AS username, player.display_name AS displayName,
       player.visibility AS visibility, player.record_status AS recordStatus,
       player.player_kind AS playerKind
FROM players AS player
LEFT JOIN player_username_history AS username
  ON username.player_id = player.player_id AND username.released_at_ms IS NULL`;

class MysqlTournamentOperationTransaction implements TournamentOperationTransaction {
  public constructor(private readonly connection: PoolConnection) {}

  public async findActiveAdministratorAccount(userAccountId: string): Promise<number | null> {
    const account = await this.findTournamentOperatorAccount(userAccountId);
    return account === null || !account.isAdministrator ? null : account.internalId;
  }

  public async findTournamentOperatorAccount(
    userAccountId: string,
  ): Promise<Readonly<{ internalId: number; isAdministrator: boolean }> | null> {
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT account.user_account_id AS internalId,
              EXISTS (
                SELECT 1 FROM administrator_grants AS grant_row
                WHERE grant_row.user_account_id = account.user_account_id
                  AND grant_row.grant_status = 'active'
              ) AS isAdministrator,
              EXISTS (
                SELECT 1 FROM account_capability_grants AS capability
                WHERE capability.user_account_id = account.user_account_id
                  AND capability.capability_code = 'tournament.operation'
                  AND capability.grant_status = 'active'
              ) AS hasCapability
       FROM user_accounts AS account
       WHERE account.public_id = ? AND account.account_status = 'active'
       LIMIT 1`,
      [userAccountId],
    );
    const row = rows[0];
    if (row === undefined) { return null; }
    const isAdministrator = flag(row["isAdministrator"]);
    if (!isAdministrator && !flag(row["hasCapability"])) { return null; }
    return { internalId: integer(row["internalId"], "account id", 1), isAdministrator };
  }

  public async listSelectableDirectors(): Promise<readonly Readonly<{
    userAccountId: string;
    internalId: number;
    displayName: string;
    isAdministrator: boolean;
    hasCapability: boolean;
  }>[]> {
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT account.public_id AS userAccountId,
              account.user_account_id AS internalId,
              COALESCE(claimedPlayer.display_name, NULLIF(TRIM(account.screen_name), ''),
                       NULLIF(TRIM(offlineAccount.display_label), '')) AS displayName,
              EXISTS (
                SELECT 1 FROM administrator_grants AS grant_row
                WHERE grant_row.user_account_id = account.user_account_id
                  AND grant_row.grant_status = 'active'
              ) AS isAdministrator,
              EXISTS (
                SELECT 1 FROM account_capability_grants AS capability
                WHERE capability.user_account_id = account.user_account_id
                  AND capability.capability_code = 'tournament.operation'
                  AND capability.grant_status = 'active'
              ) AS hasCapability
       FROM user_accounts AS account
       LEFT JOIN player_claims AS claim
         ON claim.user_account_id = account.user_account_id
        AND claim.claim_status = 'verified'
       LEFT JOIN players AS claimedPlayer
         ON claimedPlayer.player_id = claim.player_id
       LEFT JOIN offline_auth_accounts AS offlineAccount
         ON offlineAccount.user_account_id = account.user_account_id
       WHERE account.account_status = 'active'
       HAVING isAdministrator = 1 OR hasCapability = 1
       ORDER BY displayName IS NULL, displayName ASC, account.public_id ASC`,
    );
    return rows.map((row) => ({
      userAccountId: text(row["userAccountId"], "account public id"),
      internalId: integer(row["internalId"], "account id", 1),
      // An operator without a claimed Player is still selectable under the name
      // they or the host gave the account; only with none is the identifier shown.
      displayName: nullableText(row["displayName"]) ?? text(row["userAccountId"], "account public id"),
      isAdministrator: flag(row["isAdministrator"]),
      hasCapability: flag(row["hasCapability"]),
    }));
  }

  public async findTournamentForUpdate(tournamentId: string): Promise<TournamentRecord | null> {
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `${tournamentProjection} WHERE t.public_id = ? AND t.lifecycle_status = 'active' LIMIT 1 FOR UPDATE`,
      [tournamentId],
    );
    return rows[0] === undefined ? null : tournamentRecord(rows[0]);
  }

  public async findTournament(tournamentId: string): Promise<TournamentRecord | null> {
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `${tournamentProjection} WHERE t.public_id = ? AND t.lifecycle_status = 'active' LIMIT 1`,
      [tournamentId],
    );
    return rows[0] === undefined ? null : tournamentRecord(rows[0]);
  }

  public async insertTournament(input: Parameters<TournamentOperationTransaction["insertTournament"]>[0]): Promise<number> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO tournaments (
         public_id, name, series_label, edition_number, event_date, start_at_ms,
         timezone_name, director_user_account_id, stage,
         workflow_step, qualifier_rounds, max_participants,
         revision, seed_order, seeding_source, placement_strategy, owner_seating_mode,
         public_results, affects_rating, verified_only,
         created_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'setup', 2, ?, ?, 1, ?, ?, ?, ?, TRUE, TRUE, ?, ?, ?)`,
      [
        input.tournamentId, input.name, input.seriesLabel, input.editionNumber, input.eventDate,
        input.startAtMs, input.timezone,
        input.directorInternalId, input.qualifierRounds, input.maxParticipants,
        input.seedOrder, input.seedingSource ?? null, input.placementStrategy, input.ownerSeatingMode,
        input.verifiedOnly === true, input.nowMs, input.nowMs,
      ],
    );
    assertAffected(result, 1, "tournament creation");
    return result.insertId;
  }

  public async updateTournament(input: Parameters<TournamentOperationTransaction["updateTournament"]>[0]): Promise<void> {
    const assignments: string[] = ["revision = ?", "updated_at_ms = ?"];
    const values: (string | number | boolean | null)[] = [input.revision, input.nowMs];
    const set = (column: string, value: string | number | boolean | null): void => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };
    if (input.name !== undefined) { set("name", input.name); }
    if (input.seriesLabel !== undefined) { set("series_label", input.seriesLabel); }
    if (input.editionNumber !== undefined) { set("edition_number", input.editionNumber); }
    if (input.eventDate !== undefined) { set("event_date", input.eventDate); }
    if (input.startAtMs !== undefined) { set("start_at_ms", input.startAtMs); }
    if (input.timezone !== undefined) { set("timezone_name", input.timezone); }
    if (input.stage !== undefined) { set("stage", input.stage); }
    if (input.workflowStep !== undefined) { set("workflow_step", input.workflowStep); }
    if (input.qualifierRounds !== undefined) { set("qualifier_rounds", input.qualifierRounds); }
    if (input.maxParticipants !== undefined) { set("max_participants", input.maxParticipants); }
    if (input.seedOrder !== undefined) { set("seed_order", input.seedOrder); }
    if (input.seedingSource !== undefined) { set("seeding_source", input.seedingSource); }
    if (input.verifiedOnly !== undefined) { set("verified_only", input.verifiedOnly); }
    if (input.placementStrategy !== undefined) { set("placement_strategy", input.placementStrategy); }
    if (input.ownerSeatingMode !== undefined) { set("owner_seating_mode", input.ownerSeatingMode); }
    if (input.qualifierTieBreakMode !== undefined) { set("qualifier_tie_break_mode", input.qualifierTieBreakMode); }
    if (input.finalTieBreakMode !== undefined) { set("final_tie_break_mode", input.finalTieBreakMode); }
    if (input.publicResults !== undefined) { set("public_results", input.publicResults); }
    if (input.affectsRating !== undefined) { set("affects_rating", input.affectsRating); }
    if (input.publicationInternalId !== undefined) {
      set("tournament_publication_id", input.publicationInternalId);
    }
    if (input.finalizedAtMs !== undefined) { set("finalized_at_ms", input.finalizedAtMs); }
    values.push(input.internalId);
    const [result] = await this.connection.execute<ResultSetHeader>(
      `UPDATE tournaments SET ${assignments.join(", ")} WHERE tournament_id = ?`,
      values,
    );
    assertAffected(result, 1, "tournament update");
  }

  public async listTournaments(options: Parameters<TournamentOperationTransaction["listTournaments"]>[0]) {
    // A removed night is gone from every list, which is what removing means.
    // An administrator asking for their own removed ones is the exception: the
    // way back was to type its id into a form, and nothing told them the id.
    const conditions: string[] = [options.includeRetracted === true
      ? "t.lifecycle_status IN ('active', 'retracted')"
      : "t.lifecycle_status = 'active'"];
    if (!options.includeUnfinalized) { conditions.push("t.stage = 'finalized'"); }
    if (!options.includeHiddenResults) {
      conditions.push(
        "(t.stage <> 'finalized' OR (t.public_results = TRUE AND (publication.public_visibility IS NULL OR publication.public_visibility = 'public')))",
      );
    }
    if (options.directorInternalId !== undefined) {
      conditions.push("t.director_user_account_id = ?");
    }
    const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `${tournamentProjection.replace("SELECT ", "SELECT COUNT(participant.tournament_participant_id) AS participantCount, SUM(participant.attendance = 'present') AS presentCount, ")}
       LEFT JOIN tournament_participants AS participant ON participant.tournament_id = t.tournament_id
       ${where}
       GROUP BY t.tournament_id, publication.tournament_publication_id
       ORDER BY (t.stage = 'finalized') ASC, COALESCE(t.finalized_at_ms, t.updated_at_ms) DESC, t.tournament_id DESC
       LIMIT 200`,
      options.directorInternalId === undefined ? [] : [options.directorInternalId],
    );
    return rows.map((row) => ({
      record: tournamentRecord(row),
      participantCount: integer(row["participantCount"] ?? 0, "participant count"),
      presentCount: integer(row["presentCount"] ?? 0, "present count"),
    }));
  }

  public async listTournamentsPlayedBy(userAccountId: string): Promise<readonly string[]> {
    // The Tournaments this account's own Player took part in: the nights they
    // were present at, and the past editions they have races in. Both are
    // public facts about a published night; this only saves the page from
    // reading every document to find out.
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT DISTINCT t.public_id AS tournamentId
         FROM player_claims AS claim
         INNER JOIN user_accounts AS account
            ON account.user_account_id = claim.user_account_id AND account.public_id = ?
         INNER JOIN tournament_participants AS participant
            ON participant.player_id = claim.player_id AND participant.attendance = 'present'
         INNER JOIN tournaments AS t
            ON t.tournament_id = participant.tournament_id AND t.lifecycle_status = 'active'
        WHERE claim.claim_status = 'verified'`,
      [userAccountId],
    );
    const [editions] = await this.connection.execute<RowDataPacket[]>(
      `SELECT DISTINCT section.tournament_number AS editionNumber
         FROM player_claims AS claim
         INNER JOIN user_accounts AS account
            ON account.user_account_id = claim.user_account_id AND account.public_id = ?
         INNER JOIN tournament_history_placements AS placement
            ON placement.player_id = claim.player_id
         INNER JOIN tournament_history_races AS race
            ON race.tournament_history_race_id = placement.tournament_history_race_id
         INNER JOIN tournament_history_sections AS section
            ON section.tournament_history_section_id = race.tournament_history_section_id
        WHERE claim.claim_status = 'verified'`,
      [userAccountId],
    );
    return [
      ...rows.map((row) => text(row["tournamentId"], "tournament id")),
      ...editions.map((row) => `tournament.history-tn${integer(row["editionNumber"], "edition number", 1)}`),
    ];
  }

  public async listRosterCandidateContext(
    directorInternalId: number,
    tournamentInternalId: number | null,
  ): Promise<readonly RosterCandidateContext[]> {
    // ADR-0218: the picker's context for every active human Player, in a few
    // set-based reads (the community is a few hundred people) rather than
    // one round trip per Player.
    const [players] = await this.connection.execute<RowDataPacket[]>(
      `${playerProjection}
       WHERE player.player_kind = 'human' AND player.record_status = 'active'
       ORDER BY player.display_name ASC LIMIT 5000`,
    );
    const [aliasRows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT alias.player_id AS playerInternalId, alias.alias_text AS aliasText,
              alias.director_user_account_id AS directorInternalId
       FROM aliases AS alias
       WHERE alias.record_status = 'active'
         AND ((alias.director_user_account_id IS NULL AND alias.visibility = 'public')
           OR alias.director_user_account_id = ?)`,
      [directorInternalId],
    );
    const [claimRows] = await this.connection.execute<RowDataPacket[]>(
      "SELECT DISTINCT claim.player_id AS playerInternalId FROM player_claims AS claim WHERE claim.claim_status = 'verified'",
    );
    const [nightRows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT participant.player_id AS playerInternalId, participant.attendance AS attendance,
              t.tournament_id AS tournamentInternalId, t.name AS name, t.event_date AS eventDate,
              t.start_at_ms AS startAtMs, t.edition_number AS editionNumber,
              t.director_user_account_id AS directorInternalId
       FROM tournament_participants AS participant
       INNER JOIN tournaments AS t
         ON t.tournament_id = participant.tournament_id AND t.lifecycle_status = 'active'`,
    );
    const [editionRows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT DISTINCT placement.player_id AS playerInternalId, race.tournament_number AS editionNumber
       FROM legacy_race_placements AS placement
       INNER JOIN legacy_tournament_races AS race
         ON race.legacy_tournament_race_id = placement.legacy_tournament_race_id
       UNION
       SELECT DISTINCT placement.player_id, section.tournament_number
       FROM tournament_history_placements AS placement
       INNER JOIN tournament_history_races AS race
         ON race.tournament_history_race_id = placement.tournament_history_race_id
       INNER JOIN tournament_history_sections AS section
         ON section.tournament_history_section_id = race.tournament_history_section_id`,
    );
    const [directorRows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT DISTINCT t.director_user_account_id AS directorInternalId,
              ${DIRECTOR_NAME_SQL("t.director_user_account_id")} AS name
       FROM tournaments AS t
       WHERE t.lifecycle_status = 'active'`,
    );
    const [characterRows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT member.player_id AS playerInternalId, member.character_key AS characterKey,
              member.character_label AS characterLabel
       FROM tournament_group_members AS member
       INNER JOIN tournament_groups AS grp ON grp.tournament_group_id = member.tournament_group_id
       INNER JOIN tournaments AS t
         ON t.tournament_id = grp.tournament_id AND t.lifecycle_status = 'active'
       WHERE member.character_label IS NOT NULL
       ORDER BY t.start_at_ms DESC, member.tournament_group_id DESC`,
    );

    const aliases = new Map<number, { text: string; directorScoped: boolean }[]>();
    for (const row of aliasRows) {
      const owner = integer(row["playerInternalId"], "alias player", 1);
      const text = nullableText(row["aliasText"])?.trim() ?? "";
      if (text.length === 0) { continue; }
      const list = aliases.get(owner) ?? [];
      list.push({ text, directorScoped: row["directorInternalId"] !== null && row["directorInternalId"] !== undefined });
      aliases.set(owner, list);
    }
    const claimed = new Set(claimRows.map((row) => integer(row["playerInternalId"], "claimed player", 1)));
    const directorNames = new Map<number, string>();
    for (const row of directorRows) {
      const name = nullableText(row["name"]);
      if (name !== null) { directorNames.set(integer(row["directorInternalId"], "director", 1), name); }
    }
    const nights = new PlayerNightLedger();
    const knownToDirector = new Set<number>();
    const inTournament = new Set<number>();
    for (const row of nightRows) {
      const owner = integer(row["playerInternalId"], "participant player", 1);
      const director = integer(row["directorInternalId"], "tournament director", 1);
      const tournament = integer(row["tournamentInternalId"], "tournament", 1);
      if (director === directorInternalId) { knownToDirector.add(owner); }
      if (tournamentInternalId !== null && tournament === tournamentInternalId) { inTournament.add(owner); }
      if (row["attendance"] !== "present") { continue; }
      nights.add(owner, {
        key: canonicalNightKey(tournament, nullableInteger(row["editionNumber"], "edition", 1)),
        name: nullableText(row["name"]),
        date: nullableText(row["eventDate"]),
        at: nullableInteger(row["startAtMs"], "start", 0) ?? 0,
        director,
      });
    }
    for (const row of editionRows) {
      nights.add(
        integer(row["playerInternalId"], "edition player", 1),
        historyEditionNight(integer(row["editionNumber"], "edition", 1)),
      );
    }
    const characters = new Map<number, { key: string | null; label: string }>();
    for (const row of characterRows) {
      const owner = integer(row["playerInternalId"], "character player", 1);
      const label = nullableText(row["characterLabel"]);
      if (characters.has(owner) || label === null) { continue; }
      characters.set(owner, { key: nullableText(row["characterKey"]), label });
    }

    return players.map((row) => {
      const player = playerRecord(row);
      const own = nights.of(player.internalId);
      const last = lastPlayerNight(own);
      const directors = playerNightDirectorNames(own, directorNames);
      const character = characters.get(player.internalId);
      return {
        player,
        aliases: aliases.get(player.internalId) ?? [],
        claimed: claimed.has(player.internalId),
        nights: own.length,
        nightsWithDirector: own.filter((night) => night.director === directorInternalId).length,
        knownToDirector: knownToDirector.has(player.internalId),
        lastNightName: last?.name ?? null,
        lastNightDate: last?.date ?? null,
        directorNames: directors,
        characterKey: character?.key ?? null,
        characterLabel: character?.label ?? null,
        inTournament: inTournament.has(player.internalId),
      };
    });
  }

  public async insertDirectorAlias(input: Readonly<{
    playerInternalId: number;
    directorInternalId: number;
    actorInternalId: number;
    aliasText: string;
    nowMs: number;
  }>): Promise<"created" | "exists"> {
    const [existing] = await this.connection.execute<RowDataPacket[]>(
      `SELECT alias.alias_text AS aliasText
       FROM aliases AS alias
       WHERE alias.player_id = ? AND alias.record_status = 'active'
         AND (alias.director_user_account_id IS NULL OR alias.director_user_account_id = ?)
       FOR UPDATE`,
      [input.playerInternalId, input.directorInternalId],
    );
    const wanted = rosterNameKey(input.aliasText);
    if (existing.some((row) => rosterNameKey(String(row["aliasText"] ?? "")) === wanted)) { return "exists"; }
    // Restricted: a Director's name for someone is theirs, not a public fact
    // on the profile. The Director's explicit choice is the review.
    const publicId = `alias.director-${randomBytes(10).toString("hex")}`;
    const [inserted] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO aliases (
         public_id, revision, player_id, director_user_account_id, alias_text, alias_type, visibility,
         record_status, reviewed_by_user_account_id, reviewed_at_ms, created_at_ms, updated_at_ms
       ) VALUES (?, 1, ?, ?, ?, 'tournament_name', 'restricted', 'active', ?, ?, ?, ?)`,
      [publicId, input.playerInternalId, input.directorInternalId, input.aliasText,
        input.actorInternalId, input.nowMs, input.nowMs, input.nowMs],
    );
    assertAffected(inserted, 1, "director alias");
    await this.connection.execute(
      `INSERT INTO alias_provenance (alias_id, sequence_number, source_type, source_reference, observed_at_ms)
       VALUES (?, 1, 'tournament_manager', 'source.director_roster_choice', ?)`,
      [inserted.insertId, input.nowMs],
    );
    await this.connection.execute(
      `INSERT INTO alias_lifecycle (
         alias_id, sequence_number, event_type, actor_user_account_id,
         visibility_after, record_status_after, reason_code, occurred_at_ms
       ) VALUES (?, 1, 'alias_created', ?, 'restricted', 'active', 'director_roster_choice', ?)`,
      [inserted.insertId, input.actorInternalId, input.nowMs],
    );
    return "created";
  }

  public async resolvePlayers(playerIds: readonly string[]): Promise<ReadonlyMap<string, PlayerRecord>> {
    const unique = [...new Set(playerIds)];
    if (unique.length === 0) { return new Map(); }
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `${playerProjection} WHERE player.public_id IN (${unique.map(() => "?").join(", ")})`,
      unique,
    );
    return new Map(rows.map((row) => {
      const record = playerRecord(row);
      return [record.playerId, record] as const;
    }));
  }

  public async ratingSnapshot(playerInternalIds: readonly number[]) {
    const result = new Map<number, { score: number; rank: number }>();
    if (playerInternalIds.length === 0) { return result; }
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT mine.player_id AS playerInternalId,
              (mine.mu - 3 * mine.sigma) AS score,
              1 + (SELECT COUNT(*) FROM player_ratings AS other
                   INNER JOIN players AS otherPlayer
                     ON otherPlayer.player_id = other.player_id
                    AND otherPlayer.record_status = 'active'
                   WHERE (other.mu - 3 * other.sigma) > (mine.mu - 3 * mine.sigma)) AS playerRank
       FROM player_ratings AS mine
       WHERE mine.player_id IN (${playerInternalIds.map(() => "?").join(", ")})`,
      [...playerInternalIds],
    );
    for (const row of rows) {
      const score = Number(row["score"]);
      const rank = Number(row["playerRank"]);
      if (Number.isFinite(score) && Number.isSafeInteger(rank)) {
        result.set(integer(row["playerInternalId"], "player id", 1), { score, rank });
      }
    }
    return result;
  }

  /**
   * ADR-0221: every race of this Director's own finished, published nights
   * (the result set's current members, oldest night first), for the
   * "director's nights" seeding. Hidden result sets count: they are the
   * Director's own nights, and nothing of this is shown.
   */
  public async loadDirectorNightRaces(directorInternalId: number, excludingTournamentInternalId: number) {
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT t.tournament_id AS tournamentInternalId,
              COALESCE(t.start_at_ms, t.finalized_at_ms, t.created_at_ms) AS heldAtMs,
              member.sequence_number AS memberSequence,
              placement.player_id AS playerInternalId,
              placement.finish_position AS finishPosition
       FROM tournaments AS t
       INNER JOIN tournament_publications AS publication
         ON publication.tournament_publication_id = t.tournament_publication_id
        AND publication.publication_status = 'published'
       INNER JOIN tournament_publication_current_members AS member
         ON member.tournament_publication_id = publication.tournament_publication_id
       INNER JOIN tournament_race_placements AS placement
         ON placement.tournament_race_result_revision_id = member.tournament_race_result_revision_id
       WHERE t.director_user_account_id = ?
         AND t.tournament_id <> ?
         AND t.stage = 'finalized'
         AND t.lifecycle_status = 'active'
       ORDER BY heldAtMs ASC, t.tournament_id ASC, member.sequence_number ASC, placement.finish_position ASC`,
      [directorInternalId, excludingTournamentInternalId],
    );
    const races = new Map<string, { heldAtMs: number; placements: { playerInternalId: number | null; finishPosition: number }[] }>();
    for (const row of rows) {
      const key = `${String(row["tournamentInternalId"])}:${String(row["memberSequence"])}`;
      let race = races.get(key);
      if (race === undefined) {
        race = { heldAtMs: integer(row["heldAtMs"], "held at"), placements: [] };
        races.set(key, race);
      }
      race.placements.push({
        playerInternalId: row["playerInternalId"] === null ? null : integer(row["playerInternalId"], "player id", 1),
        finishPosition: integer(row["finishPosition"], "finish position", 1),
      });
    }
    return [...races.values()];
  }

  public async loadRecentPresentPlayers(
    excludingTournamentInternalId: number,
  ): Promise<readonly PlayerRecord[]> {
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `${playerProjection}
       INNER JOIN (
         SELECT DISTINCT participant.player_id
         FROM tournament_participants AS participant
         INNER JOIN (
           SELECT recent.tournament_id
           FROM tournaments AS recent
           WHERE recent.tournament_id <> ?
             AND recent.edition_number >= 4
             AND recent.stage = 'finalized'
           ORDER BY recent.edition_number DESC,
                    COALESCE(recent.finalized_at_ms, recent.updated_at_ms) DESC,
                    recent.tournament_id DESC
           LIMIT 3
         ) AS recentTournament
           ON recentTournament.tournament_id = participant.tournament_id
         WHERE participant.attendance = 'present'
       ) AS recentPlayer ON recentPlayer.player_id = player.player_id
       WHERE player.player_kind = 'human' AND player.record_status = 'active'
       ORDER BY player.display_name ASC, player.public_id ASC`,
      [excludingTournamentInternalId],
    );
    return rows.map(playerRecord);
  }

  /**
   * ADR-0177 decisions 16 and 19: the activity window is the last three
   * completed Tournaments, legacy and canonical together, newest first, and
   * it is derived on every read rather than stored.
   */
  public async loadCompletedTournamentTimes(limit: number): Promise<readonly number[]> {
    const [rows] = await this.connection.query<RowDataPacket[]>(
      `SELECT heldAtMs FROM (
         SELECT held_at_ms AS heldAtMs FROM legacy_tournament_events
         UNION ALL
         SELECT COALESCE(finalized_at_ms, start_at_ms, updated_at_ms) AS heldAtMs
         FROM tournaments
         WHERE stage = 'finalized' AND lifecycle_status = 'active'
       ) AS completed
       ORDER BY heldAtMs DESC
       LIMIT ?`,
      [limit],
    );
    return rows.map((row) => integer(row["heldAtMs"], "completed tournament time"));
  }

  public async loadHistoricalPresentPlayers(
    excludingTournamentInternalId: number,
  ): Promise<readonly HistoricalPlayerRecord[]> {
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `${playerProjection.replace("SELECT ", "SELECT historyPlayer.lastPresentAtMs AS lastPresentAtMs, ")}
       INNER JOIN (
         SELECT source.player_id, MAX(source.lastPresentAtMs) AS lastPresentAtMs
         FROM (
           SELECT participant.player_id,
                  MAX(COALESCE(historyTournament.start_at_ms, historyTournament.finalized_at_ms, historyTournament.updated_at_ms)) AS lastPresentAtMs
           FROM tournament_participants AS participant
           INNER JOIN tournaments AS historyTournament ON historyTournament.tournament_id = participant.tournament_id
           WHERE historyTournament.tournament_id <> ?
             AND historyTournament.stage = 'finalized'
             AND historyTournament.lifecycle_status = 'active'
             AND participant.attendance = 'present'
           GROUP BY participant.player_id
           UNION ALL
           SELECT historyPlacement.player_id,
                  COALESCE(MAX(legacyEvent.held_at_ms), 0) AS lastPresentAtMs
           FROM tournament_history_placements AS historyPlacement
           INNER JOIN tournament_history_races AS historyRace
             ON historyRace.tournament_history_race_id = historyPlacement.tournament_history_race_id
           INNER JOIN tournament_history_sections AS historySection
             ON historySection.tournament_history_section_id = historyRace.tournament_history_section_id
           LEFT JOIN legacy_tournament_events AS legacyEvent
             ON legacyEvent.tournament_number = historySection.tournament_number
           GROUP BY historyPlacement.player_id
         ) AS source
         GROUP BY source.player_id
       ) AS historyPlayer ON historyPlayer.player_id = player.player_id
       WHERE player.player_kind = 'human' AND player.record_status = 'active'
       ORDER BY player.display_name ASC, player.public_id ASC`,
      [excludingTournamentInternalId],
    );
    return rows.map((row) => ({
      player: playerRecord(row),
      lastPresentAtMs: integer(row["lastPresentAtMs"], "last present time"),
    }));
  }

  public async loadParticipants(tournamentInternalId: number): Promise<readonly ParticipantRecord[]> {
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `${playerProjection.replace("SELECT ", "SELECT participant.attendance AS attendance, participant.has_switch_1 AS hasSwitch1, participant.has_switch_2 AS hasSwitch2, participant.seed_score AS seedScore, participant.seed_rank AS seedRank, historyPlayer.lastPresentAtMs AS lastPresentAtMs, ")}
       INNER JOIN tournament_participants AS participant ON participant.player_id = player.player_id
       LEFT JOIN (
         SELECT source.player_id, MAX(source.lastPresentAtMs) AS lastPresentAtMs
         FROM (
           SELECT historyParticipant.player_id,
                  MAX(COALESCE(historyTournament.start_at_ms, historyTournament.finalized_at_ms, historyTournament.updated_at_ms)) AS lastPresentAtMs
           FROM tournament_participants AS historyParticipant
           INNER JOIN tournaments AS historyTournament ON historyTournament.tournament_id = historyParticipant.tournament_id
           WHERE historyTournament.tournament_id <> ?
             AND historyTournament.stage = 'finalized'
             AND historyTournament.lifecycle_status = 'active'
             AND historyParticipant.attendance = 'present'
           GROUP BY historyParticipant.player_id
           UNION ALL
           SELECT historyPlacement.player_id,
                  COALESCE(MAX(legacyEvent.held_at_ms), 0) AS lastPresentAtMs
           FROM tournament_history_placements AS historyPlacement
           INNER JOIN tournament_history_races AS historyRace
             ON historyRace.tournament_history_race_id = historyPlacement.tournament_history_race_id
           INNER JOIN tournament_history_sections AS historySection
             ON historySection.tournament_history_section_id = historyRace.tournament_history_section_id
           LEFT JOIN legacy_tournament_events AS legacyEvent
             ON legacyEvent.tournament_number = historySection.tournament_number
           GROUP BY historyPlacement.player_id
         ) AS source
         GROUP BY source.player_id
       ) AS historyPlayer ON historyPlayer.player_id = player.player_id
       WHERE participant.tournament_id = ?
       ORDER BY COALESCE(participant.seed_rank, 999999) ASC, player.display_name ASC, player.public_id ASC`,
      [tournamentInternalId, tournamentInternalId],
    );
    return rows.map((row) => {
      const seedScore = row["seedScore"] === null ? null : Number(row["seedScore"]);
      return {
        player: playerRecord(row),
        attendance: oneOf<TournamentAttendance>(row["attendance"], ["present", "waiting", "absent"], "attendance"),
        hasSwitch1: flag(row["hasSwitch1"]),
        hasSwitch2: flag(row["hasSwitch2"]),
        seedScore: seedScore !== null && Number.isFinite(seedScore) ? seedScore : null,
        seedRank: nullableInteger(row["seedRank"], "seed rank", 1),
        lastPresentAtMs: nullableInteger(row["lastPresentAtMs"], "last present time"),
      };
    });
  }

  public async ensureStationCable(
    ownerPlayerInternalId: number,
    switchType: TournamentSwitchType,
    nowMs: number,
  ): Promise<number> {
    await this.connection.execute<ResultSetHeader>(
      `INSERT IGNORE INTO tournament_station_cables (
         owner_player_id, switch_type, revision, created_at_ms, updated_at_ms
       ) VALUES (?, ?, 1, ?, ?)`,
      [ownerPlayerInternalId, switchType, nowMs, nowMs],
    );
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT cable_number AS cableNumber
       FROM tournament_station_cables
       WHERE owner_player_id = ? AND switch_type = ?
       LIMIT 1`,
      [ownerPlayerInternalId, switchType],
    );
    if (rows[0] === undefined) {
      throw new TournamentOperationPersistenceError("station cable could not be allocated");
    }
    return integer(rows[0]["cableNumber"], "cable number", 1);
  }

  public async loadStationCables(ownerPlayerIds: readonly string[]) {
    const unique = [...new Set(ownerPlayerIds)];
    if (unique.length === 0) return [];
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT player.public_id AS ownerPlayerId, cable.switch_type AS switchType,
              cable.cable_number AS cableNumber
       FROM tournament_station_cables AS cable
       INNER JOIN players AS player ON player.player_id = cable.owner_player_id
       WHERE player.public_id IN (${unique.map(() => "?").join(", ")})
       ORDER BY cable.cable_number ASC`,
      unique,
    );
    return rows.map((row) => ({
      ownerPlayerId: text(row["ownerPlayerId"], "station owner"),
      switchType: oneOf<TournamentSwitchType>(row["switchType"], ["ns1", "ns2"], "switch type"),
      cableNumber: integer(row["cableNumber"], "cable number", 1),
    }));
  }

  public async upsertParticipant(input: Parameters<TournamentOperationTransaction["upsertParticipant"]>[0]): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO tournament_participants (
         tournament_id, player_id, attendance, has_switch_1, has_switch_2,
         seed_score, seed_rank, added_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE attendance = VALUES(attendance),
         has_switch_1 = VALUES(has_switch_1), has_switch_2 = VALUES(has_switch_2),
         updated_at_ms = VALUES(updated_at_ms)`,
      [
        input.tournamentInternalId, input.playerInternalId, input.attendance,
        input.hasSwitch1, input.hasSwitch2,
        input.seedScore === null ? null : input.seedScore.toFixed(4), input.seedRank,
        input.nowMs, input.nowMs,
      ],
    );
    assertAffected(result, 0, "participant upsert");
  }

  public async deleteParticipant(tournamentInternalId: number, playerInternalId: number): Promise<void> {
    await this.connection.execute(
      "DELETE FROM tournament_participants WHERE tournament_id = ? AND player_id = ?",
      [tournamentInternalId, playerInternalId],
    );
  }

  public async loadGroups(tournamentInternalId: number): Promise<readonly GroupRecord[]> {
    const [groupRows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT tournament_group_id AS internalId, public_id AS groupId, stage, sequence_number AS sequence,
              name, tier_key AS tierKey, locked, manual_score_segments AS segments,
              tie_break_orders_json AS tieBreakOrders
       FROM tournament_groups WHERE tournament_id = ?
       ORDER BY stage ASC, sequence_number ASC`,
      [tournamentInternalId],
    );
    if (groupRows.length === 0) { return []; }
    const [memberRows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT member.tournament_group_id AS groupInternalId, player.public_id AS playerId,
              member.seat_order AS seatOrder, owner.public_id AS ownerPlayerId,
              member.station_switch_type AS switchType, member.seat_number AS seatNumber,
              member.character_key AS characterKey, member.character_label AS characterLabel,
              member.character_roster AS characterRoster
       FROM tournament_group_members AS member
       INNER JOIN tournament_groups AS grp ON grp.tournament_group_id = member.tournament_group_id
       INNER JOIN players AS player ON player.player_id = member.player_id
       LEFT JOIN players AS owner ON owner.player_id = member.station_owner_player_id
       WHERE grp.tournament_id = ?
       ORDER BY member.tournament_group_id ASC, member.seat_order ASC`,
      [tournamentInternalId],
    );
    const [stationRows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT station.tournament_group_id AS groupInternalId, station.slot_index AS slotIndex,
              owner.public_id AS ownerPlayerId, station.switch_type AS switchType
       FROM tournament_group_stations AS station
       INNER JOIN tournament_groups AS grp ON grp.tournament_group_id = station.tournament_group_id
       INNER JOIN players AS owner ON owner.player_id = station.owner_player_id
       WHERE grp.tournament_id = ?
       ORDER BY station.tournament_group_id ASC, station.slot_index ASC`,
      [tournamentInternalId],
    );
    const stationsByGroup = new Map<number, GroupRecord["stations"][number][]>();
    for (const row of stationRows) {
      const groupInternalId = integer(row["groupInternalId"], "group id", 1);
      const list = stationsByGroup.get(groupInternalId) ?? [];
      list.push({
        slotIndex: integer(row["slotIndex"], "slot index", 1),
        ownerPlayerId: text(row["ownerPlayerId"], "station owner"),
        switchType: oneOf<TournamentSwitchType>(row["switchType"], ["ns1", "ns2"], "switch type"),
      });
      stationsByGroup.set(groupInternalId, list);
    }
    const membersByGroup = new Map<number, GroupRecord["members"][number][]>();
    for (const row of memberRows) {
      const groupInternalId = integer(row["groupInternalId"], "group id", 1);
      const list = membersByGroup.get(groupInternalId) ?? [];
      const ownerPlayerId = nullableText(row["ownerPlayerId"]);
      const seatNumber = nullableInteger(row["seatNumber"], "seat number", 1);
      const characterLabel = nullableText(row["characterLabel"]);
      list.push({
        playerId: text(row["playerId"], "member player id"),
        seatOrder: integer(row["seatOrder"], "seat order", 1),
        station: ownerPlayerId === null || seatNumber === null
          ? null
          : {
              ownerPlayerId,
              switchType: oneOf<TournamentSwitchType>(row["switchType"], ["ns1", "ns2"], "switch type"),
              seatNumber: seatNumber === 2 ? 2 : 1,
            },
        character: characterLabel === null ? null : {
          key: nullableText(row["characterKey"]),
          label: characterLabel,
          roster: nullableText(row["characterRoster"]),
        },
      });
      membersByGroup.set(groupInternalId, list);
    }
    return groupRows.map((row) => {
      const internalId = integer(row["internalId"], "group id", 1);
      return {
        internalId,
        groupId: text(row["groupId"], "group public id"),
        stage: oneOf<TournamentGroupStage>(row["stage"], ["qualifier", "final"], "group stage"),
        sequence: integer(row["sequence"], "group sequence", 1),
        name: text(row["name"], "group name"),
        tierKey: nullableText(row["tierKey"]),
        locked: flag(row["locked"]),
        manualScoreSegments: integer(row["segments"], "segments", 1),
        tieBreakOrders: tieBreakOrders(row["tieBreakOrders"]),
        members: membersByGroup.get(internalId) ?? [],
        stations: stationsByGroup.get(internalId) ?? [],
      };
    });
  }

  public async setGroupMemberCharacters(
    groupInternalId: number,
    characters: Parameters<TournamentOperationTransaction["setGroupMemberCharacters"]>[1],
  ): Promise<void> {
    for (const entry of characters) {
      // A member who left the group between the import and this write simply
      // has no row to update; that is not an error.
      await this.connection.execute(
        `UPDATE tournament_group_members
            SET character_key = ?, character_label = ?, character_roster = ?
          WHERE tournament_group_id = ? AND player_id = ?`,
        [entry.characterKey, entry.characterLabel, entry.characterRoster, groupInternalId, entry.playerInternalId],
      );
    }
  }

  public async replaceGroupStations(
    groupInternalId: number,
    stations: Parameters<TournamentOperationTransaction["replaceGroupStations"]>[1],
    nowMs: number,
  ): Promise<void> {
    await this.connection.execute(
      "DELETE FROM tournament_group_stations WHERE tournament_group_id = ?",
      [groupInternalId],
    );
    for (const station of stations) {
      const [result] = await this.connection.execute<ResultSetHeader>(
        `INSERT INTO tournament_group_stations (
           tournament_group_id, slot_index, owner_player_id, switch_type, created_at_ms, updated_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [groupInternalId, station.slotIndex, station.ownerInternalId, station.switchType, nowMs, nowMs],
      );
      assertAffected(result, 1, "group station insert");
    }
  }

  public async deleteGroupsForStage(tournamentInternalId: number, stage: TournamentGroupStage): Promise<void> {
    const [raceRows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS raceCount FROM tournament_group_races AS race
       INNER JOIN tournament_groups AS grp ON grp.tournament_group_id = race.tournament_group_id
       WHERE grp.tournament_id = ? AND grp.stage = ?`,
      [tournamentInternalId, stage],
    );
    if (integer(raceRows[0]?.["raceCount"] ?? 0, "race count") > 0) {
      throw new TournamentOperationPersistenceError("groups with races cannot be deleted");
    }
    await this.connection.execute(
      `DELETE score FROM tournament_manual_scores AS score
       INNER JOIN tournament_groups AS grp ON grp.tournament_group_id = score.tournament_group_id
       WHERE grp.tournament_id = ? AND grp.stage = ?`,
      [tournamentInternalId, stage],
    );
    await this.connection.execute(
      `DELETE member FROM tournament_group_members AS member
       INNER JOIN tournament_groups AS grp ON grp.tournament_group_id = member.tournament_group_id
       WHERE grp.tournament_id = ? AND grp.stage = ?`,
      [tournamentInternalId, stage],
    );
    await this.connection.execute(
      `DELETE station FROM tournament_group_stations AS station
       INNER JOIN tournament_groups AS grp ON grp.tournament_group_id = station.tournament_group_id
       WHERE grp.tournament_id = ? AND grp.stage = ?`,
      [tournamentInternalId, stage],
    );
    await this.connection.execute(
      "DELETE FROM tournament_groups WHERE tournament_id = ? AND stage = ?",
      [tournamentInternalId, stage],
    );
  }

  public async clearGroupResultsForStage(
    tournamentInternalId: number,
    stage: TournamentGroupStage,
    nowMs: number,
  ): Promise<void> {
    await this.connection.execute(
      `DELETE race FROM tournament_group_races AS race
       INNER JOIN tournament_groups AS grp ON grp.tournament_group_id = race.tournament_group_id
       WHERE grp.tournament_id = ? AND grp.stage = ?`,
      [tournamentInternalId, stage],
    );
    await this.connection.execute(
      `DELETE score FROM tournament_manual_scores AS score
       INNER JOIN tournament_groups AS grp ON grp.tournament_group_id = score.tournament_group_id
       WHERE grp.tournament_id = ? AND grp.stage = ?`,
      [tournamentInternalId, stage],
    );
    await this.connection.execute(
      `UPDATE tournament_groups SET locked = FALSE, manual_score_segments = 1, updated_at_ms = ?
       WHERE tournament_id = ? AND stage = ?`,
      [nowMs, tournamentInternalId, stage],
    );
  }

  public async reopenAcceptedEvidenceForStage(
    tournamentInternalId: number,
    stage: TournamentGroupStage,
    actorInternalId: number,
    nowMs: number,
  ): Promise<number> {
    await this.connection.execute(
      `INSERT INTO tournament_incoming_result_reviews (
         tournament_incoming_result_id, action, actor_user_account_id,
         reason, race_result_id, occurred_at_ms
       )
       SELECT ir.tournament_incoming_result_id, 'reopened', ?,
              'Reopened automatically after Tournament layout rollback',
              ir.accepted_race_result_id, ?
         FROM tournament_incoming_results ir
         JOIN tournament_group_races gr
           ON gr.tournament_race_result_id = ir.accepted_race_result_id
         JOIN tournament_groups grp ON grp.tournament_group_id = gr.tournament_group_id
        WHERE grp.tournament_id = ? AND grp.stage = ?
          AND ir.status = 'accepted' AND ir.evidence_record_id IS NOT NULL`,
      [actorInternalId, nowMs, tournamentInternalId, stage],
    );
    const [result] = await this.connection.execute<ResultSetHeader>(
      `UPDATE tournament_incoming_results ir
       JOIN tournament_group_races gr
         ON gr.tournament_race_result_id = ir.accepted_race_result_id
       JOIN tournament_groups grp ON grp.tournament_group_id = gr.tournament_group_id
          SET ir.status = 'pending', ir.revision = ir.revision + 1,
              ir.accepted_race_result_id = NULL, ir.accepted_at_ms = NULL,
              ir.reviewed_by_user_account_id = ?,
              ir.review_reason = 'Reopened after Tournament layout rollback',
              ir.updated_at_ms = ?
        WHERE grp.tournament_id = ? AND grp.stage = ?
          AND ir.status = 'accepted' AND ir.evidence_record_id IS NOT NULL`,
      [actorInternalId, nowMs, tournamentInternalId, stage],
    );
    return result.affectedRows;
  }

  public async clearGroupResults(groupInternalId: number, nowMs: number): Promise<void> {
    await this.connection.execute(
      "DELETE FROM tournament_group_races WHERE tournament_group_id = ?",
      [groupInternalId],
    );
    await this.connection.execute(
      "DELETE FROM tournament_manual_scores WHERE tournament_group_id = ?",
      [groupInternalId],
    );
    await this.connection.execute(
      `UPDATE tournament_groups
          SET locked = FALSE, manual_score_segments = 1, updated_at_ms = ?
        WHERE tournament_group_id = ?`,
      [nowMs, groupInternalId],
    );
  }

  public async insertGroup(input: Parameters<TournamentOperationTransaction["insertGroup"]>[0]): Promise<number> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO tournament_groups (
         tournament_id, public_id, stage, sequence_number, name, tier_key, locked,
         manual_score_segments, created_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, FALSE, 1, ?, ?)`,
      [
        input.tournamentInternalId, input.groupId, input.stage, input.sequence,
        input.name, input.tierKey, input.nowMs, input.nowMs,
      ],
    );
    assertAffected(result, 1, "group creation");
    return result.insertId;
  }

  public async replaceGroupMembers(
    groupInternalId: number,
    members: Parameters<TournamentOperationTransaction["replaceGroupMembers"]>[1],
  ): Promise<void> {
    await this.connection.execute(
      "DELETE FROM tournament_group_members WHERE tournament_group_id = ?",
      [groupInternalId],
    );
    for (const member of members) {
      const [result] = await this.connection.execute<ResultSetHeader>(
        `INSERT INTO tournament_group_members (
           tournament_group_id, player_id, seat_order, station_owner_player_id,
           station_switch_type, seat_number
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          groupInternalId, member.playerInternalId, member.seatOrder,
          member.stationOwnerInternalId, member.stationSwitchType, member.seatNumber,
        ],
      );
      assertAffected(result, 1, "group member insert");
    }
  }

  public async updateGroupMemberStations(
    groupInternalId: number,
    members: Parameters<TournamentOperationTransaction["updateGroupMemberStations"]>[1],
  ): Promise<void> {
    for (const member of members) {
      await this.connection.execute(
        `UPDATE tournament_group_members
            SET station_owner_player_id = ?, station_switch_type = ?, seat_number = ?
          WHERE tournament_group_id = ? AND player_id = ?`,
        [member.stationOwnerInternalId, member.stationSwitchType, member.seatNumber,
          groupInternalId, member.playerInternalId],
      );
    }
  }

  public async updateGroup(input: Parameters<TournamentOperationTransaction["updateGroup"]>[0]): Promise<void> {
    const assignments: string[] = ["updated_at_ms = ?"];
    const values: (string | number | boolean | null)[] = [input.nowMs];
    if (input.locked !== undefined) { assignments.push("locked = ?"); values.push(input.locked); }
    if (input.manualScoreSegments !== undefined) {
      assignments.push("manual_score_segments = ?");
      values.push(input.manualScoreSegments);
    }
    if (input.tieBreakOrders !== undefined) {
      assignments.push("tie_break_orders_json = ?");
      values.push(JSON.stringify(input.tieBreakOrders));
    }
    values.push(input.groupInternalId);
    await this.connection.execute(
      `UPDATE tournament_groups SET ${assignments.join(", ")} WHERE tournament_group_id = ?`,
      values,
    );
  }

  public async loadGroupRaces(tournamentInternalId: number): Promise<readonly GroupRaceRecord[]> {
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT link.tournament_group_id AS groupInternalId, link.race_number AS raceNumber,
              result.public_id AS raceResultId, revision.revision_number AS revision,
              revision.scoring_segment AS scoringSegment, revision.source_kind AS sourceKind,
              revision.scoring_note AS scoringNote,
              revision.track_id AS trackId, revision.mode_cc AS modeValue,
              revision.mirror AS mirrorValue,
              revision.counts_toward_standings AS countsTowardStandings,
              player.public_id AS playerId, placement.finish_position AS finishPosition,
              placement.race_points AS racePoints
       FROM tournament_group_races AS link
       INNER JOIN tournament_groups AS grp ON grp.tournament_group_id = link.tournament_group_id
       INNER JOIN tournament_race_results AS result
         ON result.tournament_race_result_id = link.tournament_race_result_id
       INNER JOIN tournament_race_result_revisions AS revision
         ON revision.tournament_race_result_id = result.tournament_race_result_id
        AND revision.revision_number = (
          SELECT MAX(latest.revision_number) FROM tournament_race_result_revisions AS latest
          WHERE latest.tournament_race_result_id = result.tournament_race_result_id)
       INNER JOIN tournament_race_placements AS placement
         ON placement.tournament_race_result_revision_id = revision.tournament_race_result_revision_id
       LEFT JOIN players AS player ON player.player_id = placement.player_id
       WHERE grp.tournament_id = ?
       ORDER BY link.tournament_group_id ASC, link.race_number ASC, placement.finish_position ASC`,
      [tournamentInternalId],
    );
    const races = new Map<string, {
      groupInternalId: number; raceNumber: number; raceResultId: string; revision: number;
      scoringSegment: number; sourceKind: string; scoringNote: string | null;
      trackId: string; mode: TournamentRaceMode | null; mirror: true | null; countsTowardStandings: boolean;
      placements: { playerId: string; finishPosition: number; racePoints: number }[];
    }>();
    for (const row of rows) {
      const groupInternalId = integer(row["groupInternalId"], "group id", 1);
      const raceNumber = integer(row["raceNumber"], "race number", 1);
      const key = `${groupInternalId}:${raceNumber}`;
      let race = races.get(key);
      if (race === undefined) {
        const modeValue = nullableInteger(row["modeValue"], "mode");
        race = {
          groupInternalId,
          raceNumber,
          raceResultId: text(row["raceResultId"], "race result id"),
          revision: integer(row["revision"], "revision", 1),
          scoringSegment: integer(row["scoringSegment"], "scoring segment", 1),
          sourceKind: text(row["sourceKind"], "source kind"),
          scoringNote: nullableText(row["scoringNote"]),
          trackId: text(row["trackId"], "track id"),
          mode: isTournamentRaceMode(modeValue) ? modeValue : null,
          mirror: row["mirrorValue"] !== null && row["mirrorValue"] !== undefined && Number(row["mirrorValue"]) === 1
            ? true : null,
          countsTowardStandings: flag(row["countsTowardStandings"]),
          placements: [],
        };
        races.set(key, race);
      }
      const playerId = nullableText(row["playerId"]);
      if (playerId === null) {
        // A restricted (unidentified) placement cannot belong to an operated
        // group; surfacing it as a synthetic id keeps the race visible and
        // makes it fail membership checks instead of disappearing.
        race.placements.push({
          playerId: `player.unresolved-${integer(row["finishPosition"], "finish position", 1)}`,
          finishPosition: integer(row["finishPosition"], "finish position", 1),
          racePoints: integer(row["racePoints"], "race points"),
        });
        continue;
      }
      race.placements.push({
        playerId,
        finishPosition: integer(row["finishPosition"], "finish position", 1),
        racePoints: integer(row["racePoints"], "race points"),
      });
    }
    return [...races.values()];
  }

  public async findRaceResultInternalId(raceResultId: string): Promise<number | null> {
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      "SELECT tournament_race_result_id AS internalId FROM tournament_race_results WHERE public_id = ? LIMIT 1",
      [raceResultId],
    );
    return rows[0] === undefined ? null : integer(rows[0]["internalId"], "race result id", 1);
  }

  public async linkGroupRace(input: Parameters<TournamentOperationTransaction["linkGroupRace"]>[0]): Promise<void> {
    const [existing] = await this.connection.execute<RowDataPacket[]>(
      `SELECT tournament_group_id AS groupInternalId, race_number AS raceNumber
       FROM tournament_group_races WHERE tournament_race_result_id = ? LIMIT 1 FOR UPDATE`,
      [input.raceResultInternalId],
    );
    const row = existing[0];
    if (row !== undefined) {
      if (integer(row["groupInternalId"], "group id", 1) !== input.groupInternalId ||
        integer(row["raceNumber"], "race number", 1) !== input.raceNumber) {
        throw new TournamentOperationPersistenceError("race result is already linked to another group");
      }
      return;
    }
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO tournament_group_races (
         tournament_group_id, race_number, occurred_at_ms, tournament_race_result_id, created_at_ms
       ) VALUES (?, ?, ?, ?, ?)`,
      [input.groupInternalId, input.raceNumber, input.occurredAtMs ?? null, input.raceResultInternalId, input.nowMs],
    );
    assertAffected(result, 1, "group race link");
  }

  public async loadManualScores(tournamentInternalId: number): Promise<readonly ManualScoreRecord[]> {
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT score.tournament_group_id AS groupInternalId, player.public_id AS playerId,
              score.segment_number AS segmentNumber, score.points AS points
       FROM tournament_manual_scores AS score
       INNER JOIN tournament_groups AS grp ON grp.tournament_group_id = score.tournament_group_id
       INNER JOIN players AS player ON player.player_id = score.player_id
       WHERE grp.tournament_id = ?
       ORDER BY score.tournament_group_id, player.public_id, score.segment_number`,
      [tournamentInternalId],
    );
    return rows.map((row) => ({
      groupInternalId: integer(row["groupInternalId"], "group id", 1),
      playerId: text(row["playerId"], "player id"),
      segmentNumber: integer(row["segmentNumber"], "segment", 1),
      points: integer(row["points"], "points"),
    }));
  }

  public async replaceManualScores(
    groupInternalId: number,
    rows: Parameters<TournamentOperationTransaction["replaceManualScores"]>[1],
    nowMs: number,
  ): Promise<void> {
    await this.connection.execute(
      "DELETE FROM tournament_manual_scores WHERE tournament_group_id = ?",
      [groupInternalId],
    );
    for (const row of rows) {
      await this.connection.execute(
        `INSERT INTO tournament_manual_scores (
           tournament_group_id, player_id, segment_number, points, updated_at_ms
         ) VALUES (?, ?, ?, ?, ?)`,
        [groupInternalId, row.playerInternalId, row.segmentNumber, row.points, nowMs],
      );
    }
  }

  public async appendLifecycle(input: Parameters<TournamentOperationTransaction["appendLifecycle"]>[0]): Promise<void> {
    const [sequenceRows] = await this.connection.execute<RowDataPacket[]>(
      "SELECT COALESCE(MAX(sequence_number), 0) AS latest FROM tournament_lifecycle WHERE tournament_id = ? FOR UPDATE",
      [input.tournamentInternalId],
    );
    const sequence = integer(sequenceRows[0]?.["latest"] ?? 0, "lifecycle sequence") + 1;
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO tournament_lifecycle (
         tournament_id, sequence_number, event_type, detail, actor_user_account_id, occurred_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.tournamentInternalId, sequence, input.eventType,
        input.detail === null ? null : input.detail.slice(0, 255),
        input.actorInternalId, input.nowMs,
      ],
    );
    assertAffected(result, 1, "lifecycle append");
  }

  public async loadLifecycle(tournamentInternalId: number, limit: number): Promise<readonly LifecycleRecord[]> {
    const bounded = Math.max(1, Math.min(200, Math.floor(limit)));
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT sequence_number AS sequence, event_type AS eventType, detail, occurred_at_ms AS occurredAtMs
       FROM tournament_lifecycle WHERE tournament_id = ?
       ORDER BY sequence_number DESC LIMIT ${bounded}`,
      [tournamentInternalId],
    );
    return rows.map((row) => {
      const detail = nullableText(row["detail"]);
      return {
        sequence: integer(row["sequence"], "sequence", 1),
        eventType: text(row["eventType"], "event type"),
        ...(detail === null ? {} : { detail }),
        occurredAtMs: integer(row["occurredAtMs"], "occurred timestamp"),
      };
    });
  }

  public async findPublicationInternalId(publicationId: string): Promise<number | null> {
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      "SELECT tournament_publication_id AS internalId FROM tournament_publications WHERE public_id = ? LIMIT 1",
      [publicationId],
    );
    return rows[0] === undefined ? null : integer(rows[0]["internalId"], "publication id", 1);
  }

  public async deleteTournament(tournamentInternalId: number): Promise<void> {
    const [raceRows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS raceCount FROM tournament_group_races AS race
       INNER JOIN tournament_groups AS grp ON grp.tournament_group_id = race.tournament_group_id
       WHERE grp.tournament_id = ?`,
      [tournamentInternalId],
    );
    if (integer(raceRows[0]?.["raceCount"] ?? 0, "race count") > 0) {
      throw new TournamentOperationPersistenceError("a tournament with races cannot be deleted");
    }
    await this.connection.execute("DELETE FROM tournament_lifecycle WHERE tournament_id = ?", [tournamentInternalId]);
    await this.connection.execute(
      `DELETE score FROM tournament_manual_scores AS score
       INNER JOIN tournament_groups AS grp ON grp.tournament_group_id = score.tournament_group_id
       WHERE grp.tournament_id = ?`,
      [tournamentInternalId],
    );
    await this.connection.execute(
      `DELETE member FROM tournament_group_members AS member
       INNER JOIN tournament_groups AS grp ON grp.tournament_group_id = member.tournament_group_id
       WHERE grp.tournament_id = ?`,
      [tournamentInternalId],
    );
    await this.connection.execute("DELETE FROM tournament_groups WHERE tournament_id = ?", [tournamentInternalId]);
    await this.connection.execute("DELETE FROM tournament_participants WHERE tournament_id = ?", [tournamentInternalId]);
    const [result] = await this.connection.execute<ResultSetHeader>(
      "DELETE FROM tournaments WHERE tournament_id = ? AND stage <> 'finalized'", [tournamentInternalId],
    );
    assertAffected(result, 1, "tournament deletion");
  }

  public async setPublicationVisibility(publicationInternalId: number, visibility: "public" | "hidden"): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      "UPDATE tournament_publications SET public_visibility = ? WHERE tournament_publication_id = ?",
      [visibility, publicationInternalId],
    );
    assertAffected(result, 0, "publication visibility");
  }
}

export class MysqlTournamentOperationRepository implements TournamentOperationRepository {
  /**
   * When `bound` is given this repository joins a transaction somebody else
   * owns instead of opening one of its own, so several repositories can commit
   * or roll back together. The owner begins, commits and rolls back.
   */
  public constructor(
    private readonly pool: Pool,
    private readonly bound?: PoolConnection,
  ) {}

  public async transaction<T>(
    work: (transaction: TournamentOperationTransaction) => Promise<T>,
  ): Promise<T> {
    if (this.bound !== undefined) {
      return work(new MysqlTournamentOperationTransaction(this.bound));
    }
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(new MysqlTournamentOperationTransaction(connection));
      await connection.commit();
      return result;
    } catch (error) {
      try { await connection.rollback(); } catch { /* the original error wins */ }
      throw error;
    } finally {
      connection.release();
    }
  }
}
