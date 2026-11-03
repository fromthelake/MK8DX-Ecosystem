-- ADR-0220: a signed-in account that is not a Director may ask to host Tournaments. The request waits
-- for an administrator, who approves it (the existing tournament.operation grant, linked here) or
-- declines it with an optional reason. One open request per account: the generated column is the
-- account only while the request is open, so the unique key ignores decided requests. Two new
-- notification kinds carry the request to the administrators and the outcome back to the person.
CREATE TABLE director_host_requests (
    director_host_request_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id VARCHAR(180) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_account_id BIGINT UNSIGNED NOT NULL,
    request_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    note VARCHAR(300) NULL,
    requested_at_ms BIGINT UNSIGNED NOT NULL,
    decided_by_user_account_id BIGINT UNSIGNED NULL,
    decided_at_ms BIGINT UNSIGNED NULL,
    decline_reason VARCHAR(300) NULL,
    account_capability_grant_id BIGINT UNSIGNED NULL,
    open_user_account_id BIGINT UNSIGNED GENERATED ALWAYS AS (
        CASE WHEN request_status = 'open' THEN user_account_id ELSE NULL END
    ) STORED,
    PRIMARY KEY (director_host_request_id),
    UNIQUE KEY uq_director_host_requests_public_id (public_id),
    UNIQUE KEY uq_director_host_requests_open_account (open_user_account_id),
    KEY ix_director_host_requests_account (user_account_id, requested_at_ms),
    KEY ix_director_host_requests_status (request_status, requested_at_ms),
    KEY ix_director_host_requests_decider (decided_by_user_account_id),
    KEY ix_director_host_requests_grant (account_capability_grant_id),
    CONSTRAINT fk_director_host_requests_account FOREIGN KEY (user_account_id)
        REFERENCES user_accounts (user_account_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_director_host_requests_decider FOREIGN KEY (decided_by_user_account_id)
        REFERENCES user_accounts (user_account_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_director_host_requests_grant FOREIGN KEY (account_capability_grant_id)
        REFERENCES account_capability_grants (account_capability_grant_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_director_host_requests_public_id CHECK (LEFT(public_id, 22) = 'director_host_request.'),
    CONSTRAINT ck_director_host_requests_status CHECK (request_status IN ('open', 'approved', 'declined')),
    CONSTRAINT ck_director_host_requests_note CHECK (note IS NULL OR CHAR_LENGTH(note) BETWEEN 1 AND 300),
    CONSTRAINT ck_director_host_requests_reason CHECK (
        decline_reason IS NULL OR (request_status = 'declined' AND CHAR_LENGTH(decline_reason) BETWEEN 1 AND 300)
    ),
    CONSTRAINT ck_director_host_requests_decision CHECK (
        (request_status = 'open' AND decided_at_ms IS NULL AND decided_by_user_account_id IS NULL)
        OR (request_status <> 'open' AND decided_at_ms IS NOT NULL AND decided_by_user_account_id IS NOT NULL)
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE notifications
    DROP CONSTRAINT ck_notifications_kind,
    ADD CONSTRAINT ck_notifications_kind CHECK (
        notification_kind IN (
            'overtaken', 'reaction_received', 'claim_decided',
            'claim_requested',
            'result_published', 'group_invited', 'group_joined',
            'group_left', 'group_removed', 'group_role_changed',
            'world_record',
            'poke', 'rock_paper_scissors', 'dice_roll', 'challenge',
            'host_requested', 'host_request_decided'
        )
    );
