-- 0052: immutable Time Trial placement snapshots at publication time.
--
-- Existing publications deliberately remain NULL: calculating today's rank
-- would invent historical information. New publication events store the
-- Player's human-leaderboard position as it was when that revision became
-- public. Withheld events never carry a public placement.

ALTER TABLE time_trial_publications
    ADD COLUMN rank_at_publication INT UNSIGNED NULL
        AFTER published_at_ms,
    ADD CONSTRAINT ck_time_trial_publication_rank_snapshot CHECK (
        rank_at_publication IS NULL OR (
            publication_status = 'published' AND rank_at_publication >= 1
        )
    );

ALTER TABLE time_trial_publication_lifecycle
    ADD COLUMN rank_at_publication INT UNSIGNED NULL
        AFTER reason_code,
    ADD CONSTRAINT ck_time_trial_lifecycle_rank_snapshot CHECK (
        rank_at_publication IS NULL OR (
            publication_status_after = 'published'
            AND rank_at_publication >= 1
        )
    );
