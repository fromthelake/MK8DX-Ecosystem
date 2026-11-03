-- 0057: the corrected tournament history, and the identity links behind it.
--
-- The legacy tables from 0025 recorded what mariokart8.nl published: finish
-- positions and the score it displayed, nothing more. ADR-0154 proved that
-- record exact, so it is frozen here as evidence and is never edited again.
--
-- The recorded videos TN07-TN12 then showed three things the legacy record got
-- wrong or could not hold: one section's races are numbered in the order they
-- were entered rather than the order they were played, two complete races were
-- never entered at all, and no race carries a track or a character. Correcting
-- the legacy rows in place would destroy the very thing ADR-0154 proved. So
-- the corrected history lives here instead, beside its source rather than on
-- top of it (owner decision, 2026-09-06).
--
-- A race keeps a surrogate id for its whole life. `race_index` is an attribute
-- of a race, not its identity, precisely because it changes: renumbering
-- TN11's Poule B moves eleven races by one, and anything bound to a race by
-- its number would silently follow the wrong one afterwards.
--
-- Evidence stays where it already lives. `tournament_race_result_revisions`
-- and `tournament_race_placements` (0006) hold what the video saw, including
-- the track, the character and the name on screen; a history race points at
-- the revision that evidences it. Nothing is copied that can be referenced.

