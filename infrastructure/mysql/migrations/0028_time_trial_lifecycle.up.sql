-- 0028: owner and administrator Time Trial lifecycle.
--
-- Retiring a result is not deleting it. The submission, every revision and
-- the whole publication history stay exactly where they are; only the
-- current public competitive presence is withdrawn, which the existing
-- publication state already expresses, so every public projection follows
-- without changing a single read.
--
-- retirement_state is the authoritative lifecycle answer ("is this result
-- currently part of the Player's active record?"), while the publication
-- row remains the answer to "is this visible in public projections?".
-- Keeping both means a restored result returns through the ordinary
-- publication policy instead of being recreated.
--
-- Corrections are ordinary canonical revisions (revision N -> N+1); this
-- migration only adds the provenance values that let the platform record
-- who made them.

ALTER TABLE time_trial_submissions
    ADD COLUMN retirement_state VARCHAR(16)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
    ADD CONSTRAINT ck_time_trial_submission_retirement CHECK (
        retirement_state IN ('active', 'retired')
    );

CREATE TABLE time_trial_lifecycle_events (
    time_trial_lifecycle_event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    time_trial_submission_id BIGINT UNSIGNED NOT NULL,
    sequence_number BIGINT UNSIGNED NOT NULL,
    event_type VARCHAR(32)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    retirement_state_after VARCHAR(16)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    time_trial_submission_revision_id BIGINT UNSIGNED NOT NULL,
    actor_role VARCHAR(32)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    actor_user_account_id BIGINT UNSIGNED NOT NULL,
    reason_code VARCHAR(64)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    note VARCHAR(256) NULL,
    occurred_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (time_trial_lifecycle_event_id),
    UNIQUE KEY uq_time_trial_lifecycle_sequence (
        time_trial_submission_id,
        sequence_number
    ),
    KEY ix_time_trial_lifecycle_revision (time_trial_submission_revision_id),
    CONSTRAINT fk_time_trial_lifecycle_submission
        FOREIGN KEY (time_trial_submission_id)
        REFERENCES time_trial_submissions (time_trial_submission_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_time_trial_lifecycle_revision
        FOREIGN KEY (time_trial_submission_revision_id)
        REFERENCES time_trial_submission_revisions (
            time_trial_submission_revision_id
        )
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_time_trial_lifecycle_actor
        FOREIGN KEY (actor_user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_time_trial_lifecycle_sequence CHECK (sequence_number >= 1),
    CONSTRAINT ck_time_trial_lifecycle_event CHECK (
        event_type IN ('corrected', 'retired', 'restored')
    ),
    CONSTRAINT ck_time_trial_lifecycle_state CHECK (
        retirement_state_after IN ('active', 'retired')
    ),
    CONSTRAINT ck_time_trial_lifecycle_event_state CHECK (
        (event_type = 'retired' AND retirement_state_after = 'retired')
        OR
        (event_type IN ('corrected', 'restored')
            AND retirement_state_after = 'active')
    ),
    CONSTRAINT ck_time_trial_lifecycle_actor CHECK (
        actor_role IN ('owner', 'administrator')
    ),
    CONSTRAINT ck_time_trial_lifecycle_reason CHECK (
        reason_code IN (
            'incorrect_time',
            'wrong_track_or_mode',
            'duplicate',
            'test_result',
            'invalid_result',
            'other'
        )
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Publication provenance for the two new deliberate actors. Public reads
-- filter only on publication_status and are unaffected by these values.
ALTER TABLE time_trial_publications
    DROP CONSTRAINT ck_time_trial_publication_origin;
ALTER TABLE time_trial_publications
    ADD CONSTRAINT ck_time_trial_publication_origin CHECK (
        publication_origin IN (
            'runtime_automatic',
            'internal_withheld',
            'administrator_review',
            'owner_lifecycle',
            'administrator_lifecycle'
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
            'administrator_review_publication',
            'result_retired',
            'result_restored',
            'result_corrected',
            'player_private'
        )
    );

ALTER TABLE time_trial_publication_lifecycle
    DROP CONSTRAINT ck_time_trial_publication_lifecycle_origin;
ALTER TABLE time_trial_publication_lifecycle
    ADD CONSTRAINT ck_time_trial_publication_lifecycle_origin CHECK (
        publication_origin IN (
            'runtime_automatic',
            'internal_withheld',
            'administrator_review',
            'owner_lifecycle',
            'administrator_lifecycle'
        )
    );
