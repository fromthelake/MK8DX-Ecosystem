-- Reverses 0090. The record of accepted carried originals goes (filled revisions stay as revisions of
-- their run), the audit rows of fills go, and the three lifecycle checks return to their 0089 form.
-- DROP CONSTRAINT (not DROP CHECK) so MariaDB accepts it.
DELETE FROM time_trial_lifecycle_events WHERE event_type = 'enriched';

ALTER TABLE time_trial_lifecycle_events
    DROP CONSTRAINT ck_time_trial_lifecycle_event_state;

ALTER TABLE time_trial_lifecycle_events
    DROP CONSTRAINT ck_time_trial_lifecycle_event;

ALTER TABLE time_trial_lifecycle_events
    DROP CONSTRAINT ck_time_trial_lifecycle_reason;

ALTER TABLE time_trial_lifecycle_events
    ADD CONSTRAINT ck_time_trial_lifecycle_event CHECK (
        event_type IN ('corrected', 'retired', 'restored', 'published')
    );

ALTER TABLE time_trial_lifecycle_events
    ADD CONSTRAINT ck_time_trial_lifecycle_event_state CHECK (
        (event_type = 'retired' AND retirement_state_after = 'retired')
        OR
        (event_type IN ('corrected', 'restored', 'published')
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
            'carried_times_turned_off'
        )
    );

DROP TABLE time_trial_carried_originals;
