-- 0029: canonical Tournament operation (ADR-0160).
--
-- Running a tournament night moves from the parked PHP Tournament Manager
-- into the platform: a Tournament entity with participants and attendance,
-- qualifier/final groups with Switch seating, the canonical race results
-- entered or imported per group, optional manual totals, and an audited
-- finalization that pins the result set as a Tournament publication.
--
-- Two independent finalization settings (owner decision, 2026-08-22):
--   PUBLIC RESULTS    -> tournament_publications.public_visibility
--   AFFECTS TRUESKILL -> tournament_rating_decisions (ADR-0155)
-- Operational data is never deleted because either setting is off.

-- Operator-entered races carry their own canonical source kind
-- (tournament_manual_entry / web_form), added to the V1 contract.
ALTER TABLE tournament_race_result_revisions
    DROP CONSTRAINT ck_tournament_race_source;
ALTER TABLE tournament_race_result_revisions
    ADD CONSTRAINT ck_tournament_race_source CHECK (
        source_kind IN (
            'tournament_recorded_video',
            'tournament_live_capture',
            'tournament_spreadsheet_import',
            'tournament_manual_entry'
        )
        AND (
            source_transport IS NULL
            OR source_transport IN (
                'native_contract', 'excel_workbook', 'csv', 'web_form'
            )
        )
    );

ALTER TABLE tournament_publications
    ADD COLUMN public_visibility VARCHAR(16)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'public',
    ADD CONSTRAINT ck_tournament_publication_visibility CHECK (
        public_visibility IN ('public', 'hidden')
    );

