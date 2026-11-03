ALTER TABLE firebase_timetrial_import_records
    DROP CONSTRAINT ck_firebase_import_record_outcome;

ALTER TABLE firebase_timetrial_import_records
    ADD CONSTRAINT ck_firebase_import_record_outcome CHECK (
        (import_status = 'imported'
            AND time_trial_submission_revision_id IS NOT NULL
            AND legacy_identifier_id IS NOT NULL
            AND player_id IS NOT NULL)
        OR
        (import_status = 'failed'
            AND time_trial_submission_revision_id IS NULL)
        OR
        (import_status = 'backed_out'
            AND time_trial_submission_revision_id IS NULL
            AND legacy_identifier_id IS NOT NULL
            AND player_id IS NOT NULL)
    );

ALTER TABLE firebase_timetrial_import_records
    DROP CONSTRAINT ck_firebase_import_record_provenance;

ALTER TABLE firebase_timetrial_import_records
    DROP CONSTRAINT ck_firebase_import_record_kind;

ALTER TABLE firebase_timetrial_import_records
    MODIFY COLUMN resolution_id VARCHAR(160)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN administrator_grant_id VARCHAR(156)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN review_reason_code VARCHAR(64)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN reviewed_at_ms BIGINT UNSIGNED NOT NULL,
    MODIFY COLUMN expected_player_revision BIGINT UNSIGNED NOT NULL,
    MODIFY COLUMN target_player_public_id VARCHAR(135)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

ALTER TABLE firebase_timetrial_import_records
    DROP COLUMN legacy_visible,
    DROP COLUMN record_kind;
