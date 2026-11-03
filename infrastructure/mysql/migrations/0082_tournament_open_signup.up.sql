-- ADR-0222: open sign-up, the waiting list and the player's status line. A night's list stays the
-- Director's roster by default; a Director may open sign-up with a closing time, a maximum and a
-- selection (first come, first served, or a draw from a published seed). Sign-ups write the existing
-- roster rows (tournament_participants: attendance and the NS1/NS2 fields); these tables keep only
-- what the roster cannot: the settings, and per Player the sign-up time, the order and the outcome.
CREATE TABLE tournament_signup_settings (
    tournament_id BIGINT UNSIGNED NOT NULL,
    signup_mode VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    selection_mode VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    capacity SMALLINT UNSIGNED NOT NULL,
    closes_at_ms BIGINT UNSIGNED NOT NULL,
    selection_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    draw_seed CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    draw_algorithm VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NULL,
    closed_at_ms BIGINT UNSIGNED NULL,
    updated_by_user_account_id BIGINT UNSIGNED NOT NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_id),
    KEY ix_tournament_signup_settings_due (signup_mode, selection_status, closes_at_ms),
    KEY ix_tournament_signup_settings_updated_by (updated_by_user_account_id),
    CONSTRAINT fk_tournament_signup_settings_tournament FOREIGN KEY (tournament_id)
        REFERENCES tournaments (tournament_id) ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT fk_tournament_signup_settings_updated_by FOREIGN KEY (updated_by_user_account_id)
        REFERENCES user_accounts (user_account_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_tournament_signup_settings_mode CHECK (signup_mode IN ('director', 'open')),
    CONSTRAINT ck_tournament_signup_settings_selection CHECK (selection_mode IN ('first_come', 'draw')),
    CONSTRAINT ck_tournament_signup_settings_capacity CHECK (capacity BETWEEN 1 AND 60),
    CONSTRAINT ck_tournament_signup_settings_status CHECK (selection_status IN ('open', 'closed')),
    CONSTRAINT ck_tournament_signup_settings_seed CHECK (
        draw_seed IS NULL OR draw_seed REGEXP '^[0-9a-f]{64}$'
    ),
    CONSTRAINT ck_tournament_signup_settings_closed CHECK (
        (selection_status = 'open' AND closed_at_ms IS NULL AND draw_seed IS NULL)
        OR (selection_status = 'closed' AND closed_at_ms IS NOT NULL)
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE tournament_signups (
    tournament_signup_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_id BIGINT UNSIGNED NOT NULL,
    player_id BIGINT UNSIGNED NOT NULL,
    user_account_id BIGINT UNSIGNED NOT NULL,
    signup_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    queue_position INT UNSIGNED NULL,
    signed_up_at_ms BIGINT UNSIGNED NOT NULL,
    decided_at_ms BIGINT UNSIGNED NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_signup_id),
    UNIQUE KEY uq_tournament_signups_player (tournament_id, player_id),
    KEY ix_tournament_signups_queue (tournament_id, signup_status, queue_position),
    KEY ix_tournament_signups_player (player_id),
    KEY ix_tournament_signups_account (user_account_id),
    CONSTRAINT fk_tournament_signups_tournament FOREIGN KEY (tournament_id)
        REFERENCES tournaments (tournament_id) ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT fk_tournament_signups_player FOREIGN KEY (player_id)
        REFERENCES players (player_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_tournament_signups_account FOREIGN KEY (user_account_id)
        REFERENCES user_accounts (user_account_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_tournament_signups_status CHECK (
        signup_status IN ('pending', 'selected', 'waiting', 'withdrawn', 'removed')
    ),
    CONSTRAINT ck_tournament_signups_queue CHECK (
        (signup_status = 'waiting' AND queue_position IS NOT NULL AND queue_position >= 1)
        OR (signup_status <> 'waiting' AND queue_position IS NULL)
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The night a sign-up notification is about, so the inbox can open its page. Nullable: no other kind
-- names a night, and a removed draft leaves the entry without one.
ALTER TABLE notifications
    ADD COLUMN tournament_id BIGINT UNSIGNED NULL,
    ADD KEY ix_notifications_tournament (tournament_id),
    ADD CONSTRAINT fk_notifications_tournament FOREIGN KEY (tournament_id)
        REFERENCES tournaments (tournament_id) ON DELETE SET NULL ON UPDATE RESTRICT;

ALTER TABLE notifications
    DROP CONSTRAINT ck_notifications_kind,
    ADD CONSTRAINT ck_notifications_kind CHECK (
        notification_kind IN (
            'overtaken', 'reaction_received', 'claim_decided',
            'claim_requested',
            'result_published', 'group_invited', 'group_joined',
            'group_left', 'group_removed', 'group_role_changed',
            'world_record',
            'poke', 'rock_paper_scissors', 'dice_roll', 'challenge',
            'host_requested', 'host_request_decided',
            'tournament_signup_selected', 'tournament_signup_moved_up', 'tournament_signup_removed'
        )
    );
