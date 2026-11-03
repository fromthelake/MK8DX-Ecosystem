-- 0039 account-owned Time Trial relevance and bounded mutation budgets.
ALTER TABLE user_accounts
    ADD COLUMN time_trial_mode_preference VARCHAR(8)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'all'
        AFTER account_status,
    ADD COLUMN screen_name VARCHAR(32) NULL
        AFTER time_trial_mode_preference,
    ADD CONSTRAINT ck_accounts_time_trial_mode_preference CHECK (
        time_trial_mode_preference IN ('all', '150', '200')
    ),
    ADD CONSTRAINT ck_accounts_screen_name CHECK (
        screen_name IS NULL OR CHAR_LENGTH(screen_name) BETWEEN 1 AND 32
    );

CREATE TABLE api_mutation_rate_limits (
    scope_key VARCHAR(220) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    window_started_at_ms BIGINT UNSIGNED NOT NULL,
    event_count INT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (scope_key, window_started_at_ms),
    KEY ix_api_mutation_rate_limits_updated (updated_at_ms),
    CONSTRAINT ck_api_mutation_rate_limits_count CHECK (event_count >= 1)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
