-- A link request has to reach the people who decide it. Until now the inbox
-- only carried the decision back to the claimant; nobody was told a request
-- had arrived. 'claim_requested' is delivered to every active administrator.
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
