ALTER TABLE restricted_claim_evidence
    MODIFY COLUMN player_claim_id BIGINT UNSIGNED NULL,
    ADD COLUMN uploaded_by_user_account_id BIGINT UNSIGNED NULL
        AFTER player_claim_id,
    ADD KEY ix_claim_evidence_uploader (uploaded_by_user_account_id),
    ADD CONSTRAINT fk_claim_evidence_uploader
        FOREIGN KEY (uploaded_by_user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT;

UPDATE restricted_claim_evidence AS evidence
INNER JOIN player_claims AS claim
    ON claim.player_claim_id = evidence.player_claim_id
SET evidence.uploaded_by_user_account_id = claim.user_account_id
WHERE evidence.uploaded_by_user_account_id IS NULL;

ALTER TABLE restricted_claim_evidence
    MODIFY COLUMN uploaded_by_user_account_id BIGINT UNSIGNED NOT NULL;

ALTER TABLE restricted_identity_access_log
    DROP CONSTRAINT ck_identity_access_accessor,
    ADD CONSTRAINT ck_identity_access_accessor CHECK (
        accessor_type IN ('account', 'administrator', 'migration_operator')
    );
