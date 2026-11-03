import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

import type { ActorContext } from "../identity/types.js";
import { publicationRankSnapshots } from
  "../timetrials/publication-rank-snapshot.js";
import { refreshTimeTrialPlayerBestsForPlayers } from
  "../timetrials/time-trial-player-bests.js";

// Player public presence. This is a property of the Player, never of the
// UserAccount: accounts and authentication data are always private.
//
// A verified Player owner sets their own presence; an administrator may
// set any Player's. Going private withdraws public presence, it does not
// rewrite history: canonical submissions, revisions and publication rows
// stay exactly as they are, so going public again returns the same
// results through the ordinary publication policy rather than creating
// new ones.

export type PlayerVisibility = "public" | "private";

export class PlayerVisibilityError extends Error {
  public constructor(
    public readonly code:
      | "invalid_input"
      | "not_authenticated"
      | "forbidden"
      | "no_verified_player"
      | "player_not_found"
      | "unavailable",
  ) {
    super("The Player visibility could not be updated.");
    this.name = "PlayerVisibilityError";
  }
}

export type PlayerVisibilityState = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
  visibility: PlayerVisibility;
}>;

export interface PlayerVisibilityRepository {
  readForAccount(userAccountId: string): Promise<PlayerVisibilityState | null>;
  readForPlayer(playerId: string): Promise<PlayerVisibilityState | null>;
  // Applies the new presence and cascades public Time Trial presence in one
  // transaction. Returns null when the target Player does not exist.
  setVisibility(input: Readonly<{
    playerId: string;
    visibility: PlayerVisibility;
    actorRole: "owner" | "administrator";
    actorUserAccountId: string;
    reasonCode: string;
  }>): Promise<PlayerVisibilityState | null>;
}

const reasonPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export class PlayerVisibilityService {
  public constructor(
    private readonly repository: PlayerVisibilityRepository,
  ) {}

  public async readOwn(actor: ActorContext): Promise<PlayerVisibilityState> {
    const account = this.account(actor);
    const state = await this.guard(
      () => this.repository.readForAccount(account),
    );
    if (state === null) { throw new PlayerVisibilityError("no_verified_player"); }
    return state;
  }

  public async setOwn(
    actor: ActorContext,
    visibility: PlayerVisibility,
  ): Promise<PlayerVisibilityState> {
    const account = this.account(actor);
    this.requireVisibility(visibility);
    const current = await this.guard(
      () => this.repository.readForAccount(account),
    );
    if (current === null) {
      throw new PlayerVisibilityError("no_verified_player");
    }
    const next = await this.guard(() => this.repository.setVisibility({
      playerId: current.playerId,
      visibility,
      actorRole: "owner",
      actorUserAccountId: account,
      reasonCode: "owner_choice",
    }));
    if (next === null) { throw new PlayerVisibilityError("player_not_found"); }
    return next;
  }

  public async setForPlayer(
    actor: ActorContext,
    playerId: string,
    visibility: PlayerVisibility,
    reasonCode: string,
  ): Promise<PlayerVisibilityState> {
    if (actor.role !== "administrator") {
      throw new PlayerVisibilityError(
        actor.role === "anonymous" ? "not_authenticated" : "forbidden",
      );
    }
    this.requireVisibility(visibility);
    if (!reasonPattern.test(reasonCode) || reasonCode.length > 64) {
      throw new PlayerVisibilityError("invalid_input");
    }
    const next = await this.guard(() => this.repository.setVisibility({
      playerId,
      visibility,
      actorRole: "administrator",
      actorUserAccountId: actor.userAccountId,
      reasonCode,
    }));
    if (next === null) { throw new PlayerVisibilityError("player_not_found"); }
    return next;
  }

  private account(actor: ActorContext): string {
    if (actor.role !== "account" && actor.role !== "administrator") {
      throw new PlayerVisibilityError("not_authenticated");
    }
    return actor.userAccountId;
  }

  private requireVisibility(value: string): void {
    if (value !== "public" && value !== "private") {
      throw new PlayerVisibilityError("invalid_input");
    }
  }

  private async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof PlayerVisibilityError) { throw error; }
      throw new PlayerVisibilityError("unavailable");
    }
  }
}

