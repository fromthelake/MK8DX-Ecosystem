CREATE TABLE restricted_authentication_bindings (
    authentication_binding_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id VARCHAR(151) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    privacy_class VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_account_id BIGINT UNSIGNED NOT NULL,
    issuer_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    subject_lookup_hmac BINARY(32) NOT NULL,
    lookup_key_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    binding_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    bound_at_ms BIGINT UNSIGNED NOT NULL,
    ended_at_ms BIGINT UNSIGNED NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    active_issuer_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin
        GENERATED ALWAYS AS (
            CASE WHEN binding_status = 'active' THEN issuer_key ELSE NULL END
        ) STORED,
    active_subject_lookup_hmac BINARY(32)
        GENERATED ALWAYS AS (
            CASE WHEN binding_status = 'active' THEN subject_lookup_hmac ELSE NULL END
        ) STORED,
    active_lookup_key_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin
        GENERATED ALWAYS AS (
            CASE WHEN binding_status = 'active' THEN lookup_key_version ELSE NULL END
        ) STORED,
    PRIMARY KEY (authentication_binding_id),
    UNIQUE KEY uq_auth_bindings_public_id (public_id),
    UNIQUE KEY uq_auth_bindings_active_subject (
        active_issuer_key,
        active_lookup_key_version,
        active_subject_lookup_hmac
    ),
    KEY ix_auth_bindings_account (user_account_id),
    CONSTRAINT fk_auth_bindings_account FOREIGN KEY (user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_auth_bindings_public_id CHECK (
        LEFT(public_id, 24) = 'restricted_auth_binding.'
    ),
    CONSTRAINT ck_auth_bindings_revision CHECK (revision >= 1),
    CONSTRAINT ck_auth_bindings_privacy CHECK (privacy_class = 'private'),
    CONSTRAINT ck_auth_bindings_issuer CHECK (
        issuer_key REGEXP '^[a-z0-9]+([._-][a-z0-9]+)*$'
    ),
    CONSTRAINT ck_auth_bindings_key_version CHECK (
        lookup_key_version REGEXP '^[a-z0-9]+([._-][a-z0-9]+)*$'
    ),
    CONSTRAINT ck_auth_bindings_status CHECK (
        binding_status IN ('active', 'released', 'revoked')
    ),
    CONSTRAINT ck_auth_bindings_end_time CHECK (
        (binding_status = 'active' AND ended_at_ms IS NULL)
        OR
        (binding_status IN ('released', 'revoked')
            AND ended_at_ms IS NOT NULL
            AND ended_at_ms >= bound_at_ms)
    ),
    CONSTRAINT ck_auth_bindings_timestamps CHECK (updated_at_ms >= bound_at_ms)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE restricted_authentication_binding_lifecycle (
    authentication_binding_lifecycle_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    authentication_binding_id BIGINT UNSIGNED NOT NULL,
    sequence_number BIGINT UNSIGNED NOT NULL,
    event_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    actor_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    actor_user_account_id BIGINT UNSIGNED NULL,
    actor_reference VARCHAR(141) CHARACTER SET ascii COLLATE ascii_bin NULL,
    reason_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    occurred_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (authentication_binding_lifecycle_id),
    UNIQUE KEY uq_auth_binding_lifecycle_sequence (
        authentication_binding_id,
        sequence_number
    ),
    KEY ix_auth_binding_lifecycle_actor (actor_user_account_id),
    CONSTRAINT fk_auth_binding_lifecycle_binding
        FOREIGN KEY (authentication_binding_id)
        REFERENCES restricted_authentication_bindings (authentication_binding_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_auth_binding_lifecycle_actor
        FOREIGN KEY (actor_user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_auth_binding_lifecycle_sequence CHECK (sequence_number >= 1),
    CONSTRAINT ck_auth_binding_lifecycle_event CHECK (
        event_type IN ('binding_created', 'binding_released', 'binding_revoked')
    ),
    CONSTRAINT ck_auth_binding_lifecycle_actor CHECK (
        (actor_type = 'administrator'
            AND actor_user_account_id IS NOT NULL
            AND actor_reference IS NULL)
        OR
        (actor_type = 'migration_operator'
            AND actor_user_account_id IS NULL
            AND actor_reference IS NOT NULL)
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE restricted_identity_access_log
    ADD COLUMN authentication_binding_id BIGINT UNSIGNED NULL
        AFTER legacy_identifier_id,
    ADD KEY ix_identity_access_auth_binding (authentication_binding_id),
    ADD CONSTRAINT fk_identity_access_auth_binding
        FOREIGN KEY (authentication_binding_id)
        REFERENCES restricted_authentication_bindings (authentication_binding_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE restricted_identity_access_log
    DROP CONSTRAINT ck_identity_access_resource,
    ADD CONSTRAINT ck_identity_access_resource CHECK (
        (resource_type = 'claim_evidence'
            AND claim_evidence_id IS NOT NULL
            AND claim_review_id IS NULL
            AND legacy_identifier_id IS NULL
            AND authentication_binding_id IS NULL)
        OR
        (resource_type = 'claim_review'
            AND claim_evidence_id IS NULL
            AND claim_review_id IS NOT NULL
            AND legacy_identifier_id IS NULL
            AND authentication_binding_id IS NULL)
        OR
        (resource_type = 'legacy_identifier'
            AND claim_evidence_id IS NULL
            AND claim_review_id IS NULL
            AND legacy_identifier_id IS NOT NULL
            AND authentication_binding_id IS NULL)
        OR
        (resource_type = 'authentication_binding'
            AND claim_evidence_id IS NULL
            AND claim_review_id IS NULL
            AND legacy_identifier_id IS NULL
            AND authentication_binding_id IS NOT NULL)
    );

ALTER TABLE restricted_identity_access_log
    DROP CONSTRAINT ck_identity_access_accessor,
    ADD CONSTRAINT ck_identity_access_accessor CHECK (
        accessor_type IN (
            'account', 'administrator', 'authentication', 'migration_operator'
        )
    );
