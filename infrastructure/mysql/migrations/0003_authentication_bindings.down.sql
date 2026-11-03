ALTER TABLE restricted_identity_access_log
    DROP CONSTRAINT ck_identity_access_resource,
    ADD CONSTRAINT ck_identity_access_resource CHECK (
        (resource_type = 'claim_evidence'
            AND claim_evidence_id IS NOT NULL
            AND claim_review_id IS NULL
            AND legacy_identifier_id IS NULL)
        OR
        (resource_type = 'claim_review'
            AND claim_evidence_id IS NULL
            AND claim_review_id IS NOT NULL
            AND legacy_identifier_id IS NULL)
        OR
        (resource_type = 'legacy_identifier'
            AND claim_evidence_id IS NULL
            AND claim_review_id IS NULL
            AND legacy_identifier_id IS NOT NULL)
    );

ALTER TABLE restricted_identity_access_log
    DROP CONSTRAINT ck_identity_access_accessor,
    ADD CONSTRAINT ck_identity_access_accessor CHECK (
        accessor_type IN ('account', 'administrator', 'migration_operator')
    );

ALTER TABLE restricted_identity_access_log
    DROP FOREIGN KEY fk_identity_access_auth_binding,
    DROP INDEX ix_identity_access_auth_binding,
    DROP COLUMN authentication_binding_id;

DROP TABLE restricted_authentication_binding_lifecycle;
DROP TABLE restricted_authentication_bindings;
