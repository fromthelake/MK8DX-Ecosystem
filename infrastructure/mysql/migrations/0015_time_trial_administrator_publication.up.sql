-- 0015: allow administrator-review Time Trial publication provenance.
--
-- The publication tables were created with only the two runtime origins
-- ('runtime_automatic', 'internal_withheld') and the five submit-time reason
-- codes. Publishing reviewed migrated records is an explicit administrator
-- decision, so the origin gains 'administrator_review' and the reason set
-- gains 'administrator_review_publication'. Public reads filter only on
-- publication_status and are unaffected by the new provenance values.

ALTER TABLE time_trial_publications
    DROP CONSTRAINT ck_time_trial_publication_origin;
ALTER TABLE time_trial_publications
    ADD CONSTRAINT ck_time_trial_publication_origin CHECK (
        publication_origin IN (
            'runtime_automatic',
            'internal_withheld',
            'administrator_review'
        )
    );

ALTER TABLE time_trial_publications
    DROP CONSTRAINT ck_time_trial_publication_reason;
ALTER TABLE time_trial_publications
    ADD CONSTRAINT ck_time_trial_publication_reason CHECK (
        reason_code IN (
            'verified_claim_runtime_acceptance',
            'explicit_review_required',
            'non_player_participant',
            'producer_verification_withheld',
            'unverified_player_claim',
            'administrator_review_publication'
        )
    );

ALTER TABLE time_trial_publication_lifecycle
    DROP CONSTRAINT ck_time_trial_publication_lifecycle_origin;
ALTER TABLE time_trial_publication_lifecycle
    ADD CONSTRAINT ck_time_trial_publication_lifecycle_origin CHECK (
        publication_origin IN (
            'runtime_automatic',
            'internal_withheld',
            'administrator_review'
        )
    );
