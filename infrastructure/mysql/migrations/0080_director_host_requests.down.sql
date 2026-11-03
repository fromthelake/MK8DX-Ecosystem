-- Reverses 0080. Inbox entries of the two retired kinds go first (their push deliveries before them,
-- their members cascade), or the narrower constraint cannot be re-established. The requests go with
-- their table; a Director granted through one keeps the grant, which has its own audit trail.
DELETE delivery FROM notification_deliveries AS delivery
    INNER JOIN notifications AS notification ON notification.notification_id = delivery.notification_id
    WHERE notification.notification_kind IN ('host_requested', 'host_request_decided');

DELETE FROM notifications WHERE notification_kind IN ('host_requested', 'host_request_decided');

ALTER TABLE notifications
    DROP CONSTRAINT ck_notifications_kind,
    ADD CONSTRAINT ck_notifications_kind CHECK (
        notification_kind IN (
            'overtaken', 'reaction_received', 'claim_decided',
            'claim_requested',
            'result_published', 'group_invited', 'group_joined',
            'group_left', 'group_removed', 'group_role_changed',
            'world_record',
            'poke', 'rock_paper_scissors', 'dice_roll', 'challenge'
        )
    );

DROP TABLE director_host_requests;
