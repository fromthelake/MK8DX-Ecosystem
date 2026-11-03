ALTER TABLE restricted_legacy_identity_identifiers
    ADD COLUMN lookup_key_version VARCHAR(64)
        CHARACTER SET ascii COLLATE ascii_bin NULL AFTER lookup_hash;

ALTER TABLE restricted_legacy_identity_identifiers
    ADD CONSTRAINT ck_legacy_identity_lookup_key_version CHECK (
        lookup_key_version IS NOT NULL
    );

CREATE TABLE firebase_timetrial_import_runs (
    firebase_timetrial_import_run_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id VARCHAR(150) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    plan_sha256 BINARY(32) NOT NULL,
    runner_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    started_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (firebase_timetrial_import_run_id),
    UNIQUE KEY uq_firebase_import_run_public_id (public_id),
    CONSTRAINT ck_firebase_import_run_public_id CHECK (
        LEFT(public_id, 21) = 'migration_import_run.'
    ),
    CONSTRAINT ck_firebase_import_run_runner CHECK (
        CHAR_LENGTH(runner_version) >= 1
    ),
    CONSTRAINT ck_firebase_import_run_started CHECK (
        started_at_ms <= 253402300799999
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE firebase_timetrial_import_records (
    firebase_timetrial_import_record_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    record_key VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    candidate_sha256 BINARY(32) NOT NULL,
    resolution_id VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    administrator_grant_id VARCHAR(156)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    review_reason_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    reviewed_at_ms BIGINT UNSIGNED NOT NULL,
    expected_player_revision BIGINT UNSIGNED NOT NULL,
    target_player_public_id VARCHAR(135)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    player_id BIGINT UNSIGNED NULL,
    legacy_identifier_id BIGINT UNSIGNED NULL,
    import_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    time_trial_submission_revision_id BIGINT UNSIGNED NULL,
    attempt_count BIGINT UNSIGNED NOT NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (firebase_timetrial_import_record_id),
    UNIQUE KEY uq_firebase_import_record_key (record_key),
    UNIQUE KEY uq_firebase_import_record_revision (
        time_trial_submission_revision_id
    ),
    KEY ix_firebase_import_record_player (player_id),
    KEY ix_firebase_import_record_legacy (legacy_identifier_id),
    CONSTRAINT fk_firebase_import_record_player FOREIGN KEY (player_id)
        REFERENCES players (player_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_firebase_import_record_legacy FOREIGN KEY (legacy_identifier_id)
        REFERENCES restricted_legacy_identity_identifiers (legacy_identifier_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_firebase_import_record_revision
        FOREIGN KEY (time_trial_submission_revision_id)
        REFERENCES time_trial_submission_revisions (
            time_trial_submission_revision_id
        ) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_firebase_import_record_key CHECK (
        LEFT(record_key, 16) = 'firebase_record.'
    ),
    CONSTRAINT ck_firebase_import_record_resolution CHECK (
        LEFT(resolution_id, 30) = 'migration_identity_resolution.'
    ),
    CONSTRAINT ck_firebase_import_record_grant CHECK (
        LEFT(administrator_grant_id, 20) = 'administrator_grant.'
    ),
    CONSTRAINT ck_firebase_import_record_target_player CHECK (
        LEFT(target_player_public_id, 7) = 'player.'
    ),
    CONSTRAINT ck_firebase_import_record_reason CHECK (
        CHAR_LENGTH(review_reason_code) >= 1
    ),
    CONSTRAINT ck_firebase_import_record_expected_revision CHECK (
        expected_player_revision >= 1
    ),
    CONSTRAINT ck_firebase_import_record_status CHECK (
        import_status IN ('imported', 'failed')
    ),
    CONSTRAINT ck_firebase_import_record_outcome CHECK (
        (import_status = 'imported'
            AND time_trial_submission_revision_id IS NOT NULL
            AND legacy_identifier_id IS NOT NULL
            AND player_id IS NOT NULL)
        OR
        (import_status = 'failed'
            AND time_trial_submission_revision_id IS NULL)
    ),
    CONSTRAINT ck_firebase_import_record_attempts CHECK (attempt_count >= 1),
    CONSTRAINT ck_firebase_import_record_timestamps CHECK (
        updated_at_ms >= created_at_ms
        AND updated_at_ms <= 253402300799999
        AND reviewed_at_ms <= 253402300799999
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE firebase_timetrial_import_attempts (
    firebase_timetrial_import_attempt_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    firebase_timetrial_import_record_id BIGINT UNSIGNED NOT NULL,
    firebase_timetrial_import_run_id BIGINT UNSIGNED NOT NULL,
    attempt_number BIGINT UNSIGNED NOT NULL,
    outcome VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    candidate_sha256 BINARY(32) NOT NULL,
    occurred_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (firebase_timetrial_import_attempt_id),
    UNIQUE KEY uq_firebase_import_attempt_sequence (
        firebase_timetrial_import_record_id,
        attempt_number
    ),
    KEY ix_firebase_import_attempt_run (firebase_timetrial_import_run_id),
    CONSTRAINT fk_firebase_import_attempt_record
        FOREIGN KEY (firebase_timetrial_import_record_id)
        REFERENCES firebase_timetrial_import_records (
            firebase_timetrial_import_record_id
        ) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_firebase_import_attempt_run
        FOREIGN KEY (firebase_timetrial_import_run_id)
        REFERENCES firebase_timetrial_import_runs (
            firebase_timetrial_import_run_id
        ) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_firebase_import_attempt_number CHECK (attempt_number >= 1),
    CONSTRAINT ck_firebase_import_attempt_outcome CHECK (
        outcome IN (
            'imported',
            'skipped_already_imported',
            'failed_stale_player_revision',
            'failed_player_not_found',
            'failed_candidate_conflict',
            'failed_revision_conflict',
            'failed_legacy_owner_conflict',
            'failed_persistence'
        )
    ),
    CONSTRAINT ck_firebase_import_attempt_time CHECK (
        occurred_at_ms <= 253402300799999
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
