import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

import type {
  SignupAttendance,
  SignupEntryRecord,
  SignupEntryStatus,
  SignupRosterRow,
  SignupSettingsRecord,
  SignupTournament,
  SignupViewerAccount,
  TournamentSignupRepository,
  TournamentSignupTransaction,
} from "./tournament-signup-service.js";

type Row = RowDataPacket & Record<string, unknown>;

function integer(value: unknown, label: string, minimum = 0): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) { throw new Error(`${label} is invalid`); }
  return number;
}

function nullableInteger(value: unknown, label: string): number | null {
  return value === null || value === undefined ? null : integer(value, label);
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) { throw new Error(`${label} is invalid`); }
  return value as T;
}

const attendances = ["present", "waiting", "absent"] as const;
const statuses = ["pending", "selected", "waiting", "withdrawn", "removed"] as const;

/** Prepared SQL for open sign-up (migration 0082, ADR-0222); roster writes go to tournament_participants. */
class MysqlTournamentSignupTransaction implements TournamentSignupTransaction {
  public constructor(private readonly connection: PoolConnection) {}

  public async findTournament(tournamentId: string, lock: boolean): Promise<SignupTournament | null> {
    const [rows] = await this.connection.execute<Row[]>(
      `SELECT t.tournament_id AS internalId, t.public_id AS tournamentId, t.name AS name,
              t.director_user_account_id AS directorInternalId, t.stage AS stage,
              t.workflow_step AS workflowStep, t.max_participants AS maxParticipants,
              t.start_at_ms AS startAtMs, t.timezone_name AS timezone,
              (SELECT COUNT(*) FROM tournament_groups AS grp WHERE grp.tournament_id = t.tournament_id) AS groupCount
       FROM tournaments AS t
       WHERE t.public_id = ? AND t.lifecycle_status = 'active'
       LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [tournamentId],
    );
    const row = rows[0];
    if (row === undefined) { return null; }
    return {
      internalId: integer(row["internalId"], "tournament id", 1),
      tournamentId: String(row["tournamentId"]),
      name: String(row["name"]),
      directorInternalId: integer(row["directorInternalId"], "director id", 1),
      stage: String(row["stage"]),
      workflowStep: integer(row["workflowStep"], "workflow step"),
      maxParticipants: nullableInteger(row["maxParticipants"], "maximum"),
      startAtMs: nullableInteger(row["startAtMs"], "start"),
      timezone: typeof row["timezone"] === "string" && row["timezone"].length > 0 ? row["timezone"] : null,
      groupCount: integer(row["groupCount"], "group count"),
    };
  }

  public async loadSettings(tournamentInternalId: number, lock: boolean): Promise<SignupSettingsRecord | null> {
    const [rows] = await this.connection.execute<Row[]>(
      `SELECT signup_mode AS mode, selection_mode AS selection, capacity, closes_at_ms AS closesAtMs,
              selection_status AS status, draw_seed AS drawSeed, draw_algorithm AS drawAlgorithm,
              closed_at_ms AS closedAtMs
       FROM tournament_signup_settings WHERE tournament_id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [tournamentInternalId],
    );
    const row = rows[0];
    if (row === undefined) { return null; }
    return {
      mode: oneOf(row["mode"], ["director", "open"] as const, "sign-up mode"),
      selection: oneOf(row["selection"], ["first_come", "draw"] as const, "selection"),
      capacity: integer(row["capacity"], "capacity", 1),
      closesAtMs: integer(row["closesAtMs"], "closing time"),
      status: oneOf(row["status"], ["open", "closed"] as const, "sign-up status"),
      drawSeed: typeof row["drawSeed"] === "string" ? row["drawSeed"] : null,
      drawAlgorithm: typeof row["drawAlgorithm"] === "string" ? row["drawAlgorithm"] : null,
      closedAtMs: nullableInteger(row["closedAtMs"], "closed time"),
    };
  }

  public async saveSettings(input: Parameters<TournamentSignupTransaction["saveSettings"]>[0]): Promise<void> {
    const settings = input.settings;
    await this.connection.execute(
      `INSERT INTO tournament_signup_settings
         (tournament_id, signup_mode, selection_mode, capacity, closes_at_ms, selection_status,
          draw_seed, draw_algorithm, closed_at_ms, updated_by_user_account_id, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         signup_mode = VALUES(signup_mode), selection_mode = VALUES(selection_mode),
         capacity = VALUES(capacity), closes_at_ms = VALUES(closes_at_ms),
         selection_status = VALUES(selection_status), draw_seed = VALUES(draw_seed),
         draw_algorithm = VALUES(draw_algorithm), closed_at_ms = VALUES(closed_at_ms),
         updated_by_user_account_id = VALUES(updated_by_user_account_id), updated_at_ms = VALUES(updated_at_ms)`,
      [
        input.tournamentInternalId, settings.mode, settings.selection, settings.capacity, settings.closesAtMs,
        settings.status, settings.drawSeed, settings.drawAlgorithm, settings.closedAtMs,
        input.actorInternalId, input.nowMs, input.nowMs,
      ],
    );
  }

