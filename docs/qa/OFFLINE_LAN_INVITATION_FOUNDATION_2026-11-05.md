# A2 offline invitation foundation — 2026-11-05

This is an implementation slice under ADR-0223, not a usable A2 route.

## Boundary

- `0084_offline_lan_invitations` adds reserved offline auth accounts and
  one-use invitation digests; no Player/claim/alias link is created.
- The service generates 256-bit random URL-safe tokens, stores only a keyed
  SHA-256 digest, expires after 15 minutes, checks administrator issuance,
  account/role binding and revocation, and consumes once in a row-locked
  transaction. Neither this slice nor its tests expose a browser URL or log a
  token. The HMAC key must be provisioned and backed up with the host state in
  the later runtime slice.
- The target `UserAccount` must be active; administrator targets also need an
  active grant. The optional A2 route remains fail-closed until session
  redemption and host-only controls exist.

## Observed checks

- Disposable MariaDB 11.4 and MySQL 8.4.11 containers: the hash-pinned
  migration applier reached 0084 on a fresh database; the focused repository
  integration test passed 2/2 on each engine.
- Focused ticket unit tests passed 3/3; API typecheck and build passed.
- No existing database, hosted auth route, or online session was modified.

## Remaining gate

The next slice must implement host-local account setup, one-time bootstrap,
redacted administrator audit, browser redemption and Better Auth session
binding, with LAN isolation and recovery tests. This candidate does not
prove those flows or offline operation.
