ALTER TABLE tournament_race_result_revisions
    ADD UNIQUE KEY uq_tournament_race_revision_identity_result (
        tournament_race_result_revision_id,
        tournament_race_result_id
    );

CREATE TABLE tournament_publications (
    tournament_publication_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    event_name VARCHAR(128) NOT NULL,
    publication_revision BIGINT UNSIGNED NOT NULL,
    publication_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    published_at_ms BIGINT UNSIGNED NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_publication_id),
    UNIQUE KEY uq_tournament_publications_public_id (public_id),
    CONSTRAINT ck_tournament_publication_public_id CHECK (
        public_id REGEXP '^tournament_publication\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$'
    ),
    CONSTRAINT ck_tournament_publication_event_name CHECK (
        CHAR_LENGTH(event_name) BETWEEN 1 AND 128
    ),
    CONSTRAINT ck_tournament_publication_revision CHECK (
        publication_revision >= 1
    ),
    CONSTRAINT ck_tournament_publication_status CHECK (
        publication_status IN ('published', 'retracted')
    ),
    CONSTRAINT ck_tournament_publication_timestamps CHECK (
        updated_at_ms <= 253402300799999
        AND (
            (publication_status = 'published'
                AND published_at_ms IS NOT NULL
                AND published_at_ms <= updated_at_ms)
            OR
            (publication_status = 'retracted' AND published_at_ms IS NULL)
        )
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE tournament_publication_lifecycle (
    tournament_publication_lifecycle_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_publication_id BIGINT UNSIGNED NOT NULL,
    publication_revision BIGINT UNSIGNED NOT NULL,
    event_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    publication_status_after VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    event_name_after VARCHAR(128) NOT NULL,
    actor_user_account_id BIGINT UNSIGNED NOT NULL,
    reason_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    occurred_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_publication_lifecycle_id),
    UNIQUE KEY uq_tournament_publication_lifecycle_revision (
        tournament_publication_id,
        publication_revision
    ),
    KEY ix_tournament_publication_lifecycle_actor (actor_user_account_id),
    CONSTRAINT fk_tournament_publication_lifecycle_publication
        FOREIGN KEY (tournament_publication_id)
        REFERENCES tournament_publications (tournament_publication_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_tournament_publication_lifecycle_actor
        FOREIGN KEY (actor_user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_tournament_publication_lifecycle_revision CHECK (
        publication_revision >= 1
    ),
    CONSTRAINT ck_tournament_publication_lifecycle_event CHECK (
        event_type IN ('published', 'retracted')
    ),
    CONSTRAINT ck_tournament_publication_lifecycle_status CHECK (
        publication_status_after IN ('published', 'retracted')
    ),
    CONSTRAINT ck_tournament_publication_lifecycle_event_state CHECK (
        (event_type = 'published' AND publication_status_after = 'published')
        OR
        (event_type = 'retracted' AND publication_status_after = 'retracted')
    ),
    CONSTRAINT ck_tournament_publication_lifecycle_event_name CHECK (
        CHAR_LENGTH(event_name_after) BETWEEN 1 AND 128
    ),
    CONSTRAINT ck_tournament_publication_lifecycle_reason CHECK (
        reason_code REGEXP '^[a-z0-9]+([._-][a-z0-9]+)*$'
    ),
    CONSTRAINT ck_tournament_publication_lifecycle_time CHECK (
        occurred_at_ms <= 253402300799999
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE tournament_publication_lifecycle_members (
    tournament_publication_lifecycle_member_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_publication_lifecycle_id BIGINT UNSIGNED NOT NULL,
    sequence_number SMALLINT UNSIGNED NOT NULL,
    tournament_race_result_id BIGINT UNSIGNED NOT NULL,
    tournament_race_result_revision_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_publication_lifecycle_member_id),
    UNIQUE KEY uq_tournament_publication_lifecycle_member_sequence (
        tournament_publication_lifecycle_id,
        sequence_number
    ),
    UNIQUE KEY uq_tournament_publication_lifecycle_member_result (
        tournament_publication_lifecycle_id,
        tournament_race_result_id
    ),
    CONSTRAINT fk_tournament_publication_lifecycle_member_lifecycle
        FOREIGN KEY (tournament_publication_lifecycle_id)
        REFERENCES tournament_publication_lifecycle (
            tournament_publication_lifecycle_id
        ) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_tournament_publication_lifecycle_member_result
        FOREIGN KEY (tournament_race_result_id)
        REFERENCES tournament_race_results (tournament_race_result_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_tournament_publication_lifecycle_member_revision
        FOREIGN KEY (
            tournament_race_result_revision_id,
            tournament_race_result_id
        ) REFERENCES tournament_race_result_revisions (
            tournament_race_result_revision_id,
            tournament_race_result_id
        ) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_tournament_publication_lifecycle_member_sequence CHECK (
        sequence_number BETWEEN 1 AND 200
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE tournament_publication_current_members (
    tournament_publication_current_member_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_publication_id BIGINT UNSIGNED NOT NULL,
    sequence_number SMALLINT UNSIGNED NOT NULL,
    tournament_race_result_id BIGINT UNSIGNED NOT NULL,
    tournament_race_result_revision_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_publication_current_member_id),
    UNIQUE KEY uq_tournament_publication_current_sequence (
        tournament_publication_id,
        sequence_number
    ),
    UNIQUE KEY uq_tournament_publication_current_publication_result (
        tournament_publication_id,
        tournament_race_result_id
    ),
    UNIQUE KEY uq_tournament_publication_current_result (
        tournament_race_result_id
    ),
    CONSTRAINT fk_tournament_publication_current_publication
        FOREIGN KEY (tournament_publication_id)
        REFERENCES tournament_publications (tournament_publication_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_tournament_publication_current_result
        FOREIGN KEY (tournament_race_result_id)
        REFERENCES tournament_race_results (tournament_race_result_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_tournament_publication_current_revision
        FOREIGN KEY (
            tournament_race_result_revision_id,
            tournament_race_result_id
        ) REFERENCES tournament_race_result_revisions (
            tournament_race_result_revision_id,
            tournament_race_result_id
        ) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_tournament_publication_current_sequence CHECK (
        sequence_number BETWEEN 1 AND 200
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
