-- 0028 down: removes the owner/administrator Time Trial lifecycle.
--
-- Destructive for retirement state and its audit trail only. Publication
-- rows written with the new provenance values must be reconciled before
-- this runs, so the constraints return to their 0015 shape.

DROP TABLE time_trial_lifecycle_events;

ALTER TABLE time_trial_submissions
    DROP CONSTRAINT ck_time_trial_submission_retirement;

ALTER TABLE time_trial_submissions
    DROP COLUMN retirement_state;

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
