-- Refuses while two Players share a display name; rename them first. A Director's aliases keep their rows
-- (restricted, so no installation-wide matching reads them) and lose only their Director (ADR-0218).
ALTER TABLE aliases
    DROP FOREIGN KEY fk_aliases_director;

ALTER TABLE aliases
    DROP INDEX ix_aliases_director,
    DROP COLUMN director_user_account_id;

ALTER TABLE players
    DROP INDEX ix_players_display_name_key,
    ADD UNIQUE KEY uq_players_display_name_key (display_name_key);
