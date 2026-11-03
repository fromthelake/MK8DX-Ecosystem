ALTER TABLE restricted_identity_access_log
    DROP CONSTRAINT ck_identity_access_resource,
    ADD CONSTRAINT ck_identity_access_resource CHECK (
        (resource_type = 'claim_evidence'
            AND claim_evidence_id IS NOT NULL AND claim_review_id IS NULL
            AND legacy_identifier_id IS NULL AND authentication_binding_id IS NULL
            AND time_trial_participant_reference_id IS NULL
            AND time_trial_evidence_id IS NULL)
        OR
        (resource_type = 'claim_review'
            AND claim_evidence_id IS NULL AND claim_review_id IS NOT NULL
            AND legacy_identifier_id IS NULL AND authentication_binding_id IS NULL
            AND time_trial_participant_reference_id IS NULL
            AND time_trial_evidence_id IS NULL)
        OR
        (resource_type = 'legacy_identifier'
            AND claim_evidence_id IS NULL AND claim_review_id IS NULL
            AND legacy_identifier_id IS NOT NULL AND authentication_binding_id IS NULL
            AND time_trial_participant_reference_id IS NULL
            AND time_trial_evidence_id IS NULL)
        OR
        (resource_type = 'authentication_binding'
            AND claim_evidence_id IS NULL AND claim_review_id IS NULL
            AND legacy_identifier_id IS NULL AND authentication_binding_id IS NOT NULL
            AND time_trial_participant_reference_id IS NULL
            AND time_trial_evidence_id IS NULL)
        OR
        (resource_type = 'time_trial_participant_reference'
            AND claim_evidence_id IS NULL AND claim_review_id IS NULL
            AND legacy_identifier_id IS NULL AND authentication_binding_id IS NULL
            AND time_trial_participant_reference_id IS NOT NULL
            AND time_trial_evidence_id IS NULL)
        OR
        (resource_type = 'time_trial_evidence'
            AND claim_evidence_id IS NULL AND claim_review_id IS NULL
            AND legacy_identifier_id IS NULL AND authentication_binding_id IS NULL
            AND time_trial_participant_reference_id IS NULL
            AND time_trial_evidence_id IS NOT NULL)
    );

ALTER TABLE restricted_identity_access_log
    DROP FOREIGN KEY fk_identity_access_tournament_data,
    DROP INDEX ix_identity_access_tournament_data,
    DROP COLUMN tournament_restricted_data_id;

DROP TABLE restricted_tournament_race_data;
DROP TABLE tournament_race_placements;
DROP TABLE tournament_race_result_revisions;
DROP TABLE tournament_race_results;
