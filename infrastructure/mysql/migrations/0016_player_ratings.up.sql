-- 0016: canonical Player rating state and immutable rating history.
--
-- Semantics are the proven legacy TrueSkill behavior (ADR-0154): per-Player
-- mu/sigma with the public score derived as mu - 3*sigma. DECIMAL(24,18)
-- preserves full float64 precision of the authoritative transition seed.
-- History rows are immutable and each references the exact cause: the seed
-- import or a published canonical tournament race revision. Legacy source
-- identifiers stay in a restricted provenance table.

CREATE TABLE player_ratings (
    player_rating_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    player_id BIGINT UNSIGNED NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    mu DECIMAL(24, 18) NOT NULL,
    sigma DECIMAL(24, 18) NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (player_rating_id),
    UNIQUE KEY uq_player_ratings_player (player_id),
    CONSTRAINT fk_player_ratings_player FOREIGN KEY (player_id)
        REFERENCES players (player_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_player_ratings_revision CHECK (revision >= 1),
    CONSTRAINT ck_player_ratings_sigma CHECK (sigma > 0),
    CONSTRAINT ck_player_ratings_timestamps CHECK (
        updated_at_ms >= created_at_ms
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE player_rating_events (
    player_rating_event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    player_id BIGINT UNSIGNED NOT NULL,
    sequence_number BIGINT UNSIGNED NOT NULL,
    event_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    mu_before DECIMAL(24, 18) NULL,
    sigma_before DECIMAL(24, 18) NULL,
    mu_after DECIMAL(24, 18) NOT NULL,
    sigma_after DECIMAL(24, 18) NOT NULL,
    source_reference VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    tournament_race_result_revision_id BIGINT UNSIGNED NULL,
    occurred_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (player_rating_event_id),
    UNIQUE KEY uq_player_rating_events_sequence (player_id, sequence_number),
    KEY ix_player_rating_events_race (tournament_race_result_revision_id),
    CONSTRAINT fk_player_rating_events_player FOREIGN KEY (player_id)
        REFERENCES players (player_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_player_rating_events_race
        FOREIGN KEY (tournament_race_result_revision_id)
        REFERENCES tournament_race_result_revisions (
            tournament_race_result_revision_id
        ) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_player_rating_events_type CHECK (
        event_type IN ('seed_import', 'race_result')
    ),
    CONSTRAINT ck_player_rating_events_sequence CHECK (sequence_number >= 1),
    CONSTRAINT ck_player_rating_events_sigma CHECK (
        sigma_after > 0 AND (sigma_before IS NULL OR sigma_before > 0)
    ),
    CONSTRAINT ck_player_rating_events_before CHECK (
        (mu_before IS NULL AND sigma_before IS NULL)
        OR
        (mu_before IS NOT NULL AND sigma_before IS NOT NULL)
    ),
    CONSTRAINT ck_player_rating_events_cause CHECK (
        (event_type = 'seed_import'
            AND tournament_race_result_revision_id IS NULL)
        OR
        (event_type = 'race_result'
            AND tournament_race_result_revision_id IS NOT NULL)
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE restricted_rating_seed_identities (
    rating_seed_identity_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    player_id BIGINT UNSIGNED NOT NULL,
    source_system VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    source_player_reference VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    source_snapshot_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    imported_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (rating_seed_identity_id),
    UNIQUE KEY uq_rating_seed_identity_player (player_id),
    UNIQUE KEY uq_rating_seed_identity_source (
        source_system, source_player_reference
    ),
    CONSTRAINT fk_rating_seed_identity_player FOREIGN KEY (player_id)
        REFERENCES players (player_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
