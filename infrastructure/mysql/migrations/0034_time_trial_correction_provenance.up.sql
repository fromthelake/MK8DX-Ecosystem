-- 0034: preserve recognition-derived manual correction provenance per revision.
ALTER TABLE time_trial_submission_revisions
    ADD COLUMN corrected_fields_json JSON NULL
        AFTER verification_method;
