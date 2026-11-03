-- 0045 rollback: drop the owner seating option and return to strict-only seating.
ALTER TABLE tournaments
    DROP CHECK ck_tournaments_owner_seating,
    DROP COLUMN owner_seating_mode;
