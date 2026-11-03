-- 0027: Player public presence.
--
-- A Player may be publicly present or private. This is a property of the
-- Player, never of the UserAccount: account and authentication data are
-- always private and are unaffected by this column.
--
-- Private means ordinary public projections must not expose the Player.
-- Canonical history, revisions, publication rows, rating and Tournament
-- membership are all retained exactly as they were; nothing is rewritten
-- and nothing is lost, so returning to public restores presence without
-- duplicating or recreating any record.
--
-- Every change is recorded append-only with the acting account, the role
-- it acted in, and the state on both sides of the change, so a Player can
-- always explain who changed their presence and when.

ALTER TABLE players
    ADD COLUMN visibility VARCHAR(16)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'public',
    ADD CONSTRAINT ck_players_visibility CHECK (
        visibility IN ('public', 'private')
    );

CREATE TABLE player_visibility_lifecycle (
    player_visibility_lifecycle_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    player_id BIGINT UNSIGNED NOT NULL,
    sequence_number BIGINT UNSIGNED NOT NULL,
    visibility_before VARCHAR(16)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    visibility_after VARCHAR(16)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    actor_role VARCHAR(32)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    actor_user_account_id BIGINT UNSIGNED NULL,
    reason_code VARCHAR(64)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    occurred_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (player_visibility_lifecycle_id),
    UNIQUE KEY uq_player_visibility_lifecycle_sequence (
        player_id,
        sequence_number
    ),
    CONSTRAINT fk_player_visibility_lifecycle_player
        FOREIGN KEY (player_id)
        REFERENCES players (player_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_player_visibility_lifecycle_actor
        FOREIGN KEY (actor_user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_player_visibility_lifecycle_sequence CHECK (
        sequence_number >= 1
    ),
    CONSTRAINT ck_player_visibility_lifecycle_before CHECK (
        visibility_before IN ('public', 'private')
    ),
    CONSTRAINT ck_player_visibility_lifecycle_after CHECK (
        visibility_after IN ('public', 'private')
    ),
    CONSTRAINT ck_player_visibility_lifecycle_change CHECK (
        visibility_before <> visibility_after
    ),
    CONSTRAINT ck_player_visibility_lifecycle_actor CHECK (
        (actor_role = 'owner' AND actor_user_account_id IS NOT NULL)
        OR
        (actor_role = 'administrator' AND actor_user_account_id IS NOT NULL)
        OR
        (actor_role = 'internal' AND actor_user_account_id IS NULL)
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
