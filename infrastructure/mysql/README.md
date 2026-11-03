# MySQL schema and reference data

The ordered `migration-catalog-v1.json` owns the 66 pinned SQL migrations. Append a new migration and catalogue entry; do not edit an applied migration. The API is the only runtime database client. The separate Nintendo Staff and World Records seed files are applied explicitly by the API seed operator, never on startup. Change schema here, then run the migration and relevant API integration tests on a fresh disposable database. These seeds remain subject to a separate redistribution decision.
