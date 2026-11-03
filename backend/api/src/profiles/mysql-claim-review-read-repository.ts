import type { RowDataPacket } from "mysql2";

import {
  SHARED_TOURNAMENT_SQL,
  sharedTournamentValues,
} from "../identity/mysql-claim-write-repository.js";
import type { PreparedQueryExecutor } from
  "../identity/mysql-identity-read-repository.js";
import type { ClaimStatus, DisputeStatus } from "../identity/types.js";
import type {
  AccountClaimWalkItem,
  ClaimDecisionView,
  ClaimNoteView,
  ClaimPlayerRef,
  ClaimReviewCard,
  ClaimReviewer,
  ClaimReviewQueue,
  ClaimReviewReadRepository,
  LinkedClaimRow,
} from "./claim-review-read-service.js";

const accountIdPattern = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const claimStatuses = new Set<string>(["requested", "under_review", "verified", "rejected", "released", "revoked"]);
const disputeStatuses = new Set<string>(["none", "open", "resolved"]);

class ClaimReviewPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ClaimReviewPersistenceError";
  }
}

type Row = RowDataPacket & Record<string, unknown>;

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ClaimReviewPersistenceError(`${field} is invalid`);
  }
  return value;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function count(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function epoch(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new ClaimReviewPersistenceError(`${field} is invalid`);
  }
  return number;
}

function claimStatus(value: unknown): ClaimStatus {
  if (typeof value !== "string" || !claimStatuses.has(value)) {
    throw new ClaimReviewPersistenceError("claimStatus is invalid");
  }
  return value as ClaimStatus;
}

function disputeStatus(value: unknown): DisputeStatus {
  if (typeof value !== "string" || !disputeStatuses.has(value)) {
    throw new ClaimReviewPersistenceError("disputeStatus is invalid");
  }
  return value as DisputeStatus;
}

function playerRef(row: Row, prefix = ""): ClaimPlayerRef {
  return {
    playerId: text(row[`${prefix}playerId`], "playerId"),
    username: text(row[`${prefix}username`], "username"),
    displayName: text(row[`${prefix}displayName`], "displayName"),
  };
}

/** The display name of the Player an account owns, used as the reviewer's name. */
const ACCOUNT_NAME_SQL = (accountColumn: string): string => `(
  SELECT named.display_name FROM player_claims AS name_claim
  INNER JOIN players AS named ON named.player_id = name_claim.player_id
  WHERE name_claim.user_account_id = ${accountColumn} AND name_claim.claim_status = 'verified'
  ORDER BY name_claim.updated_at_ms ASC LIMIT 1)`;

const CLAIM_COLUMNS = `claim.public_id AS playerClaimId,
       claim.claim_status AS claimStatus,
       claim.dispute_status AS disputeStatus,
       claim.created_at_ms AS requestedAtMs,
       claim.updated_at_ms AS updatedAtMs,
       player.public_id AS playerId,
       username.username_value AS username,
       player.display_name AS displayName`;

const CLAIM_JOINS = `INNER JOIN players AS player ON player.player_id = claim.player_id
       INNER JOIN player_username_history AS username
         ON username.player_id = player.player_id AND username.released_at_ms IS NULL`;

/** Tournaments the account directs in which the claim's Player took part (ADR-0216 section 1). */
const DIRECTS_PLAYER_SQL = `EXISTS (
         SELECT 1 FROM tournaments AS directed
         INNER JOIN tournament_participants AS directed_participant
           ON directed_participant.tournament_id = directed.tournament_id
         WHERE directed.director_user_account_id = reviewer.user_account_id
           AND directed_participant.player_id = claim.player_id)`;

export class MysqlClaimReviewReadRepository implements ClaimReviewReadRepository {
  public constructor(private readonly executor: PreparedQueryExecutor) {}

