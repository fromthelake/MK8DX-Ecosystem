ALTER TABLE time_trial_submission_revisions
    DROP KEY ix_time_trial_revision_player_combo_time;

ALTER TABLE time_trial_publications
    DROP KEY ix_time_trial_publication_status_updated;

DROP TABLE time_trial_player_bests;
