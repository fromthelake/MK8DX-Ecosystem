-- 0091: the community name (installation setting communityName, ADR-0221 mechanism).
--
-- installation_settings.community_name is the name the apps show for this installation instead of its
-- web address ("Club Noord"); NULL = not set, which is every installation before this migration. The
-- audit of setting changes records it like the other settings, so its value columns widen to 60 utf8mb4
-- characters (a name is not ASCII); an unset name is recorded as ''.
--
-- DROP CONSTRAINT (not DROP CHECK) so MariaDB accepts it.
ALTER TABLE installation_settings
    ADD COLUMN community_name VARCHAR(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL
        AFTER carried_times;

ALTER TABLE installation_settings
    ADD CONSTRAINT ck_installation_settings_community_name CHECK (
        community_name IS NULL OR CHAR_LENGTH(community_name) BETWEEN 1 AND 60
    );

ALTER TABLE installation_setting_changes
    DROP CONSTRAINT ck_installation_setting_changes_value;

ALTER TABLE installation_setting_changes
    MODIFY COLUMN previous_value VARCHAR(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    MODIFY COLUMN new_value VARCHAR(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE installation_setting_changes
    ADD CONSTRAINT ck_installation_setting_changes_value CHECK (previous_value <> new_value);

ALTER TABLE installation_setting_changes
    DROP CONSTRAINT ck_installation_setting_changes_key;

ALTER TABLE installation_setting_changes
    ADD CONSTRAINT ck_installation_setting_changes_key CHECK (
        setting_key IN ('player_creation', 'rating_eligibility', 'carried_times', 'community_name')
    );
