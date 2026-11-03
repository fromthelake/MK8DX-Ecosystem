-- 0067: a web scan is recorded as a scan (ADR-0204).
--
-- Two things change, both additive:
--
-- 1. `source_kind` gains 'web_scan'. The browser scanner has been able to read
--    a result screen or a ghost panel since ADR-0187, but what it read was
--    published as 'web_manual', so a web scan was indistinguishable from
--    typing. Existing rows are untouched and there is no backfill: historical
--    web scans cannot be told apart and stay 'web_manual' (ADR-0204).
--
-- 2. The capture layout - which of the two screens was read - is recorded in a
--    separate one-row-per-revision table rather than as a column on
--    `time_trial_submission_revisions`.
--
--    The reason is the same one migration 0066 gives: the local QA mirror
--    restores a production snapshot and refuses to start when the column list
--    of a snapshotted domain table differs from the local schema
--    (`backend/api/test/local-qa-mirror-restore.mjs`), so a new column there
--    could not be exercised until production had already run the migration.
--    A separate table is empty in the snapshot and filled locally, so the
--    provenance can be verified in the order this work has to be verified in.
--    The semantics ADR-0204 decided are unchanged: the value is optional, it
--    exists only for scans, and it is bounded to the two layouts the producers
--    can read.
--
-- Nothing here touches publication eligibility, ranking or any trust
-- indicator; ADR-0204 decision 5 keeps provenance out of all of those.

ALTER TABLE time_trial_submission_revisions
    DROP CONSTRAINT ck_time_trial_source,
    ADD CONSTRAINT ck_time_trial_source CHECK (
        source_kind IN (
            'web_manual', 'web_scan', 'android_manual', 'android_scan',
            'livetrial_capture', 'livetrial_recorded_video'
        )
    );

CREATE TABLE time_trial_submission_capture_layouts (
    time_trial_submission_revision_id BIGINT UNSIGNED NOT NULL,
    -- 'time_trial_result' (the end screen) | 'ghost_details' (the Select a
    -- Ghost detail panel). A missing row means the producer did not say, which
    -- is every manual submission and every revision written before this
    -- migration.
    capture_layout VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY (time_trial_submission_revision_id),
    CONSTRAINT fk_time_trial_capture_layout_revision
        FOREIGN KEY (time_trial_submission_revision_id)
        REFERENCES time_trial_submission_revisions (time_trial_submission_revision_id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT ck_time_trial_capture_layout CHECK (
        capture_layout IN ('time_trial_result', 'ghost_details')
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
