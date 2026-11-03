-- ADR-0218: a name is never an identity. Display names may repeat (usernames stay unique through
-- player_username_history); the normalized key stays as an ordinary index for the roster picker.
-- An alias may belong to one Director (NULL = installation-wide, every existing alias). Indexes and
-- keys are dropped by name so MariaDB accepts the statements.
ALTER TABLE players
    DROP INDEX uq_players_display_name_key,
    ADD KEY ix_players_display_name_key (display_name_key);

ALTER TABLE aliases
    ADD COLUMN director_user_account_id BIGINT UNSIGNED NULL AFTER player_id,
    ADD KEY ix_aliases_director (director_user_account_id),
    ADD CONSTRAINT fk_aliases_director FOREIGN KEY (director_user_account_id)
        REFERENCES user_accounts (user_account_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