type StateRow = RowDataPacket & {
  playerInternalId: number;
  playerId: string;
  username: string;
  displayName: string;
  visibility: string;
};

export class MysqlPlayerVisibilityRepository
implements PlayerVisibilityRepository {
  public constructor(
    private readonly pool: Pool,
    private readonly clock: Readonly<{ nowMs(): number }> =
    { nowMs: () => Date.now() },
  ) {}

  public async readForAccount(
    userAccountId: string,
  ): Promise<PlayerVisibilityState | null> {
    const [rows] = await this.pool.execute<StateRow[]>(
      `${stateSelect}
       INNER JOIN player_claims AS claim
         ON claim.player_id = player.player_id
        AND claim.claim_status = 'verified'
       INNER JOIN user_accounts AS account
         ON account.user_account_id = claim.user_account_id
       WHERE account.public_id = ? AND player.record_status = 'active'
       LIMIT 1`,
      [userAccountId],
    );
    return project(rows[0]);
  }

  public async readForPlayer(
    playerId: string,
  ): Promise<PlayerVisibilityState | null> {
    const [rows] = await this.pool.execute<StateRow[]>(
      `${stateSelect} WHERE player.public_id = ? LIMIT 1`,
      [playerId],
    );
    return project(rows[0]);
  }

  public async setVisibility(input: Readonly<{
    playerId: string;
    visibility: PlayerVisibility;
    actorRole: "owner" | "administrator";
    actorUserAccountId: string;
    reasonCode: string;
  }>): Promise<PlayerVisibilityState | null> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<StateRow[]>(
        `${stateSelect} WHERE player.public_id = ? LIMIT 1 FOR UPDATE`,
        [input.playerId],
      );
      const current = rows[0];
      if (current === undefined) {
        await connection.rollback();
        return null;
      }
      const before = current.visibility === "private" ? "private" : "public";
      const playerInternalId = Number(current.playerInternalId);
      if (before !== input.visibility) {
        const [account] = await connection.execute<RowDataPacket[]>(
          `SELECT user_account_id AS internalId FROM user_accounts
           WHERE public_id = ? LIMIT 1`,
          [input.actorUserAccountId],
        );
        const actorInternalId = Number(
          (account[0] as { internalId?: unknown } | undefined)?.internalId,
        );
        if (!Number.isSafeInteger(actorInternalId)) {
          await connection.rollback();
          throw new PlayerVisibilityError("forbidden");
        }
        const occurredAtMs = this.clock.nowMs();
        await connection.execute(
          `UPDATE players SET visibility = ?, updated_at_ms = ?
           WHERE player_id = ?`,
          [input.visibility, occurredAtMs, playerInternalId],
        );
        await connection.execute(
          `INSERT INTO player_visibility_lifecycle (
             player_id, sequence_number, visibility_before, visibility_after,
             actor_role, actor_user_account_id, reason_code, occurred_at_ms
           ) SELECT ?, COALESCE(MAX(sequence_number), 0) + 1, ?, ?, ?, ?, ?, ?
             FROM player_visibility_lifecycle WHERE player_id = ?`,
          [
            playerInternalId, before, input.visibility, input.actorRole,
            actorInternalId, input.reasonCode, occurredAtMs, playerInternalId,
          ],
        );
        await this.cascadePublications(
          connection,
          playerInternalId,
          input.visibility,
          input.actorRole,
          occurredAtMs,
        );
      }
      await connection.commit();
      return {
        playerId: String(current.playerId),
        username: String(current.username),
        displayName: String(current.displayName),
        visibility: input.visibility,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // Public Time Trial presence follows the Player. Going private withholds
  // every currently published result; going public republishes exactly the
  // ones that were withheld for that reason and are still eligible, so a
  // retired result stays retired and nothing is published twice.
  private async cascadePublications(
    connection: PoolConnection,
    playerInternalId: number,
    visibility: PlayerVisibility,
    actorRole: "owner" | "administrator",
    occurredAtMs: number,
  ): Promise<void> {
    const origin = actorRole === "owner"
      ? "owner_lifecycle"
      : "administrator_lifecycle";
    const target = visibility === "private"
      ? {
        status: "withheld" as const,
        reason: "player_private",
        event: "revision_withheld" as const,
        predicate: `publication.publication_status = 'published'`,
      }
      : {
        status: "published" as const,
        reason: "result_restored",
        event: "revision_published" as const,
        predicate: `publication.publication_status = 'withheld'
           AND publication.reason_code = 'player_private'
           AND submission.retirement_state = 'active'`,
      };
    const [candidates] = await connection.execute<RowDataPacket[]>(
      `SELECT publication.time_trial_publication_id AS publicationId,
              publication.current_revision_id AS revisionId,
              publication.publication_revision AS publicationRevision
       FROM time_trial_publications AS publication
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id
            = publication.time_trial_submission_id
       INNER JOIN time_trial_submission_revisions AS revision
         ON revision.time_trial_submission_revision_id
            = publication.current_revision_id
       WHERE revision.player_id = ? AND ${target.predicate}
       FOR UPDATE`,
      [playerInternalId],
    );
    const typedCandidates = candidates as unknown as readonly {
      publicationId: number;
      revisionId: number;
      publicationRevision: number;
    }[];
    const ranks = target.status === "published"
      ? await publicationRankSnapshots(
        connection,
        typedCandidates.map((candidate) => Number(candidate.revisionId)),
      )
      : new Map<number, number>();
    for (const row of typedCandidates) {
      const nextRevision = Number(row.publicationRevision) + 1;
      const revisionId = Number(row.revisionId);
      const rankAtPublication = ranks.get(revisionId);
      if (target.status === "published" && rankAtPublication === undefined) {
        throw new PlayerVisibilityError("unavailable");
      }
      await connection.execute(
        `UPDATE time_trial_publications
         SET publication_status = ?, publication_origin = ?, reason_code = ?,
             publication_revision = ?, published_at_ms = ?,
             rank_at_publication = ?, updated_at_ms = ?
         WHERE time_trial_publication_id = ?`,
        [
          target.status, origin, target.reason, nextRevision,
          target.status === "published" ? occurredAtMs : null,
          rankAtPublication ?? null, occurredAtMs, row.publicationId,
        ],
      );
      await connection.execute(
        `INSERT INTO time_trial_publication_lifecycle (
           time_trial_publication_id, sequence_number,
           time_trial_submission_revision_id, event_type,
           publication_status_after, publication_origin, reason_code,
           rank_at_publication, occurred_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.publicationId, nextRevision, revisionId, target.event,
          target.status, origin, target.reason,
          rankAtPublication ?? null, occurredAtMs,
        ],
      );
    }
    await refreshTimeTrialPlayerBestsForPlayers(
      connection,
      [playerInternalId],
    );
  }
}

const stateSelect = `SELECT player.player_id AS playerInternalId,
        player.public_id AS playerId,
        username.username_value AS username,
        player.display_name AS displayName,
        player.visibility AS visibility
 FROM players AS player
 INNER JOIN player_username_history AS username
   ON username.current_player_id = player.player_id`;

function project(row: StateRow | undefined): PlayerVisibilityState | null {
  if (row === undefined) { return null; }
  return {
    playerId: String(row.playerId),
    username: String(row.username),
    displayName: String(row.displayName),
    visibility: row.visibility === "private" ? "private" : "public",
  };
}
