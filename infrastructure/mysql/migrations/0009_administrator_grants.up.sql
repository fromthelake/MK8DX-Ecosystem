CREATE TABLE administrator_grants (
    administrator_grant_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id VARCHAR(156) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    user_account_id BIGINT UNSIGNED NOT NULL,
    grant_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    grant_origin VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    granted_at_ms BIGINT UNSIGNED NOT NULL,
    revoked_at_ms BIGINT UNSIGNED NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    active_user_account_id BIGINT UNSIGNED GENERATED ALWAYS AS (
        CASE WHEN grant_status = 'active' THEN user_account_id ELSE NULL END
    ) STORED,
    bootstrap_slot TINYINT UNSIGNED GENERATED ALWAYS AS (
        CASE WHEN grant_origin = 'bootstrap_cli' THEN 1 ELSE NULL END
    ) STORED,
    PRIMARY KEY (administrator_grant_id),
    UNIQUE KEY uq_administrator_grants_public_id (public_id),
    UNIQUE KEY uq_administrator_grants_active_account (active_user_account_id),
    UNIQUE KEY uq_administrator_grants_bootstrap (bootstrap_slot),
    KEY ix_administrator_grants_account (user_account_id),
    CONSTRAINT fk_administrator_grants_account FOREIGN KEY (user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_administrator_grants_public_id CHECK (
        LEFT(public_id, 20) = 'administrator_grant.'
    ),
    CONSTRAINT ck_administrator_grants_revision CHECK (revision >= 1),
    CONSTRAINT ck_administrator_grants_status CHECK (
        grant_status IN ('active', 'revoked')
    ),
    CONSTRAINT ck_administrator_grants_origin CHECK (
        grant_origin IN ('bootstrap_cli', 'administrator')
    ),
    CONSTRAINT ck_administrator_grants_revocation CHECK (
        (grant_status = 'active' AND revoked_at_ms IS NULL)
        OR
        (grant_status = 'revoked'
            AND revoked_at_ms IS NOT NULL
            AND revoked_at_ms >= granted_at_ms)
    ),
    CONSTRAINT ck_administrator_grants_timestamps CHECK (
        updated_at_ms >= granted_at_ms
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE administrator_grant_lifecycle (
    administrator_grant_lifecycle_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    administrator_grant_id BIGINT UNSIGNED NOT NULL,
    sequence_number BIGINT UNSIGNED NOT NULL,
    event_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    actor_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    actor_user_account_id BIGINT UNSIGNED NULL,
    grant_status_after VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    reason_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    occurred_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (administrator_grant_lifecycle_id),
    UNIQUE KEY uq_administrator_grant_lifecycle_sequence (
        administrator_grant_id,
        sequence_number
    ),
    KEY ix_administrator_grant_lifecycle_actor (actor_user_account_id),
    CONSTRAINT fk_administrator_grant_lifecycle_grant
        FOREIGN KEY (administrator_grant_id)
        REFERENCES administrator_grants (administrator_grant_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_administrator_grant_lifecycle_actor
        FOREIGN KEY (actor_user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_administrator_grant_lifecycle_sequence CHECK (
        sequence_number >= 1
    ),
    CONSTRAINT ck_administrator_grant_lifecycle_event CHECK (
        event_type IN ('bootstrap_granted', 'granted', 'revoked')
    ),
    CONSTRAINT ck_administrator_grant_lifecycle_status CHECK (
        grant_status_after IN ('active', 'revoked')
    ),
    CONSTRAINT ck_administrator_grant_lifecycle_actor CHECK (
        (actor_type = 'bootstrap_cli'
            AND actor_user_account_id IS NULL
            AND event_type = 'bootstrap_granted')
        OR
        (actor_type = 'administrator'
            AND actor_user_account_id IS NOT NULL
            AND event_type IN ('granted', 'revoked'))
    ),
    CONSTRAINT ck_administrator_grant_lifecycle_event_state CHECK (
        (event_type IN ('bootstrap_granted', 'granted')
            AND grant_status_after = 'active')
        OR
        (event_type = 'revoked' AND grant_status_after = 'revoked')
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
