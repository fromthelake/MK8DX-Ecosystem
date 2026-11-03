-- 0055: Player-to-Player engagement, and the limits that keep it friendly.
--
-- A poke is the first of a small family: a poke now, then rock-paper-scissors,
-- a dice roll and a "beat my time" challenge. They share one table, one
-- acceptance setting and one per-recipient budget, because the thing that makes
-- them fun is also the thing that makes them a nuisance at volume.
--
-- `engagement_accept_scope` says who may reach a Player at all: everyone, only
-- the Players they have marked as rivals, or nobody. It is deliberately its own
-- setting rather than a reuse of notification_scope: what you want delivered and
-- who you want to hear from are different questions.

ALTER TABLE notification_preferences
    ADD COLUMN engagement_accept_scope VARCHAR(16)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'all'
        AFTER notification_scope,
    ADD CONSTRAINT ck_notification_preferences_engagement_scope CHECK (
        engagement_accept_scope IN ('all', 'rivals', 'none')
    );

-- One row per delivered engagement. The row is the record of the act itself;
-- the notification it produces lives in `notifications` as it does for every
-- other kind. Keeping them separate means a Player clearing their inbox does
-- not erase the statistics a game keeps.
CREATE TABLE player_engagements (
    player_engagement_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    engagement_kind VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    actor_player_id BIGINT UNSIGNED NOT NULL,
    recipient_player_id BIGINT UNSIGNED NOT NULL,
    -- Kind-specific facts: the thrown hand and the outcome for a game, the
    -- track, mode and time for a challenge. Absent for a plain poke.
    detail JSON NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (player_engagement_id),
    UNIQUE KEY uq_player_engagements_public_id (public_id),
    KEY ix_player_engagements_recipient (recipient_player_id, created_at_ms),
    KEY ix_player_engagements_actor (actor_player_id, created_at_ms),
    CONSTRAINT fk_player_engagements_actor
        FOREIGN KEY (actor_player_id) REFERENCES players (player_id),
    CONSTRAINT fk_player_engagements_recipient
        FOREIGN KEY (recipient_player_id) REFERENCES players (player_id),
    CONSTRAINT ck_player_engagements_kind CHECK (
        engagement_kind IN ('poke', 'rock_paper_scissors', 'dice_roll', 'challenge')
    ),
    CONSTRAINT ck_player_engagements_not_self CHECK (
        actor_player_id <> recipient_player_id
    )
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- The inbox has to be able to hold what an engagement produces. All four kinds
-- are named now rather than one per release: they are one family and the
-- constraint should not need touching again when the games arrive.
ALTER TABLE notifications
    DROP CONSTRAINT ck_notifications_kind,
    ADD CONSTRAINT ck_notifications_kind CHECK (
        notification_kind IN (
            'overtaken', 'reaction_received', 'claim_decided',
            'result_published', 'group_invited', 'group_joined',
            'group_left', 'group_removed', 'group_role_changed',
            'world_record',
            'poke', 'rock_paper_scissors', 'dice_roll', 'challenge'
        )
    );
