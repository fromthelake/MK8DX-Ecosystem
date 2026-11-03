-- Historical active compact operations cannot be reconstructed safely.
-- Rollback therefore removes only the additive cable registry.
DROP TABLE tournament_station_cables;
