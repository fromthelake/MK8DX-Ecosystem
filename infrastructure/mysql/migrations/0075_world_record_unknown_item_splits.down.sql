-- Refuses while a World Record has empty item splits; the next daily import replaces such a row.
ALTER TABLE world_records
    DROP CONSTRAINT ck_world_records_coins,
    DROP CONSTRAINT ck_world_records_mushrooms;

ALTER TABLE world_records
    ADD CONSTRAINT ck_world_records_coins CHECK (JSON_LENGTH(coins_per_lap_json) = JSON_LENGTH(lap_times_json)),
    ADD CONSTRAINT ck_world_records_mushrooms CHECK (JSON_LENGTH(mushrooms_per_lap_json) = JSON_LENGTH(lap_times_json));
