# Offline LAN host accounts and invitations — 2026-11-06

This A2-only source slice adds the first offline administrator transaction,
local account creation, setup fingerprints/QR, and account-bound invitation
issue/revoke to the existing loopback-only host listener. The installer still
refuses A2 startup; this is not a supported route or release candidate.

## Boundaries

- The first `UserAccount`, offline-auth record and administrator grant commit
  in one database transaction under a MySQL/MariaDB named lock. A failed
  second bootstrap rolls back; no `Player`, `PlayerClaim` or `Alias` is made.
- A subsequent administrator action rechecks the existing active grant and
  the offline administrator record. Administrator creation uses the existing
  grant policy. The host has no Caddy route and stays bound to loopback.
- The setup QR contains the HTTP `/setup` URL. Its screen displays the root
  certificate and SPKI SHA-256 fingerprints. Invitation QR/link is separate:
  the bearer lives only after `#token=` and the existing ticket service
  issues a 15-minute, one-use, revocable token. No token or cookie is written
  to this report.

## Observed checks

| Check | Result |
| --- | --- |
| Focused API unit/boundary tests, typecheck, build | 13/13 tests across host unlock, listener and invitation logic passed; typecheck and build passed. Production npm audit: zero vulnerabilities. |
| Account integration on disposable MySQL 8.4.11 | Migration catalog through 0084 applied; 3/3 account/grant/invitation tests passed. |
| Account integration on disposable MariaDB 11.4.12 | Same migration catalog applied; 3/3 tests passed. |
| Python offline installer profile | 2/2 tests passed; generated Compose config validated. |
| Disposable A2 host state | Private QA directory outside Git. API image `mk8dx-source/api:a2-host-qa` built from the local source; empty MySQL applied migrations through 0084. |
| Real host HTTP calls | Bootstrap unlock/account 200; administrator unlock/setup/player/invitation/revoke each 200. QR response had PNG data URL. QA codes and bearer values were not printed. |
| Network bind | `127.0.0.1:19090/health/ready` returned 200; direct `192.168.0.236:19090` connection was refused. Docker published only `127.0.0.1:19090:8081`. |
| Compose healthcheck correction | The initial Node `fetch` healthcheck returned 404 because it could not preserve the exact external Host header on the internal port. Node `http.get` with explicit Host returned 200; recreated host-admin, API and Web containers are all `healthy`. |
| Chromium browser | Setup QR, account list/create, invitation issue/revoke passed. A private QA screenshot was taken after revocation, so it contains no invitation bearer; the image is not in this repository. |
| Integrated HTTPS gateway | Python/OpenSSL with the generated root PEM validated the IP-SAN chain; `/health/ready` and `/offline-invite` returned 200. HTTP `/setup` returned 200 and HTTP `/` redirected 308. A newly issued invitation redeemed through the public HTTPS origin with 200; `get-session` returned 200 with a user, and replay returned 401. The QA-only script and state are outside Git. This verifies TLS and API redemption, not Windows/Chrome trust installation. |

## Still open

The full HTTPS gateway and API sign-in now work with an explicitly trusted
QA root. A browser sign-in under the normal Windows/Chrome trust procedure
has not yet been run. Android origin-specific
CA pairing, platform name-constraint measurements, offline restart/WAN block,
backup/restore/IP change, Web/APK results, and LiveTrial on another Windows
PC remain A2 acceptance gates. In particular a saved LiveTrial run must reach
this installation's API/database without a TLS bypass after offline restart.
The owner phone trial and any later release require separate decisions.
