-- 0053: account-private ownership of the Booster Course Pass.
--
-- Unknown is deliberate: absence of a DLC submission is not evidence that a
-- Player does not own the DLC. This preference controls defaults and progress
-- presentation only; it never hides public tracks or grants authorization.

ALTER TABLE user_accounts
    ADD COLUMN time_trial_track_access VARCHAR(16)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'unknown'
        AFTER screen_name,
    ADD CONSTRAINT ck_accounts_time_trial_track_access CHECK (
        time_trial_track_access IN ('unknown', 'base_only', 'base_and_bcp')
    );
