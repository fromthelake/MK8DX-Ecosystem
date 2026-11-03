-- 0066: the account-canonical appearance choice (ADR-0205).
--
-- What travels between a person's devices is the *choice* - System, Light or
-- Dark - never the mode a device resolved it to. A phone set to System follows
-- that phone's own operating system; a laptop set to System follows the
-- laptop's. High contrast and forced colours are always the device's, and are
-- never stored here.
--
-- ADR-0205 wrote this as a nullable column on `user_accounts`. It is a
-- separate one-row-per-account table instead, for one concrete reason: the
-- local QA mirror restores a production snapshot and refuses to start when the
-- column list of a snapshotted domain table differs from the local schema
-- (`backend/api/test/local-qa-mirror-restore.mjs`). A new column on
-- `user_accounts` therefore cannot be exercised on the mirror until production
-- has run the migration - which is exactly the order this work needs to be
-- verified in. The semantics ADR-0205 decided are unchanged: **no row means
-- "never chosen"**, which is what its NULL meant, and the value is bounded to
-- the same three choices.
--
-- Additive only: nothing existing is altered, so the down migration takes only
-- what this one created.

CREATE TABLE user_account_appearance_preferences (
    user_account_id BIGINT UNSIGNED NOT NULL,
    -- 'system' | 'light' | 'dark'. A missing row is "never chosen" and keeps
    -- whatever each device chose locally, so signing in never overwrites a
    -- device that the account has no opinion about.
    appearance_preference VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (user_account_id),
    CONSTRAINT fk_account_appearance_preference_account
        FOREIGN KEY (user_account_id) REFERENCES user_accounts (user_account_id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT ck_account_appearance_preference_choice CHECK (
        appearance_preference IN ('system', 'light', 'dark')
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
