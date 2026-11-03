-- A World Record's coins and mushrooms are one value per lap, or empty when the source lists them in
-- another grouping (the 7-lap Baby Park record of 2026-10-31 came with three values each).
ALTER TABLE world_records
    DROP CONSTRAINT ck_world_records_coins,
    DROP CONSTRAINT ck_world_records_mushrooms;

ALTER TABLE world_records
    ADD CONSTRAINT ck_world_records_coins CHECK (
        JSON_LENGTH(coins_per_lap_json) = 0 OR JSON_LENGTH(coins_per_lap_json) = JSON_LENGTH(lap_times_json)
    ),
    ADD CONSTRAINT ck_world_records_mushrooms CHECK (
        JSON_LENGTH(mushrooms_per_lap_json) = 0 OR JSON_LENGTH(mushrooms_per_lap_json) = JSON_LENGTH(lap_times_json)
    );
