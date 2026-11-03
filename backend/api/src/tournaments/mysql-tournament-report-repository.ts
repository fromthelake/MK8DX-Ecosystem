import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

import {
  NIGHT_REPORT_CAPABILITY,
  STORED_REPORT_VISIBILITY,
  TournamentReportError,
  type PublicTournamentReport,
  type TournamentReportDraft,
  type TournamentReportGrant,
  type TournamentReportRepository,
  type TournamentReportVisibility,
  reportVisibility,
} from "./tournament-report-service.js";

interface GrantRow extends RowDataPacket {
  grantId: string; userAccountId: string; grantStatus: "active" | "revoked";
  revision: number | string; grantedAtMs: number | string; revokedAtMs: number | string | null;
}
interface DraftRow extends RowDataPacket {
  revision: number | string; titleText: string | null; introText: string;
  summaryText: string | null; tracksIntroText: string;
  playerNotesJson: string | Record<string, unknown> | null;
  groupNotesJson: string | Record<string, unknown> | null;
  visibilityJson: string | Record<string, unknown> | null;
  publishedRevision: number | string | null; publishedAtMs: number | string | null;
  updatedAtMs: number | string;
}

/** Every column the draft reads, so the two queries cannot drift apart. */
const DRAFT_COLUMNS = `draft.revision AS revision, draft.title_text AS titleText,
              draft.intro_text AS introText, draft.summary_text AS summaryText,
              draft.tracks_intro_text AS tracksIntroText,
              draft.player_notes_json AS playerNotesJson,
              draft.group_notes_json AS groupNotesJson,
              draft.visibility_json AS visibilityJson,
              draft.published_revision AS publishedRevision,
              draft.published_at_ms AS publishedAtMs,
              draft.updated_at_ms AS updatedAtMs`;

/** MySQL hands JSON back as an object, MariaDB as text; both arrive here. */
function jsonObject(value: string | Record<string, unknown> | null): Record<string, unknown> {
  if (value === null) { return {}; }
  if (typeof value !== "string") { return value; }
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function textMap(value: string | Record<string, unknown> | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(jsonObject(value))) {
    if (typeof entry === "string") { out[key] = entry; }
  }
  return out;
}

function visibility(value: string | Record<string, unknown> | null): TournamentReportVisibility {
  return reportVisibility(jsonObject(value), STORED_REPORT_VISIBILITY);
}

function snapshot(row: GrantRow): TournamentReportGrant {
  const revoked = row.revokedAtMs === null ? undefined : Number(row.revokedAtMs);
  return {
    grantId: row.grantId, userAccountId: row.userAccountId,
    capability: NIGHT_REPORT_CAPABILITY, status: row.grantStatus,
    revision: Number(row.revision), grantedAtMs: Number(row.grantedAtMs),
    ...(revoked === undefined ? {} : { revokedAtMs: revoked }),
  };
}

function draft(row: DraftRow): TournamentReportDraft {
  const published = row.publishedRevision === null ? undefined : Number(row.publishedRevision);
  const publishedAt = row.publishedAtMs === null ? undefined : Number(row.publishedAtMs);
  return {
    revision: Number(row.revision),
    titleText: row.titleText ?? "",
    introText: row.introText,
    summaryText: row.summaryText ?? "",
    tracksIntroText: row.tracksIntroText,
    playerNotes: textMap(row.playerNotesJson),
    groupNotes: textMap(row.groupNotesJson),
    visibility: visibility(row.visibilityJson),
    updatedAtMs: Number(row.updatedAtMs),
    ...(published === undefined ? {} : { publishedRevision: published }),
    ...(publishedAt === undefined ? {} : { publishedAtMs: publishedAt }),
  };
}

export class MysqlTournamentReportRepository implements TournamentReportRepository {
  public constructor(private readonly pool: Pool) {}

