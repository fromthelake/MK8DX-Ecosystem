-- 0016 down: remove the rating domain. Destructive for rating rows only;
-- Player identity and tournament data are untouched.
DROP TABLE restricted_rating_seed_identities;
DROP TABLE player_rating_events;
DROP TABLE player_ratings;
