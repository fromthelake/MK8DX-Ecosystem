-- 0044: new operations always follow the full source-derived Step 0-10 flow.
-- Existing finalized compact events remain historical evidence; only active
-- compact operations are expanded so their qualifier result remains intact
-- and they can continue with final groups from Step 6.
UPDATE tournaments
SET qualifier_rounds = TRUE,
    workflow_step = CASE WHEN workflow_step > 6 THEN workflow_step ELSE 6 END,
    stage = CASE WHEN workflow_step > 6 THEN stage ELSE 'qualifiers' END,
    revision = revision + 1,
    updated_at_ms = GREATEST(updated_at_ms, UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000)
WHERE lifecycle_status = 'active'
  AND stage <> 'finalized'
  AND qualifier_rounds = FALSE;

-- Cable identity belongs to a physical Player-owned Switch, not to a group
-- or tournament. The auto-increment key is the stable positive cable number.
CREATE TABLE tournament_station_cables (
    cable_number BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    owner_player_id BIGINT UNSIGNED NOT NULL,
    switch_type VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision INT UNSIGNED NOT NULL DEFAULT 1,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (cable_number),
    UNIQUE KEY uq_tournament_station_cable_owner (owner_player_id, switch_type),
    CONSTRAINT fk_tournament_station_cable_owner
        FOREIGN KEY (owner_player_id) REFERENCES players (player_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_tournament_station_cable_switch CHECK (switch_type IN ('ns1', 'ns2')),
    CONSTRAINT ck_tournament_station_cable_revision CHECK (revision >= 1)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO tournament_station_cables (
    owner_player_id, switch_type, revision, created_at_ms, updated_at_ms
)
SELECT participant.player_id, station.switch_type, 1,
       MIN(participant.added_at_ms), MAX(participant.updated_at_ms)
FROM tournament_participants AS participant
JOIN (
    SELECT 'ns1' AS switch_type
    UNION ALL SELECT 'ns2'
) AS station
  ON (station.switch_type = 'ns1' AND participant.has_switch_1 = TRUE)
  OR (station.switch_type = 'ns2' AND participant.has_switch_2 = TRUE)
GROUP BY participant.player_id, station.switch_type;
