-- Refuses while a lifecycle event names a Director; the notes go with their table.
ALTER TABLE player_claim_lifecycle
    DROP CONSTRAINT ck_claim_lifecycle_actor;

ALTER TABLE player_claim_lifecycle
    ADD CONSTRAINT ck_claim_lifecycle_actor CHECK (
        actor_type IN ('requesting_account', 'administrator')
    );

DROP TABLE player_claim_notes;
