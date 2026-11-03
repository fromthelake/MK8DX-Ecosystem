START TRANSACTION;

DELETE lifecycle
FROM alias_lifecycle AS lifecycle
INNER JOIN aliases AS alias ON alias.alias_id = lifecycle.alias_id
WHERE alias.public_id = 'alias.synthetic_seed_racer';

DELETE provenance
FROM alias_provenance AS provenance
INNER JOIN aliases AS alias ON alias.alias_id = provenance.alias_id
WHERE alias.public_id = 'alias.synthetic_seed_racer';

DELETE FROM aliases WHERE public_id = 'alias.synthetic_seed_racer';

DELETE username_record
FROM player_username_history AS username_record
INNER JOIN players AS player ON player.player_id = username_record.player_id
WHERE player.public_id = 'player.synthetic_seed_racer';

DELETE FROM user_accounts
WHERE public_id = 'user_account.synthetic_seed_reviewer';

DELETE FROM players WHERE public_id = 'player.synthetic_seed_racer';

COMMIT;
