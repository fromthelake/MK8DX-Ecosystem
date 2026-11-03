-- 0025 down: removes the imported legacy race history. Destructive for
-- those imported rows only (the restricted source artifacts outside
-- Git remain the recovery source).

DROP TABLE legacy_race_placements;
DROP TABLE legacy_tournament_races;
