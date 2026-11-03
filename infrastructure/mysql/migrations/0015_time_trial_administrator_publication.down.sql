-- 0015 down: restore the original runtime-only publication provenance.
--
-- Re-adding the narrow CHECK constraints validates existing rows, so this
-- rollback fails closed (by design) while any row still carries the
-- 'administrator_review' origin or 'administrator_review_publication'
-- reason; such rows must be re-withheld or removed first.

ALTER TABLE time_trial_publication_lifecycle
    DROP CONSTRAINT ck_time_trial_publication_lifecycle_origin;
ALTER TABLE time_trial_publication_lifecycle
    ADD CONSTRAINT ck_time_trial_publication_lifecycle_origin CHECK (
        publication_origin IN ('runtime_automatic', 'internal_withheld')
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
            'unverified_player_claim'
        )
    );

ALTER TABLE time_trial_publications
    DROP CONSTRAINT ck_time_trial_publication_origin;
ALTER TABLE time_trial_publications
    ADD CONSTRAINT ck_time_trial_publication_origin CHECK (
        publication_origin IN ('runtime_automatic', 'internal_withheld')
    );
