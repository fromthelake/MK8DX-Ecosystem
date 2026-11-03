-- Better Auth 1.7.3 and later no longer write the account `issuer` column that 1.7.0-1.7.2 required, and match an
-- account by providerId and accountId again (upgrade guide "1.7"). Inserting a new account into a table where
-- `issuer` is NOT NULL then fails, so a first magic-link sign-in would answer 500. The compound unique key goes first,
-- so no index is rebuilt on accountId alone; the column stays for the rows 1.7.0 wrote; a plain index keeps the
-- accountId lookups cheap (providerId is TEXT and cannot be a key prefix).
ALTER TABLE mk8dx_auth_account DROP INDEX mk8dx_auth_account_issuer_accountId_uidx;
ALTER TABLE mk8dx_auth_account MODIFY issuer VARCHAR(191) NULL;
ALTER TABLE mk8dx_auth_account ADD KEY mk8dx_auth_account_accountId_idx (accountId);
