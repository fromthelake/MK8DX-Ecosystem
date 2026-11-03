DROP TABLE time_trial_publication_lifecycle;
DROP TABLE time_trial_publications;
ALTER TABLE time_trial_submission_revisions
    DROP INDEX uq_time_trial_revision_identity_submission;
