-- Reverses 0081. The per-night options go with their columns (seed_order keeps ranked/random, so a night
-- seeded from a Director's own nights or by hand reads as "ranked" again); the installation settings and
-- their audit go with their tables, and the defaults (everybody creates and counts) apply again.
-- DROP CONSTRAINT (not DROP CHECK) so MariaDB accepts it.
ALTER TABLE tournaments
    DROP CONSTRAINT ck_tournaments_seeding_source;

ALTER TABLE tournaments
    DROP COLUMN seeding_source;

ALTER TABLE tournaments
    DROP COLUMN verified_only;

DROP TABLE installation_setting_changes;

DROP TABLE installation_settings;
