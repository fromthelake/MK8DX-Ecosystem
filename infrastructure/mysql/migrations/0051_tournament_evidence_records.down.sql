-- 0051 development rollback. Production retains uploaded evidence and review audit.
DROP TABLE IF EXISTS tournament_incoming_result_reviews;

ALTER TABLE tournament_incoming_results
    DROP FOREIGN KEY fk_tournament_incoming_reviewer,
    DROP FOREIGN KEY fk_tournament_incoming_evidence_record,
    DROP INDEX uq_tournament_incoming_evidence_entry,
    DROP COLUMN reviewed_by_user_account_id,
    DROP COLUMN evidence_entry_key,
    DROP COLUMN evidence_record_id;

DROP TABLE IF EXISTS tournament_evidence_records;
