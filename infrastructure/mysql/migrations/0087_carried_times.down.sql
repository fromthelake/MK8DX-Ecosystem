-- Reverses 0087. Carried revisions lose where they came from (they stay as ordinary revisions of their
-- Player); the setting and its audit rows go, and the audit key check is restored to the two ADR-0221
-- settings. DROP CONSTRAINT (not DROP CHECK) so MariaDB accepts it.
ALTER TABLE time_trial_submission_revisions
    DROP CONSTRAINT ck_time_trial_revisions_carried;

ALTER TABLE time_trial_submission_revisions
    DROP COLUMN carried_original_submitted_at_ms,
    DROP COLUMN carried_original_submission_id,
    DROP COLUMN carried_from_name,
    DROP COLUMN carried_from_origin;

DELETE FROM installation_setting_changes WHERE setting_key = 'carried_times';

ALTER TABLE installation_setting_changes
    DROP CONSTRAINT ck_installation_setting_changes_key;

ALTER TABLE installation_setting_changes
    ADD CONSTRAINT ck_installation_setting_changes_key CHECK (
        setting_key IN ('player_creation', 'rating_eligibility')
    );

ALTER TABLE installation_settings
    DROP CONSTRAINT ck_installation_settings_carried_times;

ALTER TABLE installation_settings
    DROP COLUMN carried_times;
