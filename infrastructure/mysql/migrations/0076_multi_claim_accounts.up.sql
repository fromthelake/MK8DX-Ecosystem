-- ADR-0178: an account may own several Players. One verified claim per Player stays
-- (uq_claims_verified_player); the per-account key goes. The service refuses two Players
-- that met in the same Tournament.
ALTER TABLE player_claims
    DROP INDEX uq_claims_verified_account;
