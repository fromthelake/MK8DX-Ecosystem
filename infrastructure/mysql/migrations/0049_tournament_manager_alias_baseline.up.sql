-- 0049: import the Tournament Manager's curated in-game aliases.
--
-- The source Manager keeps a list of the in-game Nintendo Switch names its score-workbook import uses to resolve a
-- row to the participant it belongs to. They are `legacy_handle` aliases with `tournament_manager` provenance (curated,
-- not OCR observations); an alias resolves an import row to a Player, it never approves a claim and never merges
-- identities (ADR-0006, ADR-0178).
--
-- This was a data import for one historical installation. The public text keeps the statements with placeholder
-- names and handles, so it matches no Player and creates nothing on a new installation, as the original does. The
-- alias is skipped when the Player does not exist or already carries it, so the migration is safe to re-run.

SET @reviewer := (SELECT user_account_id FROM user_accounts ORDER BY user_account_id LIMIT 1);
SET @now := UNIX_TIMESTAMP() * 1000;

INSERT INTO aliases (
    public_id, revision, player_id, alias_text, alias_type, visibility,
    record_status, reviewed_by_user_account_id, reviewed_at_ms,
    created_at_ms, updated_at_ms
)
SELECT 'alias.tm-example-01', 1, p.player_id, 'Example 01', 'legacy_handle', 'public',
       'active', @reviewer, @now, @now, @now
FROM players AS p
WHERE p.player_kind = 'human'
  AND p.record_status = 'active'
  AND LOWER(TRIM(p.display_name)) = LOWER(TRIM('Example 02'))
  AND NOT EXISTS (
      SELECT 1 FROM aliases AS existing
      WHERE existing.player_id = p.player_id
        AND LOWER(TRIM(existing.alias_text)) = LOWER(TRIM('Example 01'))
  );
INSERT INTO aliases (
    public_id, revision, player_id, alias_text, alias_type, visibility,
    record_status, reviewed_by_user_account_id, reviewed_at_ms,
    created_at_ms, updated_at_ms
)
SELECT 'alias.tm-example-02', 1, p.player_id, 'Example 03', 'legacy_handle', 'public',
       'active', @reviewer, @now, @now, @now
FROM players AS p
WHERE p.player_kind = 'human'
  AND p.record_status = 'active'
  AND LOWER(TRIM(p.display_name)) = LOWER(TRIM('Example 04'))
  AND NOT EXISTS (
      SELECT 1 FROM aliases AS existing
      WHERE existing.player_id = p.player_id
        AND LOWER(TRIM(existing.alias_text)) = LOWER(TRIM('Example 03'))
  );
INSERT INTO aliases (
    public_id, revision, player_id, alias_text, alias_type, visibility,
    record_status, reviewed_by_user_account_id, reviewed_at_ms,
    created_at_ms, updated_at_ms
)
SELECT 'alias.tm-example-03', 1, p.player_id, 'Example 05', 'legacy_handle', 'public',
       'active', @reviewer, @now, @now, @now
FROM players AS p
WHERE p.player_kind = 'human'
  AND p.record_status = 'active'
  AND LOWER(TRIM(p.display_name)) = LOWER(TRIM('Example 06'))
  AND NOT EXISTS (
      SELECT 1 FROM aliases AS existing
      WHERE existing.player_id = p.player_id
        AND LOWER(TRIM(existing.alias_text)) = LOWER(TRIM('Example 05'))
  );
INSERT INTO aliases (
    public_id, revision, player_id, alias_text, alias_type, visibility,
    record_status, reviewed_by_user_account_id, reviewed_at_ms,
    created_at_ms, updated_at_ms
)
SELECT 'alias.tm-example-04', 1, p.player_id, 'Example 07', 'legacy_handle', 'public',
       'active', @reviewer, @now, @now, @now