  public async listClaimWalkForAccount(userAccountId: string): Promise<readonly AccountClaimWalkItem[]> {
    if (!accountIdPattern.test(userAccountId)) {
      throw new ClaimReviewPersistenceError("userAccountId is invalid");
    }
    const [rows] = await this.executor.execute<Row[]>(
      `SELECT ${CLAIM_COLUMNS}, claim.player_claim_id AS claimInternalId, claim.player_id AS playerInternalId
       FROM player_claims AS claim
       INNER JOIN user_accounts AS account ON account.user_account_id = claim.user_account_id
       ${CLAIM_JOINS}
       WHERE account.public_id = ? AND account.account_status = 'active'
       ORDER BY claim.updated_at_ms DESC, claim.public_id ASC
       LIMIT 20`,
      [userAccountId],
    );
    const items: AccountClaimWalkItem[] = [];
    for (const row of rows) {
      const claimInternalId = epoch(row["claimInternalId"], "claimInternalId");
      const playerInternalId = epoch(row["playerInternalId"], "playerInternalId");
      items.push({
        playerClaimId: text(row["playerClaimId"], "playerClaimId"),
        player: playerRef(row),
        claimStatus: claimStatus(row["claimStatus"]),
        disputeStatus: disputeStatus(row["disputeStatus"]),
        requestedAtMs: epoch(row["requestedAtMs"], "requestedAtMs"),
        updatedAtMs: epoch(row["updatedAtMs"], "updatedAtMs"),
        reviewerDirectorNames: await this.directorNames(playerInternalId),
        lastDecision: await this.lastDecision(claimInternalId),
        notes: await this.notes(claimInternalId),
      });
    }
    return items;
  }

  public async listReviewQueue(reviewer: ClaimReviewer): Promise<ClaimReviewQueue> {
    if (!accountIdPattern.test(reviewer.userAccountId)) {
      throw new ClaimReviewPersistenceError("userAccountId is invalid");
    }
    const visibility = reviewer.administrator
      ? "TRUE"
      : `${DIRECTS_PLAYER_SQL} AND claim.user_account_id <> reviewer.user_account_id`;
    const [openRows] = await this.executor.execute<Row[]>(
      `SELECT ${CLAIM_COLUMNS},
              claim.player_claim_id AS claimInternalId,
              claim.player_id AS playerInternalId,
              requester.public_id AS requesterAccountId,
              requester.user_account_id AS requesterInternalId,
              requester.created_at_ms AS accountCreatedAtMs
       FROM player_claims AS claim
       INNER JOIN user_accounts AS requester ON requester.user_account_id = claim.user_account_id
       INNER JOIN user_accounts AS reviewer ON reviewer.public_id = ?
       ${CLAIM_JOINS}
       WHERE claim.claim_status IN ('requested', 'under_review')
         AND (${visibility})
       ORDER BY claim.created_at_ms ASC, claim.public_id ASC
       LIMIT 50`,
      [reviewer.userAccountId],
    );
    const open: ClaimReviewCard[] = [];
    for (const row of openRows) {
      open.push(await this.card(row, reviewer.administrator));
    }

    const [linkedRows] = await this.executor.execute<Row[]>(
      `SELECT ${CLAIM_COLUMNS},
              claim.user_account_id AS requesterInternalId,
              claim.player_claim_id AS claimInternalId
       FROM player_claims AS claim
       INNER JOIN user_accounts AS reviewer ON reviewer.public_id = ?
       ${CLAIM_JOINS}
       WHERE claim.claim_status = 'verified' AND claim.dispute_status <> 'open'
         AND (${visibility})
       ORDER BY player.display_name ASC, claim.public_id ASC
       LIMIT 300`,
      [reviewer.userAccountId],
    );
    const linked: LinkedClaimRow[] = [];
    for (const row of linkedRows) {
      const requesterInternalId = epoch(row["requesterInternalId"], "requesterInternalId");
      const ownPlayer = playerRef(row);
      linked.push({
        playerClaimId: text(row["playerClaimId"], "playerClaimId"),
        player: ownPlayer,
        accountPlayers: (await this.verifiedPlayers(requesterInternalId))
          .filter((candidate) => candidate.playerId !== ownPlayer.playerId),
        linkedAtMs: epoch(row["updatedAtMs"], "updatedAtMs"),
        reviewerRole: reviewer.administrator ? "administrator" : "director",
      });
    }
    return { open, linked };
  }

