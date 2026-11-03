-- 0054: which notifications an account wants at all.
--
-- The two existing switches say whether a specific kind may notify. They
-- cannot say "only World Records" or "nothing at all", which is what an owner
-- reaches for when a phone is buzzing. The scope is the outer gate and the
-- kind switches remain the inner one: 'all' keeps today's behaviour exactly,
-- 'rivals' limits delivery to events another Player caused, 'world_records'
-- limits it to the World Record feed, and 'none' delivers nothing.

ALTER TABLE notification_preferences
    ADD COLUMN notification_scope VARCHAR(16)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'all'
        AFTER user_account_id,
    ADD CONSTRAINT ck_notification_preferences_scope CHECK (
        notification_scope IN ('all', 'rivals', 'world_records', 'none')
    );
