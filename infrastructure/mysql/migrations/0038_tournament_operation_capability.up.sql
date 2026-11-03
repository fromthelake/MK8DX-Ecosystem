ALTER TABLE account_capability_grants
    DROP CONSTRAINT ck_account_capability_grants_code,
    ADD CONSTRAINT ck_account_capability_grants_code CHECK (
        capability_code IN (
            'tournament.analytics.erik_report',
            'tournament.operation'
        )
    );
