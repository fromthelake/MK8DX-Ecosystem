-- 0047 down: remove the default TrueSkill prior rows written by the up
-- migration and by `seedDefaultRating`, and drop the participant seeds that
-- were derived from them. Ratings produced by the legacy seed import or by a
-- race result are untouched: they never carry this source reference and never
-- sit exactly on the prior.

UPDATE tournament_participants AS tp
INNER JOIN tournaments AS t ON t.tournament_id = tp.tournament_id
INNER JOIN player_ratings AS r ON r.player_id = tp.player_id
SET tp.seed_score = NULL,
    tp.seed_rank = NULL
WHERE t.finalized_at_ms IS NULL
  AND r.mu = 25.000000000000000000
  AND r.sigma = 8.333333333333333333;

DELETE FROM player_rating_events
WHERE source_reference = 'default_trueskill_prior_v1';

DELETE r FROM player_ratings AS r
WHERE r.mu = 25.000000000000000000
  AND r.sigma = 8.333333333333333333
  AND NOT EXISTS (
      SELECT 1 FROM player_rating_events AS e WHERE e.player_id = r.player_id
  );
