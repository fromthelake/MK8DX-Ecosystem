-- 0056: what a grouped notification is actually made of.
--
-- `notifications` deliberately collapses: forty-nine broken World Records are
-- one unread row that counts them and points at the most recent track, because
-- forty-nine rows and forty-nine pushes would be a punishment rather than news.
-- The cost of that collapse was that the forty-eight it did not name were gone.
-- The row said how many, and nothing could say which.
--
-- This table keeps the members. One row per event that was folded into an
-- aggregate, so the entry can be opened and read: which track, which mode, who
-- did it, when. It is append-only and additive; nothing in the inbox depends on
-- it, so an entry aggregated before this table existed still reads correctly and
-- simply has no members to show.

CREATE TABLE notification_events (
    notification_event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    notification_id BIGINT UNSIGNED NOT NULL,
    occurred_at_ms BIGINT UNSIGNED NOT NULL,
    -- The same kind-specific facts the aggregate carries, at the moment of the
    -- single event rather than of the most recent one.
    actor_player_id BIGINT UNSIGNED NULL,
    track_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
    mode_cc SMALLINT UNSIGNED NULL,
    detail VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    actor_time_ms BIGINT UNSIGNED NULL,
    recipient_time_ms BIGINT UNSIGNED NULL,
    recipient_rank INT UNSIGNED NULL,
    PRIMARY KEY (notification_event_id),
    KEY ix_notification_events_notification (
        notification_id, occurred_at_ms, notification_event_id
    ),
    -- An inbox entry that is deleted takes its members with it: they describe
    -- that entry and have no meaning apart from it. The act itself is recorded
    -- elsewhere - `player_engagements`, `world_records`, the Time Trial - so
    -- nothing durable is lost with them.
    CONSTRAINT fk_notification_events_notification
        FOREIGN KEY (notification_id) REFERENCES notifications (notification_id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT fk_notification_events_actor
        FOREIGN KEY (actor_player_id) REFERENCES players (player_id),
    CONSTRAINT ck_notification_events_mode CHECK (
        mode_cc IS NULL OR mode_cc IN (150, 200)
    )
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
