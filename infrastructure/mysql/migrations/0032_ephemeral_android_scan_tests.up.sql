-- 0032: isolated 24-hour Android scanner acceptance-test results.
CREATE TABLE ephemeral_time_trial_scan_tests (
    ephemeral_time_trial_scan_test_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id VARCHAR(149) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision_number BIGINT UNSIGNED NOT NULL,
    user_account_id BIGINT UNSIGNED NOT NULL,
    player_id BIGINT UNSIGNED NOT NULL,
    mode_cc SMALLINT UNSIGNED NOT NULL,
    track_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    total_time_ms INT UNSIGNED NOT NULL,
    canonical_payload JSON NOT NULL,
    payload_sha256 BINARY(32) NOT NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    expires_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (ephemeral_time_trial_scan_test_id),
    UNIQUE KEY uq_ephemeral_tt_scan_test_public_id (public_id),
    KEY ix_ephemeral_tt_scan_test_expiry (expires_at_ms),
    KEY ix_ephemeral_tt_scan_test_account (user_account_id, expires_at_ms),
    CONSTRAINT fk_ephemeral_tt_scan_test_account FOREIGN KEY (user_account_id)
        REFERENCES user_accounts (user_account_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_ephemeral_tt_scan_test_player FOREIGN KEY (player_id)
        REFERENCES players (player_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_ephemeral_tt_scan_test_id CHECK (
        public_id REGEXP '^user_submission\\.time\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$'
    ),
    CONSTRAINT ck_ephemeral_tt_scan_test_revision CHECK (revision_number >= 1),
    CONSTRAINT ck_ephemeral_tt_scan_test_mode CHECK (mode_cc IN (150, 200)),
    CONSTRAINT ck_ephemeral_tt_scan_test_track CHECK (
        track_id REGEXP '^track\\.[a-z0-9]+(_[a-z0-9]+)*$'
    ),
    CONSTRAINT ck_ephemeral_tt_scan_test_time CHECK (
        total_time_ms BETWEEN 1 AND 599999
    ),
    CONSTRAINT ck_ephemeral_tt_scan_test_expiry CHECK (
        expires_at_ms = created_at_ms + 86400000
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
