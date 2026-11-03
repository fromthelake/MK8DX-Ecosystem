-- 0023: personal rivals and the Home comeback snapshot.
--
-- Rivals are a PRIVATE account preference (never a social graph): the
-- chosen rival needs no consent, gets no notification, and the
-- selection itself is not public. Comparisons built on it use only
-- public competitive data.
--
-- The comeback snapshot stores the minimal THEN-state needed to tell a
-- returning Player what changed: two generations per account ('prev'
-- is the displayed baseline, 'curr' the state recorded at the last
-- meaningful visit). Nothing behavioral is stored - no clicks, no
-- history beyond the two generations.

CREATE TABLE player_rivals (
    player_rival_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_account_id BIGINT UNSIGNED NOT NULL,
    rival_player_id BIGINT UNSIGNED NOT NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (player_rival_id),
    UNIQUE KEY uq_player_rivals_choice (user_account_id, rival_player_id),
    CONSTRAINT fk_player_rivals_account FOREIGN KEY (user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_player_rivals_player FOREIGN KEY (rival_player_id)
        REFERENCES players (player_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE home_snapshots (
    home_snapshot_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_account_id BIGINT UNSIGNED NOT NULL,
    generation VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    tt_standing INT UNSIGNED NULL,
    snapshot_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (home_snapshot_id),
    UNIQUE KEY uq_home_snapshots_generation (user_account_id, generation),
    CONSTRAINT fk_home_snapshots_account FOREIGN KEY (user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_home_snapshots_generation CHECK (
        generation IN ('prev', 'curr')
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE home_snapshot_rivals (
    home_snapshot_rival_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_account_id BIGINT UNSIGNED NOT NULL,
    generation VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    rival_player_id BIGINT UNSIGNED NOT NULL,
    tracks_ahead INT UNSIGNED NOT NULL,
    tracks_behind INT UNSIGNED NOT NULL,
    shared_combos INT UNSIGNED NOT NULL,
    total_delta_ms BIGINT NOT NULL,
    PRIMARY KEY (home_snapshot_rival_id),
    UNIQUE KEY uq_home_snapshot_rivals (
        user_account_id, generation, rival_player_id
    ),
    CONSTRAINT fk_home_snapshot_rivals_account FOREIGN KEY (user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_home_snapshot_rivals_player FOREIGN KEY (rival_player_id)
        REFERENCES players (player_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_home_snapshot_rivals_generation CHECK (
        generation IN ('prev', 'curr')
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
