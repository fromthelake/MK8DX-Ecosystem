-- Which build of a client each Player is actually running.
--
-- Nothing recorded this. The download page knows what is on offer and the
-- client-support endpoint knows what is allowed, but neither knows what is
-- installed, so "who is still on an old build, and who never opened the app at
-- all" could only be guessed at. The owner asked for it per device and with
-- history: not a single "last seen" that overwrites itself, but a row per
-- version a device has run, so an update shows as a new row beside the old one
-- and the timeline survives.
--
-- One row is (account, installation, client, version). `installation_id` is
-- the client's own local installation profile - the Android app already
-- generates one and keeps it in its own storage; it identifies a copy of the
-- app, not a person and not a phone. `device_model` is what the device calls
-- itself ("V2405A"), which is what makes a list of devices readable; it is
-- optional and bounded, and it is the only thing here that is about hardware.
--
-- What this is not: it is not a request log. A client checks in at start and
-- from its own periodic pass, and a check-in that matches a row already there
-- only moves `last_seen_at_ms` and counts up. Rows are pruned by the write
-- path itself: an account's rows untouched for eighteen months are removed
-- when that account next checks in, so the table cannot grow without bound and
-- nothing needs a scheduler to remember.

CREATE TABLE client_installations (
    client_installation_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_account_id BIGINT UNSIGNED NOT NULL,
    -- The client's own installation profile. One copy of one app.
    installation_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    -- 'android', and room for the others without a migration.
    client_name VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    client_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    -- The build number where the client has one; Android does.
    client_build INT UNSIGNED NULL,
    device_model VARCHAR(64) NULL,
    first_seen_at_ms BIGINT UNSIGNED NOT NULL,
    last_seen_at_ms BIGINT UNSIGNED NOT NULL,
    checkin_count INT UNSIGNED NOT NULL DEFAULT 1,
    PRIMARY KEY (client_installation_id),
    UNIQUE KEY uq_client_installations_version (
        user_account_id, installation_id, client_name, client_version
    ),
    KEY ix_client_installations_recency (user_account_id, last_seen_at_ms),
    KEY ix_client_installations_build (client_name, client_build),
    CONSTRAINT fk_client_installations_account FOREIGN KEY (user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT ck_client_installations_seen CHECK (
        last_seen_at_ms >= first_seen_at_ms
    ),
    CONSTRAINT ck_client_installations_count CHECK (checkin_count >= 1),
    CONSTRAINT ck_client_installations_name CHECK (
        client_name IN ('android', 'web', 'livetrial')
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
