START TRANSACTION;

INSERT INTO players (
    public_id, revision, player_kind, display_name, record_status,
    created_at_ms, updated_at_ms
) VALUES (
    'player.synthetic_seed_racer', 1, 'human',
    'Synthetic Seed Racer', 'active', 1700000000000, 1700000000000
);

INSERT INTO player_username_history (
    player_id, sequence_number, username_value, comparison_key,
    allocated_at_ms, released_at_ms
)
SELECT
    player_id, 1, 'SyntheticSeedRacer',
    X'73796e746865746963736565647261636572', 1700000000000, NULL
FROM players
WHERE public_id = 'player.synthetic_seed_racer';

INSERT INTO user_accounts (
    public_id, revision, privacy_class, account_status,
    created_at_ms, updated_at_ms
) VALUES (
    'user_account.synthetic_seed_reviewer', 1, 'private', 'active',
    1700000000000, 1700000000000
);

INSERT INTO aliases (
    public_id, revision, player_id, alias_text, alias_type, visibility,
    record_status, reviewed_by_user_account_id, reviewed_at_ms,
    created_at_ms, updated_at_ms
)
SELECT
    'alias.synthetic_seed_racer', 1, player.player_id,
    'Seed Racer', 'declared', 'public', 'active', account.user_account_id,
    1700000000000, 1700000000000, 1700000000000
FROM players AS player
CROSS JOIN user_accounts AS account
WHERE player.public_id = 'player.synthetic_seed_racer'
  AND account.public_id = 'user_account.synthetic_seed_reviewer';

INSERT INTO alias_provenance (
    alias_id, sequence_number, source_type, source_reference, observed_at_ms
)
SELECT alias_id, 1, 'administrator', 'source.synthetic_seed_v1', 1700000000000
FROM aliases
WHERE public_id = 'alias.synthetic_seed_racer';

INSERT INTO alias_lifecycle (
    alias_id, sequence_number, event_type, actor_user_account_id,
    visibility_after, record_status_after, reason_code, occurred_at_ms
)
SELECT
    alias.alias_id, 1, 'alias_created', account.user_account_id,
    'public', 'active', 'synthetic_seed_v1', 1700000000000
FROM aliases AS alias
CROSS JOIN user_accounts AS account
WHERE alias.public_id = 'alias.synthetic_seed_racer'
  AND account.public_id = 'user_account.synthetic_seed_reviewer';

COMMIT;
