-- ADR-0216: short notes between the person asking for a claim and its reviewers, and Directors as
-- reviewers beside administrators in the claim's audit trail.
CREATE TABLE player_claim_notes (
    claim_note_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    player_claim_id BIGINT UNSIGNED NOT NULL,
    author_user_account_id BIGINT UNSIGNED NOT NULL,
    author_role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    note_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    body VARCHAR(500) NOT NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (claim_note_id),
    KEY ix_claim_notes_claim (player_claim_id, created_at_ms),
    KEY ix_claim_notes_author (author_user_account_id),
    CONSTRAINT fk_claim_notes_claim FOREIGN KEY (player_claim_id)
        REFERENCES player_claims (player_claim_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_claim_notes_author FOREIGN KEY (author_user_account_id)
        REFERENCES user_accounts (user_account_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_claim_notes_role CHECK (author_role IN ('requester', 'reviewer')),
    CONSTRAINT ck_claim_notes_kind CHECK (note_kind IN ('request', 'question', 'reply', 'decision')),
    CONSTRAINT ck_claim_notes_body CHECK (CHAR_LENGTH(body) BETWEEN 1 AND 500)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE player_claim_lifecycle
    DROP CONSTRAINT ck_claim_lifecycle_actor;

ALTER TABLE player_claim_lifecycle
    ADD CONSTRAINT ck_claim_lifecycle_actor CHECK (
        actor_type IN ('requesting_account', 'administrator', 'director')
    );
