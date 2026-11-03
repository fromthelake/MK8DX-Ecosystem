-- 0039 development rollback; preference values and rate buckets are removed.
DROP TABLE api_mutation_rate_limits;

ALTER TABLE user_accounts
    DROP CONSTRAINT ck_accounts_screen_name,
    DROP CONSTRAINT ck_accounts_time_trial_mode_preference,
    DROP COLUMN screen_name,
    DROP COLUMN time_trial_mode_preference;
