-- 0017: tournament rating decisions and deterministic recalculation epochs
-- (ADR-0155). Rating events gain an epoch: 0 is the original timeline and
-- every recalculation appends a complete new epoch, keyed by the audited
-- recalculation row id, without touching earlier epochs.

CREATE TABLE rating_recalculations (
    rating_recalculation_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    reason_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    triggered_by_user_account_id BIGINT UNSIGNED NOT NULL,
    included_publications INT UNSIGNED NOT NULL,
    applied_races INT UNSIGNED NOT NULL,
    skipped_races INT UNSIGNED NOT NULL,
    occurred_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (rating_recalculation_id),
    CONSTRAINT fk_rating_recalculation_actor
        FOREIGN KEY (triggered_by_user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_rating_recalculation_reason CHECK (
        CHAR_LENGTH(reason_code) >= 1
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE tournament_rating_decisions (
    tournament_rating_decision_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_publication_id BIGINT UNSIGNED NOT NULL,
    sequence_number BIGINT UNSIGNED NOT NULL,
    rating_included BOOLEAN NOT NULL,
    reason_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    decided_by_user_account_id BIGINT UNSIGNED NOT NULL,
    occurred_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_rating_decision_id),
    UNIQUE KEY uq_tournament_rating_decision_sequence (
        tournament_publication_id,
        sequence_number
    ),
    CONSTRAINT fk_tournament_rating_decision_publication
        FOREIGN KEY (tournament_publication_id)
        REFERENCES tournament_publications (tournament_publication_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_tournament_rating_decision_actor
        FOREIGN KEY (decided_by_user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_tournament_rating_decision_sequence CHECK (
        sequence_number >= 1
    ),
    CONSTRAINT ck_tournament_rating_decision_reason CHECK (
        CHAR_LENGTH(reason_code) >= 1
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The new uniqueness must exist BEFORE the old one is dropped: the old
-- unique key is the only index covering the player_id foreign key, and
-- InnoDB refuses to drop the last covering index. Both keys start with
-- player_id, so the foreign key stays covered throughout.
ALTER TABLE player_rating_events
    ADD COLUMN rating_epoch BIGINT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE player_rating_events
    ADD UNIQUE KEY uq_player_rating_events_epoch_sequence (
        player_id,
        rating_epoch,
        sequence_number
    );
ALTER TABLE player_rating_events
    DROP INDEX uq_player_rating_events_sequence;
