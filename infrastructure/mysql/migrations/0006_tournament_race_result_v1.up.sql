CREATE TABLE tournament_race_results (
    tournament_race_result_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id VARCHAR(151) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    first_created_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_race_result_id),
    UNIQUE KEY uq_tournament_race_results_public_id (public_id),
    CONSTRAINT ck_tournament_race_result_public_id CHECK (
        public_id REGEXP '^tournament_race_result\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$'
    ),
    CONSTRAINT ck_tournament_race_result_created CHECK (
        first_created_at_ms <= 253402300799999
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE tournament_race_result_revisions (
    tournament_race_result_revision_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_race_result_id BIGINT UNSIGNED NOT NULL,
    revision_number BIGINT UNSIGNED NOT NULL,
    schema_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    race_number BIGINT UNSIGNED NOT NULL,
    scoring_segment BIGINT UNSIGNED NOT NULL,
    mode_cc SMALLINT UNSIGNED NULL,
    track_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    counts_toward_standings BOOLEAN NOT NULL,
    scoring_note VARCHAR(240) NULL,
    observed_stage_label VARCHAR(96) NULL,
    observed_group_label VARCHAR(96) NULL,
    source_kind VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    source_transport VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    producer_version VARCHAR(64) NULL,
    local_record_id VARCHAR(128) NULL,
    session_id VARCHAR(128) NULL,
    stream_id VARCHAR(128) NULL,
    source_media_id VARCHAR(128) NULL,
    race_offset_ms BIGINT UNSIGNED NULL,
    frame_index BIGINT UNSIGNED NULL,
    occurred_at_ms BIGINT UNSIGNED NULL,
    captured_at_ms BIGINT UNSIGNED NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    submitted_at_ms BIGINT UNSIGNED NULL,
    verification_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    verification_method VARCHAR(128) NULL,
    verification_confidence DOUBLE NULL,
    confidence_track DOUBLE NULL,
    confidence_player_count DOUBLE NULL,
    confidence_finish_positions DOUBLE NULL,
    confidence_player_names DOUBLE NULL,
    confidence_characters DOUBLE NULL,
    confidence_race_points DOUBLE NULL,
    confidence_total_scores DOUBLE NULL,
    PRIMARY KEY (tournament_race_result_revision_id),
    UNIQUE KEY uq_tournament_race_result_revision (
        tournament_race_result_id,
        revision_number
    ),
    KEY ix_tournament_race_track_number (track_id, race_number),
    CONSTRAINT fk_tournament_race_revision_result
        FOREIGN KEY (tournament_race_result_id)
        REFERENCES tournament_race_results (tournament_race_result_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_tournament_race_revision_number CHECK (revision_number >= 1),
    CONSTRAINT ck_tournament_race_schema_version CHECK (
        schema_version = 'mk8dx.tournament-race-result.v1'
    ),
    CONSTRAINT ck_tournament_race_numbers CHECK (
        race_number >= 1 AND scoring_segment >= 1
    ),
    CONSTRAINT ck_tournament_race_mode CHECK (
        mode_cc IS NULL OR mode_cc IN (150, 200)
    ),
    CONSTRAINT ck_tournament_race_track_id CHECK (
        track_id REGEXP '^track\.[a-z0-9]+(_[a-z0-9]+)*$'
    ),
    CONSTRAINT ck_tournament_race_counts CHECK (
        counts_toward_standings IN (0, 1)
    ),
    CONSTRAINT ck_tournament_race_scoring_note CHECK (
        (counts_toward_standings = 1)
        OR (scoring_note IS NOT NULL AND CHAR_LENGTH(scoring_note) >= 1)
    ),
    CONSTRAINT ck_tournament_race_context_labels CHECK (
        (observed_stage_label IS NULL OR CHAR_LENGTH(observed_stage_label) >= 1)
        AND (observed_group_label IS NULL OR CHAR_LENGTH(observed_group_label) >= 1)
    ),
    CONSTRAINT ck_tournament_race_source CHECK (
        source_kind IN (
            'tournament_recorded_video',
            'tournament_live_capture',
            'tournament_spreadsheet_import'
        )
        AND (
            source_transport IS NULL
            OR source_transport IN ('native_contract', 'excel_workbook', 'csv')
        )
    ),
    CONSTRAINT ck_tournament_race_source_text CHECK (
        (producer_version IS NULL OR CHAR_LENGTH(producer_version) >= 1)
        AND (local_record_id IS NULL OR CHAR_LENGTH(local_record_id) >= 1)
        AND (session_id IS NULL OR CHAR_LENGTH(session_id) >= 1)
        AND (stream_id IS NULL OR CHAR_LENGTH(stream_id) >= 1)
        AND (source_media_id IS NULL OR CHAR_LENGTH(source_media_id) >= 1)
    ),
    CONSTRAINT ck_tournament_race_timestamps CHECK (
        created_at_ms <= 253402300799999
        AND (occurred_at_ms IS NULL OR occurred_at_ms <= 253402300799999)
        AND (captured_at_ms IS NULL OR captured_at_ms <= 253402300799999)
        AND (submitted_at_ms IS NULL OR submitted_at_ms <= 253402300799999)
    ),
    CONSTRAINT ck_tournament_race_verification_status CHECK (
        verification_status IS NULL OR verification_status IN (
            'not_checked', 'producer_check_passed',
            'producer_check_failed', 'needs_review'
        )
    ),
    CONSTRAINT ck_tournament_race_verification_presence CHECK (
        verification_status IS NOT NULL
        OR (
            verification_method IS NULL
            AND verification_confidence IS NULL
            AND confidence_track IS NULL
            AND confidence_player_count IS NULL
            AND confidence_finish_positions IS NULL
            AND confidence_player_names IS NULL
            AND confidence_characters IS NULL
            AND confidence_race_points IS NULL
            AND confidence_total_scores IS NULL
        )
    ),
    CONSTRAINT ck_tournament_race_verification_method CHECK (
        verification_method IS NULL OR CHAR_LENGTH(verification_method) >= 1
    ),
    CONSTRAINT ck_tournament_race_confidence CHECK (
        (verification_confidence IS NULL OR verification_confidence BETWEEN 0 AND 1)
        AND (confidence_track IS NULL OR confidence_track BETWEEN 0 AND 1)
        AND (confidence_player_count IS NULL OR confidence_player_count BETWEEN 0 AND 1)
        AND (confidence_finish_positions IS NULL OR confidence_finish_positions BETWEEN 0 AND 1)
        AND (confidence_player_names IS NULL OR confidence_player_names BETWEEN 0 AND 1)
        AND (confidence_characters IS NULL OR confidence_characters BETWEEN 0 AND 1)
        AND (confidence_race_points IS NULL OR confidence_race_points BETWEEN 0 AND 1)
        AND (confidence_total_scores IS NULL OR confidence_total_scores BETWEEN 0 AND 1)
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE tournament_race_placements (
    tournament_race_placement_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_race_result_revision_id BIGINT UNSIGNED NOT NULL,
    finish_position TINYINT UNSIGNED NOT NULL,
    participant_reference_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    player_id BIGINT UNSIGNED NULL,
    observed_player_name VARCHAR(64) NULL,
    character_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
    character_variant_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
    race_points BIGINT UNSIGNED NOT NULL,
    total_before_race BIGINT UNSIGNED NOT NULL,
    total_after_race BIGINT UNSIGNED NOT NULL,
    rank_after_race TINYINT UNSIGNED NOT NULL,
    confidence_finish_position DOUBLE NULL,
    confidence_player_name DOUBLE NULL,
    confidence_character DOUBLE NULL,
    confidence_race_points DOUBLE NULL,
    confidence_total_after_race DOUBLE NULL,
    PRIMARY KEY (tournament_race_placement_id),
    UNIQUE KEY uq_tournament_race_finish_position (
        tournament_race_result_revision_id,
        finish_position
    ),
    UNIQUE KEY uq_tournament_race_central_player (
        tournament_race_result_revision_id,
        player_id
    ),
    KEY ix_tournament_race_placement_player (player_id),
    CONSTRAINT fk_tournament_race_placement_revision
        FOREIGN KEY (tournament_race_result_revision_id)
        REFERENCES tournament_race_result_revisions (
            tournament_race_result_revision_id
        ) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_tournament_race_placement_player FOREIGN KEY (player_id)
        REFERENCES players (player_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_tournament_race_finish_position CHECK (
        finish_position BETWEEN 1 AND 12
    ),
    CONSTRAINT ck_tournament_race_participant CHECK (
        (participant_reference_kind = 'player' AND player_id IS NOT NULL)
        OR
        (participant_reference_kind = 'restricted_reference' AND player_id IS NULL)
    ),
    CONSTRAINT ck_tournament_race_observed_name CHECK (
        observed_player_name IS NULL OR CHAR_LENGTH(observed_player_name) >= 1
    ),
    CONSTRAINT ck_tournament_race_character_id CHECK (
        character_id IS NULL
        OR character_id REGEXP '^character\.[a-z0-9]+(_[a-z0-9]+)*$'
    ),
    CONSTRAINT ck_tournament_race_character_variant CHECK (
        character_variant_id IS NULL
        OR (
            character_id IS NOT NULL
            AND character_variant_id REGEXP '^character_variant\.[a-z0-9]+(_[a-z0-9]+)*\.[0-9]{3}_[a-z0-9]+(_[a-z0-9]+)*$'
        )
    ),
    CONSTRAINT ck_tournament_race_rank CHECK (rank_after_race BETWEEN 1 AND 12),
    CONSTRAINT ck_tournament_race_placement_confidence CHECK (
        (confidence_finish_position IS NULL OR confidence_finish_position BETWEEN 0 AND 1)
        AND (confidence_player_name IS NULL OR confidence_player_name BETWEEN 0 AND 1)
        AND (confidence_character IS NULL OR confidence_character BETWEEN 0 AND 1)
        AND (confidence_race_points IS NULL OR confidence_race_points BETWEEN 0 AND 1)
        AND (confidence_total_after_race IS NULL OR confidence_total_after_race BETWEEN 0 AND 1)
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE restricted_tournament_race_data (
    tournament_restricted_data_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_race_result_revision_id BIGINT UNSIGNED NULL,
    tournament_race_placement_id BIGINT UNSIGNED NULL,
    data_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    sequence_number TINYINT UNSIGNED NULL,
    subtype VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    reference_namespace VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    lookup_hmac BINARY(32) NULL,
    lookup_key_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    value_ciphertext VARBINARY(2048) NOT NULL,
    encryption_key_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    sha256 BINARY(32) NULL,
    media_type VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    revision_sequence_key TINYINT UNSIGNED GENERATED ALWAYS AS (
        IF(
            data_kind IN ('evidence_reference', 'verification_issue'),
            sequence_number,
            NULL
        )
    ) STORED,
    revision_subtype_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin
        GENERATED ALWAYS AS (
            IF(data_kind = 'context_reference', subtype, NULL)
        ) STORED,
    PRIMARY KEY (tournament_restricted_data_id),
    UNIQUE KEY uq_tournament_restricted_revision_sequence (
        tournament_race_result_revision_id,
        data_kind,
        revision_sequence_key
    ),
    UNIQUE KEY uq_tournament_restricted_revision_subtype (
        tournament_race_result_revision_id,
        data_kind,
        revision_subtype_key
    ),
    UNIQUE KEY uq_tournament_restricted_placement_item (
        tournament_race_placement_id,
        data_kind
    ),
    UNIQUE KEY uq_tournament_restricted_participant_reference (
        tournament_race_result_revision_id,
        data_kind,
        subtype,
        lookup_key_version,
        lookup_hmac
    ),
    KEY ix_tournament_restricted_lookup (
        data_kind,
        reference_namespace,
        lookup_key_version,
        lookup_hmac
    ),
    CONSTRAINT fk_tournament_restricted_revision
        FOREIGN KEY (tournament_race_result_revision_id)
        REFERENCES tournament_race_result_revisions (
            tournament_race_result_revision_id
        ) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_tournament_restricted_placement
        FOREIGN KEY (tournament_race_placement_id)
        REFERENCES tournament_race_placements (tournament_race_placement_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_tournament_restricted_shape CHECK (
        (
            data_kind = 'participant_reference'
            AND tournament_race_result_revision_id IS NOT NULL
            AND tournament_race_placement_id IS NOT NULL
            AND sequence_number IS NULL
            AND subtype IN (
                'tournament_manager_player',
                'producer_local_player',
                'unresolved_observation'
            )
            AND reference_namespace IS NULL
            AND lookup_hmac IS NOT NULL
            AND lookup_key_version IS NOT NULL
            AND sha256 IS NULL
            AND media_type IS NULL
        )
        OR
        (
            data_kind = 'context_reference'
            AND tournament_race_result_revision_id IS NOT NULL
            AND tournament_race_placement_id IS NULL
            AND sequence_number IS NULL
            AND subtype IN ('tournament', 'stage', 'group')
            AND reference_namespace REGEXP '^[a-z][a-z0-9_]{1,63}$'
            AND lookup_hmac IS NOT NULL
            AND lookup_key_version IS NOT NULL
            AND sha256 IS NULL
            AND media_type IS NULL
        )
        OR
        (
            data_kind = 'evidence_reference'
            AND tournament_race_result_revision_id IS NOT NULL
            AND tournament_race_placement_id IS NULL
            AND sequence_number BETWEEN 1 AND 16
            AND subtype IN (
                'race_score_screen', 'total_score_screen', 'video',
                'capture_session', 'workbook'
            )
            AND reference_namespace IS NULL
            AND lookup_hmac IS NULL
            AND lookup_key_version IS NULL
        )
        OR
        (
            data_kind = 'verification_issue'
            AND tournament_race_result_revision_id IS NOT NULL
            AND tournament_race_placement_id IS NULL
            AND sequence_number BETWEEN 1 AND 32
            AND subtype REGEXP '^[a-z][a-z0-9_.-]{1,63}$'
            AND reference_namespace IS NULL
            AND lookup_hmac IS NULL
            AND lookup_key_version IS NULL
            AND sha256 IS NULL
            AND media_type IS NULL
        )
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE restricted_identity_access_log
    ADD COLUMN tournament_restricted_data_id BIGINT UNSIGNED NULL
        AFTER time_trial_evidence_id,
    ADD KEY ix_identity_access_tournament_data (tournament_restricted_data_id),
    ADD CONSTRAINT fk_identity_access_tournament_data
        FOREIGN KEY (tournament_restricted_data_id)
        REFERENCES restricted_tournament_race_data (tournament_restricted_data_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE restricted_identity_access_log
    DROP CONSTRAINT ck_identity_access_resource,
    ADD CONSTRAINT ck_identity_access_resource CHECK (
        (resource_type = 'claim_evidence'
            AND claim_evidence_id IS NOT NULL AND claim_review_id IS NULL
            AND legacy_identifier_id IS NULL AND authentication_binding_id IS NULL
            AND time_trial_participant_reference_id IS NULL
            AND time_trial_evidence_id IS NULL AND tournament_restricted_data_id IS NULL)
        OR
        (resource_type = 'claim_review'
            AND claim_evidence_id IS NULL AND claim_review_id IS NOT NULL
            AND legacy_identifier_id IS NULL AND authentication_binding_id IS NULL
            AND time_trial_participant_reference_id IS NULL
            AND time_trial_evidence_id IS NULL AND tournament_restricted_data_id IS NULL)
        OR
        (resource_type = 'legacy_identifier'
            AND claim_evidence_id IS NULL AND claim_review_id IS NULL
            AND legacy_identifier_id IS NOT NULL AND authentication_binding_id IS NULL
            AND time_trial_participant_reference_id IS NULL
            AND time_trial_evidence_id IS NULL AND tournament_restricted_data_id IS NULL)
        OR
        (resource_type = 'authentication_binding'
            AND claim_evidence_id IS NULL AND claim_review_id IS NULL
            AND legacy_identifier_id IS NULL AND authentication_binding_id IS NOT NULL
            AND time_trial_participant_reference_id IS NULL
            AND time_trial_evidence_id IS NULL AND tournament_restricted_data_id IS NULL)
        OR
        (resource_type = 'time_trial_participant_reference'
            AND claim_evidence_id IS NULL AND claim_review_id IS NULL
            AND legacy_identifier_id IS NULL AND authentication_binding_id IS NULL
            AND time_trial_participant_reference_id IS NOT NULL
            AND time_trial_evidence_id IS NULL AND tournament_restricted_data_id IS NULL)
        OR
        (resource_type = 'time_trial_evidence'
            AND claim_evidence_id IS NULL AND claim_review_id IS NULL
            AND legacy_identifier_id IS NULL AND authentication_binding_id IS NULL
            AND time_trial_participant_reference_id IS NULL
            AND time_trial_evidence_id IS NOT NULL AND tournament_restricted_data_id IS NULL)
        OR
        (resource_type = 'tournament_restricted_data'
            AND claim_evidence_id IS NULL AND claim_review_id IS NULL
            AND legacy_identifier_id IS NULL AND authentication_binding_id IS NULL
            AND time_trial_participant_reference_id IS NULL
            AND time_trial_evidence_id IS NULL AND tournament_restricted_data_id IS NOT NULL)
    );
