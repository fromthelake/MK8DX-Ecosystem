# Offline LAN CA lifecycle foundation — 2026-11-05

This is an implementation checkpoint under ADR-0223, not qualification of an
installable offline A2 route. The installer and gateway orchestration still have
to call these primitives and pass the offline end-to-end gates.

`tooling/offline_lan_ca_lifecycle.py` validates that the Caddy signer key,
certificate, issuer, IP constraint, expiry and installation metadata agree.
The installer must call this before every gateway start. A partial signer
rotation therefore fails closed. Rotation requires Caddy to be stopped by the
caller. It issues a fresh seven-day, exact-IP intermediate while keeping the
root certificate and encrypted root key unchanged; the installer must reload
Caddy afterwards and schedule renewal before day five.

The recovery export is a separate owner-held file outside Git. It encrypts the
root key with AES-256-GCM and a passphrase-derived scrypt key. The passphrase is
not stored in the installation. Restore accepts only an empty state directory,
checks the root certificate and private key, and can issue a new intermediate
for a changed private LAN IP. Losing both the installation key and its recovery
file requires a new root and removing/reinstalling trust on every device. The
database backup/restore still needs to be coupled to this CA recovery path.

The file permissions and Windows machine-scope DPAPI are additional host
controls, not a security boundary against a local administrator or a local
user who obtains ciphertext and can call DPAPI. The recovery file must be kept
separate from the host; its passphrase must be held by the owner.

Focused check on Windows: the disposable fresh venv at
`D:\Private\Ai\MK8DX_QA\offline-lan-ca-spike\venv` ran
`python -m unittest tooling.tests.test_offline_lan_ca
tooling.tests.test_offline_lan_ca_lifecycle -v`. This covers unique provisioning,
machine-scope DPAPI round-trip, same-root recovery to a new IP, wrong-passphrase
rejection, signer renewal, and mismatched signer rejection. Platform trust,
name-constraint enforcement, automatic renewal and WAN-blocked installation
remain unverified.
