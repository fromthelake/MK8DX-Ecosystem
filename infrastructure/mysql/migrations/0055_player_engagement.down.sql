-- Reverses 0055.

ALTER TABLE notifications
    DROP CONSTRAINT ck_notifications_kind,
    ADD CONSTRAINT ck_notifications_kind CHECK (
        notification_kind IN (
            'overtaken', 'reaction_received', 'claim_decided',
            'result_published', 'group_invited', 'group_joined',
            'group_left', 'group_removed', 'group_role_changed',
            'world_record'
        )
    );

DROP TABLE IF EXISTS player_engagements;

ALTER TABLE notification_preferences
    DROP CONSTRAINT ck_notification_preferences_engagement_scope,
    DROP COLUMN engagement_accept_scope;