CREATE TABLE tournaments (
    tournament_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(128) NOT NULL,
    edition_number INT UNSIGNED NULL,
    event_date VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NULL,
    director_user_account_id BIGINT UNSIGNED NOT NULL,
    stage VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    seed_order VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    placement_strategy VARCHAR(16)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    public_results BOOLEAN NOT NULL DEFAULT TRUE,
    affects_rating BOOLEAN NOT NULL DEFAULT TRUE,
    tournament_publication_id BIGINT UNSIGNED NULL,
    finalized_at_ms BIGINT UNSIGNED NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_id),
    UNIQUE KEY uq_tournaments_public_id (public_id),
    UNIQUE KEY uq_tournaments_publication (tournament_publication_id),
    KEY ix_tournaments_stage (stage, updated_at_ms),
    CONSTRAINT fk_tournaments_director
        FOREIGN KEY (director_user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_tournaments_publication
        FOREIGN KEY (tournament_publication_id)
        REFERENCES tournament_publications (tournament_publication_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_tournaments_public_id CHECK (
        public_id REGEXP '^tournament\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$'
    ),
    CONSTRAINT ck_tournaments_name CHECK (CHAR_LENGTH(name) BETWEEN 1 AND 128),
    CONSTRAINT ck_tournaments_stage CHECK (
        stage IN ('setup', 'qualifiers', 'finals', 'finalized')
    ),
    CONSTRAINT ck_tournaments_revision CHECK (revision >= 1),
    CONSTRAINT ck_tournaments_seed_order CHECK (
        seed_order IN ('ranked', 'random')
    ),
    CONSTRAINT ck_tournaments_placement CHECK (
        placement_strategy IN ('balanced', 'minimal_move')
    ),
    CONSTRAINT ck_tournaments_event_date CHECK (
        event_date IS NULL OR event_date REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    ),
    CONSTRAINT ck_tournaments_finalized CHECK (
        (stage = 'finalized' AND finalized_at_ms IS NOT NULL)
        OR (stage <> 'finalized' AND finalized_at_ms IS NULL
            AND tournament_publication_id IS NULL)
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE tournament_participants (
    tournament_participant_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_id BIGINT UNSIGNED NOT NULL,
    player_id BIGINT UNSIGNED NOT NULL,
    attendance VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    has_switch_1 BOOLEAN NOT NULL DEFAULT FALSE,
    has_switch_2 BOOLEAN NOT NULL DEFAULT FALSE,
    seed_score DECIMAL(12, 4) NULL,
    seed_rank INT UNSIGNED NULL,
    added_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_participant_id),
    UNIQUE KEY uq_tournament_participants_player (tournament_id, player_id),
    CONSTRAINT fk_tournament_participants_tournament
        FOREIGN KEY (tournament_id)
        REFERENCES tournaments (tournament_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_tournament_participants_player
        FOREIGN KEY (player_id)
        REFERENCES players (player_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_tournament_participants_attendance CHECK (
        attendance IN ('present', 'waiting', 'absent')
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE tournament_groups (
    tournament_group_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_id BIGINT UNSIGNED NOT NULL,
    public_id VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    stage VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    sequence_number SMALLINT UNSIGNED NOT NULL,
    name VARCHAR(64) NOT NULL,
    tier_key VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
    locked BOOLEAN NOT NULL DEFAULT FALSE,
    manual_score_segments SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_group_id),
    UNIQUE KEY uq_tournament_groups_public_id (public_id),
    UNIQUE KEY uq_tournament_groups_sequence (
        tournament_id, stage, sequence_number
    ),
    CONSTRAINT fk_tournament_groups_tournament
        FOREIGN KEY (tournament_id)
        REFERENCES tournaments (tournament_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_tournament_groups_public_id CHECK (
        public_id REGEXP '^tournament_group\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$'
    ),
    CONSTRAINT ck_tournament_groups_stage CHECK (
        stage IN ('qualifier', 'final')
    ),
    CONSTRAINT ck_tournament_groups_sequence CHECK (
        sequence_number BETWEEN 1 AND 5
    ),
    CONSTRAINT ck_tournament_groups_name CHECK (
        CHAR_LENGTH(name) BETWEEN 1 AND 64
    ),
    CONSTRAINT ck_tournament_groups_segments CHECK (
        manual_score_segments BETWEEN 1 AND 6
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE tournament_group_members (
    tournament_group_member_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_group_id BIGINT UNSIGNED NOT NULL,
    player_id BIGINT UNSIGNED NOT NULL,
    seat_order SMALLINT UNSIGNED NOT NULL,
    station_owner_player_id BIGINT UNSIGNED NULL,
    station_switch_type VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
    seat_number TINYINT UNSIGNED NULL,
    PRIMARY KEY (tournament_group_member_id),
    UNIQUE KEY uq_tournament_group_members_player (
        tournament_group_id, player_id
    ),
    CONSTRAINT fk_tournament_group_members_group
        FOREIGN KEY (tournament_group_id)
        REFERENCES tournament_groups (tournament_group_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_tournament_group_members_player
        FOREIGN KEY (player_id)
        REFERENCES players (player_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_tournament_group_members_station_owner
        FOREIGN KEY (station_owner_player_id)
        REFERENCES players (player_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_tournament_group_members_seat_order CHECK (
        seat_order BETWEEN 1 AND 12
    ),
    CONSTRAINT ck_tournament_group_members_station CHECK (
        (station_owner_player_id IS NULL AND station_switch_type IS NULL
            AND seat_number IS NULL)
        OR (station_owner_player_id IS NOT NULL
            AND station_switch_type IN ('ns1', 'ns2')
            AND seat_number BETWEEN 1 AND 2)
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE tournament_group_races (
    tournament_group_race_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_group_id BIGINT UNSIGNED NOT NULL,
    race_number SMALLINT UNSIGNED NOT NULL,
    tournament_race_result_id BIGINT UNSIGNED NOT NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_group_race_id),
    UNIQUE KEY uq_tournament_group_races_number (
        tournament_group_id, race_number
    ),
    UNIQUE KEY uq_tournament_group_races_result (tournament_race_result_id),
    CONSTRAINT fk_tournament_group_races_group
        FOREIGN KEY (tournament_group_id)
        REFERENCES tournament_groups (tournament_group_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_tournament_group_races_result
        FOREIGN KEY (tournament_race_result_id)
        REFERENCES tournament_race_results (tournament_race_result_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_tournament_group_races_number CHECK (
        race_number BETWEEN 1 AND 64
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE tournament_manual_scores (
    tournament_manual_score_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_group_id BIGINT UNSIGNED NOT NULL,
    player_id BIGINT UNSIGNED NOT NULL,
    segment_number SMALLINT UNSIGNED NOT NULL,
    points INT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_manual_score_id),
    UNIQUE KEY uq_tournament_manual_scores_segment (
        tournament_group_id, player_id, segment_number
    ),
    CONSTRAINT fk_tournament_manual_scores_group
        FOREIGN KEY (tournament_group_id)
        REFERENCES tournament_groups (tournament_group_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_tournament_manual_scores_player
        FOREIGN KEY (player_id)
        REFERENCES players (player_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_tournament_manual_scores_segment CHECK (
        segment_number BETWEEN 1 AND 6
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE tournament_lifecycle (
    tournament_lifecycle_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_id BIGINT UNSIGNED NOT NULL,
    sequence_number BIGINT UNSIGNED NOT NULL,
    event_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    detail VARCHAR(255) NULL,
    actor_user_account_id BIGINT UNSIGNED NOT NULL,
    occurred_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_lifecycle_id),
    UNIQUE KEY uq_tournament_lifecycle_sequence (
        tournament_id, sequence_number
    ),
    CONSTRAINT fk_tournament_lifecycle_tournament
        FOREIGN KEY (tournament_id)
        REFERENCES tournaments (tournament_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_tournament_lifecycle_actor
        FOREIGN KEY (actor_user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_tournament_lifecycle_sequence CHECK (sequence_number >= 1),
    CONSTRAINT ck_tournament_lifecycle_event CHECK (
        event_type REGEXP '^[a-z][a-z0-9_]{1,31}$'
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
