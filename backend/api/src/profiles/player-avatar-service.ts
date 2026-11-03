import type { ActorContext } from "../identity/types.js";

// The profile character (avatar) is presentation metadata, never
// identity evidence, never a loadout, never rating input. A signed-in
// account may set, change, or clear the avatar of the Player it holds a
// verified claim on; only stable canonical schema-9 character and
// character-variant ids are accepted.

export class PlayerAvatarError extends Error {
  public constructor(
    public readonly code:
      | "invalid_input"
      | "not_authenticated"
      | "no_verified_player"
      | "unavailable",
  ) {
    super("The profile character could not be updated.");
    this.name = "PlayerAvatarError";
  }
}

export interface PlayerAvatarRepository {
  setAvatarForAccount(
    userAccountId: string,
    avatarId: string | null,
  ): Promise<boolean>;
}

export interface CharacterAppearanceCatalog {
  hasCharacterAppearance(avatarId: string): boolean;
}

const avatarIdPattern = /^character(_variant)?\.[a-z0-9_.]+$/;

export class PlayerAvatarService {
  public constructor(
    private readonly repository: PlayerAvatarRepository,
    private readonly catalog: CharacterAppearanceCatalog,
  ) {}

  public async setOwnAvatar(
    actor: ActorContext,
    avatarId: string | null,
  ): Promise<void> {
    if (actor.role !== "account" && actor.role !== "administrator") {
      throw new PlayerAvatarError("not_authenticated");
    }
    if (avatarId !== null &&
        (avatarId.length > 128 || !avatarIdPattern.test(avatarId) ||
         !this.catalog.hasCharacterAppearance(avatarId))) {
      throw new PlayerAvatarError("invalid_input");
    }
    let updated: boolean;
    try {
      updated = await this.repository.setAvatarForAccount(
        actor.userAccountId,
        avatarId,
      );
    } catch {
      throw new PlayerAvatarError("unavailable");
    }
    if (!updated) {
      throw new PlayerAvatarError("no_verified_player");
    }
  }
}

export class MysqlPlayerAvatarRepository implements PlayerAvatarRepository {
  public constructor(
    private readonly executor: Pick<
      import("mysql2/promise").Pool,
      "execute"
    >,
  ) {}

  public async setAvatarForAccount(
    userAccountId: string,
    avatarId: string | null,
  ): Promise<boolean> {
    const [rows] = await this.executor.execute(
      `SELECT player.player_id AS playerInternalId
       FROM players AS player
       INNER JOIN player_claims AS claim
         ON claim.player_id = player.player_id
        AND claim.claim_status = 'verified'
       INNER JOIN user_accounts AS account
         ON account.user_account_id = claim.user_account_id
       WHERE account.public_id = ? AND player.record_status = 'active'
       LIMIT 1`,
      [userAccountId],
    );
    const row = (rows as readonly { playerInternalId?: unknown }[])[0];
    const playerInternalId = Number(row?.playerInternalId);
    if (!Number.isSafeInteger(playerInternalId)) { return false; }
    await this.executor.execute(
      `UPDATE players SET avatar_id = ? WHERE player_id = ?`,
      [avatarId, playerInternalId],
    );
    return true;
  }
}
