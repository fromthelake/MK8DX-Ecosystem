-- 0043: reserve normalized visible Player names across active and archived rows.
ALTER TABLE players
    ADD COLUMN display_name_key VARCHAR(128)
        GENERATED ALWAYS AS (LOWER(TRIM(display_name))) STORED
        AFTER display_name,
    ADD UNIQUE KEY uq_players_display_name_key (display_name_key);
