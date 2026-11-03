ALTER TABLE restricted_authentication_binding_lifecycle
    DROP CONSTRAINT ck_auth_binding_lifecycle_actor,
    ADD CONSTRAINT ck_auth_binding_lifecycle_actor CHECK (
        (actor_type = 'administrator'
            AND actor_user_account_id IS NOT NULL
            AND actor_reference IS NULL)
        OR
        (actor_type = 'migration_operator'
            AND actor_user_account_id IS NULL
            AND actor_reference IS NOT NULL)
    );
