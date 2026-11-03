-- Reverses 0048 (placeholder identity; matches no rows on a new installation).

DELETE e FROM player_rating_events AS e
INNER JOIN players AS p ON p.player_id = e.player_id
WHERE p.public_id = 'player.example_split_source'
  AND e.source_reference = 'default_trueskill_prior_v1';

DELETE r FROM player_ratings AS r
INNER JOIN players AS p ON p.player_id = r.player_id
WHERE p.public_id = 'player.example_split_source'
  AND r.mu = 25.000000000000000000
  AND r.sigma = 8.333333333333333333;

UPDATE player_ratings AS pr
INNER JOIN players AS old_player ON old_player.public_id = 'player.example_split_source'
INNER JOIN players AS new_player ON new_player.public_id = 'player.example_split_target'
SET pr.player_id = old_player.player_id
WHERE pr.player_id = new_player.player_id;

UPDATE player_rating_events AS pre
INNER JOIN players AS old_player ON old_player.public_id = 'player.example_split_source'
INNER JOIN players AS new_player ON new_player.public_id = 'player.example_split_target'
SET pre.player_id = old_player.player_id
WHERE pre.player_id = new_player.player_id;

UPDATE restricted_rating_seed_identities AS rsi
INNER JOIN players AS old_player ON old_player.public_id = 'player.example_split_source'
INNER JOIN players AS new_player ON new_player.public_id = 'player.example_split_target'
SET rsi.player_id = old_player.player_id
WHERE rsi.player_id = new_player.player_id;

UPDATE tournament_participants AS tp
INNER JOIN players AS old_player ON old_player.public_id = 'player.example_split_source'
INNER JOIN players AS new_player ON new_player.public_id = 'player.example_split_target'
SET tp.player_id = old_player.player_id
WHERE tp.player_id = new_player.player_id;

UPDATE legacy_race_placements AS lrp
INNER JOIN players AS old_player ON old_player.public_id = 'player.example_split_source'
INNER JOIN players AS new_player ON new_player.public_id = 'player.example_split_target'
SET lrp.player_id = old_player.player_id
WHERE lrp.player_id = new_player.player_id;

DELETE h FROM player_username_history AS h
INNER JOIN players AS p ON p.player_id = h.player_id
WHERE p.public_id = 'player.example_split_target';

DELETE FROM players WHERE public_id = 'player.example_split_target';
