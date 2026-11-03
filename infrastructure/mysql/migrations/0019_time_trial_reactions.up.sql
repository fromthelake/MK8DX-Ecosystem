-- 0019: lightweight social reactions on published Time Trials.
--
-- One reaction per user account per Time Trial submission; changing the
-- reaction replaces the previous kind. The kind vocabulary is a small
-- closed set enforced here so arbitrary content can never enter the
-- social layer (reactions, not comments).

CREATE TABLE time_trial_reactions (
    time_trial_reaction_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    time_trial_submission_id BIGINT UNSIGNED NOT NULL,
    user_account_id BIGINT UNSIGNED NOT NULL,
    reaction_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (time_trial_reaction_id),
    UNIQUE KEY uq_time_trial_reactions_target_account (
        time_trial_submission_id,
        user_account_id
    ),
    KEY ix_time_trial_reactions_account (user_account_id),
    CONSTRAINT fk_time_trial_reactions_submission
        FOREIGN KEY (time_trial_submission_id)
        REFERENCES time_trial_submissions (time_trial_submission_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_time_trial_reactions_account
        FOREIGN KEY (user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_time_trial_reactions_kind CHECK (
        reaction_kind IN ('fire', 'clap', 'wow')
    ),
    CONSTRAINT ck_time_trial_reactions_timestamps CHECK (
        updated_at_ms >= created_at_ms
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
