-- 0043 rollback: remove the normalized visible-name database invariant.
ALTER TABLE players
    DROP INDEX uq_players_display_name_key,
    DROP COLUMN display_name_key;
