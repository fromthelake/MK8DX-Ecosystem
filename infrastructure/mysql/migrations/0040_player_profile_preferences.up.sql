-- 0040: Public, player-owned presentation preferences. The existing avatar_id is
-- the favorite character; these columns complete the preferred loadout.
ALTER TABLE players
    ADD COLUMN favorite_body_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL
        AFTER avatar_id,
    ADD COLUMN favorite_tire_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL
        AFTER favorite_body_id,
    ADD COLUMN favorite_glider_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL
        AFTER favorite_tire_id,
    ADD CONSTRAINT ck_players_favorite_body_id CHECK (
        favorite_body_id IS NULL OR favorite_body_id REGEXP '^body\\.[a-z0-9_]+$'
    ),
    ADD CONSTRAINT ck_players_favorite_tire_id CHECK (
        favorite_tire_id IS NULL OR favorite_tire_id REGEXP '^tire\\.[a-z0-9_]+$'
    ),
    ADD CONSTRAINT ck_players_favorite_glider_id CHECK (
        favorite_glider_id IS NULL OR favorite_glider_id REGEXP '^glider\\.[a-z0-9_]+$'
    );
