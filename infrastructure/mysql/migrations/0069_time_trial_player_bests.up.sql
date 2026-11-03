CREATE TABLE time_trial_player_bests (
    player_id BIGINT UNSIGNED NOT NULL,
    track_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    mode_cc SMALLINT UNSIGNED NOT NULL,
    time_trial_publication_id BIGINT UNSIGNED NOT NULL,
    time_trial_submission_revision_id BIGINT UNSIGNED NOT NULL,
    total_time_ms INT UNSIGNED NOT NULL,
    published_at_ms BIGINT UNSIGNED NOT NULL,
    public_eligible TINYINT UNSIGNED NOT NULL,
    PRIMARY KEY (player_id, track_id, mode_cc),
    UNIQUE KEY uq_time_trial_player_best_publication (
        time_trial_publication_id
    ),
    UNIQUE KEY uq_time_trial_player_best_revision (
        time_trial_submission_revision_id
    ),
    KEY ix_time_trial_player_best_track_mode_time (
        track_id, mode_cc, public_eligible, total_time_ms, player_id
    ),
    KEY ix_time_trial_player_best_mode_player (mode_cc, player_id),
    CONSTRAINT fk_time_trial_player_best_player FOREIGN KEY (player_id)
        REFERENCES players (player_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_time_trial_player_best_publication
        FOREIGN KEY (time_trial_publication_id)
        REFERENCES time_trial_publications (time_trial_publication_id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT fk_time_trial_player_best_revision
        FOREIGN KEY (time_trial_submission_revision_id)
        REFERENCES time_trial_submission_revisions (
            time_trial_submission_revision_id
        ) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_time_trial_player_best_mode CHECK (mode_cc IN (150, 200)),
    CONSTRAINT ck_time_trial_player_best_track CHECK (
        track_id REGEXP '^track\\.[a-z0-9]+(_[a-z0-9]+)*$'
    ),
    CONSTRAINT ck_time_trial_player_best_time CHECK (
        total_time_ms BETWEEN 1 AND 599999
    ),
    CONSTRAINT ck_time_trial_player_best_public_eligible CHECK (
        public_eligible IN (0, 1)
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO time_trial_player_bests (
    player_id, track_id, mode_cc, time_trial_publication_id,
    time_trial_submission_revision_id, total_time_ms, published_at_ms,
    public_eligible
)
SELECT ranked.player_id, ranked.track_id, ranked.mode_cc,
       ranked.time_trial_publication_id,
       ranked.time_trial_submission_revision_id,
       ranked.total_time_ms, ranked.published_at_ms,
       ranked.public_eligible
FROM (
    SELECT revision.player_id, revision.track_id, revision.mode_cc,
           publication.time_trial_publication_id,
           revision.time_trial_submission_revision_id,
           revision.total_time_ms, publication.published_at_ms,
           (player.record_status = 'active' AND player.visibility = 'public')
             AS public_eligible,
           ROW_NUMBER() OVER (
               PARTITION BY revision.player_id, revision.track_id,
                            revision.mode_cc
               ORDER BY revision.total_time_ms ASC,
                        publication.published_at_ms DESC,
                        submission.public_id DESC
           ) AS player_best
    FROM time_trial_publications AS publication
    INNER JOIN time_trial_submission_revisions AS revision
      ON revision.time_trial_submission_revision_id =
         publication.current_revision_id
     AND revision.time_trial_submission_id =
         publication.time_trial_submission_id
    INNER JOIN time_trial_submissions AS submission
      ON submission.time_trial_submission_id =
         publication.time_trial_submission_id
    INNER JOIN players AS player ON player.player_id = revision.player_id
    WHERE publication.publication_status = 'published'
      AND revision.player_id IS NOT NULL
) AS ranked
WHERE ranked.player_best = 1;

ALTER TABLE time_trial_publications
    ADD KEY ix_time_trial_publication_status_updated (
        publication_status, updated_at_ms, current_revision_id
    );

ALTER TABLE time_trial_submission_revisions
    ADD KEY ix_time_trial_revision_player_combo_time (
        player_id, track_id, mode_cc, total_time_ms
    );
