SET NAMES utf8mb4;

CREATE TABLE players (
    player_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id VARCHAR(135) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    player_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    display_name VARCHAR(128) NOT NULL,
    record_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (player_id),
    UNIQUE KEY uq_players_public_id (public_id),
    CONSTRAINT ck_players_public_id CHECK (LEFT(public_id, 7) = 'player.'),
    CONSTRAINT ck_players_kind CHECK (player_kind = 'human'),
    CONSTRAINT ck_players_revision CHECK (revision >= 1),
    CONSTRAINT ck_players_status CHECK (record_status IN ('active', 'archived')),
    CONSTRAINT ck_players_timestamps CHECK (updated_at_ms >= created_at_ms)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE player_username_history (
    username_history_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    player_id BIGINT UNSIGNED NOT NULL,
    sequence_number BIGINT UNSIGNED NOT NULL,
    username_value VARCHAR(64) NOT NULL,
    comparison_key VARBINARY(512) NOT NULL,
    allocated_at_ms BIGINT UNSIGNED NOT NULL,
    released_at_ms BIGINT UNSIGNED NULL,
    current_player_id BIGINT UNSIGNED GENERATED ALWAYS AS (
        CASE WHEN released_at_ms IS NULL THEN player_id ELSE NULL END
    ) STORED,
    current_comparison_key VARBINARY(512) GENERATED ALWAYS AS (
        CASE WHEN released_at_ms IS NULL THEN comparison_key ELSE NULL END
    ) STORED,
    PRIMARY KEY (username_history_id),
    UNIQUE KEY uq_username_player_sequence (player_id, sequence_number),
    UNIQUE KEY uq_username_current_player (current_player_id),
    UNIQUE KEY uq_username_current_key (current_comparison_key),
    CONSTRAINT fk_username_player FOREIGN KEY (player_id)
        REFERENCES players (player_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_username_sequence CHECK (sequence_number >= 1),
    CONSTRAINT ck_username_value CHECK (CHAR_LENGTH(username_value) >= 1),
    CONSTRAINT ck_username_key CHECK (OCTET_LENGTH(comparison_key) >= 1),
    CONSTRAINT ck_username_time CHECK (
        released_at_ms IS NULL OR released_at_ms >= allocated_at_ms
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE user_accounts (
    user_account_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id VARCHAR(141) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    privacy_class VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    account_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (user_account_id),
    UNIQUE KEY uq_accounts_public_id (public_id),
    CONSTRAINT ck_accounts_public_id CHECK (
        LEFT(public_id, 13) = 'user_account.'
    ),
    CONSTRAINT ck_accounts_revision CHECK (revision >= 1),
    CONSTRAINT ck_accounts_privacy CHECK (privacy_class = 'private'),
    CONSTRAINT ck_accounts_status CHECK (
        account_status IN ('active', 'suspended', 'closed')
    ),
    CONSTRAINT ck_accounts_timestamps CHECK (updated_at_ms >= created_at_ms)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE player_claims (
    player_claim_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id VARCHAR(141) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    privacy_class VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    player_id BIGINT UNSIGNED NOT NULL,
    user_account_id BIGINT UNSIGNED NOT NULL,
    claim_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    dispute_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    active_verified_player_id BIGINT UNSIGNED GENERATED ALWAYS AS (
        CASE WHEN claim_status = 'verified' THEN player_id ELSE NULL END
    ) STORED,
    active_verified_account_id BIGINT UNSIGNED GENERATED ALWAYS AS (
        CASE WHEN claim_status = 'verified' THEN user_account_id ELSE NULL END
    ) STORED,
    PRIMARY KEY (player_claim_id),
    UNIQUE KEY uq_claims_public_id (public_id),
    UNIQUE KEY uq_claims_verified_player (active_verified_player_id),
    UNIQUE KEY uq_claims_verified_account (active_verified_account_id),
    KEY ix_claims_player (player_id),
    KEY ix_claims_account (user_account_id),
    CONSTRAINT fk_claims_player FOREIGN KEY (player_id)
        REFERENCES players (player_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_claims_account FOREIGN KEY (user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_claims_public_id CHECK (
        LEFT(public_id, 13) = 'player_claim.'
    ),
    CONSTRAINT ck_claims_revision CHECK (revision >= 1),
    CONSTRAINT ck_claims_privacy CHECK (privacy_class = 'private'),
    CONSTRAINT ck_claims_status CHECK (
        claim_status IN (
            'requested', 'under_review', 'verified',
            'rejected', 'released', 'revoked'
        )
    ),
    CONSTRAINT ck_claims_dispute CHECK (dispute_status IN ('none', 'open', 'resolved')),
    CONSTRAINT ck_claims_timestamps CHECK (updated_at_ms >= created_at_ms)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE restricted_claim_evidence (
    claim_evidence_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id VARCHAR(148) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    player_claim_id BIGINT UNSIGNED NOT NULL,
    source_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    captured_at_ms BIGINT UNSIGNED NOT NULL,
    storage_reference VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
    PRIMARY KEY (claim_evidence_id),
    UNIQUE KEY uq_claim_evidence_public_id (public_id),
    KEY ix_claim_evidence_claim (player_claim_id),
    CONSTRAINT fk_claim_evidence_claim FOREIGN KEY (player_claim_id)
        REFERENCES player_claims (player_claim_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_claim_evidence_public_id CHECK (
        LEFT(public_id, 20) = 'restricted_evidence.'
    ),
    CONSTRAINT ck_claim_evidence_source CHECK (
        source_type IN (
            'account_submission',
            'administrator_observation',
            'legacy_reconciliation'
        )
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE restricted_claim_reviews (
    claim_review_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id VARCHAR(146) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    player_claim_id BIGINT UNSIGNED NOT NULL,
    reviewer_user_account_id BIGINT UNSIGNED NOT NULL,
    decision VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    reason_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    detail_ciphertext LONGBLOB NULL,
    encryption_key_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    reviewed_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (claim_review_id),
    UNIQUE KEY uq_claim_reviews_public_id (public_id),
    KEY ix_claim_reviews_claim (player_claim_id),
    KEY ix_claim_reviews_reviewer (reviewer_user_account_id),
    CONSTRAINT fk_claim_reviews_claim FOREIGN KEY (player_claim_id)
        REFERENCES player_claims (player_claim_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_claim_reviews_reviewer FOREIGN KEY (reviewer_user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_claim_reviews_public_id CHECK (
        LEFT(public_id, 18) = 'restricted_review.'
    ),
    CONSTRAINT ck_claim_reviews_decision CHECK (
        decision IN ('started', 'verified', 'rejected', 'released', 'revoked', 'dispute_resolved')
    ),
    CONSTRAINT ck_claim_reviews_encryption CHECK (
        (detail_ciphertext IS NULL AND encryption_key_version IS NULL)
        OR
        (detail_ciphertext IS NOT NULL AND encryption_key_version IS NOT NULL)
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE player_claim_lifecycle (
    claim_lifecycle_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    player_claim_id BIGINT UNSIGNED NOT NULL,
    sequence_number BIGINT UNSIGNED NOT NULL,
    event_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    actor_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    actor_user_account_id BIGINT UNSIGNED NOT NULL,
    occurred_at_ms BIGINT UNSIGNED NOT NULL,
    reason_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    claim_review_id BIGINT UNSIGNED NULL,
    PRIMARY KEY (claim_lifecycle_id),
    UNIQUE KEY uq_claim_lifecycle_sequence (player_claim_id, sequence_number),
    KEY ix_claim_lifecycle_actor (actor_user_account_id),
    KEY ix_claim_lifecycle_review (claim_review_id),
    CONSTRAINT fk_claim_lifecycle_claim FOREIGN KEY (player_claim_id)
        REFERENCES player_claims (player_claim_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_claim_lifecycle_actor FOREIGN KEY (actor_user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_claim_lifecycle_review FOREIGN KEY (claim_review_id)
        REFERENCES restricted_claim_reviews (claim_review_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_claim_lifecycle_sequence CHECK (sequence_number >= 1),
    CONSTRAINT ck_claim_lifecycle_event CHECK (
        event_type IN (
            'claim_requested', 'review_started', 'claim_verified',
            'claim_rejected', 'claim_released', 'claim_revoked',
            'dispute_opened', 'dispute_resolved'
        )
    ),
    CONSTRAINT ck_claim_lifecycle_actor CHECK (
        actor_type IN ('requesting_account', 'administrator')
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE player_claim_event_evidence (
    claim_lifecycle_id BIGINT UNSIGNED NOT NULL,
    claim_evidence_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (claim_lifecycle_id, claim_evidence_id),
    CONSTRAINT fk_claim_event_evidence_event FOREIGN KEY (claim_lifecycle_id)
        REFERENCES player_claim_lifecycle (claim_lifecycle_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_claim_event_evidence_item FOREIGN KEY (claim_evidence_id)
        REFERENCES restricted_claim_evidence (claim_evidence_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE aliases (
    alias_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id VARCHAR(134) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    player_id BIGINT UNSIGNED NOT NULL,
    alias_text VARCHAR(128) NOT NULL,
    alias_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    visibility VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    record_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    reviewed_by_user_account_id BIGINT UNSIGNED NOT NULL,
    reviewed_at_ms BIGINT UNSIGNED NOT NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (alias_id),
    UNIQUE KEY uq_aliases_public_id (public_id),
    KEY ix_aliases_player (player_id),
    KEY ix_aliases_reviewer (reviewed_by_user_account_id),
    CONSTRAINT fk_aliases_player FOREIGN KEY (player_id)
        REFERENCES players (player_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_aliases_reviewer FOREIGN KEY (reviewed_by_user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_aliases_public_id CHECK (LEFT(public_id, 6) = 'alias.'),
    CONSTRAINT ck_aliases_revision CHECK (revision >= 1),
    CONSTRAINT ck_aliases_text CHECK (CHAR_LENGTH(alias_text) >= 1),
    CONSTRAINT ck_aliases_type CHECK (
        alias_type IN (
            'declared', 'legacy_handle', 'tournament_name',
            'ocr_observation', 'other_observation'
        )
    ),
    CONSTRAINT ck_aliases_visibility CHECK (visibility IN ('public', 'restricted')),
    CONSTRAINT ck_aliases_status CHECK (record_status IN ('active', 'retired')),
    CONSTRAINT ck_aliases_review_time CHECK (reviewed_at_ms >= created_at_ms),
    CONSTRAINT ck_aliases_timestamps CHECK (updated_at_ms >= created_at_ms)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE alias_provenance (
    alias_provenance_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    alias_id BIGINT UNSIGNED NOT NULL,
    sequence_number BIGINT UNSIGNED NOT NULL,
    source_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    source_reference VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    observed_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (alias_provenance_id),
    UNIQUE KEY uq_alias_provenance_sequence (alias_id, sequence_number),
    CONSTRAINT fk_alias_provenance_alias FOREIGN KEY (alias_id)
        REFERENCES aliases (alias_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_alias_provenance_sequence CHECK (sequence_number >= 1),
    CONSTRAINT ck_alias_provenance_source CHECK (
        source_type IN (
            'player_declaration', 'tournament_manager',
            'tournament_workbook', 'timetrial_firebase',
            'ocr', 'administrator'
        )
    ),
    CONSTRAINT ck_alias_provenance_reference CHECK (
        LEFT(source_reference, 7) = 'source.'
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE restricted_legacy_identity_identifiers (
    legacy_identifier_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    source_system VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    identifier_kind VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    lookup_hash BINARY(32) NOT NULL,
    identifier_ciphertext VARBINARY(2048) NOT NULL,
    encryption_key_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    linked_player_id BIGINT UNSIGNED NULL,
    linked_user_account_id BIGINT UNSIGNED NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    last_accessed_at_ms BIGINT UNSIGNED NULL,
    PRIMARY KEY (legacy_identifier_id),
    UNIQUE KEY uq_legacy_identity_lookup (source_system, identifier_kind, lookup_hash),
    KEY ix_legacy_identity_player (linked_player_id),
    KEY ix_legacy_identity_account (linked_user_account_id),
    CONSTRAINT fk_legacy_identity_player FOREIGN KEY (linked_player_id)
        REFERENCES players (player_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_legacy_identity_account FOREIGN KEY (linked_user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_legacy_identity_link CHECK (
        (linked_player_id IS NOT NULL AND linked_user_account_id IS NULL)
        OR
        (linked_player_id IS NULL AND linked_user_account_id IS NOT NULL)
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE restricted_identity_access_log (
    identity_access_log_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    resource_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    claim_evidence_id BIGINT UNSIGNED NULL,
    claim_review_id BIGINT UNSIGNED NULL,
    legacy_identifier_id BIGINT UNSIGNED NULL,
    accessor_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    accessor_reference VARCHAR(141) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    purpose_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    accessed_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (identity_access_log_id),
    KEY ix_identity_access_evidence (claim_evidence_id),
    KEY ix_identity_access_review (claim_review_id),
    KEY ix_identity_access_legacy (legacy_identifier_id),
    KEY ix_identity_access_accessor (accessor_type, accessor_reference),
    CONSTRAINT fk_identity_access_evidence FOREIGN KEY (claim_evidence_id)
        REFERENCES restricted_claim_evidence (claim_evidence_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_identity_access_review FOREIGN KEY (claim_review_id)
        REFERENCES restricted_claim_reviews (claim_review_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_identity_access_legacy FOREIGN KEY (legacy_identifier_id)
        REFERENCES restricted_legacy_identity_identifiers (legacy_identifier_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_identity_access_resource CHECK (
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
    ),
    CONSTRAINT ck_identity_access_accessor CHECK (
        accessor_type IN ('administrator', 'migration_operator')
    ),
    CONSTRAINT ck_identity_access_reference CHECK (
        CHAR_LENGTH(accessor_reference) >= 1
    ),
    CONSTRAINT ck_identity_access_purpose CHECK (CHAR_LENGTH(purpose_code) >= 1)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
