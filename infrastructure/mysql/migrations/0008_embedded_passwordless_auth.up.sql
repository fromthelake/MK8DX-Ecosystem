CREATE TABLE mk8dx_auth_user (
    id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    emailVerified BOOLEAN NOT NULL,
    image TEXT NULL,
    createdAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updatedAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_mk8dx_auth_user_email (email),
    CONSTRAINT ck_mk8dx_auth_user_email_verified CHECK (
        emailVerified IN (FALSE, TRUE)
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE mk8dx_auth_session (
    id VARCHAR(36) NOT NULL,
    expiresAt TIMESTAMP(3) NOT NULL,
    token VARCHAR(255) NOT NULL,
    createdAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updatedAt TIMESTAMP(3) NOT NULL,
    ipAddress TEXT NULL,
    userAgent TEXT NULL,
    userId VARCHAR(36) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_mk8dx_auth_session_token (token),
    KEY mk8dx_auth_session_userId_idx (userId),
    CONSTRAINT fk_mk8dx_auth_session_user FOREIGN KEY (userId)
        REFERENCES mk8dx_auth_user (id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT ck_mk8dx_auth_session_expiry CHECK (expiresAt > createdAt)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE mk8dx_auth_account (
    id VARCHAR(36) NOT NULL,
    issuer VARCHAR(191) NOT NULL,
    accountId VARCHAR(191) NOT NULL,
    providerId TEXT NOT NULL,
    userId VARCHAR(36) NOT NULL,
    accessToken TEXT NULL,
    refreshToken TEXT NULL,
    idToken TEXT NULL,
    accessTokenExpiresAt TIMESTAMP(3) NULL,
    refreshTokenExpiresAt TIMESTAMP(3) NULL,
    scope TEXT NULL,
    password TEXT NULL,
    createdAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updatedAt TIMESTAMP(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY mk8dx_auth_account_issuer_accountId_uidx (issuer, accountId),
    KEY mk8dx_auth_account_userId_idx (userId),
    CONSTRAINT fk_mk8dx_auth_account_user FOREIGN KEY (userId)
        REFERENCES mk8dx_auth_user (id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT ck_mk8dx_auth_account_no_password CHECK (password IS NULL)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE mk8dx_auth_verification (
    id VARCHAR(36) NOT NULL,
    identifier VARCHAR(255) NOT NULL,
    value TEXT NOT NULL,
    expiresAt TIMESTAMP(3) NOT NULL,
    createdAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updatedAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY mk8dx_auth_verification_identifier_idx (identifier),
    CONSTRAINT ck_mk8dx_auth_verification_expiry CHECK (expiresAt > createdAt)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE mk8dx_auth_device_code (
    id VARCHAR(36) NOT NULL,
    deviceCode VARCHAR(191) NOT NULL,
    userCode VARCHAR(191) NOT NULL,
    userId TEXT NULL,
    expiresAt TIMESTAMP(3) NOT NULL,
    status TEXT NOT NULL,
    lastPolledAt TIMESTAMP(3) NULL,
    pollingInterval INTEGER NULL,
    clientId TEXT NULL,
    scope TEXT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY mk8dx_auth_device_code_deviceCode_uidx (deviceCode),
    UNIQUE KEY mk8dx_auth_device_code_userCode_uidx (userCode),
    CONSTRAINT ck_mk8dx_auth_device_code_polling CHECK (
        pollingInterval IS NULL OR pollingInterval >= 1000
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE mk8dx_auth_rate_limit (
    id VARCHAR(36) NOT NULL,
    `key` VARCHAR(255) NOT NULL,
    `count` INTEGER NOT NULL,
    lastRequest BIGINT NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_mk8dx_auth_rate_limit_key (`key`),
    CONSTRAINT ck_mk8dx_auth_rate_limit_count CHECK (`count` >= 0),
    CONSTRAINT ck_mk8dx_auth_rate_limit_time CHECK (lastRequest >= 0)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE mk8dx_auth_audit_event (
    auth_audit_event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_kind VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    privacy_class VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    subject_id VARCHAR(36) NULL,
    session_id VARCHAR(36) NULL,
    client_id VARCHAR(191) NULL,
    occurred_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (auth_audit_event_id),
    KEY ix_mk8dx_auth_audit_subject (subject_id),
    KEY ix_mk8dx_auth_audit_session (session_id),
    KEY ix_mk8dx_auth_audit_time (occurred_at_ms),
    CONSTRAINT ck_mk8dx_auth_audit_kind CHECK (
        event_kind IN (
            'auth_user_created',
            'auth_session_created',
            'auth_session_revoked',
            'device_authorization_requested'
        )
    ),
    CONSTRAINT ck_mk8dx_auth_audit_privacy CHECK (privacy_class = 'private'),
    CONSTRAINT ck_mk8dx_auth_audit_shape CHECK (
        (event_kind = 'auth_user_created'
            AND subject_id IS NOT NULL
            AND session_id IS NULL
            AND client_id IS NULL)
        OR
        (event_kind IN ('auth_session_created', 'auth_session_revoked')
            AND subject_id IS NOT NULL
            AND session_id IS NOT NULL
            AND client_id IS NULL)
        OR
        (event_kind = 'device_authorization_requested'
            AND subject_id IS NULL
            AND session_id IS NULL
            AND client_id IS NOT NULL)
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
