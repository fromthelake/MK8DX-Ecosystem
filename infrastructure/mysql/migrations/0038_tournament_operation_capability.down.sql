DELETE lifecycle
FROM account_capability_grant_lifecycle AS lifecycle
INNER JOIN account_capability_grants AS grant_record
    ON grant_record.account_capability_grant_id = lifecycle.account_capability_grant_id
WHERE grant_record.capability_code = 'tournament.operation';

DELETE FROM account_capability_grants
WHERE capability_code = 'tournament.operation';

ALTER TABLE account_capability_grants
    DROP CONSTRAINT ck_account_capability_grants_code,
    ADD CONSTRAINT ck_account_capability_grants_code CHECK (
        capability_code = 'tournament.analytics.erik_report'
    );
