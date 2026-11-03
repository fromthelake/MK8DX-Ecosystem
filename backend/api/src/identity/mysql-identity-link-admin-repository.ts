import type { Pool, RowDataPacket } from "mysql2/promise";

import type { AuthenticationSubjectHmacKeyringProtector } from
  "../authentication/authentication-subject-hmac-protector.js";
import type {
  IdentityLinkReadRepository, LinkableAccount, LinkablePlayer,
} from "./identity-link-admin-service.js";

const MK8DX_PASSWORDLESS_ISSUER = "mk8dx.passwordless.v1";

interface AuthUserRow extends RowDataPacket {
  id: string;
  email: string | null;
}
interface BindingRow extends RowDataPacket {
  subject_lookup_hmac: Buffer;
  user_account_public_id: string;
  account_status: string;
  screen_name: string | null;
  linked_player_public_id: string | null;
  linked_player_name: string | null;
  player_claim_public_id: string | null;
}
interface PlayerRow extends RowDataPacket {
  public_id: string;
  display_name: string;
  username_value: string | null;
  time_trials: number;
  tournament_races: number;
  linked_account_public_id: string | null;
}

/**
 * Reads the three-way picture an administrator needs.
 *
 * The address is deliberately not stored on the domain side: a binding keys on
 * an HMAC of the sign-in subject, so nothing but the authentication tables can
 * say which address an account belongs to. Joining the two is therefore done
 * here rather than in SQL - the subject is hashed with the same keyring the
 * sign-in path uses, and every retained key version is tried, so an account
 * whose binding predates a key rotation still resolves.
 */
export class MysqlIdentityLinkAdminRepository implements IdentityLinkReadRepository {
  public constructor(
    private readonly pool: Pool,
    private readonly protector: AuthenticationSubjectHmacKeyringProtector,
  ) {}

  public async listAccounts(): Promise<readonly LinkableAccount[]> {
    const [authUsers] = await this.pool.query<AuthUserRow[]>(
      "SELECT id, email FROM mk8dx_auth_user ORDER BY email");
    const [bindings] = await this.pool.query<BindingRow[]>(`
      SELECT binding.subject_lookup_hmac,
             account.public_id AS user_account_public_id,
             account.account_status,
             account.screen_name,
             player.public_id AS linked_player_public_id,
             player.display_name AS linked_player_name,
             claim.public_id AS player_claim_public_id
        FROM restricted_authentication_bindings binding
        JOIN user_accounts account
          ON account.user_account_id = binding.user_account_id
        LEFT JOIN player_claims claim
          ON claim.user_account_id = account.user_account_id
         AND claim.claim_status = 'verified'
        LEFT JOIN players player ON player.player_id = claim.player_id
       WHERE binding.binding_status = 'active'`);

    const byHmac = new Map<string, BindingRow>();
    for (const row of bindings) {
      byHmac.set(Buffer.from(row.subject_lookup_hmac).toString("hex"), row);
    }

    const accounts: LinkableAccount[] = [];
    const matched = new Set<string>();
    for (const user of authUsers) {
      let found: BindingRow | undefined;
      for (const candidate of this.protector.protectVerifiedSubjectCandidates(
        MK8DX_PASSWORDLESS_ISSUER, user.id,
      )) {
        const key = Buffer.from(candidate.subjectLookupHmac).toString("hex");
        const hit = byHmac.get(key);
        if (hit !== undefined) { found = hit; matched.add(key); break; }
      }
      if (found === undefined) {
        // Signed in at least once but never provisioned a domain account, or
        // provisioned under a key version this deployment no longer retains.
        accounts.push({
          userAccountId: "", email: user.email, accountStatus: "unbound",
          screenName: null, linkedPlayerId: null, linkedPlayerName: null,
          playerClaimId: null, lastSeenAtMs: null,
        });
        continue;
      }
      accounts.push({
        userAccountId: found.user_account_public_id,
        email: user.email,
        accountStatus: found.account_status,
        screenName: found.screen_name,
        linkedPlayerId: found.linked_player_public_id,
        linkedPlayerName: found.linked_player_name,
        playerClaimId: found.player_claim_public_id,
        lastSeenAtMs: null,
      });
    }
    // Accounts with no address the authentication tables can name - the QA
    // shadow accounts, for example - still belong on the screen, because they
    // may hold a link somebody needs to see.
    for (const [key, row] of byHmac) {
      if (matched.has(key)) { continue; }
      accounts.push({
        userAccountId: row.user_account_public_id,
        email: null,
        accountStatus: row.account_status,
        screenName: row.screen_name,
        linkedPlayerId: row.linked_player_public_id,
        linkedPlayerName: row.linked_player_name,
        playerClaimId: row.player_claim_public_id,
        lastSeenAtMs: null,
      });
    }
    return accounts;
  }

  public async listPlayers(): Promise<readonly LinkablePlayer[]> {
    const [rows] = await this.pool.query<PlayerRow[]>(`
      SELECT player.public_id,
             player.display_name,
             username.username_value,
             (SELECT COUNT(*) FROM time_trial_submission_revisions revision
               WHERE revision.player_id = player.player_id) AS time_trials,
             (SELECT COUNT(*) FROM legacy_race_placements placement
               WHERE placement.player_id = player.player_id) AS tournament_races,
             account.public_id AS linked_account_public_id
        FROM players player
        LEFT JOIN player_username_history username
          ON username.player_id = player.player_id AND username.released_at_ms IS NULL
        LEFT JOIN player_claims claim
          ON claim.player_id = player.player_id AND claim.claim_status = 'verified'
        LEFT JOIN user_accounts account
          ON account.user_account_id = claim.user_account_id
       WHERE player.player_kind = 'human' AND player.record_status = 'active'
       ORDER BY player.display_name`);
    return rows.map((row) => ({
      playerId: row.public_id,
      displayName: row.display_name,
      username: row.username_value,
      timeTrials: Number(row.time_trials),
      tournamentRaces: Number(row.tournament_races),
      linkedAccountId: row.linked_account_public_id,
    }));
  }

  public async findClaimIdForAccount(userAccountId: string): Promise<string | null> {
    const [rows] = await this.pool.query<RowDataPacket[]>(`
      SELECT claim.public_id
        FROM player_claims claim
        JOIN user_accounts account
          ON account.user_account_id = claim.user_account_id
       WHERE account.public_id = ? AND claim.claim_status = 'verified'
       LIMIT 1`, [userAccountId]);
    return rows.length === 0 ? null : String(rows[0]?.["public_id"]);
  }
}
