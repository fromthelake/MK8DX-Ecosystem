-- 0034 rollback: remove only the correction provenance column.
ALTER TABLE time_trial_submission_revisions
    DROP COLUMN corrected_fields_json;
