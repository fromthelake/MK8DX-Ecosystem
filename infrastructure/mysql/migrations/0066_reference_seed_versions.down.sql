-- Development-only rollback; never drop installed reference state on upgrade.
DROP TABLE reference_seed_rows;
DROP TABLE reference_seed_versions;
