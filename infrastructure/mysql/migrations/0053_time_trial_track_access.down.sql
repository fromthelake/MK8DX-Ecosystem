-- 0053 development rollback; the private DLC preference is removed.
ALTER TABLE user_accounts
    DROP CONSTRAINT ck_accounts_time_trial_track_access,
    DROP COLUMN time_trial_track_access;
