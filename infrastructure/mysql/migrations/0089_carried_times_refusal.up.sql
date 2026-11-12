-- 0089: refusing every carried time that waited for review when the setting is turned off (ADR-0225).
--
-- When an administrator changes carriedTimes from 'review' to 'off' and chooses "Refuse all", each carried
-- run still waiting is retired, one audited lifecycle event per run, like any retirement (and restorable
-- like any retirement). Its reason is 'carried_times_turned_off'; this migration only lets the lifecycle
-- audit record that reason.
--
-- DROP CONSTRAINT (not DROP CHECK) so MariaDB accepts it.
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
            'review_approved',
            'carried_times_turned_off'
        )
    );