  public async hasCapability(userAccountId: string): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT grant_record.account_capability_grant_id
       FROM account_capability_grants AS grant_record
       INNER JOIN user_accounts AS account ON account.user_account_id = grant_record.user_account_id
       WHERE account.public_id = ? AND account.account_status = 'active'
         AND grant_record.capability_code = ? AND grant_record.grant_status = 'active' LIMIT 1`,
      [userAccountId, NIGHT_REPORT_CAPABILITY],
    );
    return rows.length === 1;
  }

  public async listActiveGrants(): Promise<readonly TournamentReportGrant[]> {
    const [rows] = await this.pool.execute<GrantRow[]>(
      `SELECT grant_record.public_id AS grantId, account.public_id AS userAccountId,
              grant_record.grant_status AS grantStatus, grant_record.revision AS revision,
              grant_record.granted_at_ms AS grantedAtMs, grant_record.revoked_at_ms AS revokedAtMs
       FROM account_capability_grants AS grant_record
       INNER JOIN user_accounts AS account ON account.user_account_id = grant_record.user_account_id
       WHERE grant_record.capability_code = ? AND grant_record.grant_status = 'active'
       ORDER BY grant_record.granted_at_ms, grant_record.account_capability_grant_id`,
      [NIGHT_REPORT_CAPABILITY],
    );
    return rows.map(snapshot);
  }

  public async grant(input: Parameters<TournamentReportRepository["grant"]>[0]): Promise<TournamentReportGrant> {
    return this.transaction(async (connection) => {
      const [accounts] = await connection.execute<RowDataPacket[]>(
        `SELECT user_account_id FROM user_accounts
         WHERE public_id = ? AND account_status = 'active' LIMIT 1 FOR UPDATE`, [input.userAccountId]);
      if (accounts.length !== 1) { throw new TournamentReportError("not_found", "UserAccount not found"); }
      const [existing] = await connection.execute<RowDataPacket[]>(
        `SELECT account_capability_grant_id FROM account_capability_grants
         WHERE user_account_id = ? AND capability_code = ? AND grant_status = 'active' LIMIT 1 FOR UPDATE`,
        [accounts[0]!["user_account_id"], NIGHT_REPORT_CAPABILITY]);
      if (existing.length > 0) { throw new TournamentReportError("conflict", "capability already granted"); }
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO account_capability_grants
         (public_id, revision, user_account_id, capability_code, grant_status,
          granted_by_user_account_id, granted_at_ms, revoked_at_ms, updated_at_ms)
         SELECT ?, 1, subject.user_account_id, ?, 'active', actor.user_account_id, ?, NULL, ?
         FROM user_accounts AS subject INNER JOIN user_accounts AS actor
         WHERE subject.public_id = ? AND actor.public_id = ?`,
        [input.grantId, NIGHT_REPORT_CAPABILITY, input.occurredAtMs, input.occurredAtMs,
          input.userAccountId, input.actorUserAccountId]);
      if (result.affectedRows !== 1) { throw new TournamentReportError("conflict", "grant was not created"); }
      await connection.execute(
        `INSERT INTO account_capability_grant_lifecycle
         (account_capability_grant_id, sequence_number, event_type, actor_user_account_id,
          grant_status_after, reason_code, occurred_at_ms)
         SELECT ?, 1, 'granted', user_account_id, 'active', ?, ? FROM user_accounts WHERE public_id = ?`,
        [result.insertId, input.reasonCode, input.occurredAtMs, input.actorUserAccountId]);
      return { grantId: input.grantId, userAccountId: input.userAccountId,
        capability: NIGHT_REPORT_CAPABILITY, status: "active", revision: 1,
        grantedAtMs: input.occurredAtMs };
    });
  }

  public async revoke(input: Parameters<TournamentReportRepository["revoke"]>[0]): Promise<TournamentReportGrant> {
    return this.transaction(async (connection) => {
      const [rows] = await connection.execute<GrantRow[]>(
        `SELECT grant_record.account_capability_grant_id, grant_record.public_id AS grantId,
                account.public_id AS userAccountId, grant_record.grant_status AS grantStatus,
                grant_record.revision AS revision, grant_record.granted_at_ms AS grantedAtMs,
                grant_record.revoked_at_ms AS revokedAtMs
         FROM account_capability_grants AS grant_record
         INNER JOIN user_accounts AS account ON account.user_account_id = grant_record.user_account_id
         WHERE account.public_id = ? AND grant_record.capability_code = ?
           AND grant_record.grant_status = 'active' LIMIT 1 FOR UPDATE`,
        [input.userAccountId, NIGHT_REPORT_CAPABILITY]);
      const current = rows[0];
      if (current === undefined) { throw new TournamentReportError("not_found", "active capability not found"); }
      const revision = Number(current.revision);
      const grantPk = current["account_capability_grant_id"];
      await connection.execute(
        `UPDATE account_capability_grants SET grant_status = 'revoked', revision = revision + 1,
         revoked_at_ms = ?, updated_at_ms = ? WHERE account_capability_grant_id = ? AND revision = ?`,
        [input.occurredAtMs, input.occurredAtMs, grantPk, revision]);
      await connection.execute(
        `INSERT INTO account_capability_grant_lifecycle
         (account_capability_grant_id, sequence_number, event_type, actor_user_account_id,
          grant_status_after, reason_code, occurred_at_ms)
         SELECT ?, ?, 'revoked', user_account_id, 'revoked', ?, ? FROM user_accounts WHERE public_id = ?`,
        [grantPk, revision + 1, input.reasonCode, input.occurredAtMs, input.actorUserAccountId]);
      return { ...snapshot(current), status: "revoked", revision: revision + 1, revokedAtMs: input.occurredAtMs };
    });
  }

  public async loadDraft(tournamentId: string): Promise<TournamentReportDraft | null> {
    const [rows] = await this.pool.execute<DraftRow[]>(
      `SELECT ${DRAFT_COLUMNS}
       FROM tournament_report_drafts AS draft
       INNER JOIN tournaments AS tournament ON tournament.tournament_id = draft.tournament_id
       WHERE tournament.public_id = ? LIMIT 1`, [tournamentId]);
    return rows[0] === undefined ? null : draft(rows[0]);
  }

  public async loadPublished(tournamentId: string): Promise<PublicTournamentReport | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT draft.published_payload_json AS payload
       FROM tournament_report_drafts AS draft
       INNER JOIN tournaments AS tournament ON tournament.tournament_id = draft.tournament_id
       WHERE tournament.public_id = ? AND draft.published_revision IS NOT NULL LIMIT 1`, [tournamentId]);
    const raw = rows[0]?.["payload"] as string | Record<string, unknown> | null | undefined;
    if (raw === undefined || raw === null) { return null; }
    const payload = jsonObject(raw);
    // Written by publish() from a typed value; read back defensively all the
    // same, because a row outlives the code that wrote it.
    return typeof payload["title"] === "string" ? payload as unknown as PublicTournamentReport : null;
  }

  /** Reopening the night puts a published report back to draft: the text stays, the community's copy goes. */
  public async unpublish(input: Readonly<{ tournamentId: string; nowMs: number }>): Promise<void> {
    await this.pool.execute(
      `UPDATE tournament_report_drafts AS draft
       INNER JOIN tournaments AS tournament ON tournament.tournament_id = draft.tournament_id
          SET draft.published_revision = NULL, draft.published_at_ms = NULL,
              draft.published_by_user_account_id = NULL, draft.published_payload_json = NULL
        WHERE tournament.public_id = ? AND draft.published_revision IS NOT NULL`,
      [input.tournamentId],
    );
    void input.nowMs;
  }

  public async publish(input: Parameters<TournamentReportRepository["publish"]>[0]): Promise<TournamentReportDraft> {
    return this.transaction(async (connection) => {
      const [rows] = await connection.execute<DraftRow[]>(
        `SELECT ${DRAFT_COLUMNS}
         FROM tournament_report_drafts AS draft
         INNER JOIN tournaments AS tournament ON tournament.tournament_id = draft.tournament_id
         WHERE tournament.public_id = ? LIMIT 1 FOR UPDATE`, [input.tournamentId]);
      const current = rows[0];
      if (current === undefined) { throw new TournamentReportError("not_found", "there is no report to publish"); }
      if (Number(current.revision) !== input.expectedRevision) {
        throw new TournamentReportError("conflict", "report draft changed concurrently");
      }
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE tournament_report_drafts AS draft
         INNER JOIN tournaments AS tournament ON tournament.tournament_id = draft.tournament_id
         INNER JOIN user_accounts AS actor ON actor.public_id = ?
            SET draft.published_revision = ?, draft.published_at_ms = ?,
                draft.published_by_user_account_id = actor.user_account_id,
                draft.published_payload_json = ?
          WHERE tournament.public_id = ?`,
        [input.actorUserAccountId, input.expectedRevision, input.occurredAtMs,
          JSON.stringify(input.payload), input.tournamentId]);
      if (result.affectedRows < 1) { throw new TournamentReportError("not_found", "tournament or account not found"); }
      return {
        ...draft(current),
        publishedRevision: input.expectedRevision,
        publishedAtMs: input.occurredAtMs,
      };
    });
  }

  public async saveDraft(input: Parameters<TournamentReportRepository["saveDraft"]>[0]): Promise<TournamentReportDraft> {
    return this.transaction(async (connection) => {
      const [currentRows] = await connection.execute<DraftRow[]>(
        `SELECT ${DRAFT_COLUMNS}
         FROM tournament_report_drafts AS draft
         INNER JOIN tournaments AS tournament ON tournament.tournament_id = draft.tournament_id
         WHERE tournament.public_id = ? LIMIT 1 FOR UPDATE`, [input.tournamentId]);
      const current = currentRows[0];
      if ((current === undefined && input.expectedRevision !== null) ||
          (current !== undefined && input.expectedRevision !== Number(current.revision))) {
        throw new TournamentReportError("conflict", "report draft changed concurrently");
      }
      const nextRevision = current === undefined ? 1 : Number(current.revision) + 1;
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO tournament_report_drafts
         (tournament_id, revision, title_text, intro_text, summary_text, tracks_intro_text,
          player_notes_json, group_notes_json, visibility_json,
          updated_by_user_account_id, updated_at_ms)
         SELECT tournament.tournament_id, ?, ?, ?, ?, ?, ?, ?, ?, actor.user_account_id, ?
         FROM tournaments AS tournament INNER JOIN user_accounts AS actor
         WHERE tournament.public_id = ? AND actor.public_id = ?
         ON DUPLICATE KEY UPDATE revision = VALUES(revision), title_text = VALUES(title_text),
          intro_text = VALUES(intro_text), summary_text = VALUES(summary_text),
          tracks_intro_text = VALUES(tracks_intro_text), player_notes_json = VALUES(player_notes_json),
          group_notes_json = VALUES(group_notes_json), visibility_json = VALUES(visibility_json),
          updated_by_user_account_id = VALUES(updated_by_user_account_id), updated_at_ms = VALUES(updated_at_ms)`,
        [nextRevision, input.titleText, input.introText, input.summaryText, input.tracksIntroText,
          JSON.stringify(input.playerNotes), JSON.stringify(input.groupNotes),
          JSON.stringify(input.visibility),
          input.occurredAtMs, input.tournamentId, input.actorUserAccountId]);
      if (result.affectedRows < 1) { throw new TournamentReportError("not_found", "tournament or account not found"); }
      // Publishing is left exactly as it was: an edit is not a publication.
      const published = current === undefined || current.publishedRevision === null
        ? {}
        : { publishedRevision: Number(current.publishedRevision), publishedAtMs: Number(current.publishedAtMs) };
      return {
        revision: nextRevision, titleText: input.titleText, introText: input.introText,
        summaryText: input.summaryText, tracksIntroText: input.tracksIntroText,
        playerNotes: input.playerNotes, groupNotes: input.groupNotes,
        visibility: input.visibility, updatedAtMs: input.occurredAtMs, ...published,
      };
    });
  }

  private async transaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try { await connection.beginTransaction(); const result = await work(connection); await connection.commit(); return result; }
    catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
}
