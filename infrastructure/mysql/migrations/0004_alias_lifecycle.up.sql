CREATE TABLE alias_lifecycle (
    alias_lifecycle_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    alias_id BIGINT UNSIGNED NOT NULL,
    sequence_number BIGINT UNSIGNED NOT NULL,
    event_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    actor_user_account_id BIGINT UNSIGNED NOT NULL,
    visibility_after VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    record_status_after VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    reason_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    occurred_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (alias_lifecycle_id),
    UNIQUE KEY uq_alias_lifecycle_sequence (alias_id, sequence_number),
    KEY ix_alias_lifecycle_actor (actor_user_account_id),
    CONSTRAINT fk_alias_lifecycle_alias FOREIGN KEY (alias_id)
        REFERENCES aliases (alias_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_alias_lifecycle_actor FOREIGN KEY (actor_user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_alias_lifecycle_sequence CHECK (sequence_number >= 1),
    CONSTRAINT ck_alias_lifecycle_event CHECK (
        event_type IN (
            'alias_baseline_imported', 'alias_created',
            'visibility_changed', 'alias_retired'
        )
    ),
    CONSTRAINT ck_alias_lifecycle_visibility CHECK (
        visibility_after IN ('public', 'restricted')
    ),
    CONSTRAINT ck_alias_lifecycle_status CHECK (
        record_status_after IN ('active', 'retired')
    ),
    CONSTRAINT ck_alias_lifecycle_event_state CHECK (
        event_type <> 'alias_retired' OR record_status_after = 'retired'
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO alias_lifecycle (
    alias_id, sequence_number, event_type, actor_user_account_id,
    visibility_after, record_status_after, reason_code, occurred_at_ms
)
SELECT
    alias_id, 1, 'alias_baseline_imported', reviewed_by_user_account_id,
    visibility, record_status, 'migration_0004_baseline', reviewed_at_ms
FROM aliases;
