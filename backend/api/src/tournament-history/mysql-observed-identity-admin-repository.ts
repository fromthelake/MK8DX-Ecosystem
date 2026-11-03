import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import type {
  LinkablePlayer,
  ObservedIdentityLink,
  ObservedIdentityRepository,
} from "./observed-identity-admin-service.js";

// The mapping lives in `tournament_observed_identity_links`, one row per
// (section, name on screen). Per section rather than per person because
// "Vlietberg" is Moss HZ in TN08 and Milo V in TN10, and the extractor's own
// "Wanda_1"/"Wanda_2" suffixes mean nothing outside the recording that made
// them.

interface LinkRow extends RowDataPacket {
  linkId: unknown;
  tournamentNumber: unknown;
  sectionId: unknown;
  sectionName: unknown;
  legacySectionLabel: unknown;
  observedName: unknown;
  playerId: unknown;
  playerName: unknown;
  decisionSource: unknown;
  orderAgreement: unknown;
  videoPoints: unknown;
  historyPoints: unknown;
  note: unknown;
  placements: unknown;
}

interface PlayerRow extends RowDataPacket {
  playerId: unknown;
  displayName: unknown;
  tournamentRaces: unknown;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) { return null; }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export class MysqlObservedIdentityAdminRepository
implements ObservedIdentityRepository {
  readonly #pool: Pool;

  public constructor(pool: Pool) {
    this.#pool = pool;
  }

  public async listLinks(): Promise<readonly ObservedIdentityLink[]> {
    const [rows] = await this.#pool.execute<LinkRow[]>(
      `SELECT link.tournament_observed_identity_link_id AS linkId,
              section.tournament_number AS tournamentNumber,
              section.tournament_history_section_id AS sectionId,
              section.display_name AS sectionName,
              section.legacy_section_label AS legacySectionLabel,
              link.observed_name AS observedName,
              player.public_id AS playerId,
              player.display_name AS playerName,
              link.decision_source AS decisionSource,
              link.order_agreement AS orderAgreement,
              link.video_points AS videoPoints,
              link.history_points AS historyPoints,
              link.note AS note,
              (SELECT COUNT(*)
                 FROM tournament_history_placements AS placement
                 JOIN tournament_history_races AS race
                   ON race.tournament_history_race_id
                      = placement.tournament_history_race_id
                WHERE race.tournament_history_section_id
                      = section.tournament_history_section_id
                  AND placement.observed_player_name = link.observed_name
              ) AS placements
       FROM tournament_observed_identity_links AS link
       JOIN tournament_history_sections AS section
         ON section.tournament_history_section_id
            = link.tournament_history_section_id
       JOIN players AS player ON player.player_id = link.player_id
       ORDER BY section.tournament_number DESC, section.stage,
                section.sequence_number, link.observed_name`,
    );
    return rows.map((row) => ({
      linkId: String(row.linkId),
      tournamentNumber: Number(row.tournamentNumber),
      sectionId: String(row.sectionId),
      sectionName: String(row.sectionName),
      legacySectionLabel: row.legacySectionLabel === null
        ? null : String(row.legacySectionLabel),
      observedName: String(row.observedName),
      playerId: String(row.playerId),
      playerName: String(row.playerName),
      decisionSource: row.decisionSource === "manual" ? "manual" : "derived",
      orderAgreement: optionalNumber(row.orderAgreement),
      videoPoints: optionalNumber(row.videoPoints),
      historyPoints: optionalNumber(row.historyPoints),
      note: row.note === null ? null : String(row.note),
      placements: Number(row.placements ?? 0),
    }));
  }

  public async listLinkablePlayers(): Promise<readonly LinkablePlayer[]> {
    const [rows] = await this.#pool.execute<PlayerRow[]>(
      `SELECT player.public_id AS playerId,
              player.display_name AS displayName,
              COUNT(placement.tournament_history_placement_id)
                AS tournamentRaces
       FROM players AS player
       LEFT JOIN tournament_history_placements AS placement
         ON placement.player_id = player.player_id
       WHERE player.record_status = 'active'
       GROUP BY player.player_id
       HAVING tournamentRaces > 0
       ORDER BY player.display_name`,
    );
    return rows.map((row) => ({
      playerId: String(row.playerId),
      displayName: String(row.displayName),
      tournamentRaces: Number(row.tournamentRaces ?? 0),
    }));
  }

  public async assign(command: Readonly<{
    linkId: string;
    playerId: string;
    note: string | null;
    decidedByUserAccountId: string | null;
    decidedAtMs: number;
  }>): Promise<boolean> {
    const [result] = await this.#pool.execute<ResultSetHeader>(
      `UPDATE tournament_observed_identity_links AS link
       JOIN players AS player ON player.public_id = ?
       LEFT JOIN user_accounts AS account ON account.public_id = ?
       SET link.player_id = player.player_id,
           link.decision_source = 'manual',
           link.note = ?,
           link.decided_by_user_account_id = account.user_account_id,
           link.decided_at_ms = ?
       WHERE link.tournament_observed_identity_link_id = ?`,
      [command.playerId, command.decidedByUserAccountId ?? "",
        command.note, command.decidedAtMs, command.linkId],
    );
    return result.affectedRows > 0;
  }

  public async restoreDerived(linkId: string): Promise<boolean> {
    // The derived answer is not stored anywhere else, so the row is only
    // unmarked here; the next rebuild recomputes it from the races.
    const [result] = await this.#pool.execute<ResultSetHeader>(
      `UPDATE tournament_observed_identity_links
       SET decision_source = 'derived', note = NULL,
           decided_by_user_account_id = NULL
       WHERE tournament_observed_identity_link_id = ?
         AND decision_source = 'manual'`,
      [linkId],
    );
    return result.affectedRows > 0;
  }
}
