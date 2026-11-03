-- 0026: full-precision rating state per legacy race placement.
--
-- Owner decision 2026-08-21: the rating-history graph becomes
-- interactive and shows mu/sigma per race on hover. The imported
-- artifact only carried the two-decimal display score, but the
-- canonical engine replay (proven bit-compatible, ADR-0154) reproduces
-- the exact trajectory; a verified backfill writes it into these
-- columns. Leaderboards keep exposing the conservative score only.

ALTER TABLE legacy_race_placements
    ADD COLUMN mu_after DECIMAL(24, 18) NULL,
    ADD COLUMN sigma_after DECIMAL(24, 18) NULL;
