-- Removes the recorded character of every group member.
ALTER TABLE tournament_group_members
    DROP COLUMN character_key,
    DROP COLUMN character_label,
    DROP COLUMN character_roster;
