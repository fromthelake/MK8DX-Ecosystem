-- 0018: optional Player country as a stable schema-9 country id, for the
-- established flag presentation (never a legacy numeric index). NULL means
-- unknown/not set; no flag is shown.
ALTER TABLE players
    ADD COLUMN country_id VARCHAR(64)
        CHARACTER SET ascii COLLATE ascii_bin NULL;
ALTER TABLE players
    ADD CONSTRAINT ck_players_country CHECK (
        country_id IS NULL OR country_id REGEXP '^country\.[a-z0-9_]+$'
    );
