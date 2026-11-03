-- 0048: split one migrated Player that carried two real-world identities into a Time Trials Player and a
-- Tournament Player (ADR-0178 decision 1). This was a data repair for one historical installation; the public
-- text uses a placeholder identity, so it matches no rows on a new installation, as the original does.
--
-- Nothing is deleted. Rows move to the new Player and every legacy identifier and provenance record is preserved
-- (identity history supports later reassignment without destructive replacement).
--
-- Stays with the source Player: firebase_timetrial_import_records, time_trial_submission_revisions,
-- restricted_legacy_identity_identifiers (timetrials_firebase), the username.
-- Moves to the target Player: legacy_race_placements, player_ratings, player_rating_events,
-- restricted_rating_seed_identities, tournament_participants.

INSERT INTO players (
    public_id, revision, player_kind, display_name, record_status,
    created_at_ms, updated_at_ms
)
SELECT 'player.example_split_target', 1, 'human', 'Split Target', 'active',
       p.created_at_ms, p.created_at_ms
FROM players AS p
WHERE p.public_id = 'player.example_split_source'
  AND NOT EXISTS (
      SELECT 1 FROM players AS existing WHERE existing.public_id = 'player.example_split_target'
  );

INSERT INTO player_username_history (
    player_id, sequence_number, username_value, comparison_key,
    allocated_at_ms, released_at_ms
)
SELECT new_player.player_id, 1, 'split_target', CAST('split_target' AS BINARY),
       new_player.created_at_ms, NULL
FROM players AS new_player
WHERE new_player.public_id = 'player.example_split_target'
  AND NOT EXISTS (
      SELECT 1 FROM player_username_history AS h
      WHERE h.player_id = new_player.player_id
  );

-- Move the Tournament side.

UPDATE legacy_race_placements AS lrp
INNER JOIN players AS old_player ON old_player.public_id = 'player.example_split_source'
INNER JOIN players AS new_player ON new_player.public_id = 'player.example_split_target'
SET lrp.player_id = new_player.player_id
WHERE lrp.player_id = old_player.player_id;

UPDATE tournament_participants AS tp
INNER JOIN players AS old_player ON old_player.public_id = 'player.example_split_source'
INNER JOIN players AS new_player ON new_player.public_id = 'player.example_split_target'
SET tp.player_id = new_player.player_id
WHERE tp.player_id = old_player.player_id;

UPDATE restricted_rating_seed_identities AS rsi
INNER JOIN players AS old_player ON old_player.public_id = 'player.example_split_source'
INNER JOIN players AS new_player ON new_player.public_id = 'player.example_split_target'
SET rsi.player_id = new_player.player_id
WHERE rsi.player_id = old_player.player_id;

UPDATE player_rating_events AS pre
INNER JOIN players AS old_player ON old_player.public_id = 'player.example_split_source'
INNER JOIN players AS new_player ON new_player.public_id = 'player.example_split_target'
SET pre.player_id = new_player.player_id
WHERE pre.player_id = old_player.player_id;

UPDATE player_ratings AS pr
INNER JOIN players AS old_player ON old_player.public_id = 'player.example_split_source'
INNER JOIN players AS new_player ON new_player.public_id = 'player.example_split_target'
SET pr.player_id = new_player.player_id
WHERE pr.player_id = old_player.player_id;

-- The TimeTrials Player now holds no rating history, so it starts from the
-- canonical TrueSkill prior like any Player who has never raced a Tournament
-- (ADR-0177 decision 20). Its conservative score is therefore 0.00.

INSERT INTO player_ratings (
    player_id, revision, mu, sigma, updated_at_ms, created_at_ms
)
SELECT p.player_id, 1,
       25.000000000000000000, 8.333333333333333333,
       p.created_at_ms, p.created_at_ms
FROM players AS p
WHERE p.public_id = 'player.example_split_source'
  AND NOT EXISTS (
      SELECT 1 FROM player_ratings AS r WHERE r.player_id = p.player_id
  );

INSERT INTO player_rating_events (
    player_id, sequence_number, event_type, mu_before, sigma_before,
    mu_after, sigma_after, source_reference,
    tournament_race_result_revision_id, occurred_at_ms
)
SELECT r.player_id, 1, 'seed_import', NULL, NULL, r.mu, r.sigma,
       'default_trueskill_prior_v1', NULL, r.created_at_ms
FROM player_ratings AS r
INNER JOIN players AS p ON p.player_id = r.player_id
WHERE p.public_id = 'player.example_split_source'
  AND NOT EXISTS (
      SELECT 1 FROM player_rating_events AS e WHERE e.player_id = r.player_id
  );
