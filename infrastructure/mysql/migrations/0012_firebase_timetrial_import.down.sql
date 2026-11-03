DROP TABLE firebase_timetrial_import_attempts;
DROP TABLE firebase_timetrial_import_records;
DROP TABLE firebase_timetrial_import_runs;
ALTER TABLE restricted_legacy_identity_identifiers
    DROP CONSTRAINT ck_legacy_identity_lookup_key_version;
ALTER TABLE restricted_legacy_identity_identifiers
    DROP COLUMN lookup_key_version;
