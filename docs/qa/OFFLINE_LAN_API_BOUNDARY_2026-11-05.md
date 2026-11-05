# Offline LAN API boundary checkpoint — 2026-11-05

An `MK8DX_OFFLINE_LAN=true` runtime requires one exact RFC1918 IPv4 HTTPS
origin and only that trusted origin. It rejects configured SMTP delivery and
Web Push. It constructs no SMTP client, does not verify a mail server on
startup. The public API baseline imports world records only during an explicit
installer operation and has no periodic runtime import timer. The mode blocks
the public magic-link issuance and verification routes, plus e-mail change
and verification. The existing hosted path continues to require SMTP and
keeps its former timers and auth routes. Local sessions and device
authorization are left available for the later invitation flow.

This does not yet make the offline route usable. A host-only administrator
screen, first-admin bootstrap, account-bound one-use invitations, browser
redemption and Android origin/CA pairing must be integrated and validated
before the installer startup guard is removed. In particular, no invitation
token is emitted or accepted by this checkpoint.

Focused checks: `npx vitest run --config vitest.config.ts
test/hosted-runtime-config.test.ts test/embedded-passwordless-auth.test.ts`
from `backend/api` passed 13 tests. Typecheck and build passed. The future
integration gate must prove MariaDB startup, no WAN access after reboot,
login and result persistence, and unchanged online auth.
