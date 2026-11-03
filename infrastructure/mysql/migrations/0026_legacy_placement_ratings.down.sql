-- 0026 down: removes the backfilled per-placement rating state. The
-- values are deterministically reproducible via the engine replay.

ALTER TABLE legacy_race_placements
    DROP COLUMN mu_after,
    DROP COLUMN sigma_after;
