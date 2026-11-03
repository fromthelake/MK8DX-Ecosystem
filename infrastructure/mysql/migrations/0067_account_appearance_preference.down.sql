-- 0066 development rollback. Only the synced appearance choice is lost; every
-- device keeps its own local choice, so the product still renders correctly.
-- `DROP TABLE` is accepted by both Oracle MySQL and MariaDB (the hosted
-- engine); no `DROP CHECK` is used anywhere here.

DROP TABLE user_account_appearance_preferences;
