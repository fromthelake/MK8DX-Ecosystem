ALTER TABLE account_capability_grants
    DROP CONSTRAINT ck_account_capability_grants_code;

UPDATE account_capability_grants
SET capability_code = 'tournament.analytics.erik_report'
WHERE capability_code = 'tournament.analytics.night_report';

ALTER TABLE account_capability_grants
    ADD CONSTRAINT ck_account_capability_grants_code CHECK (
        capability_code IN (
            'tournament.analytics.erik_report',
            'tournament.operation'
        )
    );
