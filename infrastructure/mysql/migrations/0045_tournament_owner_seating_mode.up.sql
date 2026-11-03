-- 0045: ADR-0177 decision 7 restores the source Manager's owner seating option.
-- Strict pins a Nintendo Switch owner into seat 1 of their own console; soft
-- lets the seating move them when that produces a better layout. Existing
-- Tournaments keep the strict behaviour they were generated under.
ALTER TABLE tournaments
    ADD COLUMN owner_seating_mode VARCHAR(16)
        CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'owner_strict'
        AFTER placement_strategy,
    ADD CONSTRAINT ck_tournaments_owner_seating CHECK (
        owner_seating_mode IN ('owner_strict', 'owner_soft')
    );
