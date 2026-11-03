-- Reverses 0082. Inbox entries of the three retired kinds go first (their push deliveries before them,
-- their members cascade), or the narrower constraint cannot be re-established. The sign-up tables go
-- with their rows; the roster rows sign-ups wrote stay, because they are the night's own list.
DELETE delivery FROM notification_deliveries AS delivery
    INNER JOIN notifications AS notification ON notification.notification_id = delivery.notification_id
    WHERE notification.notification_kind IN (
        'tournament_signup_selected', 'tournament_signup_moved_up', 'tournament_signup_removed'
    );

DELETE FROM notifications WHERE notification_kind IN (
    'tournament_signup_selected', 'tournament_signup_moved_up', 'tournament_signup_removed'
);

ALTER TABLE notifications
    DROP CONSTRAINT ck_notifications_kind,
    ADD CONSTRAINT ck_notifications_kind CHECK (
        notification_kind IN (
            'overtaken', 'reaction_received', 'claim_decided',
            'claim_requested',
            'result_published', 'group_invited', 'group_joined',
            'group_left', 'group_removed', 'group_role_changed',
            'world_record',
            'poke', 'rock_paper_scissors', 'dice_roll', 'challenge',
            'host_requested', 'host_request_decided'
        )
    );

ALTER TABLE notifications DROP FOREIGN KEY fk_notifications_tournament;
ALTER TABLE notifications DROP KEY ix_notifications_tournament;
ALTER TABLE notifications DROP COLUMN tournament_id;

DROP TABLE tournament_signups;
DROP TABLE tournament_signup_settings;
