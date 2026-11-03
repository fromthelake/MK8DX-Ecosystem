-- 0029 down: removes canonical Tournament operation state.
--
-- Destructive for tournament rosters, groups, seating, manual scores, group
-- race links and the tournament audit trail. Canonical race results and
-- publications themselves are untouched; the visibility column returns to
-- the 0011 shape, so a hidden publication becomes public again after this.

DROP TABLE tournament_lifecycle;
DROP TABLE tournament_manual_scores;
DROP TABLE tournament_group_races;
DROP TABLE tournament_group_members;
DROP TABLE tournament_groups;
DROP TABLE tournament_participants;
DROP TABLE tournaments;

ALTER TABLE tournament_publications
    DROP CONSTRAINT ck_tournament_publication_visibility;
ALTER TABLE tournament_publications
    DROP COLUMN public_visibility;

-- Manual-entry rows must be reconciled before this runs, because the
-- 0006 source constraint returns without the manual kind.
ALTER TABLE tournament_race_result_revisions
    DROP CONSTRAINT ck_tournament_race_source;
ALTER TABLE tournament_race_result_revisions
    ADD CONSTRAINT ck_tournament_race_source CHECK (
        source_kind IN (
            'tournament_recorded_video',
            'tournament_live_capture',
            'tournament_spreadsheet_import'
        )
        AND (
            source_transport IS NULL
            OR source_transport IN ('native_contract', 'excel_workbook', 'csv')
        )
    );
