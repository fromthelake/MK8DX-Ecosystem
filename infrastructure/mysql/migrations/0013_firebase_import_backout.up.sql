ALTER TABLE firebase_timetrial_import_records
    DROP CONSTRAINT ck_firebase_import_record_status;

ALTER TABLE firebase_timetrial_import_records
    ADD CONSTRAINT ck_firebase_import_record_status CHECK (
        import_status IN ('imported', 'failed', 'backed_out')
    );

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

ALTER TABLE firebase_timetrial_import_attempts
    DROP CONSTRAINT ck_firebase_import_attempt_outcome;

ALTER TABLE firebase_timetrial_import_attempts
    ADD CONSTRAINT ck_firebase_import_attempt_outcome CHECK (
        outcome IN (
            'imported',
            'skipped_already_imported',
            'failed_stale_player_revision',
            'failed_player_not_found',
            'failed_candidate_conflict',
            'failed_revision_conflict',
            'failed_legacy_owner_conflict',
            'failed_persistence',
            'backed_out',
            'skipped_already_backed_out',
            'failed_backout_published',
            'failed_backout_superseded',
            'failed_backout_state'
        )
    );
