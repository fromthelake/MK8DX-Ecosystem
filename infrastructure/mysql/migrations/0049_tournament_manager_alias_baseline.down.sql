-- 0049 down: remove the alias baseline this migration imported. Only rows it
-- created carry the `alias.tm-` public id prefix, so curated or player-declared
-- aliases added later are untouched.

DELETE l FROM alias_lifecycle AS l
INNER JOIN aliases AS a ON a.alias_id = l.alias_id
WHERE LEFT(a.public_id, 9) = 'alias.tm-';

DELETE pr FROM alias_provenance AS pr
INNER JOIN aliases AS a ON a.alias_id = pr.alias_id
WHERE LEFT(a.public_id, 9) = 'alias.tm-';

DELETE FROM aliases WHERE LEFT(public_id, 9) = 'alias.tm-';