FROM players AS p
WHERE p.player_kind = 'human'
  AND p.record_status = 'active'
  AND LOWER(TRIM(p.display_name)) = LOWER(TRIM('Example 08'))
  AND NOT EXISTS (
      SELECT 1 FROM aliases AS existing
      WHERE existing.player_id = p.player_id
        AND LOWER(TRIM(existing.alias_text)) = LOWER(TRIM('Example 07'))
  );
INSERT INTO aliases (
    public_id, revision, player_id, alias_text, alias_type, visibility,
    record_status, reviewed_by_user_account_id, reviewed_at_ms,
    created_at_ms, updated_at_ms
)
SELECT 'alias.tm-example-05', 1, p.player_id, 'Example 09', 'legacy_handle', 'public',
       'active', @reviewer, @now, @now, @now
FROM players AS p
WHERE p.player_kind = 'human'
  AND p.record_status = 'active'
  AND LOWER(TRIM(p.display_name)) = LOWER(TRIM('Example 08'))
  AND NOT EXISTS (
      SELECT 1 FROM aliases AS existing
      WHERE existing.player_id = p.player_id
        AND LOWER(TRIM(existing.alias_text)) = LOWER(TRIM('Example 09'))
  );
INSERT INTO aliases (
    public_id, revision, player_id, alias_text, alias_type, visibility,
    record_status, reviewed_by_user_account_id, reviewed_at_ms,
    created_at_ms, updated_at_ms
)
SELECT 'alias.tm-example-06', 1, p.player_id, 'Example 10', 'legacy_handle', 'public',
       'active', @reviewer, @now, @now, @now
FROM players AS p
WHERE p.player_kind = 'human'
  AND p.record_status = 'active'
  AND LOWER(TRIM(p.display_name)) = LOWER(TRIM('Example 11'))
  AND NOT EXISTS (
      SELECT 1 FROM aliases AS existing
      WHERE existing.player_id = p.player_id
        AND LOWER(TRIM(existing.alias_text)) = LOWER(TRIM('Example 10'))
  );
INSERT INTO aliases (
    public_id, revision, player_id, alias_text, alias_type, visibility,
    record_status, reviewed_by_user_account_id, reviewed_at_ms,
    created_at_ms, updated_at_ms
)
SELECT 'alias.tm-example-07', 1, p.player_id, 'Example 12', 'legacy_handle', 'public',
       'active', @reviewer, @now, @now, @now
FROM players AS p
WHERE p.player_kind = 'human'
  AND p.record_status = 'active'
  AND LOWER(TRIM(p.display_name)) = LOWER(TRIM('Example 13'))
  AND NOT EXISTS (
      SELECT 1 FROM aliases AS existing
      WHERE existing.player_id = p.player_id
        AND LOWER(TRIM(existing.alias_text)) = LOWER(TRIM('Example 12'))
  );
INSERT INTO aliases (
    public_id, revision, player_id, alias_text, alias_type, visibility,
    record_status, reviewed_by_user_account_id, reviewed_at_ms,
    created_at_ms, updated_at_ms
)
SELECT 'alias.tm-example-08', 1, p.player_id, 'Example 14', 'legacy_handle', 'public',
       'active', @reviewer, @now, @now, @now
FROM players AS p
WHERE p.player_kind = 'human'
  AND p.record_status = 'active'
  AND LOWER(TRIM(p.display_name)) = LOWER(TRIM('Example 15'))
  AND NOT EXISTS (
      SELECT 1 FROM aliases AS existing
      WHERE existing.player_id = p.player_id
        AND LOWER(TRIM(existing.alias_text)) = LOWER(TRIM('Example 14'))
  );
INSERT INTO aliases (
    public_id, revision, player_id, alias_text, alias_type, visibility,
    record_status, reviewed_by_user_account_id, reviewed_at_ms,
    created_at_ms, updated_at_ms
)
SELECT 'alias.tm-example-09', 1, p.player_id, 'Example 16', 'legacy_handle', 'public',
       'active', @reviewer, @now, @now, @now
