import type { Pool, RowDataPacket } from "mysql2/promise";

import type { ActorContext } from "../identity/types.js";

/**
 * The numbers an administrator opens the page for: how many people are
 * registered, how many were around lately, and what is waiting for a
 * decision. Read-only, and the same document for the website and the phone.
 *
 * "Active" is measured from the sign-in layer: a session that was created or
 * refreshed inside the window. Sessions refresh at most every twelve hours,
 * so the 24-hour figure has that granularity. "Submitted" counts the Players
 * who published a Time Trial inside the window, which is the other honest
 * sign of life the platform has.
 */
export const ADMINISTRATOR_OVERVIEW_SCHEMA_VERSION = "mk8dx.administrator-overview.v1";

export type AdministratorOverviewWindow = Readonly<{
  /** Distinct people with a signed-in session created or refreshed. */
  signedIn: number;
  /** Distinct Players who published a Time Trial. */
  submitted: number;
}>;

export type AdministratorOverview = Readonly<{
  schemaVersion: typeof ADMINISTRATOR_OVERVIEW_SCHEMA_VERSION;
  generatedAtMs: number;
  registered: Readonly<{
    /** People who completed a sign-in at least once. */
    signInIdentities: number;
    /** Domain accounts in the active state. */
    accounts: number;
    /** Active human Players, migrated and self-service alike. */
    players: number;
    /** Players linked to an account through a verified claim. */
    linkedPlayers: number;
    administrators: number;
  }>;
  active: Readonly<{
    last24h: AdministratorOverviewWindow;
    last7d: AdministratorOverviewWindow;
    last30d: AdministratorOverviewWindow;
  }>;
  pending: Readonly<{
    /** Link requests waiting for an administrator. */
    playerClaims: number;
  }>;
}>;

export class AdministratorOverviewError extends Error {
  public constructor(
    public readonly code: "forbidden" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "AdministratorOverviewError";
  }
}

export interface AdministratorOverviewRepository {
  registered(): Promise<AdministratorOverview["registered"]>;
  activeSince(sinceMs: number): Promise<AdministratorOverviewWindow>;
  pendingPlayerClaims(): Promise<number>;
}

const HOUR_MS = 60 * 60 * 1000;

export class AdministratorOverviewService {
  public constructor(
    private readonly repository: AdministratorOverviewRepository,
    private readonly clock: Readonly<{ nowMs(): number }> = { nowMs: () => Date.now() },
  ) {}

  public async overview(actor: ActorContext): Promise<AdministratorOverview> {
    if (actor.role !== "administrator") {
      throw new AdministratorOverviewError("forbidden", "administrator actor required");
    }
    const nowMs = this.clock.nowMs();
    const [registered, last24h, last7d, last30d, playerClaims] = await Promise.all([
      this.repository.registered(),
      this.repository.activeSince(nowMs - 24 * HOUR_MS),
      this.repository.activeSince(nowMs - 7 * 24 * HOUR_MS),
      this.repository.activeSince(nowMs - 30 * 24 * HOUR_MS),
      this.repository.pendingPlayerClaims(),
    ]);
    return {
      schemaVersion: ADMINISTRATOR_OVERVIEW_SCHEMA_VERSION,
      generatedAtMs: nowMs,
      registered,
      active: { last24h, last7d, last30d },
      pending: { playerClaims },
    };
  }
}

interface CountRow extends RowDataPacket { countValue: unknown }

function count(rows: readonly CountRow[]): number {
  const value = Number(rows[0]?.countValue);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export class MysqlAdministratorOverviewRepository
implements AdministratorOverviewRepository {
  public constructor(private readonly executor: Pick<Pool, "execute">) {}

  private async countOf(sql: string, parameters: (string | number)[] = []): Promise<number> {
    const [rows] = await this.executor.execute<CountRow[]>(sql, parameters);
    return count(rows);
  }

  public async registered(): Promise<AdministratorOverview["registered"]> {
    const [signInIdentities, accounts, players, linkedPlayers, administrators] =
      await Promise.all([
        this.countOf(`SELECT COUNT(*) AS countValue FROM mk8dx_auth_user`),
        this.countOf(
          `SELECT COUNT(*) AS countValue FROM user_accounts
           WHERE account_status = 'active'`,
        ),
        this.countOf(
          `SELECT COUNT(*) AS countValue FROM players
           WHERE player_kind = 'human' AND record_status = 'active'`,
        ),
        this.countOf(
          `SELECT COUNT(*) AS countValue FROM player_claims
           WHERE claim_status = 'verified'`,
        ),
        this.countOf(
          `SELECT COUNT(*) AS countValue FROM administrator_grants
           WHERE grant_status = 'active'`,
        ),
      ]);
    return { signInIdentities, accounts, players, linkedPlayers, administrators };
  }

  public async activeSince(sinceMs: number): Promise<AdministratorOverviewWindow> {
    const [signedIn, submitted] = await Promise.all([
      this.countOf(
        `SELECT COUNT(DISTINCT userId) AS countValue FROM mk8dx_auth_session
         WHERE createdAt >= FROM_UNIXTIME(? / 1000)
            OR updatedAt >= FROM_UNIXTIME(? / 1000)`,
        [sinceMs, sinceMs],
      ),
      this.countOf(
        `SELECT COUNT(DISTINCT revision.player_id) AS countValue
         FROM time_trial_publications AS publication
         INNER JOIN time_trial_submission_revisions AS revision
           ON revision.time_trial_submission_revision_id =
              publication.current_revision_id
         WHERE publication.publication_status = 'published'
           AND publication.published_at_ms >= ?`,
        [sinceMs],
      ),
    ]);
    return { signedIn, submitted };
  }

  public async pendingPlayerClaims(): Promise<number> {
    return this.countOf(
      `SELECT COUNT(*) AS countValue FROM player_claims
       WHERE claim_status IN ('requested', 'under_review')`,
    );
  }
}
