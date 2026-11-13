-- 0090: the same carried time twice (ADR-0225 amendment, 2026-11-12 late).
--
-- time_trial_carried_originals records every carried time this installation accepted: as a new run
-- ('run') or as filling the empty fields of an equal run of the same Player ('fill'). Its unique key on
-- (origin, original submission id) refuses the same original a second time, also between two requests
-- at the same moment; a carried time without an original id is recorded but never matched (NULL is
-- never equal). The revision is the one the carried time created, so a run's history can name where a
-- fill came from. Rows stay while the run exists, retired or not.
--
-- Carried runs accepted before this migration are recorded from their revisions. The lifecycle audit
-- learns the 'enriched' event (the run stays active) with reason 'carried_fill'.
--
-- DROP CONSTRAINT (not DROP CHECK) so MariaDB accepts it.
CREATE TABLE time_trial_carried_originals (
    time_trial_carried_original_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    carried_from_origin VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    original_submission_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
    time_trial_submission_id BIGINT UNSIGNED NOT NULL,
    time_trial_submission_revision_id BIGINT UNSIGNED NOT NULL,
    disposition VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    filled_fields_json VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (time_trial_carried_original_id),
    UNIQUE KEY uq_time_trial_carried_original (carried_from_origin, original_submission_id),
    KEY ix_time_trial_carried_original_submission (time_trial_submission_id),
    KEY ix_time_trial_carried_original_revision (time_trial_submission_revision_id),
    CONSTRAINT fk_time_trial_carried_original_submission FOREIGN KEY (time_trial_submission_id)
        REFERENCES time_trial_submissions (time_trial_submission_id) ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT fk_time_trial_carried_original_revision FOREIGN KEY (time_trial_submission_revision_id)
        REFERENCES time_trial_submission_revisions (time_trial_submission_revision_id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT ck_time_trial_carried_original_disposition CHECK (disposition IN ('run', 'fill')),
    CONSTRAINT ck_time_trial_carried_original_fill CHECK (
        (disposition = 'run' AND filled_fields_json IS NULL)
        OR (disposition = 'fill' AND filled_fields_json IS NOT NULL)
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO time_trial_carried_originals (
    carried_from_origin, original_submission_id, time_trial_submission_id,
    time_trial_submission_revision_id, disposition, filled_fields_json, created_at_ms
)
SELECT revision.carried_from_origin, revision.carried_original_submission_id, revision.time_trial_submission_id,
       MIN(revision.time_trial_submission_revision_id), 'run', NULL, MIN(revision.created_at_ms)
FROM time_trial_submission_revisions AS revision
WHERE revision.carried_from_origin IS NOT NULL
GROUP BY revision.time_trial_submission_id, revision.carried_from_origin, revision.carried_original_submission_id;

ALTER TABLE time_trial_lifecycle_events
    DROP CONSTRAINT ck_time_trial_lifecycle_event_state;

ALTER TABLE time_trial_lifecycle_events
    DROP CONSTRAINT ck_time_trial_lifecycle_event;

ALTER TABLE time_trial_lifecycle_events
    DROP CONSTRAINT ck_time_trial_lifecycle_reason;

ALTER TABLE time_trial_lifecycle_events
    ADD CONSTRAINT ck_time_trial_lifecycle_event CHECK (
        event_type IN ('corrected', 'retired', 'restored', 'published', 'enriched')
    );

ALTER TABLE time_trial_lifecycle_events
    ADD CONSTRAINT ck_time_trial_lifecycle_event_state CHECK (
        (event_type = 'retired' AND retirement_state_after = 'retired')
        OR
        (event_type IN ('corrected', 'restored', 'published', 'enriched')
            AND retirement_state_after = 'active')
    );

ALTER TABLE time_trial_lifecycle_events
    ADD CONSTRAINT ck_time_trial_lifecycle_reason CHECK (
        reason_code IN (
            'incorrect_time',
            'wrong_track_or_mode',
            'duplicate',
            'test_result',
            'invalid_result',
            'other',
            'review_approved',
            'carried_times_turned_off',
            'carried_fill'
        )
    );
