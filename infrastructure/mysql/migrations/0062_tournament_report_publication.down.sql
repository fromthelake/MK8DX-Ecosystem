ALTER TABLE tournament_report_drafts
    DROP FOREIGN KEY fk_tournament_report_drafts_publisher;

ALTER TABLE tournament_report_drafts
    DROP COLUMN published_payload_json,
    DROP COLUMN published_by_user_account_id,
    DROP COLUMN published_at_ms,
    DROP COLUMN published_revision,
    DROP COLUMN visibility_json,
    DROP COLUMN group_notes_json,
    DROP COLUMN summary_text,
    DROP COLUMN title_text;
