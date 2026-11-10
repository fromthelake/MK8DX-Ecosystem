-- ADR-0224 phase 2: one-tap account switching on shared devices (docs/product/ACCOUNT_SWITCHING_DESIGN.md).
-- Empty tables only. No session token, cookie value or plain PIN is ever stored: a device is an HMAC
-- digest of its random cookie, and a PIN is a peppered scrypt digest. Identity is unchanged: rows
-- refer to an existing Better Auth user or UserAccount and never link anything by name.
CREATE TABLE account_switch_remembered_accounts (
    entry_id CHAR(22) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    device_digest BINARY(32) NOT NULL,
    auth_user_id VARCHAR(36) NOT NULL,
    remembered_at_ms BIGINT UNSIGNED NOT NULL,
    last_used_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (entry_id),
    UNIQUE KEY uq_account_switch_device_user (device_digest, auth_user_id),
    KEY ix_account_switch_user (auth_user_id),
    CONSTRAINT fk_account_switch_auth_user FOREIGN KEY (auth_user_id)
        REFERENCES mk8dx_auth_user (id) ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT ck_account_switch_time CHECK (last_used_at_ms >= remembered_at_ms)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE account_switch_sessions (
    session_id VARCHAR(36) NOT NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (session_id),
    CONSTRAINT fk_account_switch_session FOREIGN KEY (session_id)
        REFERENCES mk8dx_auth_session (id) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE account_switch_pins (
    user_account_id BIGINT UNSIGNED NOT NULL,
    pin_digest BINARY(32) NOT NULL,
    pin_salt BINARY(16) NOT NULL,
    pepper_version INT UNSIGNED NOT NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (user_account_id),
    CONSTRAINT fk_account_switch_pin_account FOREIGN KEY (user_account_id)
        REFERENCES user_accounts (user_account_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_account_switch_pin_time CHECK (updated_at_ms >= created_at_ms),
    CONSTRAINT ck_account_switch_pin_pepper CHECK (pepper_version >= 1)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
