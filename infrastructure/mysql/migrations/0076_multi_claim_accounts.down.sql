-- Refuses while an account holds more than one verified claim; release or revoke the extra claims first.
ALTER TABLE player_claims
    ADD UNIQUE KEY uq_claims_verified_account (active_verified_account_id);
