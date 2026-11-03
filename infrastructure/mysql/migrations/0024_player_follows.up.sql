-- 0024: personal follows - a second PRIVATE Player-list preference.
--
-- FOLLOW is distinct from RIVAL: a rival feeds competitive comparisons
-- and challenges, a follow only raises the personal relevance of that
-- Player's public activity in curated views. Like rivals, follows are
-- never a social graph: no consent, no notification to the followed
-- Player, no follower counts, and the selection itself is not public.

CREATE TABLE player_follows (
    player_follow_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_account_id BIGINT UNSIGNED NOT NULL,
    followed_player_id BIGINT UNSIGNED NOT NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (player_follow_id),
    UNIQUE KEY uq_player_follows_choice (user_account_id, followed_player_id),
    CONSTRAINT fk_player_follows_account FOREIGN KEY (user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_player_follows_player FOREIGN KEY (followed_player_id)
        REFERENCES players (player_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
