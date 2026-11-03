SET NAMES utf8mb4;

CREATE TABLE schema_migrations (
    migration_version VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    migration_name VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    up_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    applied_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (migration_version),
    UNIQUE KEY uq_schema_migrations_name (migration_name),
    CONSTRAINT ck_schema_migrations_version CHECK (
        migration_version REGEXP '^[0-9]{4}$'
    ),
    CONSTRAINT ck_schema_migrations_sha CHECK (
        up_sha256 REGEXP '^[0-9a-f]{64}$'
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
