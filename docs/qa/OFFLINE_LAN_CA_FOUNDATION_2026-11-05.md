# Offline LAN CA/gateway foundation — 2026-11-05

Scope: the first bounded implementation slice for [issue #90](https://github.com/fromthelake/MK8DX-Ecosystem/issues/90).
This **does not** expose or qualify an installable offline A2 route. ADR-0223
is the design authority; existing A1/A2/A3/B1/B2 routes are unchanged.

## Design and source

`tooling/offline_lan_ca.py` creates a unique P-256 root and a seven-day
intermediate for one RFC1918 host IP. The root carries RFC1918 IP constraints;
the path-length-zero intermediate carries the exact `/32` IP constraint.
The host stores the root key only as Windows machine-scope DPAPI ciphertext
with an ACL for the current operator, SYSTEM and Administrators. Microsoft
states that machine-scope DPAPI is decryptable by any local user **who obtains
the blob**; the ACL and excluding the blob from Caddy mounts are essential.
The Caddy mount contains only the public root certificate and intermediate
certificate/key. The HTTP setup mount has precisely the page, Android/Windows
`.crt` and iOS `.mobileconfig`. The setup page warns that HTTP cannot
authenticate itself and requires comparison with the future localhost host
screen. Neither a QR invitation nor any private key is in that mount.

`Caddyfile.offline-lan` uses a custom `tls internal` CA and `default_sni` for
IP-literal clients, with an allowlist for the three HTTP setup resources and
HTTP→HTTPS for all other paths. `compose.offline-lan.yaml` is separate from
the existing route overlays. No installer mode selects it yet.

## Observed local evidence

- A fresh Python 3.12 Windows venv installed the exact three-pin closure
  `cryptography 50.0.0`, `cffi 2.0.0`, `pycparser 3.0` from wheels; `pip check`
  was clean. The three focused tests passed, including Windows DPAPI
  round-trip, distinct roots for two installations, exact intermediate
  constraints, regeneration refusal and the setup-file allowlist.
- The disposable Caddy 2.11.7 image validated the separate Caddyfile with a
  custom intermediate. Without `default_sni`, an IP-literal TLS handshake
  failed; with it, Python/OpenSSL verified an IP-SAN certificate and TLS 1.3.
  The root private key was absent inside the Caddy container.
- Against a disposable gateway container bound only to host loopback, HTTP
  `/setup`, `/setup/`, `/setup/root.crt` and `/setup/root.mobileconfig` returned
  200. `/setup/root.pem`, `/setup/metadata.json`, `/setup/other` and
  `/api/test` redirected 308 to the exact HTTPS IP. `docker compose config
  --quiet` passed with a synthetic state file. The QA containers were stopped.
- Windows curl/Schannel reported unknown revocation status for the local chain
  without a bypass flag. Python/OpenSSL succeeded. The curl bypass probe is
  **not** Windows-client acceptance.

Private disposable certificates, keys, synthetic state and raw logs:
`<private QA root>/offline-lan-ca-spike/`. No certificate key or
configuration secret belongs in Git.

## Still required before any support claim

The installation mode and host-only administrator screen, unattended
intermediate renewal, encrypted backup/restore and IP-change flow are not yet
implemented. HTTP setup and host-screen fingerprints have not been compared
on a real LAN. Name-constraint enforcement still needs Android, Windows,
Chrome and available iOS tests, including a deliberately out-of-scope leaf.
Offline auth/invitations, Android pairing, WAN-blocked restart, A1/A3
regression and the owner's phone trial all remain. No online runtime behavior
or production state was changed.

## Primary references

- [Caddy custom PKI and `default_sni`](https://caddyserver.com/docs/caddyfile/options).
- [Windows DPAPI machine-scope behavior](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata).
- [RFC 5280 path validation and name constraints](https://www.rfc-editor.org/rfc/rfc5280).
