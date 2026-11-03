-- ADR-0217: a Tournament race carries its class. mode_cc accepts every LAN class (50/100/150/200cc) and a Mirror
-- race (150cc, course mirrored) is marked by mirror = 1. DROP CONSTRAINT (not DROP CHECK) so MariaDB accepts it.
ALTER TABLE tournament_race_result_revisions
    DROP CONSTRAINT ck_tournament_race_mode;

ALTER TABLE tournament_race_result_revisions
    ADD CONSTRAINT ck_tournament_race_mode CHECK (
        mode_cc IS NULL OR mode_cc IN (50, 100, 150, 200)
    );

ALTER TABLE tournament_race_result_revisions
    ADD COLUMN mirror TINYINT(1) NULL AFTER mode_cc;

ALTER TABLE tournament_race_result_revisions
    ADD CONSTRAINT ck_tournament_race_mirror CHECK (
        mirror IS NULL OR (mirror = 1 AND mode_cc = 150)
    );
