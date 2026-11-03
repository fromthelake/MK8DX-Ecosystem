-- 0017 down: remove recalculation epochs and decisions. Restoring the
-- original per-player uniqueness fails closed (by design) while more than
-- one epoch exists; recalculation epochs must be removed deliberately first.
ALTER TABLE player_rating_events
    ADD UNIQUE KEY uq_player_rating_events_sequence (
        player_id,
        sequence_number
    );
ALTER TABLE player_rating_events
    DROP INDEX uq_player_rating_events_epoch_sequence;
ALTER TABLE player_rating_events
    DROP COLUMN rating_epoch;
DROP TABLE tournament_rating_decisions;
DROP TABLE rating_recalculations;
