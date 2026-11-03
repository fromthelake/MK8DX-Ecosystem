-- 0020 down: restores the original three-kind vocabulary. Reactions
-- with kinds outside the original set are removed first, so this down
-- migration is destructive for those rows.

DELETE FROM time_trial_reactions
WHERE reaction_kind NOT IN ('fire', 'clap', 'wow');

ALTER TABLE time_trial_reactions
    DROP CONSTRAINT ck_time_trial_reactions_kind;

ALTER TABLE time_trial_reactions
    ADD CONSTRAINT ck_time_trial_reactions_kind CHECK (
        reaction_kind IN ('fire', 'clap', 'wow')
    );
