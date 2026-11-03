-- 0022 down: removes the profile character column. Destructive for the
-- stored avatar choices only.

ALTER TABLE players
    DROP CONSTRAINT ck_players_avatar_id;

ALTER TABLE players
    DROP COLUMN avatar_id;
