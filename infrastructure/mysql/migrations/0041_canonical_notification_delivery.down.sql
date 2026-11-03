-- 0041 rollback: remove provider-neutral delivery and restore legacy kind names.
DROP TABLE notification_deliveries;
DROP TABLE web_push_subscriptions;
DROP TABLE notification_preferences;

ALTER TABLE notifications DROP CONSTRAINT ck_notifications_competitive_values;
ALTER TABLE notifications DROP CONSTRAINT ck_notifications_kind;

UPDATE notifications
SET notification_kind = 'time_beaten',
    aggregation_key = CONCAT('time_beaten|legacy|', notification_id)
WHERE notification_kind = 'overtaken';

ALTER TABLE notifications
    DROP COLUMN recipient_rank,
    DROP COLUMN recipient_time_ms,
    DROP COLUMN actor_time_ms,
    ADD CONSTRAINT ck_notifications_kind CHECK (
        notification_kind IN (
            'time_beaten', 'reaction_received', 'claim_decided',
            'result_published', 'group_invited', 'group_joined',
            'group_left', 'group_removed', 'group_role_changed',
            'world_record'
        )
    );
