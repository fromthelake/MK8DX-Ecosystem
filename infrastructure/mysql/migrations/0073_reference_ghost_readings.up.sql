-- 0072: what LiveTrial read from a Nintendo staff ghost or a World Record ghost (ADR-0212).
--
-- One row per reference: the kind, track, class and exact total identify the ghost, so a newer
-- World Record is a new row and the old one stays as it was read. The first proven reading fills
-- the row; a later one either completes it (a replay adds coins, mushrooms and events to laps read
-- from the panel), confirms it, or is kept beside it as a conflict without changing it. Coins are
-- per-lap gains, as mkwrs and the staff splits count them. The sending account is kept for
-- accountability and never published.
CREATE TABLE reference_ghost_readings (
    reference_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    mode_cc SMALLINT UNSIGNED NOT NULL,
    track_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    total_time_ms INT UNSIGNED NOT NULL,
    observed_name VARCHAR(96) NOT NULL,
    country_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    character_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NULL,
    body_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NULL,
    tire_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NULL,
    glider_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NULL,
    lap_times_json JSON NOT NULL,
    coins_per_lap_json JSON NULL,
    mushrooms_per_lap_json JSON NULL,
    events_json JSON NULL,
    reading_source VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    confirmation_count INT UNSIGNED NOT NULL DEFAULT 0,
    conflict_count INT UNSIGNED NOT NULL DEFAULT 0,
    last_conflict_json JSON NULL,
    last_conflict_at_ms BIGINT UNSIGNED NULL,
    first_user_account_id BIGINT UNSIGNED NOT NULL,
    first_read_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (reference_kind, mode_cc, track_id, total_time_ms),
    KEY ix_reference_ghost_readings_track (track_id, mode_cc),
    CONSTRAINT fk_reference_ghost_reading_account
        FOREIGN KEY (first_user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_reference_ghost_reading_kind CHECK (
        reference_kind IN ('nintendo_staff', 'world_record')
    ),
    CONSTRAINT ck_reference_ghost_reading_mode CHECK (mode_cc IN (150, 200)),
    CONSTRAINT ck_reference_ghost_reading_source CHECK (
        reading_source IN ('ghost_panel', 'ghost_replay')
    ),
    CONSTRAINT ck_reference_ghost_reading_total CHECK (total_time_ms > 0)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
