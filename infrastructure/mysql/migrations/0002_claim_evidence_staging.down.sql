ALTER TABLE restricted_identity_access_log
    DROP CONSTRAINT ck_identity_access_accessor,
    ADD CONSTRAINT ck_identity_access_accessor CHECK (
        accessor_type IN ('administrator', 'migration_operator')
    );

ALTER TABLE restricted_claim_evidence
    MODIFY COLUMN player_claim_id BIGINT UNSIGNED NOT NULL;

ALTER TABLE restricted_claim_evidence
    DROP FOREIGN KEY fk_claim_evidence_uploader,
    DROP INDEX ix_claim_evidence_uploader,
    DROP COLUMN uploaded_by_user_account_id;
