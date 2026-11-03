-- 0042: persist the recovered Tournament Manager workflow across Web and Android.
ALTER TABLE tournaments
    ADD COLUMN workflow_step TINYINT UNSIGNED NOT NULL DEFAULT 2 AFTER stage,
    ADD COLUMN qualifier_rounds BOOLEAN NOT NULL DEFAULT TRUE AFTER workflow_step,
    ADD COLUMN max_participants SMALLINT UNSIGNED NULL AFTER qualifier_rounds,
    ADD CONSTRAINT ck_tournaments_workflow_step CHECK (
        workflow_step BETWEEN 2 AND 10
    ),
    ADD CONSTRAINT ck_tournaments_max_participants CHECK (
        max_participants IS NULL OR max_participants BETWEEN 1 AND 60
    );
