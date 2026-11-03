-- Reference snapshots are applied deliberately after schema migration.
CREATE TABLE reference_seed_versions (
    seed_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    seed_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    seed_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    applied_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (seed_kind),
    CONSTRAINT ck_reference_seed_kind CHECK (seed_kind IN ('nintendo_staff', 'world_records'))
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE reference_seed_rows (
    seed_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    record_key VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    row_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY (seed_kind, record_key),
    CONSTRAINT fk_reference_seed_row_kind FOREIGN KEY (seed_kind)
        REFERENCES reference_seed_versions (seed_kind) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
