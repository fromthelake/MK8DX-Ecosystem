-- Reverses 0092. The live capture delegations and the recorded authorization basis go; evidence records
-- keep their entries (purged ones stay empty). DROP CONSTRAINT (not DROP CHECK) so MariaDB accepts it.
DROP TABLE tournament_live_capture_delegations;

ALTER TABLE tournament_live_mapping_audit
    DROP CONSTRAINT chk_tournament_live_mapping_audit_basis;

ALTER TABLE tournament_live_mapping_audit
    DROP COLUMN authorization_basis;

ALTER TABLE tournament_evidence_records
    DROP KEY idx_tournament_evidence_retention,
    DROP KEY idx_tournament_evidence_open_bytes,
    DROP KEY idx_tournament_evidence_uploader_open,
    DROP COLUMN live_withdrawn_at_ms,
    DROP COLUMN payload_purged_at_ms,
    DROP COLUMN entries_byte_length;
