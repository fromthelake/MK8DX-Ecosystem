-- Reverses 0089. The audit rows of runs refused this way go (the runs stay retired, and can be restored);
-- the reason check returns to its 0088 form. DROP CONSTRAINT (not DROP CHECK) so MariaDB accepts it.
DELETE FROM time_trial_lifecycle_events WHERE reason_code = 'carried_times_turned_off';

ALTER TABLE time_trial_lifecycle_events
    DROP CONSTRAINT ck_time_trial_lifecycle_reason;

ALTER TABLE time_trial_lifecycle_events
    ADD CONSTRAINT ck_time_trial_lifecycle_reason CHECK (
        reason_code IN (
            'incorrect_time',
            'wrong_track_or_mode',
            'duplicate',
            'test_result',
            'invalid_result',
            'other',
            'review_approved'
        )
    );
