-- 0040 development rollback; public favorite loadout choices are removed.
ALTER TABLE players
    DROP CONSTRAINT ck_players_favorite_glider_id,
    DROP CONSTRAINT ck_players_favorite_tire_id,
    DROP CONSTRAINT ck_players_favorite_body_id,
    DROP COLUMN favorite_glider_id,
    DROP COLUMN favorite_tire_id,
    DROP COLUMN favorite_body_id;