  public async loadRoster(tournamentInternalId: number): Promise<readonly SignupRosterRow[]> {
    const [rows] = await this.connection.execute<Row[]>(
      `SELECT participant.player_id AS playerInternalId, player.public_id AS playerId,
              player.display_name AS displayName, player.visibility AS visibility,
              player.record_status AS recordStatus, participant.attendance AS attendance,
              participant.has_switch_1 AS hasSwitch1, participant.has_switch_2 AS hasSwitch2
       FROM tournament_participants AS participant
       INNER JOIN players AS player ON player.player_id = participant.player_id
       WHERE participant.tournament_id = ?`,
      [tournamentInternalId],
    );
    return rows.map((row) => ({
      playerInternalId: integer(row["playerInternalId"], "player id", 1),
      playerId: String(row["playerId"]),
      displayName: String(row["displayName"]),
      publicIdentity: row["visibility"] === "public" && row["recordStatus"] === "active",
      attendance: oneOf(row["attendance"], attendances, "attendance"),
      hasSwitch1: flag(row["hasSwitch1"]),
      hasSwitch2: flag(row["hasSwitch2"]),
    }));
  }

  public async loadEntries(tournamentInternalId: number): Promise<readonly SignupEntryRecord[]> {
    const [rows] = await this.connection.execute<Row[]>(
      `SELECT signup.player_id AS playerInternalId, player.public_id AS playerId,
              player.display_name AS displayName, player.visibility AS visibility,
              player.record_status AS recordStatus, signup.user_account_id AS accountInternalId,
              signup.signup_status AS status, signup.queue_position AS queuePosition,
              signup.signed_up_at_ms AS signedUpAtMs
       FROM tournament_signups AS signup
       INNER JOIN players AS player ON player.player_id = signup.player_id
       WHERE signup.tournament_id = ?
       ORDER BY signup.signed_up_at_ms ASC, signup.tournament_signup_id ASC`,
      [tournamentInternalId],
    );
    return rows.map((row) => ({
      playerInternalId: integer(row["playerInternalId"], "player id", 1),
      playerId: String(row["playerId"]),
      displayName: String(row["displayName"]),
      publicIdentity: row["visibility"] === "public" && row["recordStatus"] === "active",
      accountInternalId: integer(row["accountInternalId"], "account id", 1),
      status: oneOf(row["status"], statuses, "sign-up status") as SignupEntryStatus,
      queuePosition: nullableInteger(row["queuePosition"], "queue position"),
      signedUpAtMs: integer(row["signedUpAtMs"], "sign-up time"),
    }));
  }

  public async saveEntry(input: Parameters<TournamentSignupTransaction["saveEntry"]>[0]): Promise<void> {
    await this.connection.execute(
      `INSERT INTO tournament_signups
         (tournament_id, player_id, user_account_id, signup_status, queue_position,
          signed_up_at_ms, decided_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         user_account_id = VALUES(user_account_id), signup_status = VALUES(signup_status),
         queue_position = VALUES(queue_position), signed_up_at_ms = VALUES(signed_up_at_ms),
         decided_at_ms = VALUES(decided_at_ms), updated_at_ms = VALUES(updated_at_ms)`,
      [
        input.tournamentInternalId, input.playerInternalId, input.accountInternalId, input.status,
        input.status === "waiting" ? input.queuePosition : null, input.signedUpAtMs,
        input.decided ? input.nowMs : null, input.nowMs,
      ],
    );
  }