  private async card(row: Row, administrator: boolean): Promise<ClaimReviewCard> {
    const claimInternalId = epoch(row["claimInternalId"], "claimInternalId");
    const playerInternalId = epoch(row["playerInternalId"], "playerInternalId");
    const requesterInternalId = epoch(row["requesterInternalId"], "requesterInternalId");
    const requesterAccountId = text(row["requesterAccountId"], "requesterAccountId");
    const player = playerRef(row);

    const [statsRows] = await this.executor.execute<Row[]>(
      `SELECT
         (SELECT COUNT(*) FROM (
            SELECT CASE WHEN t.edition_number IS NULL THEN CONCAT('t', t.tournament_id)
                        ELSE CONCAT('TN', t.edition_number) END AS night
            FROM tournament_participants AS tp
            INNER JOIN tournaments AS t ON t.tournament_id = tp.tournament_id
            WHERE tp.player_id = ?
            UNION
            SELECT CONCAT('TN', race.tournament_number)
            FROM legacy_race_placements AS lp
            INNER JOIN legacy_tournament_races AS race
              ON race.legacy_tournament_race_id = lp.legacy_tournament_race_id
            WHERE lp.player_id = ?
            UNION
            SELECT CONCAT('TN', section.tournament_number)
            FROM tournament_history_placements AS hp
            INNER JOIN tournament_history_races AS hrace
              ON hrace.tournament_history_race_id = hp.tournament_history_race_id
            INNER JOIN tournament_history_sections AS section
              ON section.tournament_history_section_id = hrace.tournament_history_section_id
            WHERE hp.player_id = ?
          ) AS nights) AS tournamentNights,
         (SELECT r.mu - 3 * r.sigma FROM player_ratings AS r WHERE r.player_id = ?) AS conservativeRating,
         (SELECT COUNT(*) FROM time_trial_publications AS publication
            INNER JOIN time_trial_submission_revisions AS revision
              ON revision.time_trial_submission_revision_id = publication.current_revision_id
            WHERE publication.publication_status = 'published' AND revision.player_id = ?) AS publishedTimeTrials,
         (SELECT COUNT(*) FROM player_claims AS other
            WHERE other.player_id = ? AND other.player_claim_id <> ?
              AND other.claim_status IN ('requested', 'under_review')) AS otherOpenClaims,
         (SELECT COUNT(*) FROM player_claims AS linked
            WHERE linked.player_id = ? AND linked.claim_status = 'verified') AS linkedClaims`,
      [
        playerInternalId, playerInternalId, playerInternalId, playerInternalId, playerInternalId,
        playerInternalId, claimInternalId, playerInternalId,
      ],
    );
    const stats = statsRows[0] ?? ({} as Row);
    const [lastRows] = await this.executor.execute<Row[]>(
      `SELECT t.name AS name, t.event_date AS eventDate
       FROM tournament_participants AS tp
       INNER JOIN tournaments AS t ON t.tournament_id = tp.tournament_id
       WHERE tp.player_id = ?
       ORDER BY t.event_date DESC, t.created_at_ms DESC
       LIMIT 1`,
      [playerInternalId],
    );
    const [sharedRows] = await this.executor.execute<Row[]>(
      SHARED_TOURNAMENT_SQL,
      sharedTournamentValues(requesterAccountId, player.playerId),
    );
    const rating = stats["conservativeRating"] === null || stats["conservativeRating"] === undefined
      ? null
      : Number(stats["conservativeRating"]);

    return {
      playerClaimId: text(row["playerClaimId"], "playerClaimId"),
      claimStatus: claimStatus(row["claimStatus"]),
      disputeStatus: disputeStatus(row["disputeStatus"]),
      requestedAtMs: epoch(row["requestedAtMs"], "requestedAtMs"),
      updatedAtMs: epoch(row["updatedAtMs"], "updatedAtMs"),
      reviewerRole: administrator ? "administrator" : "director",
      requester: {
        userAccountId: requesterAccountId,
        accountCreatedAtMs: epoch(row["accountCreatedAtMs"], "accountCreatedAtMs"),
        verifiedPlayers: await this.verifiedPlayers(requesterInternalId),
      },
      player: {
        ...player,
        tournamentNights: count(stats["tournamentNights"]),
        lastNightName: optionalText(lastRows[0]?.["name"]),
        lastNightDate: optionalText(lastRows[0]?.["eventDate"]),
        directorNames: await this.directorNames(playerInternalId),
        conservativeRating: rating !== null && Number.isFinite(rating) ? Math.round(rating * 100) / 100 : null,
        publishedTimeTrials: count(stats["publishedTimeTrials"]),
        otherOpenClaims: count(stats["otherOpenClaims"]),
      },
      conflicts: {
        playerAlreadyLinked: count(stats["linkedClaims"]) > 0,
        sharedTournament: optionalText(sharedRows[0]?.["label"]),
      },
      notes: await this.notes(claimInternalId),
    };
  }

