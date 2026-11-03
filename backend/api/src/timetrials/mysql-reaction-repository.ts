import type { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";

import {
  REACTION_KINDS,
  type ReactionKind,
  type ReactionRepository,
  type ReactionSummary,
} from "./reaction-service.js";

type PreparedQueryExecutor = Pick<Pool, "execute">;

interface CountRow extends RowDataPacket {
  resultId: unknown;
  reactionKind: unknown;
  reactionCount: unknown;
}

interface MineRow extends RowDataPacket {
  resultId: unknown;
  reactionKind: unknown;
}

function kindOf(value: unknown): ReactionKind | null {
  return typeof value === "string" &&
    (REACTION_KINDS as readonly string[]).includes(value)
    ? value as ReactionKind
    : null;
}

export class MysqlReactionRepository implements ReactionRepository {
  public constructor(private readonly executor: PreparedQueryExecutor) {}

  public async summarize(
    resultIds: readonly string[],
    userAccountId: string | null,
  ): Promise<readonly ReactionSummary[]> {
    const placeholders = resultIds.map(() => "?").join(", ");
    const [countRows] = await this.executor.execute<CountRow[]>(
      `SELECT submission.public_id AS resultId,
              reaction.reaction_kind AS reactionKind,
              COUNT(*) AS reactionCount
       FROM time_trial_reactions AS reaction
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id =
            reaction.time_trial_submission_id
       WHERE submission.public_id IN (${placeholders})
       GROUP BY submission.public_id, reaction.reaction_kind`,
      [...resultIds],
    );
    const mine = new Map<string, ReactionKind>();
    if (userAccountId !== null) {
      const [mineRows] = await this.executor.execute<MineRow[]>(
        `SELECT submission.public_id AS resultId,
                reaction.reaction_kind AS reactionKind
         FROM time_trial_reactions AS reaction
         INNER JOIN time_trial_submissions AS submission
           ON submission.time_trial_submission_id =
              reaction.time_trial_submission_id
         INNER JOIN user_accounts AS account
           ON account.user_account_id = reaction.user_account_id
         WHERE account.public_id = ?
           AND submission.public_id IN (${placeholders})`,
        [userAccountId, ...resultIds],
      );
      for (const row of mineRows) {
        const kind = kindOf(row.reactionKind);
        if (typeof row.resultId === "string" && kind !== null) {
          mine.set(row.resultId, kind);
        }
      }
    }
    const summaries = new Map<string, Partial<Record<ReactionKind, number>>>(
      resultIds.map((resultId) => [resultId, {}]),
    );
    for (const row of countRows) {
      const kind = kindOf(row.reactionKind);
      const counts = typeof row.resultId === "string"
        ? summaries.get(row.resultId)
        : undefined;
      const count = Number(row.reactionCount);
      if (kind !== null && counts !== undefined && Number.isSafeInteger(count)) {
        counts[kind] = count;
      }
    }
    return resultIds.map((resultId) => {
      const myKind = mine.get(resultId);
      return {
        resultId,
        counts: summaries.get(resultId)!,
        ...(myKind === undefined ? {} : { mine: myKind }),
      };
    });
  }

  public async react(
    resultId: string,
    userAccountId: string,
    kind: ReactionKind,
    nowMs: number,
  ): Promise<"reacted_new" | "reacted" | "not_found" | "own_result"> {
    // Only a published Time Trial of an active Player can be reacted to,
    // and never the reactor's own Time Trial; the SELECT resolves to zero
    // rows otherwise and nothing is written.
    const [result] = await this.executor.execute<ResultSetHeader>(
      `INSERT INTO time_trial_reactions
         (time_trial_submission_id, user_account_id, reaction_kind,
          created_at_ms, updated_at_ms)
       SELECT submission.time_trial_submission_id,
              account.user_account_id, ?, ?, ?
       FROM time_trial_submissions AS submission
       INNER JOIN time_trial_publications AS publication
         ON publication.time_trial_submission_id =
            submission.time_trial_submission_id
        AND publication.publication_status = 'published'
       INNER JOIN user_accounts AS account
         ON account.public_id = ? AND account.account_status = 'active'
       INNER JOIN time_trial_submission_revisions AS revision
         ON revision.time_trial_submission_revision_id =
            publication.current_revision_id
       WHERE submission.public_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM player_claims AS claim
           WHERE claim.claim_status = 'verified'
             AND claim.player_id = revision.player_id
             AND claim.user_account_id = account.user_account_id
         )
       ON DUPLICATE KEY UPDATE
         reaction_kind = VALUES(reaction_kind),
         updated_at_ms = VALUES(updated_at_ms)`,
      [kind, nowMs, nowMs, userAccountId, resultId],
    );
    // MySQL reports 1 affected row for a fresh insert and 2 for an
    // ON DUPLICATE update; 0 covers both an unchanged same-kind reaction
    // and a refused target, distinguished via direct lookups.
    if (result.affectedRows === 1) { return "reacted_new"; }
    if (result.affectedRows > 1 ||
        await this.exists(resultId, userAccountId)) {
      return "reacted";
    }
    return await this.isOwnPublishedResult(resultId, userAccountId)
      ? "own_result"
      : "not_found";
  }

  private async isOwnPublishedResult(
    resultId: string,
    userAccountId: string,
  ): Promise<boolean> {
    const [rows] = await this.executor.execute<RowDataPacket[]>(
      `SELECT publication.time_trial_publication_id
       FROM time_trial_publications AS publication
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id =
            publication.time_trial_submission_id
       INNER JOIN time_trial_submission_revisions AS revision
         ON revision.time_trial_submission_revision_id =
            publication.current_revision_id
       INNER JOIN player_claims AS claim
         ON claim.claim_status = 'verified'
        AND claim.player_id = revision.player_id
       INNER JOIN user_accounts AS account
         ON account.user_account_id = claim.user_account_id
       WHERE publication.publication_status = 'published'
         AND submission.public_id = ?
         AND account.public_id = ?
       LIMIT 1`,
      [resultId, userAccountId],
    );
    return rows.length > 0;
  }

  private async exists(
    resultId: string,
    userAccountId: string,
  ): Promise<boolean> {
    const [rows] = await this.executor.execute<RowDataPacket[]>(
      `SELECT reaction.time_trial_reaction_id
       FROM time_trial_reactions AS reaction
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id =
            reaction.time_trial_submission_id
       INNER JOIN user_accounts AS account
         ON account.user_account_id = reaction.user_account_id
       WHERE submission.public_id = ? AND account.public_id = ?
       LIMIT 1`,
      [resultId, userAccountId],
    );
    return rows.length > 0;
  }

  public async remove(resultId: string, userAccountId: string): Promise<void> {
    await this.executor.execute<ResultSetHeader>(
      `DELETE reaction FROM time_trial_reactions AS reaction
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id =
            reaction.time_trial_submission_id
       INNER JOIN user_accounts AS account
         ON account.user_account_id = reaction.user_account_id
       WHERE submission.public_id = ? AND account.public_id = ?`,
      [resultId, userAccountId],
    );
  }
}
