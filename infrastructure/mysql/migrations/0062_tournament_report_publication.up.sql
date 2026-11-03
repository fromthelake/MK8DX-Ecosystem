-- The Director writes the night's report at Step 10 and publishes it when it
-- reads the way they want. Migration 0030 already stores a draft - the intro,
-- the Top 5 intro, a note per Player, and a revision so two windows cannot
-- overwrite each other. This adds what publishing a night of our own needs.
--
-- The new columns are nullable rather than NOT NULL with a default: MySQL 8
-- refuses a literal default on JSON and MariaDB's support differs, and an
-- absent value simply means "nothing written yet".
--
-- `published_payload_json` is a copy, not a pointer. Once a report is
-- published the Director keeps editing the draft, and the community must go on
-- reading what was published until they publish again.
ALTER TABLE tournament_report_drafts
    ADD COLUMN title_text VARCHAR(160) NULL AFTER revision,
    ADD COLUMN summary_text TEXT NULL AFTER intro_text,
    ADD COLUMN group_notes_json JSON NULL AFTER player_notes_json,
    ADD COLUMN visibility_json JSON NULL AFTER group_notes_json,
    ADD COLUMN published_revision BIGINT UNSIGNED NULL AFTER visibility_json,
    ADD COLUMN published_at_ms BIGINT UNSIGNED NULL AFTER published_revision,
    ADD COLUMN published_by_user_account_id BIGINT UNSIGNED NULL AFTER published_at_ms,
    ADD COLUMN published_payload_json JSON NULL AFTER published_by_user_account_id,
    ADD CONSTRAINT fk_tournament_report_drafts_publisher
        FOREIGN KEY (published_by_user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT;
