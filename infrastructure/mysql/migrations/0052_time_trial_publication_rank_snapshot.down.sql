ALTER TABLE time_trial_publication_lifecycle
    DROP CONSTRAINT ck_time_trial_lifecycle_rank_snapshot,
    DROP COLUMN rank_at_publication;

ALTER TABLE time_trial_publications
    DROP CONSTRAINT ck_time_trial_publication_rank_snapshot,
    DROP COLUMN rank_at_publication;
