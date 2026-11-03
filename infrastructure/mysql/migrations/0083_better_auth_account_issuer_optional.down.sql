-- Reverses 0083 for Better Auth 1.7.0-1.7.2. Accounts written by a later version carry no issuer; they get their
-- provider id as a stand-in before the column is required again. Two such accounts with the same accountId would
-- block the restored unique key, which is why this down is destructive.
UPDATE mk8dx_auth_account SET issuer = LEFT(providerId, 191) WHERE issuer IS NULL;
ALTER TABLE mk8dx_auth_account DROP INDEX mk8dx_auth_account_accountId_idx;
ALTER TABLE mk8dx_auth_account MODIFY issuer VARCHAR(191) NOT NULL;
ALTER TABLE mk8dx_auth_account ADD UNIQUE KEY mk8dx_auth_account_issuer_accountId_uidx (issuer, accountId);
