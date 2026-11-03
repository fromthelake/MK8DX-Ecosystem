ALTER TABLE restricted_identity_access_log
    DROP CONSTRAINT ck_identity_access_resource,
    ADD CONSTRAINT ck_identity_access_resource CHECK (
        (resource_type = 'claim_evidence'
            AND claim_evidence_id IS NOT NULL
            AND claim_review_id IS NULL
            AND legacy_identifier_id IS NULL
            AND authentication_binding_id IS NULL)
        OR
        (resource_type = 'claim_review'
            AND claim_evidence_id IS NULL
            AND claim_review_id IS NOT NULL
            AND legacy_identifier_id IS NULL
            AND authentication_binding_id IS NULL)
        OR
        (resource_type = 'legacy_identifier'
            AND claim_evidence_id IS NULL
            AND claim_review_id IS NULL
            AND legacy_identifier_id IS NOT NULL
            AND authentication_binding_id IS NULL)
        OR
        (resource_type = 'authentication_binding'
            AND claim_evidence_id IS NULL
            AND claim_review_id IS NULL
            AND legacy_identifier_id IS NULL
            AND authentication_binding_id IS NOT NULL)
    );

ALTER TABLE restricted_identity_access_log
    DROP FOREIGN KEY fk_identity_access_tt_evidence,
    DROP FOREIGN KEY fk_identity_access_tt_participant,
    DROP INDEX ix_identity_access_tt_evidence,
    DROP INDEX ix_identity_access_tt_participant,
    DROP COLUMN time_trial_evidence_id,
    DROP COLUMN time_trial_participant_reference_id;

DROP TABLE restricted_time_trial_evidence;
DROP TABLE restricted_time_trial_participant_references;
DROP TABLE time_trial_laps;
DROP TABLE time_trial_submission_revisions;
DROP TABLE time_trial_submissions;