CREATE TABLE tournament_history_sections (
    tournament_history_section_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_number INT UNSIGNED NOT NULL,
    -- 'qualifier' before 'final', which is also the order they were played.
    stage VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    sequence_number INT UNSIGNED NOT NULL,
    -- champion|talent|wild for a final; NULL for a qualification group.
    tier_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    -- Dutch, as the product shows it: "Kampioen", "Kwalificatie Groep 2".
    display_name VARCHAR(96) NOT NULL,
    -- Exactly what the legacy history called this section, so a row here can
    -- always be traced back to the rows it was built from. The wording changed
    -- over the years ("Poule A" became "Kwalificatie Groep 1", "1e Divisie"
    -- became "Kampioen"), and that history is worth keeping legible.
    legacy_section_label VARCHAR(96) NULL,
    roster_size TINYINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_history_section_id),
    UNIQUE KEY uq_history_section (tournament_number, stage, sequence_number),
    UNIQUE KEY uq_history_section_legacy (tournament_number, legacy_section_label),
    CONSTRAINT ck_history_section_stage CHECK (stage IN ('qualifier', 'final')),
    CONSTRAINT ck_history_section_roster CHECK (roster_size BETWEEN 2 AND 12)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE tournament_history_races (
    tournament_history_race_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_history_section_id BIGINT UNSIGNED NOT NULL,
    -- Chronological within the section, corrected where the video proved the
    -- legacy order wrong.
    race_index INT UNSIGNED NOT NULL,
    -- Chronological across the whole history; the order a replay walks.
    race_sequence INT UNSIGNED NOT NULL,
    -- What the legacy history called this race. NULL for a race the legacy
    -- history never held. Differs from race_index exactly where a correction
    -- was applied, which makes every correction visible without a changelog.
    legacy_race_index INT UNSIGNED NULL,
    -- 'legacy' - present in the legacy history;
    -- 'video_recovered' - proven by video, never entered at the time.
    origin VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    -- A race with a short field is evidence but does not score: a group of
    -- twelve racing with ten lost people to a connection error, and rating it
    -- would either punish those who dropped or hand the rest a free lead.
    counts_toward_rating TINYINT(1) NOT NULL DEFAULT 1,
    exclusion_reason VARCHAR(160) NULL,
    track_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
    -- The video evidence this race was read from, where there is any. TN4-TN6
    -- have no recordings and never will.
    tournament_race_result_revision_id BIGINT UNSIGNED NULL,
    PRIMARY KEY (tournament_history_race_id),
    UNIQUE KEY uq_history_race_index (tournament_history_section_id, race_index),
    UNIQUE KEY uq_history_race_sequence (race_sequence),
    KEY ix_history_race_evidence (tournament_race_result_revision_id),
    CONSTRAINT fk_history_race_section
        FOREIGN KEY (tournament_history_section_id)
        REFERENCES tournament_history_sections (tournament_history_section_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_history_race_evidence
        FOREIGN KEY (tournament_race_result_revision_id)
        REFERENCES tournament_race_result_revisions (tournament_race_result_revision_id)
        ON DELETE SET NULL ON UPDATE RESTRICT,
    CONSTRAINT ck_history_race_origin
        CHECK (origin IN ('legacy', 'video_recovered')),
    CONSTRAINT ck_history_race_numbers
        CHECK (race_index >= 1 AND race_sequence >= 1),
    -- A race that does not score has to say why.
    CONSTRAINT ck_history_race_exclusion CHECK (
        counts_toward_rating = 1 OR exclusion_reason IS NOT NULL
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE tournament_history_placements (
    tournament_history_placement_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_history_race_id BIGINT UNSIGNED NOT NULL,
    player_id BIGINT UNSIGNED NOT NULL,
    finish_position TINYINT UNSIGNED NOT NULL,
    -- From the video. NULL where there is no recording.
    race_points SMALLINT UNSIGNED NULL,
    total_after_race SMALLINT UNSIGNED NULL,
    rank_after_race TINYINT UNSIGNED NULL,
    character_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
    character_variant_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
    -- The name on the console that race. Kept per placement because it is a
    -- fact about that race, not about the player: people swapped seats.
    observed_player_name VARCHAR(64) NULL,
    -- The score mariokart8.nl displayed after this race, preserved so the
    -- proven legacy trajectory stays readable next to any recalculation.
    legacy_score_after DECIMAL(10, 2) NULL,
    PRIMARY KEY (tournament_history_placement_id),
    UNIQUE KEY uq_history_placement_player (tournament_history_race_id, player_id),
    UNIQUE KEY uq_history_placement_position (
        tournament_history_race_id, finish_position
    ),
    KEY ix_history_placement_player (player_id),
    KEY ix_history_placement_character (character_id),
    CONSTRAINT fk_history_placement_race
        FOREIGN KEY (tournament_history_race_id)
        REFERENCES tournament_history_races (tournament_history_race_id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT fk_history_placement_player FOREIGN KEY (player_id)
        REFERENCES players (player_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_history_placement_position
        CHECK (finish_position BETWEEN 1 AND 12)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Which person was behind a name on screen, for one section of one tournament.
--
-- Not per person and not per tournament: "Name A" is Player B in TN08 and
-- Player C in TN10, and the extractor's own suffixes "Name D_1"/"Name D_2" mean
-- nothing outside the single recording that produced them. A section is the
-- narrowest scope that is still stable.
--
-- The derived link is a starting point, not a verdict. A name that matches a
-- player exactly can still be the wrong person - in TN07 the screen said
-- "Name D" for the 242 points the history credits to Player E - so every link
-- carries the evidence that produced it and can be replaced by hand.
CREATE TABLE tournament_observed_identity_links (
    tournament_observed_identity_link_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_history_section_id BIGINT UNSIGNED NOT NULL,
    observed_name VARCHAR(64) NOT NULL,
    player_id BIGINT UNSIGNED NOT NULL,
    -- 'derived' - produced by the binder; 'manual' - a person decided.
    decision_source VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    -- The evidence, kept so a reviewer can see why the binder concluded this.
    order_agreement DECIMAL(5, 4) NULL,
    video_points SMALLINT UNSIGNED NULL,
    history_points SMALLINT UNSIGNED NULL,
    note VARCHAR(240) NULL,
    decided_by_user_account_id BIGINT UNSIGNED NULL,
    decided_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_observed_identity_link_id),
    UNIQUE KEY uq_observed_identity (tournament_history_section_id, observed_name),
    KEY ix_observed_identity_player (player_id),
    CONSTRAINT fk_observed_identity_section
        FOREIGN KEY (tournament_history_section_id)
        REFERENCES tournament_history_sections (tournament_history_section_id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT fk_observed_identity_player FOREIGN KEY (player_id)
        REFERENCES players (player_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_observed_identity_account
        FOREIGN KEY (decided_by_user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE SET NULL ON UPDATE RESTRICT,
    CONSTRAINT ck_observed_identity_source
        CHECK (decision_source IN ('derived', 'manual')),
    CONSTRAINT ck_observed_identity_name CHECK (CHAR_LENGTH(observed_name) >= 1)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
