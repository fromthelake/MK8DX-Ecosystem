CREATE TABLE account_capability_grants (
    account_capability_grant_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id VARCHAR(180) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    user_account_id BIGINT UNSIGNED NOT NULL,
    capability_code VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    grant_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    granted_by_user_account_id BIGINT UNSIGNED NOT NULL,
    granted_at_ms BIGINT UNSIGNED NOT NULL,
    revoked_at_ms BIGINT UNSIGNED NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    active_user_account_id BIGINT UNSIGNED GENERATED ALWAYS AS (
        CASE WHEN grant_status = 'active' THEN user_account_id ELSE NULL END
    ) STORED,
    PRIMARY KEY (account_capability_grant_id),
    UNIQUE KEY uq_account_capability_grants_public_id (public_id),
    UNIQUE KEY uq_account_capability_grants_active_account (
        active_user_account_id, capability_code
    ),
    KEY ix_account_capability_grants_account (user_account_id),
    CONSTRAINT fk_account_capability_grants_account FOREIGN KEY (user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_account_capability_grants_actor FOREIGN KEY (granted_by_user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_account_capability_grants_public_id CHECK (
        LEFT(public_id, 25) = 'account_capability_grant.'
    ),
    CONSTRAINT ck_account_capability_grants_revision CHECK (revision >= 1),
    CONSTRAINT ck_account_capability_grants_code CHECK (
        capability_code = 'tournament.analytics.erik_report'
    ),
    CONSTRAINT ck_account_capability_grants_status CHECK (
        grant_status IN ('active', 'revoked')
    ),
    CONSTRAINT ck_account_capability_grants_revocation CHECK (
        (grant_status = 'active' AND revoked_at_ms IS NULL)
        OR (grant_status = 'revoked' AND revoked_at_ms IS NOT NULL
            AND revoked_at_ms >= granted_at_ms)
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE account_capability_grant_lifecycle (
    account_capability_grant_lifecycle_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    account_capability_grant_id BIGINT UNSIGNED NOT NULL,
    sequence_number BIGINT UNSIGNED NOT NULL,
    event_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    actor_user_account_id BIGINT UNSIGNED NOT NULL,
    grant_status_after VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    reason_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    occurred_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (account_capability_grant_lifecycle_id),
    UNIQUE KEY uq_account_capability_lifecycle_sequence (
        account_capability_grant_id, sequence_number
    ),
    CONSTRAINT fk_account_capability_lifecycle_grant
        FOREIGN KEY (account_capability_grant_id)
        REFERENCES account_capability_grants (account_capability_grant_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_account_capability_lifecycle_actor
        FOREIGN KEY (actor_user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_account_capability_lifecycle_event CHECK (
        event_type IN ('granted', 'revoked')
    ),
    CONSTRAINT ck_account_capability_lifecycle_status CHECK (
        grant_status_after IN ('active', 'revoked')
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE tournament_report_drafts (
    tournament_report_draft_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_id BIGINT UNSIGNED NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    intro_text TEXT NOT NULL,
    tracks_intro_text TEXT NOT NULL,
    player_notes_json JSON NOT NULL,
    updated_by_user_account_id BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_report_draft_id),
    UNIQUE KEY uq_tournament_report_drafts_tournament (tournament_id),
    CONSTRAINT fk_tournament_report_drafts_tournament FOREIGN KEY (tournament_id)
        REFERENCES tournaments (tournament_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_tournament_report_drafts_actor FOREIGN KEY (updated_by_user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_tournament_report_drafts_revision CHECK (revision >= 1),
    CONSTRAINT ck_tournament_report_drafts_text CHECK (
        CHAR_LENGTH(intro_text) <= 8000
        AND CHAR_LENGTH(tracks_intro_text) <= 8000
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
