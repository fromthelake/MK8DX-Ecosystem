-- ADR-0225: carrying a time from another community.
--
-- installation_settings.carried_times is the receiving administrator's choice: 'off' refuses a carried
-- time, 'review' keeps every carried time for an administrator to approve, 'allowed' applies the normal
-- publication rules. NOT NULL DEFAULT 'off': the existing row (if any) and every installation without a
-- row keep refusing, as before this migration. The audit table learns the new setting key.
--
-- The four carried columns describe where a revision came from: the https origin of the other
-- community, its display name, the id there and when it was first submitted there. All four are NULL for
-- a time set here, which is every revision stored before this migration. They sit on the revision with
-- the rest of the submitted content, so a correction copies them like the other provenance.
--
-- DROP CONSTRAINT (not DROP CHECK) so MariaDB accepts it.
ALTER TABLE installation_settings
    ADD COLUMN carried_times VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'off'
        AFTER rating_eligibility_changed_at_ms;

ALTER TABLE installation_settings
    ADD CONSTRAINT ck_installation_settings_carried_times CHECK (
        carried_times IN ('off', 'review', 'allowed')
    );

ALTER TABLE installation_setting_changes
    DROP CONSTRAINT ck_installation_setting_changes_key;

ALTER TABLE installation_setting_changes
    ADD CONSTRAINT ck_installation_setting_changes_key CHECK (
        setting_key IN ('player_creation', 'rating_eligibility', 'carried_times')
    );

ALTER TABLE time_trial_submission_revisions
    ADD COLUMN carried_from_origin VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN carried_from_name VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
    ADD COLUMN carried_original_submission_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
    ADD COLUMN carried_original_submitted_at_ms BIGINT UNSIGNED NULL;

ALTER TABLE time_trial_submission_revisions
    ADD CONSTRAINT ck_time_trial_revisions_carried CHECK (
        (carried_from_origin IS NULL AND carried_from_name IS NULL
            AND carried_original_submission_id IS NULL AND carried_original_submitted_at_ms IS NULL)
        OR (carried_from_origin IS NOT NULL AND carried_original_submitted_at_ms IS NOT NULL)
    );
