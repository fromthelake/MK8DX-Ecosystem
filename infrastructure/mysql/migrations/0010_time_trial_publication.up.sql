ALTER TABLE time_trial_submission_revisions
    ADD UNIQUE KEY uq_time_trial_revision_identity_submission (
        time_trial_submission_revision_id,
        time_trial_submission_id
    );

CREATE TABLE time_trial_publications (
    time_trial_publication_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    time_trial_submission_id BIGINT UNSIGNED NOT NULL,
    current_revision_id BIGINT UNSIGNED NOT NULL,
    publication_revision BIGINT UNSIGNED NOT NULL,
    publication_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    publication_origin VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    reason_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    published_at_ms BIGINT UNSIGNED NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (time_trial_publication_id),
    UNIQUE KEY uq_time_trial_publication_submission (time_trial_submission_id),
    UNIQUE KEY uq_time_trial_publication_revision (current_revision_id),
    CONSTRAINT fk_time_trial_publication_submission
        FOREIGN KEY (time_trial_submission_id)
        REFERENCES time_trial_submissions (time_trial_submission_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_time_trial_publication_revision
        FOREIGN KEY (current_revision_id, time_trial_submission_id)
        REFERENCES time_trial_submission_revisions (
            time_trial_submission_revision_id,
            time_trial_submission_id
        )
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_time_trial_publication_revision CHECK (publication_revision >= 1),
    CONSTRAINT ck_time_trial_publication_status CHECK (
        publication_status IN ('published', 'withheld')
    ),
    CONSTRAINT ck_time_trial_publication_origin CHECK (
        publication_origin IN ('runtime_automatic', 'internal_withheld')
    ),
    CONSTRAINT ck_time_trial_publication_reason CHECK (
        reason_code IN (
            'verified_claim_runtime_acceptance',
            'explicit_review_required',
            'non_player_participant',
            'producer_verification_withheld',
            'unverified_player_claim'
        )
    ),
    CONSTRAINT ck_time_trial_publication_timestamp CHECK (
        (publication_status = 'published' AND published_at_ms IS NOT NULL)
        OR
        (publication_status = 'withheld' AND published_at_ms IS NULL)
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE time_trial_publication_lifecycle (
    time_trial_publication_lifecycle_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    time_trial_publication_id BIGINT UNSIGNED NOT NULL,
    sequence_number BIGINT UNSIGNED NOT NULL,
    time_trial_submission_revision_id BIGINT UNSIGNED NOT NULL,
    event_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    publication_status_after VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    publication_origin VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    reason_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    occurred_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (time_trial_publication_lifecycle_id),
    UNIQUE KEY uq_time_trial_publication_lifecycle_sequence (
        time_trial_publication_id,
        sequence_number
    ),
    KEY ix_time_trial_publication_lifecycle_revision (
        time_trial_submission_revision_id
    ),
    CONSTRAINT fk_time_trial_publication_lifecycle_publication
        FOREIGN KEY (time_trial_publication_id)
        REFERENCES time_trial_publications (time_trial_publication_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_time_trial_publication_lifecycle_revision
        FOREIGN KEY (time_trial_submission_revision_id)
        REFERENCES time_trial_submission_revisions (time_trial_submission_revision_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_time_trial_publication_lifecycle_sequence CHECK (
        sequence_number >= 1
    ),
    CONSTRAINT ck_time_trial_publication_lifecycle_event CHECK (
        event_type IN ('revision_published', 'revision_withheld')
    ),
    CONSTRAINT ck_time_trial_publication_lifecycle_status CHECK (
        publication_status_after IN ('published', 'withheld')
    ),
    CONSTRAINT ck_time_trial_publication_lifecycle_origin CHECK (
        publication_origin IN ('runtime_automatic', 'internal_withheld')
    ),
    CONSTRAINT ck_time_trial_publication_lifecycle_event_state CHECK (
        (event_type = 'revision_published'
            AND publication_status_after = 'published')
        OR
        (event_type = 'revision_withheld'
            AND publication_status_after = 'withheld')
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
