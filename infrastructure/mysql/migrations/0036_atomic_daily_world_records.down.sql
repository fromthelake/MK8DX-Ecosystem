-- 0036 rollback: remove the atomic World Record snapshot.
DELETE FROM notifications WHERE notification_kind = 'world_record';
DROP TABLE world_record_import_runs;
DROP TABLE world_records;
