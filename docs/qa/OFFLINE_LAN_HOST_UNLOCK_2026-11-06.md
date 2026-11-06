# Offline LAN host unlock foundation — 2026-11-06

Source commit: private `b6e7fcd3`. This is an isolated A2-only host access
foundation. The A2 installer still refuses startup; no public route, release
or production installation changed.

## Behavior

- A local operator command issues a random, five-minute, one-use code only
  before the first administrator grant or for an active offline administrator.
  Only its SHA-256 digest is written to an installation-scoped Docker volume;
  a newer issue invalidates the previous code.
- A separate Fastify listener accepts the code only in a JSON POST body with
  the exact loopback Host and Origin. It has no Caddy route and Docker publishes
  its port only on the host's `127.0.0.1`. The unlock endpoint allows at most
  five attempts per minute; the listener also has a global request limit.
- The HttpOnly, SameSite=Strict host cookie is held only in memory (15-minute
  idle, 60-minute absolute limit). Each session read rechecks the active
  administrator grant; the bootstrap session is valid only before any grant.
  The bootstrap code stays valid until the future account transaction commits;
  simply opening the form does not spend it. Restart loses sessions. The page
  exposes no setup QR, account action or
  invitation yet.

## Observed checks

| Check | Result |
| --- | --- |
| API unit/boundary tests | 9/9 passed across three files; one-use, expiry, replacement, Host/Origin/query rejection, rate limit, session recheck and bootstrap role. |
| API typecheck and build | Passed with the current Node/TypeScript closure. |
| Windows offline installer profile | 2/2 focused Python tests passed with Python 3.12 and the pinned cryptography closure; generated Compose config validated. |
| API Docker image | Built from the private source without additional runtime dependencies. |
| Disposable host container | Published `127.0.0.1:19090:8081`; `/health/ready` returned 200; a foreign Host returned 404. Container stopped and removed after the check. |

## Open gates

The live database authorization query and first-account transaction have not
been exercised. The host screen has no account, invitation, CA fingerprint or
QR action yet. Browser cookie/Origin behavior and an actual LAN-isolation
probe still need a packaged A2 installation. The installer remains fail-closed.
LiveTrial on another Windows PC is part of the A2 acceptance scope and is
not qualified by this foundation check.
