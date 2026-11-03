-- 0022: optional profile character (avatar) on Players.
--
-- Presentation metadata only, never identity evidence, never a Time
-- Trial loadout, never rating input. Stores the exact stable canonical
-- schema-9 character or character-variant id so the chosen appearance
-- (including colour variants) is reproducible.

ALTER TABLE players
    ADD COLUMN avatar_id VARCHAR(128)
        CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD CONSTRAINT ck_players_avatar_id CHECK (
        avatar_id IS NULL OR
        avatar_id REGEXP '^character(_variant)?\\.[a-z0-9_.]+$'
    );
