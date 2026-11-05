# A2 offline invitation session redemption — 2026-11-05

This is an isolated source slice under ADR-0223, not an installed A2 route.

In offline mode only, Better Auth registers POST
`/api/auth/offline-invitation/redeem`. It accepts one token in a JSON body
from the exact configured HTTPS origin, with a five-per-minute rate limit.
The ticket service spends the token atomically and does not log or echo it.
The plugin creates or reuses the reserved `.invalid` auth user, explicitly
binds its verified subject to the invitation's existing `UserAccount` via
`AuthenticationProvisioningService`, then sets Better Auth's Secure session
cookie. It returns only `{ "ok": true }`; it does not return a session token.
The digest key is purpose-separated from the existing Better Auth secret; a
secret rotation invalidates outstanding 15-minute tickets, and the host can
reissue them. A failure after consumption also requires reissue.

The disposable MariaDB 11.4 integration test reached migration 0084, denied
the public magic-link endpoint and a foreign origin, accepted one invitation,
verified the Secure cookie and session, resolved the subject to the invited
`UserAccount`, and denied replay. API typecheck and build passed. MySQL 8.4 and
the complete Verify remain the PR gate. This slice does not include the
host-only administration screen, browser invitation page, installer activation,
account/session revocation UI, or a WAN-blocked end-to-end test.
