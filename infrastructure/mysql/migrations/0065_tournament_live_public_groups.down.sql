DROP TABLE IF EXISTS tournament_live_mapping_audit;

ALTER TABLE tournament_evidence_records
    DROP FOREIGN KEY fk_tournament_evidence_live_approver,
    DROP CHECK chk_tournament_evidence_live_status,
    DROP INDEX idx_tournament_evidence_live,
    DROP COLUMN live_completed_at_ms,
    DROP COLUMN live_stopped_at_ms,
    DROP COLUMN live_approved_at_ms,
    DROP COLUMN live_approved_by_user_account_id,
    DROP COLUMN live_mappings_json,
    DROP COLUMN live_status;
