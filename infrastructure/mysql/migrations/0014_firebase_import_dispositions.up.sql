ALTER TABLE firebase_timetrial_import_records
    ADD COLUMN record_kind VARCHAR(32)
        CHARACTER SET ascii COLLATE ascii_bin NULL AFTER candidate_sha256,
    ADD COLUMN legacy_visible BOOLEAN NULL AFTER reviewed_at_ms;

UPDATE firebase_timetrial_import_records
    SET record_kind = 'reviewed_player'
    WHERE record_kind IS NULL;

ALTER TABLE firebase_timetrial_import_records
    MODIFY COLUMN resolution_id VARCHAR(160)
        CHARACTER SET ascii COLLATE ascii_bin NULL,
    MODIFY COLUMN administrator_grant_id VARCHAR(156)
        CHARACTER SET ascii COLLATE ascii_bin NULL,
    MODIFY COLUMN review_reason_code VARCHAR(64)
        CHARACTER SET ascii COLLATE ascii_bin NULL,
    MODIFY COLUMN reviewed_at_ms BIGINT UNSIGNED NULL,
    MODIFY COLUMN expected_player_revision BIGINT UNSIGNED NULL,
    MODIFY COLUMN target_player_public_id VARCHAR(135)
        CHARACTER SET ascii COLLATE ascii_bin NULL;

ALTER TABLE firebase_timetrial_import_records
    ADD CONSTRAINT ck_firebase_import_record_kind CHECK (
        record_kind IS NOT NULL
        AND record_kind IN ('reviewed_player', 'system_reference')
    );

ALTER TABLE firebase_timetrial_import_records
    ADD CONSTRAINT ck_firebase_import_record_provenance CHECK (
        (record_kind = 'reviewed_player'
            AND resolution_id IS NOT NULL
            AND administrator_grant_id IS NOT NULL
            AND review_reason_code IS NOT NULL
            AND reviewed_at_ms IS NOT NULL
            AND expected_player_revision IS NOT NULL
            AND target_player_public_id IS NOT NULL)
        OR
        (record_kind = 'system_reference'
            AND resolution_id IS NULL
            AND administrator_grant_id IS NULL
            AND review_reason_code IS NULL
            AND reviewed_at_ms IS NULL
            AND expected_player_revision IS NULL
            AND target_player_public_id IS NULL
            AND player_id IS NULL
            AND legacy_identifier_id IS NULL)
    );

ALTER TABLE firebase_timetrial_import_records
    DROP CONSTRAINT ck_firebase_import_record_outcome;

ALTER TABLE firebase_timetrial_import_records
    ADD CONSTRAINT ck_firebase_import_record_outcome CHECK (
        (import_status = 'imported'
            AND time_trial_submission_revision_id IS NOT NULL
            AND (record_kind = 'system_reference'
                OR (legacy_identifier_id IS NOT NULL AND player_id IS NOT NULL)))
        OR
        (import_status = 'failed'
            AND time_trial_submission_revision_id IS NULL)
        OR
        (import_status = 'backed_out'
            AND time_trial_submission_revision_id IS NULL
            AND (record_kind = 'system_reference'
                OR (legacy_identifier_id IS NOT NULL AND player_id IS NOT NULL)))
    );
