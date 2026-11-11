-- ADR-0224 amendment (owner, 2026-11-11): an administrator may be remembered on a device only behind
-- a PIN, and the fifth wrong PIN on that device forgets the entry. This column counts wrong PINs per
-- remembered entry; it holds a number only, never a PIN, and is reset by a right PIN.
ALTER TABLE account_switch_remembered_accounts
    ADD COLUMN pin_failures TINYINT UNSIGNED NOT NULL DEFAULT 0;
