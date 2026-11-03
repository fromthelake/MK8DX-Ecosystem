-- ADR-0221: installation settings and the per-night rating options.
--
-- installation_settings holds at most one row (id 1). No row means the defaults (Players are created by
-- self sign-up and by Directors; every Player counts for the rating), so a new installation and the QA
-- mirror need no seed. installation_setting_changes is the append-only audit of every change: who, when,
-- which setting, from what to what. rating_eligibility_changed_at_ms tells the administrator page that the
-- ratings were not recalculated since eligibility last changed.
--
-- tournaments.verified_only: only Players with a verified claim count for the rating from this night;
-- everybody still plays and stands in the results. tournaments.seeding_source refines seed_order = 'ranked'
-- (NULL = the community rating, as before); 'random' stays in seed_order, so an application that only knows
-- ranked/random keeps reading and writing seed_order unchanged.
CREATE TABLE installation_settings (
    installation_settings_id TINYINT UNSIGNED NOT NULL,
    revision INT UNSIGNED NOT NULL,
    player_creation VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    rating_eligibility VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    rating_eligibility_changed_at_ms BIGINT UNSIGNED NULL,
    updated_by_user_account_id BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (installation_settings_id),
    KEY ix_installation_settings_updated_by (updated_by_user_account_id),
    CONSTRAINT fk_installation_settings_updated_by FOREIGN KEY (updated_by_user_account_id)
        REFERENCES user_accounts (user_account_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_installation_settings_singleton CHECK (installation_settings_id = 1),
    CONSTRAINT ck_installation_settings_revision CHECK (revision >= 1),
    CONSTRAINT ck_installation_settings_player_creation CHECK (
        player_creation IN ('self_and_directors', 'self_only', 'directors_only')
    ),
    CONSTRAINT ck_installation_settings_rating_eligibility CHECK (
        rating_eligibility IN ('all_players', 'claimed_only')
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE installation_setting_changes (
    installation_setting_change_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    setting_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    previous_value VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    new_value VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    changed_by_user_account_id BIGINT UNSIGNED NOT NULL,
    occurred_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (installation_setting_change_id),
    KEY ix_installation_setting_changes_time (occurred_at_ms),
    KEY ix_installation_setting_changes_actor (changed_by_user_account_id),
    CONSTRAINT fk_installation_setting_changes_actor FOREIGN KEY (changed_by_user_account_id)
        REFERENCES user_accounts (user_account_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_installation_setting_changes_key CHECK (
        setting_key IN ('player_creation', 'rating_eligibility')
    ),
    CONSTRAINT ck_installation_setting_changes_value CHECK (previous_value <> new_value)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE tournaments
    ADD COLUMN verified_only BOOLEAN NOT NULL DEFAULT FALSE AFTER affects_rating;

ALTER TABLE tournaments
    ADD COLUMN seeding_source VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER seed_order;

ALTER TABLE tournaments
    ADD CONSTRAINT ck_tournaments_seeding_source CHECK (
        seeding_source IS NULL OR seeding_source IN ('community_rating', 'director_nights', 'manual')
    );
