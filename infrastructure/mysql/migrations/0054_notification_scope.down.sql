-- 0054 development rollback; the notification scope is removed and every
-- account falls back to the two kind switches alone.
ALTER TABLE notification_preferences
    DROP CONSTRAINT ck_notification_preferences_scope,
    DROP COLUMN notification_scope;
