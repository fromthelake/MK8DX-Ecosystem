-- 0070 down: restore the 0033 auth-audit vocabulary.
ALTER TABLE mk8dx_auth_audit_event
    DROP CONSTRAINT ck_mk8dx_auth_audit_kind,
    DROP CONSTRAINT ck_mk8dx_auth_audit_shape,
    ADD CONSTRAINT ck_mk8dx_auth_audit_kind CHECK (
        event_kind IN (
            'auth_user_created',
            'auth_session_created',
            'auth_session_revoked',
            'device_authorization_requested',
            'device_authorization_operator_approved'
        )
    ),
    ADD CONSTRAINT ck_mk8dx_auth_audit_shape CHECK (
        (event_kind = 'auth_user_created'
            AND subject_id IS NOT NULL
            AND session_id IS NULL
            AND client_id IS NULL)
        OR
        (event_kind IN ('auth_session_created', 'auth_session_revoked')
            AND subject_id IS NOT NULL
            AND session_id IS NOT NULL
            AND client_id IS NULL)
        OR
        (event_kind = 'device_authorization_requested'
            AND subject_id IS NULL
            AND session_id IS NULL
            AND client_id IS NOT NULL)
        OR
        (event_kind = 'device_authorization_operator_approved'
            AND subject_id IS NOT NULL
            AND session_id IS NULL
            AND client_id IS NOT NULL)
    );
