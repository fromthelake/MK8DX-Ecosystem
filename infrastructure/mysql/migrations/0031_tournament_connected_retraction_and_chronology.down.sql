-- 0031 development rollback; production retains audit evidence.
DROP TABLE IF EXISTS tournament_retraction_audit;
DROP TABLE IF EXISTS tournament_incoming_results;

ALTER TABLE tournament_group_races
    DROP COLUMN occurred_at_ms;

ALTER TABLE tournaments
    DROP INDEX idx_tournaments_active_start,
    DROP FOREIGN KEY fk_tournaments_retracted_by,
    DROP CONSTRAINT chk_tournaments_lifecycle_status,
    DROP COLUMN retraction_rating_epoch_id,
    DROP COLUMN retraction_reason,
    DROP COLUMN retracted_by_user_account_id,
    DROP COLUMN retracted_at_ms,
    DROP COLUMN lifecycle_status,
    DROP COLUMN timezone_name,
    DROP COLUMN start_at_ms,
    DROP COLUMN series_label;
