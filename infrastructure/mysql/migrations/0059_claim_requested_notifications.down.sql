-- Reverses 0059. Entries of the retired kind have to go first, or the
-- narrower constraint cannot be re-established.
DELETE FROM notifications WHERE notification_kind = 'claim_requested';

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
