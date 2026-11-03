-- Refuses while a revision stores a 50cc/100cc class; the Mirror marks go with their column.
ALTER TABLE tournament_race_result_revisions
    DROP CONSTRAINT ck_tournament_race_mirror;

ALTER TABLE tournament_race_result_revisions
    DROP COLUMN mirror;

ALTER TABLE tournament_race_result_revisions
    DROP CONSTRAINT ck_tournament_race_mode;

ALTER TABLE tournament_race_result_revisions
    ADD CONSTRAINT ck_tournament_race_mode CHECK (
        mode_cc IS NULL OR mode_cc IN (150, 200)
    );
