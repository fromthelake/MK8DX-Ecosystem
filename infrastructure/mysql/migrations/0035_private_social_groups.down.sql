-- 0035 rollback: remove private social Groups and saved Rank scope.
DELETE FROM notifications WHERE notification_kind IN (
    'group_invited', 'group_joined', 'group_left', 'group_removed',
    'group_role_changed'
);
ALTER TABLE notifications DROP CONSTRAINT ck_notifications_kind;
ALTER TABLE notifications ADD CONSTRAINT ck_notifications_kind CHECK (
    notification_kind IN ('time_beaten', 'reaction_received', 'claim_decided', 'result_published')
);
ALTER TABLE notifications DROP FOREIGN KEY fk_notifications_social_group;
ALTER TABLE notifications DROP COLUMN social_group_id;
DROP TABLE rank_scope_group_preferences;
DROP TABLE rank_scope_preferences;
DROP TABLE social_group_memberships;
DROP TABLE social_groups;
