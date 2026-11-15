-- 0092: Tournament evidence storage limits, retention and Director-issued live capture delegations.
--
-- entries_byte_length records how many bytes a record's result entries take, so the per-account and
-- installation quotas on unlinked evidence are a cheap indexed sum instead of serialising every JSON
-- document. Existing rows are measured once below. payload_purged_at_ms marks a stale, never-linked record
-- whose entries were removed by retention while its live-mapping audit stays; NULL = not purged.
-- live_withdrawn_at_ms marks a live feed the Director (or a delegation revocation) took off the public view;
-- while it is set a roster match cannot open that feed again, only an explicit Director confirmation can.
--
-- tournament_live_capture_delegations is the explicit, revocable, time-limited permission a Tournament's
-- Director (or an administrator) gives one account to run that Tournament's live capture. Only such a
-- delegation, the Director or an administrator lets a strong roster match open the public live view; the
-- roster match alone never authorizes anything. tournament_live_mapping_audit.authorization_basis records
-- which authority changed a live mapping (NULL for rows written before this migration).
--
-- DROP CONSTRAINT (not DROP CHECK) in the down migration so MariaDB accepts it.
ALTER TABLE tournament_evidence_records
    ADD COLUMN entries_byte_length INT UNSIGNED NOT NULL DEFAULT 0 AFTER content_sha256,
    ADD COLUMN payload_purged_at_ms BIGINT UNSIGNED NULL AFTER updated_at_ms,
    ADD COLUMN live_withdrawn_at_ms BIGINT UNSIGNED NULL AFTER live_completed_at_ms,
    ADD KEY idx_tournament_evidence_uploader_open
        (uploaded_by_user_account_id, linked_tournament_id, record_status, entries_byte_length),
    ADD KEY idx_tournament_evidence_open_bytes
        (record_status, linked_tournament_id, entries_byte_length),
    ADD KEY idx_tournament_evidence_retention
        (updated_at_ms, linked_tournament_id);

UPDATE tournament_evidence_records
   SET entries_byte_length = LEAST(LENGTH(result_entries_json), 4294967295);

ALTER TABLE tournament_live_mapping_audit
    ADD COLUMN authorization_basis VARCHAR(24) NULL AFTER reason,
    ADD CONSTRAINT chk_tournament_live_mapping_audit_basis CHECK (
        authorization_basis IS NULL OR authorization_basis IN (
            'administrator', 'director', 'capture_delegation', 'delegation_revoked'
        )
    );

CREATE TABLE tournament_live_capture_delegations (
    tournament_live_capture_delegation_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id VARCHAR(80) NOT NULL,
    tournament_id BIGINT UNSIGNED NOT NULL,
    delegate_user_account_id BIGINT UNSIGNED NOT NULL,
    delegation_status VARCHAR(16) NOT NULL DEFAULT 'active',
    granted_by_user_account_id BIGINT UNSIGNED NOT NULL,
    grant_reason VARCHAR(255) NOT NULL,
    granted_at_ms BIGINT UNSIGNED NOT NULL,
    expires_at_ms BIGINT UNSIGNED NOT NULL,
    revoked_by_user_account_id BIGINT UNSIGNED NULL,
    revoke_reason VARCHAR(255) NULL,
    revoked_at_ms BIGINT UNSIGNED NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_live_capture_delegation_id),
    UNIQUE KEY uq_tournament_live_capture_delegations_public_id (public_id),
    KEY idx_tournament_live_capture_delegations_lookup
        (tournament_id, delegate_user_account_id, delegation_status, expires_at_ms),
    CONSTRAINT fk_tournament_live_capture_delegations_tournament
        FOREIGN KEY (tournament_id) REFERENCES tournaments(tournament_id),
    CONSTRAINT fk_tournament_live_capture_delegations_delegate
        FOREIGN KEY (delegate_user_account_id) REFERENCES user_accounts(user_account_id),
    CONSTRAINT fk_tournament_live_capture_delegations_granter
        FOREIGN KEY (granted_by_user_account_id) REFERENCES user_accounts(user_account_id),
    CONSTRAINT fk_tournament_live_capture_delegations_revoker
        FOREIGN KEY (revoked_by_user_account_id) REFERENCES user_accounts(user_account_id),
    CONSTRAINT chk_tournament_live_capture_delegations_status
        CHECK (delegation_status IN ('active', 'revoked')),
    CONSTRAINT chk_tournament_live_capture_delegations_window
        CHECK (expires_at_ms > granted_at_ms),
    CONSTRAINT chk_tournament_live_capture_delegations_revocation CHECK (
        (delegation_status = 'active' AND revoked_at_ms IS NULL AND revoked_by_user_account_id IS NULL)
        OR (delegation_status = 'revoked' AND revoked_at_ms IS NOT NULL AND revoked_by_user_account_id IS NOT NULL)
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
