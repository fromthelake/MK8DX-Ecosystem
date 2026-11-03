-- 0027 down: removes Player public presence. Destructive for the stored
-- visibility choices and their audit trail only; no canonical Player,
-- result, publication or rating row is touched.

DROP TABLE player_visibility_lifecycle;

ALTER TABLE players
    DROP CONSTRAINT ck_players_visibility;

ALTER TABLE players
    DROP COLUMN visibility;
