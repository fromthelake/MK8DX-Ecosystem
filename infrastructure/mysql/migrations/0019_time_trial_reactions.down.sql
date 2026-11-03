-- 0019 down: removes the social reaction layer and its accumulated
-- reactions. Destructive for reaction rows only; Time Trials and
-- accounts are untouched.

DROP TABLE time_trial_reactions;
