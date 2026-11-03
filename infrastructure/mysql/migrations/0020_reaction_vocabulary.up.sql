-- 0020: the owner-approved curated reaction vocabulary.
--
-- The reaction layer stays a server-controlled allowlist (never free
-- Unicode with a blacklist): only these twenty child-friendly keys can
-- be persisted. Emoji rendering is a client concern; the database stores
-- stable ascii keys.

ALTER TABLE time_trial_reactions
    DROP CONSTRAINT ck_time_trial_reactions_kind;

ALTER TABLE time_trial_reactions
    ADD CONSTRAINT ck_time_trial_reactions_kind CHECK (
        reaction_kind IN (
            'laugh', 'very_funny', 'crying', 'nervous', 'wow',
            'unbelievable', 'cool', 'competitive', 'watching', 'fire',
            'fast', 'rocket', 'strong', 'clap', 'thumbs_up',
            'trophy', 'gold', 'crown', 'target', 'heart'
        )
    );
