-- 0041: canonical competitive notifications and provider-neutral delivery.
--
-- The notification row is the durable personal event. Browser push and native
-- Android presentation are delivery projections of that row; they do not
-- invent their own competitive semantics.

ALTER TABLE notifications DROP CONSTRAINT ck_notifications_kind;

UPDATE notifications
SET notification_kind = 'overtaken',
    aggregation_key = CONCAT('overtaken|legacy|', notification_id)
WHERE notification_kind = 'time_beaten';

ALTER TABLE notifications
    ADD COLUMN actor_time_ms INT UNSIGNED NULL AFTER detail,
    ADD COLUMN recipient_time_ms INT UNSIGNED NULL AFTER actor_time_ms,
    ADD COLUMN recipient_rank INT UNSIGNED NULL AFTER recipient_time_ms,
    ADD CONSTRAINT ck_notifications_kind CHECK (
        notification_kind IN (
            'overtaken', 'reaction_received', 'claim_decided',
            'result_published', 'group_invited', 'group_joined',
            'group_left', 'group_removed', 'group_role_changed',
            'world_record'
        )
    ),
    ADD CONSTRAINT ck_notifications_competitive_values CHECK (
        (actor_time_ms IS NULL AND recipient_time_ms IS NULL AND
         recipient_rank IS NULL)
        OR
        (actor_time_ms BETWEEN 1 AND 599999 AND
         recipient_time_ms BETWEEN 1 AND 599999 AND
         actor_time_ms < recipient_time_ms AND recipient_rank >= 1)
    );

CREATE TABLE notification_preferences (
    user_account_id BIGINT UNSIGNED NOT NULL,
    competitive_overtaken BOOLEAN NOT NULL DEFAULT TRUE,
    activity_reactions BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (user_account_id),
    CONSTRAINT fk_notification_preferences_account
        FOREIGN KEY (user_account_id) REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE web_push_subscriptions (
    web_push_subscription_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_account_id BIGINT UNSIGNED NOT NULL,
    endpoint_sha256 BINARY(32) NOT NULL,
    subscription_ciphertext VARBINARY(4096) NOT NULL,
    encryption_key_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    revoked_at_ms BIGINT UNSIGNED NULL,
    active_endpoint_sha256 BINARY(32)
        GENERATED ALWAYS AS (
            CASE WHEN revoked_at_ms IS NULL THEN endpoint_sha256 ELSE NULL END
        ) STORED,
    PRIMARY KEY (web_push_subscription_id),
    UNIQUE KEY uq_web_push_active_endpoint (active_endpoint_sha256),
    KEY ix_web_push_account (user_account_id, revoked_at_ms),
    CONSTRAINT fk_web_push_subscription_account
        FOREIGN KEY (user_account_id) REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_web_push_subscription_times CHECK (
        revoked_at_ms IS NULL OR revoked_at_ms >= created_at_ms
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE notification_deliveries (
    notification_delivery_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    notification_id BIGINT UNSIGNED NOT NULL,
    web_push_subscription_id BIGINT UNSIGNED NOT NULL,
    event_revision INT UNSIGNED NOT NULL,
    delivery_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    attempt_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    next_attempt_at_ms BIGINT UNSIGNED NOT NULL,
    last_attempt_at_ms BIGINT UNSIGNED NULL,
    delivered_at_ms BIGINT UNSIGNED NULL,
    last_error_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    PRIMARY KEY (notification_delivery_id),
    UNIQUE KEY uq_notification_delivery_target_revision (
        notification_id, web_push_subscription_id, event_revision
    ),
    KEY ix_notification_delivery_due (delivery_status, next_attempt_at_ms),
    CONSTRAINT fk_notification_delivery_notification
        FOREIGN KEY (notification_id) REFERENCES notifications (notification_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_notification_delivery_subscription
        FOREIGN KEY (web_push_subscription_id)
        REFERENCES web_push_subscriptions (web_push_subscription_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_notification_delivery_status CHECK (
        delivery_status IN ('pending', 'processing', 'retry', 'delivered', 'dead')
    ),
    CONSTRAINT ck_notification_delivery_revision CHECK (event_revision >= 1),
    CONSTRAINT ck_notification_delivery_attempts CHECK (attempt_count <= 8)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
