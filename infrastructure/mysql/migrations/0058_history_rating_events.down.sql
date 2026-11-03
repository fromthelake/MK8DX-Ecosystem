-- Reverse of 0058: back to the two causes 0016 defined. Any 'history_race'
-- event must be removed first, or the restored constraint cannot hold; this
-- deletes them, which is why the down is destructive.
DELETE FROM player_rating_events WHERE event_type = 'history_race';

ALTER TABLE player_rating_events
    DROP CONSTRAINT ck_player_rating_events_type;

ALTER TABLE player_rating_events
    DROP CONSTRAINT ck_player_rating_events_cause;

ALTER TABLE player_rating_events
    ADD CONSTRAINT ck_player_rating_events_type CHECK (
        event_type IN ('seed_import', 'race_result')
    );

ALTER TABLE player_rating_events
    ADD CONSTRAINT ck_player_rating_events_cause CHECK (
        (event_type = 'seed_import'
            AND tournament_race_result_revision_id IS NULL)
        OR (event_type = 'race_result'
            AND tournament_race_result_revision_id IS NOT NULL)
    );
