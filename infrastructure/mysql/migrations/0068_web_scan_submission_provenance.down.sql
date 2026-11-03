-- 0067 rollback: take back only what 0067 created.
--
-- Destructive: dropping the table loses every recorded capture layout, and
-- narrowing the source check refuses any 'web_scan' revision that already
-- exists, so this rollback is only safe before any web scan has been stored.

DROP TABLE time_trial_submission_capture_layouts;

ALTER TABLE time_trial_submission_revisions
    DROP CONSTRAINT ck_time_trial_source,
    ADD CONSTRAINT ck_time_trial_source CHECK (
        source_kind IN (
            'web_manual', 'android_manual', 'android_scan',
            'livetrial_capture', 'livetrial_recorded_video'
        )
    );
