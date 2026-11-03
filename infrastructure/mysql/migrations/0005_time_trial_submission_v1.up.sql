CREATE TABLE time_trial_submissions (
    time_trial_submission_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id VARCHAR(149) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    first_created_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (time_trial_submission_id),
    UNIQUE KEY uq_time_trial_submissions_public_id (public_id),
    CONSTRAINT ck_time_trial_submission_public_id CHECK (
        public_id REGEXP '^user_submission\\.time\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$'
    ),
    CONSTRAINT ck_time_trial_submission_created CHECK (
        first_created_at_ms <= 253402300799999
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE time_trial_submission_revisions (
    time_trial_submission_revision_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    time_trial_submission_id BIGINT UNSIGNED NOT NULL,
    revision_number BIGINT UNSIGNED NOT NULL,
    schema_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    mode_cc SMALLINT UNSIGNED NOT NULL,
    track_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    total_time_ms INT UNSIGNED NOT NULL,
    participant_reference_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    player_id BIGINT UNSIGNED NULL,
    observed_player_name VARCHAR(64) NULL,
    character_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
    character_variant_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
    body_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
    body_variant_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
    tire_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
    glider_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
    glider_variant_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
    country_id VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NULL,
    source_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    producer_version VARCHAR(64) NULL,
    local_record_id VARCHAR(128) NULL,
    occurred_at_ms BIGINT UNSIGNED NULL,
    captured_at_ms BIGINT UNSIGNED NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    submitted_at_ms BIGINT UNSIGNED NULL,
    verification_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    verification_method VARCHAR(128) NULL,
    verification_lap_sum_matches BOOLEAN NULL,
    verification_confidence DOUBLE NULL,
    confidence_total_time DOUBLE NULL,
    confidence_track DOUBLE NULL,
    confidence_character DOUBLE NULL,
    confidence_character_variant DOUBLE NULL,
    confidence_body DOUBLE NULL,
    confidence_tire DOUBLE NULL,
    confidence_glider DOUBLE NULL,
    confidence_country DOUBLE NULL,
    confidence_player_name DOUBLE NULL,
    PRIMARY KEY (time_trial_submission_revision_id),
    UNIQUE KEY uq_time_trial_submission_revision (
        time_trial_submission_id,
        revision_number
    ),
    KEY ix_time_trial_revision_player (player_id),
    KEY ix_time_trial_revision_track_mode_time (track_id, mode_cc, total_time_ms),
    CONSTRAINT fk_time_trial_revision_submission
        FOREIGN KEY (time_trial_submission_id)
        REFERENCES time_trial_submissions (time_trial_submission_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_time_trial_revision_player FOREIGN KEY (player_id)
        REFERENCES players (player_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_time_trial_revision_number CHECK (revision_number >= 1),
    CONSTRAINT ck_time_trial_schema_version CHECK (
        schema_version = 'mk8dx.time-trial-submission.v1'
    ),
    CONSTRAINT ck_time_trial_mode CHECK (mode_cc IN (150, 200)),
    CONSTRAINT ck_time_trial_track_id CHECK (
        track_id REGEXP '^track\\.[a-z0-9]+(_[a-z0-9]+)*$'
    ),
    CONSTRAINT ck_time_trial_total_time CHECK (
        total_time_ms BETWEEN 1 AND 599999
    ),
    CONSTRAINT ck_time_trial_participant CHECK (
        (participant_reference_kind = 'player' AND player_id IS NOT NULL)
        OR
        (participant_reference_kind = 'restricted_reference' AND player_id IS NULL)
    ),
    CONSTRAINT ck_time_trial_observed_name CHECK (
        observed_player_name IS NULL OR CHAR_LENGTH(observed_player_name) >= 1
    ),
    CONSTRAINT ck_time_trial_loadout CHECK (
        (character_variant_id IS NULL OR character_id IS NOT NULL)
        AND (body_variant_id IS NULL OR body_id IS NOT NULL)
        AND (glider_variant_id IS NULL OR glider_id IS NOT NULL)
    ),
    CONSTRAINT ck_time_trial_character_id CHECK (
        character_id IS NULL
        OR character_id REGEXP '^character\\.[a-z0-9]+(_[a-z0-9]+)*$'
    ),
    CONSTRAINT ck_time_trial_character_variant_id CHECK (
        character_variant_id IS NULL
        OR character_variant_id REGEXP '^character_variant\\.[a-z0-9]+(_[a-z0-9]+)*\\.[0-9]{3}_[a-z0-9]+(_[a-z0-9]+)*$'
    ),
    CONSTRAINT ck_time_trial_body_id CHECK (
        body_id IS NULL OR body_id REGEXP '^body\\.[a-z0-9]+(_[a-z0-9]+)*$'
    ),
    CONSTRAINT ck_time_trial_body_variant_id CHECK (
        body_variant_id IS NULL
        OR body_variant_id REGEXP '^body_variant\\.[a-z0-9]+(_[a-z0-9]+)*\\.[0-9]{3}_[a-z0-9]+(_[a-z0-9]+)*$'
    ),
    CONSTRAINT ck_time_trial_tire_id CHECK (
        tire_id IS NULL OR tire_id REGEXP '^tire\\.[a-z0-9]+(_[a-z0-9]+)*$'
    ),
    CONSTRAINT ck_time_trial_glider_id CHECK (
        glider_id IS NULL OR glider_id REGEXP '^glider\\.[a-z0-9]+(_[a-z0-9]+)*$'
    ),
    CONSTRAINT ck_time_trial_glider_variant_id CHECK (
        glider_variant_id IS NULL
        OR glider_variant_id REGEXP '^glider_variant\\.[a-z0-9]+(_[a-z0-9]+)*\\.[0-9]{3}_[a-z0-9]+(_[a-z0-9]+)*$'
    ),
    CONSTRAINT ck_time_trial_country_id CHECK (
        country_id IS NULL OR country_id REGEXP '^country\\.[a-z]{2}$'
    ),
    CONSTRAINT ck_time_trial_source CHECK (
        source_kind IN (
            'web_manual', 'android_manual', 'android_scan',
            'livetrial_capture', 'livetrial_recorded_video'
        )
    ),
    CONSTRAINT ck_time_trial_source_text CHECK (
        (producer_version IS NULL OR CHAR_LENGTH(producer_version) >= 1)
        AND (local_record_id IS NULL OR CHAR_LENGTH(local_record_id) >= 1)
    ),
    CONSTRAINT ck_time_trial_timestamps CHECK (
        created_at_ms <= 253402300799999
        AND (occurred_at_ms IS NULL OR occurred_at_ms <= 253402300799999)
        AND (captured_at_ms IS NULL OR captured_at_ms <= 253402300799999)
        AND (submitted_at_ms IS NULL OR submitted_at_ms <= 253402300799999)
    ),
    CONSTRAINT ck_time_trial_verification_status CHECK (
        verification_status IS NULL OR verification_status IN (
            'not_checked', 'producer_check_passed',
            'producer_check_failed', 'needs_review'
        )
    ),
    CONSTRAINT ck_time_trial_verification_presence CHECK (
        verification_status IS NOT NULL
        OR (
            verification_method IS NULL
            AND verification_lap_sum_matches IS NULL
            AND verification_confidence IS NULL
            AND confidence_total_time IS NULL
            AND confidence_track IS NULL
            AND confidence_character IS NULL
            AND confidence_character_variant IS NULL
            AND confidence_body IS NULL
            AND confidence_tire IS NULL
            AND confidence_glider IS NULL
            AND confidence_country IS NULL
            AND confidence_player_name IS NULL
        )
    ),
    CONSTRAINT ck_time_trial_verification_method CHECK (
        verification_method IS NULL OR CHAR_LENGTH(verification_method) >= 1
    ),
    CONSTRAINT ck_time_trial_verification_boolean CHECK (
        verification_lap_sum_matches IS NULL
        OR verification_lap_sum_matches IN (0, 1)
    ),
    CONSTRAINT ck_time_trial_confidence CHECK (
        (verification_confidence IS NULL OR verification_confidence BETWEEN 0 AND 1)
        AND (confidence_total_time IS NULL OR confidence_total_time BETWEEN 0 AND 1)
        AND (confidence_track IS NULL OR confidence_track BETWEEN 0 AND 1)
        AND (confidence_character IS NULL OR confidence_character BETWEEN 0 AND 1)
        AND (confidence_character_variant IS NULL OR confidence_character_variant BETWEEN 0 AND 1)
        AND (confidence_body IS NULL OR confidence_body BETWEEN 0 AND 1)
        AND (confidence_tire IS NULL OR confidence_tire BETWEEN 0 AND 1)
        AND (confidence_glider IS NULL OR confidence_glider BETWEEN 0 AND 1)
        AND (confidence_country IS NULL OR confidence_country BETWEEN 0 AND 1)
        AND (confidence_player_name IS NULL OR confidence_player_name BETWEEN 0 AND 1)
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE time_trial_laps (
    time_trial_lap_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    time_trial_submission_revision_id BIGINT UNSIGNED NOT NULL,
    lap_number TINYINT UNSIGNED NOT NULL,
    time_ms INT UNSIGNED NOT NULL,
    coins_collected TINYINT UNSIGNED NULL,
    mushrooms_used TINYINT UNSIGNED NULL,
    confidence DOUBLE NULL,
    PRIMARY KEY (time_trial_lap_id),
    UNIQUE KEY uq_time_trial_lap_number (
        time_trial_submission_revision_id,
        lap_number
    ),
    CONSTRAINT fk_time_trial_lap_revision
        FOREIGN KEY (time_trial_submission_revision_id)
        REFERENCES time_trial_submission_revisions (time_trial_submission_revision_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_time_trial_lap_number CHECK (lap_number BETWEEN 1 AND 7),
    CONSTRAINT ck_time_trial_lap_time CHECK (time_ms BETWEEN 1 AND 599999),
    CONSTRAINT ck_time_trial_lap_coins CHECK (
        coins_collected IS NULL OR coins_collected BETWEEN 0 AND 10
    ),
    CONSTRAINT ck_time_trial_lap_mushrooms CHECK (
        mushrooms_used IS NULL OR mushrooms_used BETWEEN 0 AND 3
    ),
    CONSTRAINT ck_time_trial_lap_confidence CHECK (
        confidence IS NULL OR confidence BETWEEN 0 AND 1
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE restricted_time_trial_participant_references (
    time_trial_participant_reference_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    time_trial_submission_revision_id BIGINT UNSIGNED NOT NULL,
    reference_namespace VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    lookup_hmac BINARY(32) NOT NULL,
    lookup_key_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    reference_ciphertext VARBINARY(1024) NOT NULL,
    encryption_key_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY (time_trial_participant_reference_id),
    UNIQUE KEY uq_time_trial_participant_revision (time_trial_submission_revision_id),
    KEY ix_time_trial_participant_lookup (
        reference_namespace,
        lookup_key_version,
        lookup_hmac
    ),
    CONSTRAINT fk_time_trial_participant_revision
        FOREIGN KEY (time_trial_submission_revision_id)
        REFERENCES time_trial_submission_revisions (time_trial_submission_revision_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_time_trial_participant_namespace CHECK (
        reference_namespace IN (
            'legacy_firebase_user',
            'producer_local_profile',
            'unresolved_observation'
        )
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE restricted_time_trial_evidence (
    time_trial_evidence_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    time_trial_submission_revision_id BIGINT UNSIGNED NOT NULL,
    sequence_number TINYINT UNSIGNED NOT NULL,
    evidence_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    reference_ciphertext VARBINARY(2048) NOT NULL,
    encryption_key_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    sha256 BINARY(32) NULL,
    media_type VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    PRIMARY KEY (time_trial_evidence_id),
    UNIQUE KEY uq_time_trial_evidence_sequence (
        time_trial_submission_revision_id,
        sequence_number
    ),
    CONSTRAINT fk_time_trial_evidence_revision
        FOREIGN KEY (time_trial_submission_revision_id)
        REFERENCES time_trial_submission_revisions (time_trial_submission_revision_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_time_trial_evidence_sequence CHECK (
        sequence_number BETWEEN 1 AND 8
    ),
    CONSTRAINT ck_time_trial_evidence_kind CHECK (
        evidence_kind IN ('screenshot', 'video', 'capture_session', 'scan_result')
    ),
    CONSTRAINT ck_time_trial_evidence_media_type CHECK (
        media_type IS NULL OR media_type REGEXP '^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$'
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE restricted_identity_access_log
    ADD COLUMN time_trial_participant_reference_id BIGINT UNSIGNED NULL
        AFTER authentication_binding_id,
    ADD COLUMN time_trial_evidence_id BIGINT UNSIGNED NULL
        AFTER time_trial_participant_reference_id,
    ADD KEY ix_identity_access_tt_participant (time_trial_participant_reference_id),
    ADD KEY ix_identity_access_tt_evidence (time_trial_evidence_id),
    ADD CONSTRAINT fk_identity_access_tt_participant
        FOREIGN KEY (time_trial_participant_reference_id)
        REFERENCES restricted_time_trial_participant_references (
            time_trial_participant_reference_id
        ) ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT fk_identity_access_tt_evidence
        FOREIGN KEY (time_trial_evidence_id)
        REFERENCES restricted_time_trial_evidence (time_trial_evidence_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE restricted_identity_access_log
    DROP CONSTRAINT ck_identity_access_resource,
    ADD CONSTRAINT ck_identity_access_resource CHECK (
        (resource_type = 'claim_evidence'
            AND claim_evidence_id IS NOT NULL
            AND claim_review_id IS NULL
            AND legacy_identifier_id IS NULL
            AND authentication_binding_id IS NULL
            AND time_trial_participant_reference_id IS NULL
            AND time_trial_evidence_id IS NULL)
        OR
        (resource_type = 'claim_review'
            AND claim_evidence_id IS NULL
            AND claim_review_id IS NOT NULL
            AND legacy_identifier_id IS NULL
            AND authentication_binding_id IS NULL
            AND time_trial_participant_reference_id IS NULL
            AND time_trial_evidence_id IS NULL)
        OR
        (resource_type = 'legacy_identifier'
            AND claim_evidence_id IS NULL
            AND claim_review_id IS NULL
            AND legacy_identifier_id IS NOT NULL
            AND authentication_binding_id IS NULL
            AND time_trial_participant_reference_id IS NULL
            AND time_trial_evidence_id IS NULL)
        OR
        (resource_type = 'authentication_binding'
            AND claim_evidence_id IS NULL
            AND claim_review_id IS NULL
            AND legacy_identifier_id IS NULL
            AND authentication_binding_id IS NOT NULL
            AND time_trial_participant_reference_id IS NULL
            AND time_trial_evidence_id IS NULL)
        OR
        (resource_type = 'time_trial_participant_reference'
            AND claim_evidence_id IS NULL
            AND claim_review_id IS NULL
            AND legacy_identifier_id IS NULL
            AND authentication_binding_id IS NULL
            AND time_trial_participant_reference_id IS NOT NULL
            AND time_trial_evidence_id IS NULL)
        OR
        (resource_type = 'time_trial_evidence'
            AND claim_evidence_id IS NULL
            AND claim_review_id IS NULL
            AND legacy_identifier_id IS NULL
            AND authentication_binding_id IS NULL
            AND time_trial_participant_reference_id IS NULL
            AND time_trial_evidence_id IS NOT NULL)
    );