  private async verifiedPlayers(accountInternalId: number): Promise<readonly ClaimPlayerRef[]> {
    const [rows] = await this.executor.execute<Row[]>(
      `SELECT player.public_id AS playerId, username.username_value AS username,
              player.display_name AS displayName
       FROM player_claims AS claim
       ${CLAIM_JOINS}
       WHERE claim.user_account_id = ? AND claim.claim_status = 'verified'
       ORDER BY claim.updated_at_ms ASC
       LIMIT 10`,
      [accountInternalId],
    );
    return rows.map((row) => playerRef(row));
  }

  private async directorNames(playerInternalId: number): Promise<readonly string[]> {
    const [rows] = await this.executor.execute<Row[]>(
      `SELECT DISTINCT ${ACCOUNT_NAME_SQL("t.director_user_account_id")} AS name
       FROM tournament_participants AS tp
       INNER JOIN tournaments AS t ON t.tournament_id = tp.tournament_id
       INNER JOIN user_accounts AS director ON director.user_account_id = t.director_user_account_id
       WHERE tp.player_id = ? AND director.account_status = 'active'
       LIMIT 10`,
      [playerInternalId],
    );
    return [...new Set(rows.map((row) => optionalText(row["name"])).filter((name): name is string => name !== null))];
  }

  private async lastDecision(claimInternalId: number): Promise<ClaimDecisionView | null> {
    const [rows] = await this.executor.execute<Row[]>(
      `SELECT event.event_type AS eventType, event.actor_type AS actorType,
              event.reason_code AS reasonCode, event.occurred_at_ms AS occurredAtMs,
              ${ACCOUNT_NAME_SQL("event.actor_user_account_id")} AS actorName
       FROM player_claim_lifecycle AS event
       WHERE event.player_claim_id = ?
         AND event.event_type IN ('claim_verified', 'claim_rejected', 'claim_released', 'claim_revoked')
       ORDER BY event.sequence_number DESC
       LIMIT 1`,
      [claimInternalId],
    );
    const row = rows[0];
    if (row === undefined) { return null; }
    const decisions: Record<string, ClaimDecisionView["decision"]> = {
      claim_verified: "verified",
      claim_rejected: "rejected",
      claim_released: "released",
      claim_revoked: "revoked",
    };
    const roles: Record<string, ClaimDecisionView["byRole"]> = {
      requesting_account: "requester",
      administrator: "administrator",
      director: "director",
    };
    const decision = decisions[String(row["eventType"])];
    const byRole = roles[String(row["actorType"])];
    if (decision === undefined || byRole === undefined) {
      throw new ClaimReviewPersistenceError("claim decision is invalid");
    }
    return {
      decision,
      byRole,
      byName: byRole === "requester" ? null : optionalText(row["actorName"]),
      reasonCode: optionalText(row["reasonCode"]),
      decidedAtMs: epoch(row["occurredAtMs"], "occurredAtMs"),
    };
  }

  private async notes(claimInternalId: number): Promise<readonly ClaimNoteView[]> {
    const [rows] = await this.executor.execute<Row[]>(
      `SELECT note.author_role AS role, note.note_kind AS kind, note.body AS body,
              note.created_at_ms AS createdAtMs,
              ${ACCOUNT_NAME_SQL("note.author_user_account_id")} AS authorName
       FROM player_claim_notes AS note
       WHERE note.player_claim_id = ?
       ORDER BY note.created_at_ms ASC, note.claim_note_id ASC
       LIMIT 50`,
      [claimInternalId],
    );
    return rows.map((row) => {
      const role = row["role"] === "reviewer" ? "reviewer" : "requester";
      const kind = String(row["kind"]);
      if (!["request", "question", "reply", "decision"].includes(kind)) {
        throw new ClaimReviewPersistenceError("note kind is invalid");
      }
      return {
        role,
        kind: kind as ClaimNoteView["kind"],
        body: text(row["body"], "body"),
        authorName: role === "reviewer" ? optionalText(row["authorName"]) : null,
        createdAtMs: epoch(row["createdAtMs"], "createdAtMs"),
      };
    });
  }
}
