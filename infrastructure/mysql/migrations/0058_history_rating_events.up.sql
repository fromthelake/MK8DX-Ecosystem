-- 0058: let a rating event come from the corrected tournament history.
--
-- Migration 0016 knew two causes for a rating event: the one-off seed import,
-- and a race result carrying the V1 evidence revision it was read from. The
-- corrected history (0057) is a third. Its races are the rated ones, and most
-- of them have no evidence revision and never will - TN4 through TN6 were
-- never recorded, and the recordings that do exist are evidence for a race
-- rather than the thing that made it rateable.
--
-- So a third case is added rather than the existing two loosened: a
-- 'history_race' event references a race in `tournament_history_races` through
-- its source_reference and carries no V1 revision. The seed and race_result
-- cases keep their exact original shape, so nothing already written changes
-- meaning.
--
-- DROP CONSTRAINT rather than DROP CHECK. Both name the same thing and MySQL
-- 8 accepts either, but the hosted database is MariaDB, which only knows
-- DROP CONSTRAINT. The first attempt at this migration used DROP CHECK and
-- failed on its opening statement in production - harmlessly, because that
-- statement is the first, but DDL is not transactional and a later failure
-- would not have been harmless.

ALTER TABLE player_rating_events
    DROP CONSTRAINT ck_player_rating_events_type;

ALTER TABLE player_rating_events
    DROP CONSTRAINT ck_player_rating_events_cause;

ALTER TABLE player_rating_events
    ADD CONSTRAINT ck_player_rating_events_type CHECK (
        event_type IN ('seed_import', 'race_result', 'history_race')
    );

ALTER TABLE player_rating_events
    ADD CONSTRAINT ck_player_rating_events_cause CHECK (
        (event_type = 'seed_import'
            AND tournament_race_result_revision_id IS NULL)
        OR (event_type = 'race_result'
            AND tournament_race_result_revision_id IS NOT NULL)
        OR (event_type = 'history_race'
            AND tournament_race_result_revision_id IS NULL)
    );
