-- The night report's writing capability is named after what it is, not after the Director who
-- first used it (owner 2026-10-31). Existing grants keep their rows and lifecycle; only the code changes.
ALTER TABLE account_capability_grants
    DROP CONSTRAINT ck_account_capability_grants_code;

UPDATE account_capability_grants
SET capability_code = 'tournament.analytics.night_report'
WHERE capability_code = 'tournament.analytics.erik_report';

ALTER TABLE account_capability_grants
    ADD CONSTRAINT ck_account_capability_grants_code CHECK (
        capability_code IN (
            'tournament.analytics.night_report',
            'tournament.operation'
        )
    );
