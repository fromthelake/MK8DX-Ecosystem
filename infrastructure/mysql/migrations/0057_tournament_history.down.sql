-- Reverse of 0057. Destructive: the corrected history and the identity links
-- are dropped. The legacy tables from 0025 are untouched by both directions,
-- so the source evidence survives a rollback and the history can be rebuilt.
DROP TABLE IF EXISTS tournament_observed_identity_links;
DROP TABLE IF EXISTS tournament_history_placements;
DROP TABLE IF EXISTS tournament_history_races;
DROP TABLE IF EXISTS tournament_history_sections;
