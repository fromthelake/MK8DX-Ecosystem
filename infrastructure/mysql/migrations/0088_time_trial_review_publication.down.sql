-- Reverses 0088. The audit rows of reviewed publications go (the publications themselves stay published,
-- with the provenance 0015 allows); the three checks return to their 0028 form.
-- DROP CONSTRAINT (not DROP CHECK) so MariaDB accepts it.
DELETE FROM time_trial_lifecycle_events WHERE event_type = 'published';

ALTER TABLE time_trial_lifecycle_events
    DROP CONSTRAINT ck_time_trial_lifecycle_event_state;

ALTER TABLE time_trial_lifecycle_events
    DROP CONSTRAINT ck_time_trial_lifecycle_event;

ALTER TABLE time_trial_lifecycle_events
    DROP CONSTRAINT ck_time_trial_lifecycle_reason;

ALTER TABLE time_trial_lifecycle_events
    ADD CONSTRAINT ck_time_trial_lifecycle_event CHECK (
        event_type IN ('corrected', 'retired', 'restored')
    );

ALTER TABLE time_trial_lifecycle_events
    ADD CONSTRAINT ck_time_trial_lifecycle_event_state CHECK (
        (event_type = 'retired' AND retirement_state_after = 'retired')
        OR
        (event_type IN ('corrected', 'restored')
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
            'other'
        )
    );
