-- 0018 down: remove the optional Player country presentation attribute.
ALTER TABLE players
    DROP CONSTRAINT ck_players_country;
ALTER TABLE players
    DROP COLUMN country_id;
