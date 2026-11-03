CREATE TABLE notification_producer_jobs (
    notification_producer_job_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    producer_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    time_trial_publication_id BIGINT UNSIGNED NOT NULL,
    publication_revision BIGINT UNSIGNED NOT NULL,
    job_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
    next_attempt_at_ms BIGINT UNSIGNED NOT NULL,
    claimed_at_ms BIGINT UNSIGNED NULL,
    completed_at_ms BIGINT UNSIGNED NULL,
    last_error_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (notification_producer_job_id),
    UNIQUE KEY uq_notification_producer_job_source (
        producer_kind, time_trial_publication_id, publication_revision
    ),
    KEY ix_notification_producer_job_due (
        job_status, next_attempt_at_ms, notification_producer_job_id
    ),
    CONSTRAINT fk_notification_producer_job_publication
        FOREIGN KEY (time_trial_publication_id)
        REFERENCES time_trial_publications (time_trial_publication_id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT ck_notification_producer_job_kind CHECK (
        producer_kind = 'overtaken'
    ),
    CONSTRAINT ck_notification_producer_job_status CHECK (
        job_status IN ('pending', 'processing', 'retry', 'completed', 'dead')
    ),
    CONSTRAINT ck_notification_producer_job_attempts CHECK (
        attempt_count <= 5
    ),
    CONSTRAINT ck_notification_producer_job_completion CHECK (
        (job_status = 'completed' AND completed_at_ms IS NOT NULL)
        OR (job_status <> 'completed' AND completed_at_ms IS NULL)
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
