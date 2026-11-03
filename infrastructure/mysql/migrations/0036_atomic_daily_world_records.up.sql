-- 0036: complete, atomic daily mkwrs snapshots for both engine classes.
CREATE TABLE world_records (
    mode_cc SMALLINT UNSIGNED NOT NULL,
    track_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    total_time_ms INT UNSIGNED NOT NULL,
    player_name VARCHAR(384) NOT NULL,
    nation_name VARCHAR(96) NULL,
    record_date DATE NOT NULL,
    duration_days INT UNSIGNED NOT NULL,
    character_name VARCHAR(96) NOT NULL,
    body_name VARCHAR(96) NOT NULL,
    tire_name VARCHAR(96) NOT NULL,
    glider_name VARCHAR(96) NOT NULL,
    video_url VARCHAR(512) NULL,
    lap_times_json JSON NOT NULL,
    coins_per_lap_json JSON NOT NULL,
    mushrooms_per_lap_json JSON NOT NULL,
    holders_json JSON NOT NULL,
    source_url VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    imported_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (mode_cc, track_id),
    CONSTRAINT ck_world_records_mode CHECK (mode_cc IN (150, 200)),
    CONSTRAINT ck_world_records_time CHECK (total_time_ms > 0),
    CONSTRAINT ck_world_records_laps CHECK (JSON_LENGTH(lap_times_json) IN (3, 7)),
    CONSTRAINT ck_world_records_coins CHECK (JSON_LENGTH(coins_per_lap_json) = JSON_LENGTH(lap_times_json)),
    CONSTRAINT ck_world_records_mushrooms CHECK (JSON_LENGTH(mushrooms_per_lap_json) = JSON_LENGTH(lap_times_json)),
    CONSTRAINT ck_world_records_holders CHECK (JSON_TYPE(holders_json) = 'ARRAY' AND JSON_LENGTH(holders_json) BETWEEN 1 AND 3)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE world_record_import_runs (
    world_record_import_run_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    imported_at_ms BIGINT UNSIGNED NOT NULL,
    records_150 INT UNSIGNED NOT NULL,
    records_200 INT UNSIGNED NOT NULL,
    changed_records INT UNSIGNED NOT NULL,
    PRIMARY KEY (world_record_import_run_id),
    KEY ix_world_record_import_recency (imported_at_ms),
    CONSTRAINT ck_world_record_import_complete CHECK (records_150 = 96 AND records_200 = 96)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
