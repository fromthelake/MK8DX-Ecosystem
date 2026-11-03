-- 0071: a YouTube video the Player attaches to their own Time Trial (owner 2026-09-28: "I want a
-- user to be able to add a youtube link for their uploaded video, to attach to a run"; optional in
-- Post a Time, added, changed or removed later in Manage).
--
-- One video per result, keyed by the submission rather than a revision, so it survives every later
-- correction or completion of the same run. Only the eleven-character YouTube video id is kept; the
-- public link is always rebuilt as https://www.youtube.com/watch?v=<id>, so nothing else a person
-- pasted (tracking parameters, other sites) is ever stored or shown. Removing the link deletes the
-- row: it is the Player's own optional attachment, not part of the result's history.
CREATE TABLE time_trial_videos (
    time_trial_submission_id BIGINT UNSIGNED NOT NULL,
    youtube_video_id CHAR(11) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    set_by_user_account_id BIGINT UNSIGNED NOT NULL,
    set_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (time_trial_submission_id),
    CONSTRAINT fk_time_trial_video_submission
        FOREIGN KEY (time_trial_submission_id)
        REFERENCES time_trial_submissions (time_trial_submission_id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT fk_time_trial_video_account
        FOREIGN KEY (set_by_user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_time_trial_video_id CHECK (
        youtube_video_id REGEXP '^[A-Za-z0-9_-]{11}$'
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
