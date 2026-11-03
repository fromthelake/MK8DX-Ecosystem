-- Removes the record of which build each device runs. Nothing else reads this
-- table, so dropping it costs only the history itself.

DROP TABLE client_installations;
