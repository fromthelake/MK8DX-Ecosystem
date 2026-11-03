-- 0025: legacy tournament race history (mariokart8.nl, TN4..TN12).
--
-- Purpose: the per-race competitive history behind the imported rating
-- seed - finish positions and the legacy-displayed score after each
-- race - so the product can show TrueSkill progression graphs and
-- head-to-head statistics. The canonical TypeScript rating engine was
-- proven bit-compatible with exactly this history (ADR-0154), so the
-- stored trajectory and the seeded ratings agree.
--
-- Deliberately SEPARATE from the TournamentRaceResultV1 evidence model:
-- the legacy site never recorded tracks, race points, or capture
-- provenance, and fabricating those fields would poison the V1
-- contract. Only source-observed facts are stored (tournament number,
-- section label, race index, finish position, legacy score), linked to
-- canonical Players via the restricted mapping. Observed legacy names
-- stay outside this schema entirely.
--
-- Owner decision 2026-08-21: this content is community data of the
-- hosted mk8dx.example instance only. A future open-source data
-- package may ship the schema but must NOT ship these rows.

CREATE TABLE legacy_tournament_races (
    legacy_tournament_race_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    race_sequence INT UNSIGNED NOT NULL,
    tournament_number INT UNSIGNED NOT NULL,
    section_label VARCHAR(96) NOT NULL,
    race_index INT UNSIGNED NOT NULL,
    PRIMARY KEY (legacy_tournament_race_id),
    UNIQUE KEY uq_legacy_tournament_race (
        tournament_number, section_label, race_index
    ),
    UNIQUE KEY uq_legacy_tournament_race_sequence (race_sequence),
    CONSTRAINT ck_legacy_race_numbers CHECK (
        race_sequence >= 1 AND tournament_number >= 1 AND race_index >= 1
    ),
    CONSTRAINT ck_legacy_race_section CHECK (
        CHAR_LENGTH(section_label) >= 1
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE legacy_race_placements (
    legacy_race_placement_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    legacy_tournament_race_id BIGINT UNSIGNED NOT NULL,
    player_id BIGINT UNSIGNED NOT NULL,
    finish_position TINYINT UNSIGNED NOT NULL,
    score_after DECIMAL(10, 2) NOT NULL,
    score_delta DECIMAL(10, 2) NULL,
    PRIMARY KEY (legacy_race_placement_id),
    UNIQUE KEY uq_legacy_race_placement_player (
        legacy_tournament_race_id, player_id
    ),
    UNIQUE KEY uq_legacy_race_placement_position (
        legacy_tournament_race_id, finish_position
    ),
    KEY ix_legacy_race_placement_player (player_id),
    CONSTRAINT fk_legacy_race_placement_race
        FOREIGN KEY (legacy_tournament_race_id)
        REFERENCES legacy_tournament_races (legacy_tournament_race_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_legacy_race_placement_player FOREIGN KEY (player_id)
        REFERENCES players (player_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_legacy_race_placement_position CHECK (
        finish_position BETWEEN 1 AND 12
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
