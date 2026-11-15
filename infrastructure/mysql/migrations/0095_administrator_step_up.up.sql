-- 0095: fresh e-mail confirmation (step-up) before dangerous administrator actions.
--
-- api_step_up_challenges holds one row per confirmation link that was sent. The row is bound to the
-- signed-in session that asked for it (session_digest = SHA-256 of the Better Auth session id) and to
-- that session's account (auth_user_id). Only digests of the link token are stored. Opening the link and
-- pressing Confirm sets confirmed_at_ms once (a second use changes nothing) and opens a short window
-- (grant_expires_at_ms) in which that one session may perform dangerous actions. Rows past their link
-- and window are removed in bounded batches.
--
-- api_step_up_audit_events records what happened without any token, address or e-mail: a link was
-- requested, confirmed, refused or rate limited, and which dangerous route pattern was allowed or
-- refused for which account, and when a host operator issued the link of a pending request on the server
-- (step-up-operator-main.ts, for an installation whose e-mail fails). Rows older than 400 days are removed
-- in bounded batches.
CREATE TABLE api_step_up_challenges (
    step_up_challenge_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    session_digest BINARY(32) NOT NULL,
    auth_user_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    link_digest BINARY(32) NOT NULL,
    client_kind VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    requested_at_ms BIGINT UNSIGNED NOT NULL,
    link_expires_at_ms BIGINT UNSIGNED NOT NULL,
    confirmed_at_ms BIGINT UNSIGNED NULL,
    grant_expires_at_ms BIGINT UNSIGNED NULL,
    PRIMARY KEY (step_up_challenge_id),
    UNIQUE KEY uq_api_step_up_challenges_link (link_digest),
    KEY ix_api_step_up_challenges_session (session_digest, grant_expires_at_ms),
    KEY ix_api_step_up_challenges_expiry (link_expires_at_ms),
    CONSTRAINT ck_api_step_up_challenges_client CHECK (client_kind IN ('web', 'native')),
    CONSTRAINT ck_api_step_up_challenges_grant CHECK (
        (confirmed_at_ms IS NULL AND grant_expires_at_ms IS NULL) OR
        (confirmed_at_ms IS NOT NULL AND grant_expires_at_ms IS NOT NULL AND grant_expires_at_ms > confirmed_at_ms)
    )
);

CREATE TABLE api_step_up_audit_events (
    step_up_audit_event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    auth_user_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    session_digest BINARY(32) NULL,
    client_kind VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
    route_pattern VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NULL,
    occurred_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (step_up_audit_event_id),
    KEY ix_api_step_up_audit_user (auth_user_id, occurred_at_ms),
    KEY ix_api_step_up_audit_time (occurred_at_ms),
    CONSTRAINT ck_api_step_up_audit_kind CHECK (event_kind IN (
        'step_up_requested', 'step_up_rate_limited', 'step_up_confirmed', 'step_up_link_refused',
        'step_up_action_allowed', 'step_up_action_refused', 'step_up_operator_link'
    )),
    CONSTRAINT ck_api_step_up_audit_client CHECK (client_kind IS NULL OR client_kind IN ('web', 'native'))
);
