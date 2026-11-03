-- A Nintendo Switch sits in a group's slot whether or not anybody is seated at
-- it yet. Until now a console existed in a group only through the Players
-- seated at it (tournament_group_members.station_*): a Switch placed in an
-- empty slot, with its two seats still to be filled, had nowhere to live and
-- vanished on the next layout write. This table is the slot order itself:
-- one row per console per group, in the order the board shows them.
CREATE TABLE tournament_group_stations (
    tournament_group_station_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_group_id BIGINT UNSIGNED NOT NULL,
    slot_index SMALLINT UNSIGNED NOT NULL,
    owner_player_id BIGINT UNSIGNED NOT NULL,
    switch_type VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_group_station_id),
    UNIQUE KEY uq_tournament_group_station_slot (tournament_group_id, slot_index),
    UNIQUE KEY uq_tournament_group_station_console (
        tournament_group_id, owner_player_id, switch_type
    ),
    KEY ix_tournament_group_station_owner (owner_player_id),
    CONSTRAINT fk_tournament_group_station_group
        FOREIGN KEY (tournament_group_id)
        REFERENCES tournament_groups (tournament_group_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_tournament_group_station_owner
        FOREIGN KEY (owner_player_id)
        REFERENCES players (player_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_tournament_group_station_slot CHECK (slot_index >= 1 AND slot_index <= 6),
    CONSTRAINT ck_tournament_group_station_type CHECK (switch_type IN ('ns1', 'ns2'))
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Every console a seated Player already sits at becomes a row, in the order
-- the seats were written, so an existing draw keeps its slots exactly.
INSERT INTO tournament_group_stations (
    tournament_group_id, slot_index, owner_player_id, switch_type, created_at_ms, updated_at_ms
)
SELECT ordered.tournament_group_id,
       ordered.slot_index,
       ordered.station_owner_player_id,
       ordered.station_switch_type,
       UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000,
       UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000
FROM (
    SELECT firsts.tournament_group_id,
           firsts.station_owner_player_id,
           firsts.station_switch_type,
           ROW_NUMBER() OVER (
               PARTITION BY firsts.tournament_group_id ORDER BY firsts.first_seat_order
           ) AS slot_index
    FROM (
        SELECT member.tournament_group_id,
               member.station_owner_player_id,
               member.station_switch_type,
               MIN(member.seat_order) AS first_seat_order
        FROM tournament_group_members AS member
        WHERE member.station_owner_player_id IS NOT NULL
          AND member.station_switch_type IS NOT NULL
        GROUP BY member.tournament_group_id, member.station_owner_player_id, member.station_switch_type
    ) AS firsts
) AS ordered
WHERE ordered.slot_index <= 6;
