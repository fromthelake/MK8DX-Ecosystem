-- 0021: aggregated user notifications.
--
-- One row is one aggregated notification for one user account: repeated
-- events with the same aggregation key collapse into the unread row
-- (event_count grows) instead of spamming; once read, a new event opens
-- a fresh unread row. The generated unread_dedupe column makes the
-- unread row unique per (account, aggregation key) while read history
-- rows never collide (NULLs are distinct in the unique index).
--
-- Kinds are a closed vocabulary. Rows carry only public product
-- references (players, tracks); never security or audit internals.

CREATE TABLE notifications (
    notification_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_account_id BIGINT UNSIGNED NOT NULL,
    notification_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    aggregation_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    actor_player_id BIGINT UNSIGNED NULL,
    track_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
    mode_cc SMALLINT UNSIGNED NULL,
    detail VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    event_count INT UNSIGNED NOT NULL DEFAULT 1,
    first_event_at_ms BIGINT UNSIGNED NOT NULL,
    last_event_at_ms BIGINT UNSIGNED NOT NULL,
    read_at_ms BIGINT UNSIGNED NULL,
    unread_dedupe VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin
        GENERATED ALWAYS AS (
            CASE WHEN read_at_ms IS NULL THEN aggregation_key ELSE NULL END
        ) STORED,
    PRIMARY KEY (notification_id),
    UNIQUE KEY uq_notifications_unread (user_account_id, unread_dedupe),
    KEY ix_notifications_account_recency (
        user_account_id, read_at_ms, last_event_at_ms
    ),
    CONSTRAINT fk_notifications_account FOREIGN KEY (user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_notifications_actor_player FOREIGN KEY (actor_player_id)
        REFERENCES players (player_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_notifications_kind CHECK (
        notification_kind IN (
            'time_beaten', 'reaction_received', 'claim_decided',
            'result_published'
        )
    ),
    CONSTRAINT ck_notifications_count CHECK (event_count >= 1),
    CONSTRAINT ck_notifications_mode CHECK (
        mode_cc IS NULL OR mode_cc IN (150, 200)
    ),
    CONSTRAINT ck_notifications_times CHECK (
        last_event_at_ms >= first_event_at_ms
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