FROM players AS p
WHERE p.player_kind = 'human'
  AND p.record_status = 'active'
  AND LOWER(TRIM(p.display_name)) = LOWER(TRIM('Example 17'))
  AND NOT EXISTS (
      SELECT 1 FROM aliases AS existing
      WHERE existing.player_id = p.player_id
        AND LOWER(TRIM(existing.alias_text)) = LOWER(TRIM('Example 16'))
  );
INSERT INTO aliases (
    public_id, revision, player_id, alias_text, alias_type, visibility,
    record_status, reviewed_by_user_account_id, reviewed_at_ms,
    created_at_ms, updated_at_ms
)
SELECT 'alias.tm-example-10', 1, p.player_id, 'Example 18', 'legacy_handle', 'public',
       'active', @reviewer, @now, @now, @now
FROM players AS p
WHERE p.player_kind = 'human'
  AND p.record_status = 'active'
  AND LOWER(TRIM(p.display_name)) = LOWER(TRIM('Example 19'))
  AND NOT EXISTS (
      SELECT 1 FROM aliases AS existing
      WHERE existing.player_id = p.player_id
        AND LOWER(TRIM(existing.alias_text)) = LOWER(TRIM('Example 18'))
  );
INSERT INTO aliases (
    public_id, revision, player_id, alias_text, alias_type, visibility,
    record_status, reviewed_by_user_account_id, reviewed_at_ms,
    created_at_ms, updated_at_ms
)
SELECT 'alias.tm-example-11', 1, p.player_id, 'Example 20', 'legacy_handle', 'public',
       'active', @reviewer, @now, @now, @now
FROM players AS p
WHERE p.player_kind = 'human'
  AND p.record_status = 'active'
  AND LOWER(TRIM(p.display_name)) = LOWER(TRIM('Example 21'))
  AND NOT EXISTS (
      SELECT 1 FROM aliases AS existing
      WHERE existing.player_id = p.player_id
        AND LOWER(TRIM(existing.alias_text)) = LOWER(TRIM('Example 20'))
  );
INSERT INTO aliases (
    public_id, revision, player_id, alias_text, alias_type, visibility,
    record_status, reviewed_by_user_account_id, reviewed_at_ms,
    created_at_ms, updated_at_ms
)
SELECT 'alias.tm-example-12', 1, p.player_id, 'Example 22', 'legacy_handle', 'public',
       'active', @reviewer, @now, @now, @now
FROM players AS p
WHERE p.player_kind = 'human'
  AND p.record_status = 'active'
  AND LOWER(TRIM(p.display_name)) = LOWER(TRIM('Example 23'))
  AND NOT EXISTS (
      SELECT 1 FROM aliases AS existing
      WHERE existing.player_id = p.player_id
        AND LOWER(TRIM(existing.alias_text)) = LOWER(TRIM('Example 22'))
  );

-- Provenance and lifecycle for every alias this migration created.

INSERT INTO alias_provenance (alias_id, sequence_number, source_type, source_reference, observed_at_ms)
SELECT a.alias_id, 1, 'tournament_manager',
       'source.tournament_manager_score_import_aliases_v1', a.created_at_ms
FROM aliases AS a
WHERE LEFT(a.public_id, 9) = 'alias.tm-'
  AND NOT EXISTS (
      SELECT 1 FROM alias_provenance AS existing WHERE existing.alias_id = a.alias_id
  );

INSERT INTO alias_lifecycle (
    alias_id, sequence_number, event_type, actor_user_account_id,
    visibility_after, record_status_after, reason_code, occurred_at_ms
)
SELECT a.alias_id, 1, 'alias_baseline_imported', a.reviewed_by_user_account_id,
       a.visibility, a.record_status, 'score_import_alias_baseline', a.created_at_ms
FROM aliases AS a
WHERE LEFT(a.public_id, 9) = 'alias.tm-'
  AND NOT EXISTS (
      SELECT 1 FROM alias_lifecycle AS existing WHERE existing.alias_id = a.alias_id
  );
