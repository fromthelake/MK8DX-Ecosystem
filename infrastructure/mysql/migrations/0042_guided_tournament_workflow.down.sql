-- 0042 rollback: remove the guided workflow projection.
ALTER TABLE tournaments
    DROP CONSTRAINT ck_tournaments_max_participants,
    DROP CONSTRAINT ck_tournaments_workflow_step,
    DROP COLUMN max_participants,
    DROP COLUMN qualifier_rounds,
    DROP COLUMN workflow_step;
