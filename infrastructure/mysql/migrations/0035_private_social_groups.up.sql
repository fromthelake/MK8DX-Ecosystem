-- 0035: private social groups and persisted Rank scope selection.
-- Tournament groups are intentionally unrelated. Membership is visible only
-- to active/invited members and every lifecycle change produces a notification.

CREATE TABLE social_groups (
    social_group_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(80) NOT NULL,
    record_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
    created_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (social_group_id),
    UNIQUE KEY uq_social_groups_public_id (public_id),
    CONSTRAINT ck_social_groups_status CHECK (record_status IN ('active', 'archived'))
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE social_group_memberships (
    social_group_id BIGINT UNSIGNED NOT NULL,
    player_id BIGINT UNSIGNED NOT NULL,
    member_role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    membership_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    invited_by_player_id BIGINT UNSIGNED NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (social_group_id, player_id),
    KEY ix_social_group_memberships_player (player_id, membership_status),
    CONSTRAINT fk_social_group_memberships_group FOREIGN KEY (social_group_id)
        REFERENCES social_groups (social_group_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_social_group_memberships_player FOREIGN KEY (player_id)
        REFERENCES players (player_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_social_group_memberships_inviter FOREIGN KEY (invited_by_player_id)
        REFERENCES players (player_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_social_group_member_role CHECK (member_role IN ('owner', 'admin', 'member')),
    CONSTRAINT ck_social_group_member_status CHECK (membership_status IN ('invited', 'active', 'declined', 'left', 'removed')),
    CONSTRAINT ck_social_group_owner_active CHECK (member_role <> 'owner' OR membership_status = 'active')
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE rank_scope_preferences (
    user_account_id BIGINT UNSIGNED NOT NULL,
    include_global BOOLEAN NOT NULL DEFAULT TRUE,
    include_rivals BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (user_account_id),
    CONSTRAINT fk_rank_scope_preferences_account FOREIGN KEY (user_account_id)
        REFERENCES user_accounts (user_account_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE rank_scope_group_preferences (
    user_account_id BIGINT UNSIGNED NOT NULL,
    social_group_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (user_account_id, social_group_id),
    CONSTRAINT fk_rank_scope_group_preferences_account FOREIGN KEY (user_account_id)
        REFERENCES user_accounts (user_account_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_rank_scope_group_preferences_group FOREIGN KEY (social_group_id)
        REFERENCES social_groups (social_group_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE notifications
    ADD COLUMN social_group_id BIGINT UNSIGNED NULL AFTER mode_cc,
    ADD CONSTRAINT fk_notifications_social_group FOREIGN KEY (social_group_id)
        REFERENCES social_groups (social_group_id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE notifications DROP CONSTRAINT ck_notifications_kind;
ALTER TABLE notifications ADD CONSTRAINT ck_notifications_kind CHECK (
    notification_kind IN (
        'time_beaten', 'reaction_received', 'claim_decided', 'result_published',
        'group_invited', 'group_joined', 'group_left', 'group_removed',
        'group_role_changed', 'world_record'
    )
);
