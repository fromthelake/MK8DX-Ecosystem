-- UX19: explicitly approved public live groups, independent of final Player linking.
ALTER TABLE tournament_evidence_records
    ADD COLUMN live_status VARCHAR(16) NOT NULL DEFAULT 'none' AFTER linked_at_ms,
    ADD COLUMN live_mappings_json JSON NULL AFTER live_status,
    ADD COLUMN live_approved_by_user_account_id BIGINT UNSIGNED NULL AFTER live_mappings_json,
    ADD COLUMN live_approved_at_ms BIGINT UNSIGNED NULL AFTER live_approved_by_user_account_id,
    ADD COLUMN live_stopped_at_ms BIGINT UNSIGNED NULL AFTER live_approved_at_ms,
    ADD COLUMN live_completed_at_ms BIGINT UNSIGNED NULL AFTER live_stopped_at_ms,
    ADD KEY idx_tournament_evidence_live (suggested_tournament_id, live_status, updated_at_ms),
    ADD CONSTRAINT fk_tournament_evidence_live_approver
        FOREIGN KEY (live_approved_by_user_account_id) REFERENCES user_accounts(user_account_id),
    ADD CONSTRAINT chk_tournament_evidence_live_status
        CHECK (live_status IN ('none', 'requested', 'active', 'stopping', 'complete', 'invalidated'));

CREATE TABLE tournament_live_mapping_audit (
    tournament_live_mapping_audit_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_evidence_record_id BIGINT UNSIGNED NOT NULL,
    tournament_id BIGINT UNSIGNED NOT NULL,
    changed_by_user_account_id BIGINT UNSIGNED NOT NULL,
    previous_mappings_json JSON NOT NULL,
    next_mappings_json JSON NOT NULL,
    reason VARCHAR(512) NOT NULL,
    changed_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_live_mapping_audit_id),
    KEY idx_tournament_live_mapping_audit_record
        (tournament_evidence_record_id, changed_at_ms),
    CONSTRAINT fk_tournament_live_mapping_audit_record
        FOREIGN KEY (tournament_evidence_record_id)
        REFERENCES tournament_evidence_records(tournament_evidence_record_id),
    CONSTRAINT fk_tournament_live_mapping_audit_tournament
        FOREIGN KEY (tournament_id) REFERENCES tournaments(tournament_id),
    CONSTRAINT fk_tournament_live_mapping_audit_actor
        FOREIGN KEY (changed_by_user_account_id) REFERENCES user_accounts(user_account_id)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
