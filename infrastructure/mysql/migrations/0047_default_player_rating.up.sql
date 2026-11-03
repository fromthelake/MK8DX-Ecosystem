-- 0047: give every canonical Player a TrueSkill rating.
--
-- Owner decision 2026-08-27 (ADR-0177 decision 20). A Player created during a
-- tournament night had no row in `player_ratings` at all, so the Tournament
-- roster showed "SP -" and rank "#?" and the seeding rule could only fall back
-- to "unknown sorts last" by accident of a NULL.
--
-- The canonical prior is the engine's own: mu = 25, sigma = 25/3 (ADR-0154,
-- `RATING_INITIAL_MU` / `RATING_INITIAL_SIGMA`). The public score is the
-- conservative `mu - 3 * sigma`, which for the prior is 0. Every rated Player
-- in the canonical database currently scores between 13.03 and 28.67, so a
-- newcomer lands below all of them and seeds last in "Maak kwalificatiegroepen"
-- through the ordinary ranking rule rather than a special case.
--
-- The source Manager's `MANUAL_DEFAULT_SP = 25.0` is deliberately not copied:
-- on this scale it would seed an unknown player near the top of the field.
--
-- Sigma is written as the exact decimal truncation of 25/3 so the stored value
-- is not a float64 artefact and the derived score is not slightly negative.

INSERT INTO player_ratings (
    player_id, revision, mu, sigma, updated_at_ms, created_at_ms
)
SELECT p.player_id,
       1,
       25.000000000000000000,
       8.333333333333333333,
       p.created_at_ms,
       p.created_at_ms
FROM players AS p
WHERE p.player_kind = 'human'
  AND p.record_status = 'active'
  AND NOT EXISTS (
      SELECT 1 FROM player_ratings AS r WHERE r.player_id = p.player_id
  );

INSERT INTO player_rating_events (
    player_id, sequence_number, event_type, mu_before, sigma_before,
    mu_after, sigma_after, source_reference,
    tournament_race_result_revision_id, occurred_at_ms
)
SELECT r.player_id,
       1,
       'seed_import',
       NULL,
       NULL,
       r.mu,
       r.sigma,
       'default_trueskill_prior_v1',
       NULL,
       r.created_at_ms
FROM player_ratings AS r
WHERE r.mu = 25.000000000000000000
  AND r.sigma = 8.333333333333333333
  AND NOT EXISTS (
      SELECT 1 FROM player_rating_events AS e WHERE e.player_id = r.player_id
  );

-- Participant rows are a snapshot taken when the Player was added to the
-- roster, so the newcomers already on an unfinished Tournament still carry the
-- NULL seed. Refresh only those NULLs, and only where the Tournament has not
-- been finalized: a finalized Tournament keeps the seeds it was drawn under.
UPDATE tournament_participants AS tp
INNER JOIN tournaments AS t ON t.tournament_id = tp.tournament_id
INNER JOIN player_ratings AS r ON r.player_id = tp.player_id
SET tp.seed_score = r.mu - 3 * r.sigma,
    tp.seed_rank = 1 + (
        SELECT COUNT(*)
        FROM player_ratings AS other
        INNER JOIN players AS otherPlayer
            ON otherPlayer.player_id = other.player_id
           AND otherPlayer.record_status = 'active'
        WHERE (other.mu - 3 * other.sigma) > (r.mu - 3 * r.sigma)
    )
WHERE tp.seed_score IS NULL
  AND tp.seed_rank IS NULL
  AND t.finalized_at_ms IS NULL;
