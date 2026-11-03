-- 0031: optional connected evidence, audited retraction and time chronology.
ALTER TABLE tournaments
    ADD COLUMN series_label VARCHAR(64) NULL AFTER name,
    ADD COLUMN start_at_ms BIGINT UNSIGNED NULL AFTER event_date,
    ADD COLUMN timezone_name VARCHAR(64) NULL AFTER start_at_ms,
    ADD COLUMN lifecycle_status VARCHAR(16) NOT NULL DEFAULT 'active' AFTER stage,
    ADD COLUMN retracted_at_ms BIGINT UNSIGNED NULL AFTER finalized_at_ms,
    ADD COLUMN retracted_by_user_account_id BIGINT UNSIGNED NULL AFTER retracted_at_ms,
    ADD COLUMN retraction_reason VARCHAR(512) NULL AFTER retracted_by_user_account_id,
    ADD COLUMN retraction_rating_epoch_id BIGINT UNSIGNED NULL AFTER retraction_reason,
    ADD CONSTRAINT chk_tournaments_lifecycle_status
        CHECK (lifecycle_status IN ('active', 'retracted')),
    ADD CONSTRAINT fk_tournaments_retracted_by
        FOREIGN KEY (retracted_by_user_account_id) REFERENCES user_accounts(user_account_id),
    ADD INDEX idx_tournaments_active_start (lifecycle_status, start_at_ms, tournament_id);

ALTER TABLE tournament_group_races
    ADD COLUMN occurred_at_ms BIGINT UNSIGNED NULL AFTER race_number;

CREATE TABLE tournament_incoming_results (
    tournament_incoming_result_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id CHAR(36) NOT NULL,
    tournament_id BIGINT UNSIGNED NOT NULL,
    source_kind VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    revision INT UNSIGNED NOT NULL DEFAULT 1,
    result_payload_json JSON NOT NULL,
    semantic_fingerprint CHAR(64) NOT NULL,
    suggested_phase VARCHAR(64) NULL,
    suggested_group_public_id VARCHAR(64) NULL,
    suggested_race_number INT UNSIGNED NULL,
    occurred_at_ms BIGINT UNSIGNED NULL,
    captured_at_ms BIGINT UNSIGNED NULL,
    submitted_by_user_account_id BIGINT UNSIGNED NOT NULL,
    accepted_race_result_id BIGINT UNSIGNED NULL,
    accepted_at_ms BIGINT UNSIGNED NULL,
    rejected_at_ms BIGINT UNSIGNED NULL,
    review_reason VARCHAR(512) NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_incoming_result_id),
    UNIQUE KEY uq_tournament_incoming_results_public_id (public_id),
    KEY idx_tournament_incoming_results_queue (tournament_id, status, created_at_ms),
    KEY idx_tournament_incoming_results_fingerprint (tournament_id, semantic_fingerprint, status),
    CONSTRAINT fk_tournament_incoming_results_tournament
        FOREIGN KEY (tournament_id) REFERENCES tournaments(tournament_id),
    CONSTRAINT fk_tournament_incoming_results_submitter
        FOREIGN KEY (submitted_by_user_account_id) REFERENCES user_accounts(user_account_id),
    CONSTRAINT fk_tournament_incoming_results_accepted_race
        FOREIGN KEY (accepted_race_result_id) REFERENCES tournament_race_results(tournament_race_result_id),
    CONSTRAINT chk_tournament_incoming_results_status
        CHECK (status IN ('pending', 'accepted', 'rejected', 'blocked')),
    CONSTRAINT chk_tournament_incoming_results_race_number
        CHECK (suggested_race_number IS NULL OR suggested_race_number >= 1)
);

CREATE TABLE tournament_retraction_audit (
    tournament_retraction_audit_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_id BIGINT UNSIGNED NOT NULL,
    action VARCHAR(16) NOT NULL,
    actor_user_account_id BIGINT UNSIGNED NOT NULL,
    reason VARCHAR(512) NOT NULL,
    publication_was_public BOOLEAN NOT NULL,
    rating_was_included BOOLEAN NOT NULL,
    rating_epoch_id BIGINT UNSIGNED NULL,
    occurred_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_retraction_audit_id),
    KEY idx_tournament_retraction_audit_tournament (tournament_id, occurred_at_ms),
    CONSTRAINT fk_tournament_retraction_audit_tournament
        FOREIGN KEY (tournament_id) REFERENCES tournaments(tournament_id),
    CONSTRAINT fk_tournament_retraction_audit_actor
        FOREIGN KEY (actor_user_account_id) REFERENCES user_accounts(user_account_id),
    CONSTRAINT chk_tournament_retraction_audit_action
        CHECK (action IN ('remove', 'restore'))
);