  public async writeRoster(input: Parameters<TournamentSignupTransaction["writeRoster"]>[0]): Promise<void> {
    const [rows] = await this.connection.execute<Row[]>(
      `SELECT attendance, has_switch_1 AS hasSwitch1, has_switch_2 AS hasSwitch2
       FROM tournament_participants WHERE tournament_id = ? AND player_id = ? LIMIT 1 FOR UPDATE`,
      [input.tournamentInternalId, input.playerInternalId],
    );
    const existing = rows[0];
    const attendance: SignupAttendance = input.attendance ??
      (existing === undefined ? "absent" : oneOf(existing["attendance"], attendances, "attendance"));
    const hasSwitch1 = input.hasSwitch1 ?? (existing === undefined ? false : flag(existing["hasSwitch1"]));
    const hasSwitch2 = input.hasSwitch2 ?? (existing === undefined ? false : flag(existing["hasSwitch2"]));
    if (existing === undefined) {
      // A new roster row starts without a seed: the night shows the live rating until the groups
      // are drawn, and drawing writes the seed down, exactly as for a Player the Director adds.
      await this.connection.execute(
        `INSERT INTO tournament_participants
           (tournament_id, player_id, attendance, has_switch_1, has_switch_2, seed_score, seed_rank,
            added_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
        [input.tournamentInternalId, input.playerInternalId, attendance, hasSwitch1, hasSwitch2, input.nowMs, input.nowMs],
      );
    } else {
      await this.connection.execute(
        `UPDATE tournament_participants
         SET attendance = ?, has_switch_1 = ?, has_switch_2 = ?, updated_at_ms = ?
         WHERE tournament_id = ? AND player_id = ?`,
        [attendance, hasSwitch1, hasSwitch2, input.nowMs, input.tournamentInternalId, input.playerInternalId],
      );
    }
    // A console somebody brings has its UTP cable number, as when the Director ticks it.
    for (const [owned, switchType] of [[hasSwitch1, "ns1"], [hasSwitch2, "ns2"]] as const) {
      if (!owned) { continue; }
      await this.connection.execute(
        `INSERT IGNORE INTO tournament_station_cables (owner_player_id, switch_type, revision, created_at_ms, updated_at_ms)
         VALUES (?, ?, 1, ?, ?)`,
        [input.playerInternalId, switchType, input.nowMs, input.nowMs],
      );
    }
  }

  public async touchTournament(tournamentInternalId: number, nowMs: number): Promise<void> {
    await this.connection.execute(
      "UPDATE tournaments SET revision = revision + 1, updated_at_ms = ? WHERE tournament_id = ?",
      [nowMs, tournamentInternalId],
    );
  }

  public async appendLifecycle(input: Parameters<TournamentSignupTransaction["appendLifecycle"]>[0]): Promise<void> {
    const [sequenceRows] = await this.connection.execute<Row[]>(
      "SELECT COALESCE(MAX(sequence_number), 0) AS latest FROM tournament_lifecycle WHERE tournament_id = ? FOR UPDATE",
      [input.tournamentInternalId],
    );
    const sequence = integer(sequenceRows[0]?.["latest"] ?? 0, "lifecycle sequence") + 1;
    await this.connection.execute(
      `INSERT INTO tournament_lifecycle
         (tournament_id, sequence_number, event_type, detail, actor_user_account_id, occurred_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.tournamentInternalId, sequence, input.eventType,
        input.detail === null ? null : input.detail.slice(0, 255), input.actorInternalId, input.nowMs,
      ],
    );
  }

  public async viewerAccount(userAccountId: string): Promise<SignupViewerAccount | null> {
    const [accounts] = await this.connection.execute<Row[]>(
      `SELECT user_account_id AS internalId FROM user_accounts
       WHERE public_id = ? AND account_status = 'active' LIMIT 1`,
      [userAccountId],
    );
    const account = accounts[0];
    if (account === undefined) { return null; }
    const internalId = integer(account["internalId"], "account id", 1);
    const [players] = await this.connection.execute<Row[]>(
      `SELECT player.player_id AS internalId, player.public_id AS playerId, player.display_name AS displayName
       FROM player_claims AS claim
       INNER JOIN players AS player ON player.player_id = claim.player_id
       WHERE claim.user_account_id = ? AND claim.claim_status = 'verified'
         AND player.record_status = 'active' AND player.player_kind = 'human'
       ORDER BY claim.updated_at_ms ASC, claim.player_claim_id ASC
       LIMIT 10`,
      [internalId],
    );
    return {
      internalId,
      players: players.map((row) => ({
        internalId: integer(row["internalId"], "player id", 1),
        playerId: String(row["playerId"]),
        displayName: String(row["displayName"]),
      })),
    };
  }

  public async operatorAccount(userAccountId: string): Promise<Readonly<{ internalId: number; isAdministrator: boolean }> | null> {
    const [rows] = await this.connection.execute<Row[]>(
      `SELECT account.user_account_id AS internalId,
              EXISTS (SELECT 1 FROM administrator_grants AS grant_row
                      WHERE grant_row.user_account_id = account.user_account_id
                        AND grant_row.grant_status = 'active') AS isAdministrator,
              EXISTS (SELECT 1 FROM account_capability_grants AS capability
                      WHERE capability.user_account_id = account.user_account_id
                        AND capability.capability_code = 'tournament.operation'
                        AND capability.grant_status = 'active') AS hasCapability
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

  public async listDueTournamentIds(nowMs: number, limit: number): Promise<readonly string[]> {
    const [rows] = await this.connection.execute<Row[]>(
      `SELECT t.public_id AS tournamentId
       FROM tournament_signup_settings AS settings
       INNER JOIN tournaments AS t ON t.tournament_id = settings.tournament_id
       WHERE settings.signup_mode = 'open' AND settings.selection_status = 'open'
         AND settings.closes_at_ms <= ? AND t.lifecycle_status = 'active'
       ORDER BY settings.closes_at_ms ASC
       LIMIT ${Math.max(1, Math.min(100, Math.trunc(limit)))}`,
      [nowMs],
    );
    return rows.map((row) => String(row["tournamentId"]));
  }
}

export class MysqlTournamentSignupRepository implements TournamentSignupRepository {
  public constructor(private readonly pool: Pool) {}

  public async transaction<T>(work: (transaction: TournamentSignupTransaction) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(new MysqlTournamentSignupTransaction(connection));
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
