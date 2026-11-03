-- 0051: independent Tournament Live evidence records and advisory matching.
CREATE TABLE tournament_evidence_records (
    tournament_evidence_record_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id CHAR(36) NOT NULL,
    client_record_id VARCHAR(160) NOT NULL,
    revision INT UNSIGNED NOT NULL DEFAULT 1,
    record_status VARCHAR(16) NOT NULL DEFAULT 'uploading',
    source_kind VARCHAR(64) NOT NULL,
    result_entries_json JSON NOT NULL,
    summary_payload_json JSON NOT NULL,
    content_sha256 CHAR(64) NOT NULL,
    suggested_tournament_id BIGINT UNSIGNED NULL,
    linked_tournament_id BIGINT UNSIGNED NULL,
    uploaded_by_user_account_id BIGINT UNSIGNED NOT NULL,
    linked_by_user_account_id BIGINT UNSIGNED NULL,
    started_at_ms BIGINT UNSIGNED NULL,
    stopped_at_ms BIGINT UNSIGNED NULL,
    analysis_completed_at_ms BIGINT UNSIGNED NULL,
    completed_at_ms BIGINT UNSIGNED NULL,
    linked_at_ms BIGINT UNSIGNED NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_evidence_record_id),
    UNIQUE KEY uq_tournament_evidence_records_public_id (public_id),
    UNIQUE KEY uq_tournament_evidence_records_uploader_client
        (uploaded_by_user_account_id, client_record_id),
    KEY idx_tournament_evidence_records_available
        (record_status, completed_at_ms, tournament_evidence_record_id),
    KEY idx_tournament_evidence_records_suggestion
        (suggested_tournament_id, record_status, created_at_ms),
    CONSTRAINT fk_tournament_evidence_records_suggested_tournament
        FOREIGN KEY (suggested_tournament_id) REFERENCES tournaments(tournament_id),
    CONSTRAINT fk_tournament_evidence_records_linked_tournament
        FOREIGN KEY (linked_tournament_id) REFERENCES tournaments(tournament_id),
    CONSTRAINT fk_tournament_evidence_records_uploader
        FOREIGN KEY (uploaded_by_user_account_id) REFERENCES user_accounts(user_account_id),
    CONSTRAINT fk_tournament_evidence_records_linker
        FOREIGN KEY (linked_by_user_account_id) REFERENCES user_accounts(user_account_id),
    CONSTRAINT chk_tournament_evidence_records_status
        CHECK (record_status IN ('uploading', 'available', 'linked', 'blocked')),
    CONSTRAINT chk_tournament_evidence_records_capture_time
        CHECK (started_at_ms IS NULL OR stopped_at_ms IS NULL OR stopped_at_ms >= started_at_ms)
);

ALTER TABLE tournament_incoming_results
    ADD COLUMN evidence_record_id BIGINT UNSIGNED NULL AFTER tournament_id,
    ADD COLUMN evidence_entry_key VARCHAR(160) NULL AFTER evidence_record_id,
    ADD COLUMN reviewed_by_user_account_id BIGINT UNSIGNED NULL AFTER submitted_by_user_account_id,
    ADD UNIQUE KEY uq_tournament_incoming_evidence_entry (evidence_record_id, evidence_entry_key),
    ADD CONSTRAINT fk_tournament_incoming_evidence_record
        FOREIGN KEY (evidence_record_id) REFERENCES tournament_evidence_records(tournament_evidence_record_id),
    ADD CONSTRAINT fk_tournament_incoming_reviewer
        FOREIGN KEY (reviewed_by_user_account_id) REFERENCES user_accounts(user_account_id);

CREATE TABLE tournament_incoming_result_reviews (
    tournament_incoming_result_review_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_incoming_result_id BIGINT UNSIGNED NOT NULL,
    action VARCHAR(24) NOT NULL,
    actor_user_account_id BIGINT UNSIGNED NOT NULL,
    reason VARCHAR(512) NOT NULL,
    race_result_id BIGINT UNSIGNED NULL,
    occurred_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_incoming_result_review_id),
    KEY idx_tournament_incoming_reviews_result
        (tournament_incoming_result_id, occurred_at_ms),
    CONSTRAINT fk_tournament_incoming_reviews_incoming
        FOREIGN KEY (tournament_incoming_result_id)
        REFERENCES tournament_incoming_results(tournament_incoming_result_id),
    CONSTRAINT fk_tournament_incoming_reviews_actor
        FOREIGN KEY (actor_user_account_id) REFERENCES user_accounts(user_account_id),
    CONSTRAINT fk_tournament_incoming_reviews_race
        FOREIGN KEY (race_result_id) REFERENCES tournament_race_results(tournament_race_result_id),
    CONSTRAINT chk_tournament_incoming_reviews_action
        CHECK (action IN ('accepted', 'rejected', 'reopened'))
);
