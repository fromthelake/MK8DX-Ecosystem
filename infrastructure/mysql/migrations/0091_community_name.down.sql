-- Reverses 0091. The community name and its audit rows go; the audit value columns and the key check
-- return to their 0087 form. DROP CONSTRAINT (not DROP CHECK) so MariaDB accepts it.
DELETE FROM installation_setting_changes WHERE setting_key = 'community_name';

ALTER TABLE installation_setting_changes
    DROP CONSTRAINT ck_installation_setting_changes_key;

ALTER TABLE installation_setting_changes
    ADD CONSTRAINT ck_installation_setting_changes_key CHECK (
        setting_key IN ('player_creation', 'rating_eligibility', 'carried_times')
    );

ALTER TABLE installation_setting_changes
    DROP CONSTRAINT ck_installation_setting_changes_value;

ALTER TABLE installation_setting_changes
    MODIFY COLUMN previous_value VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN new_value VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

ALTER TABLE installation_setting_changes
    ADD CONSTRAINT ck_installation_setting_changes_value CHECK (previous_value <> new_value);

ALTER TABLE installation_settings
    DROP CONSTRAINT ck_installation_settings_community_name;

ALTER TABLE installation_settings
    DROP COLUMN community_name;
