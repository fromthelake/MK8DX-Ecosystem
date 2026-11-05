-- Optional A2 offline auth records. No e-mail is sent to these internal .invalid addresses.
-- UserAccount and Player remain separate; this migration adds no claim or alias.
CREATE TABLE offline_auth_accounts (
    account_key VARCHAR(52) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    auth_email VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    display_label VARCHAR(80) NOT NULL,
    account_role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    user_account_id BIGINT UNSIGNED NOT NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (account_key),
    UNIQUE KEY uq_offline_auth_email (auth_email),
    UNIQUE KEY uq_offline_user_account (user_account_id),
    CONSTRAINT fk_offline_auth_user_account FOREIGN KEY (user_account_id)
        REFERENCES user_accounts (user_account_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_offline_auth_key CHECK (LEFT(account_key, 16) = 'offline_account.'),
    CONSTRAINT ck_offline_auth_email CHECK (RIGHT(auth_email, 23) = '@accounts.mk8dx.invalid'),
    CONSTRAINT ck_offline_auth_role CHECK (account_role IN ('account', 'administrator')),
    CONSTRAINT ck_offline_auth_active CHECK (active IN (FALSE, TRUE)),
    CONSTRAINT ck_offline_auth_time CHECK (updated_at_ms >= created_at_ms)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE offline_invitation_tickets (
    invitation_id VARCHAR(55) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    token_digest BINARY(32) NOT NULL,
    account_key VARCHAR(52) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    account_role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    issued_by_user_account_id BIGINT UNSIGNED NOT NULL,
    issued_at_ms BIGINT UNSIGNED NOT NULL,
    expires_at_ms BIGINT UNSIGNED NOT NULL,
    consumed_at_ms BIGINT UNSIGNED NULL,
    revoked_at_ms BIGINT UNSIGNED NULL,
    PRIMARY KEY (invitation_id),
    UNIQUE KEY uq_offline_invitation_digest (token_digest),
    KEY ix_offline_invitation_expiry (expires_at_ms),
    KEY ix_offline_invitation_account (account_key),
    CONSTRAINT fk_offline_invitation_account FOREIGN KEY (account_key)
        REFERENCES offline_auth_accounts (account_key) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_offline_invitation_issuer FOREIGN KEY (issued_by_user_account_id)
        REFERENCES user_accounts (user_account_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_offline_invitation_id CHECK (LEFT(invitation_id, 19) = 'offline_invitation.'),
    CONSTRAINT ck_offline_invitation_role CHECK (account_role IN ('account', 'administrator')),
    CONSTRAINT ck_offline_invitation_expiry CHECK (expires_at_ms > issued_at_ms),
    CONSTRAINT ck_offline_invitation_final CHECK (consumed_at_ms IS NULL OR revoked_at_ms IS NULL)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
