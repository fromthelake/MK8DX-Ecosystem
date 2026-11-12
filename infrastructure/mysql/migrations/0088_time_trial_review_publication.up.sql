-- 0088: an administrator publishes a Time Trial that is waiting for review (ADR-0225).
--
-- A run withheld with reason explicit_review_required (every carried time under the carriedTimes setting
-- 'review') is published unchanged by an explicit administrator action. The publication itself uses the
-- provenance migration 0015 added for reviewed publication (origin administrator_review, reason
-- administrator_review_publication); this migration only lets the lifecycle audit record the action:
-- event 'published' (the run stays active) with reason 'review_approved'.
--
-- DROP CONSTRAINT (not DROP CHECK) so MariaDB accepts it.
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
            'review_approved'
        )
    );
