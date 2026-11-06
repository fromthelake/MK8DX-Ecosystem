# Offline LAN browser invitation page — 2026-11-06

This is one A2 source slice under ADR-0223. It does not activate or qualify
the offline installer. The previously integrated API session redemption is
separately documented in `OFFLINE_LAN_SESSION_REDEMPTION_2026-11-05.md`.

The offline Caddy configuration alone serves `/offline-invite` and its two
static resources from outside `/srv`. Other gateways do not route this page.
The page takes an exact 43-character bearer from `#token=`, removes the
fragment and any query from the address before rendering, requires HTTPS,
and waits for an explicit click. It sends one same-origin JSON-body POST to
`/api/auth/offline-invitation/redeem` with `no-referrer` and `no-store`.
The token is never rendered, logged, put in storage, sent in a GET URL, or
reused after the click. A failed attempt gives a generic reissue instruction.
The Web service worker does not replace this route with a cached homepage.
This route is outside Android's ADR-0199 app-link filters.

## Observed checks

- `node --check` passed for the standalone script; the changed files passed
  `git diff --check`.
- Caddy 2.11.7 adapted the offline configuration. A disposable Caddy with
  the existing QA-only CA returned HTTPS 200 for the page with a validated
  IP-SAN chain in Python/OpenSSL, `Cache-Control: no-store`, a strict CSP and
  `Referrer-Policy: no-referrer`. HTTP `/setup` returned 200 and HTTP
  `/offline-invite` redirected 308 to HTTPS.
- Real Chromium 1248 at 390 CSS px and `nl-NL` loaded the page; the URL
  fragment disappeared before interaction. The link to the product stayed
  hidden. The request log contained three GETs without the bearer and one
  POST only after the click. A query-token variant was rejected and sent no
  POST. Screenshot and the disposable browser script are private under
  `D:\Private\Ai\MK8DX_QA\offline-lan-ca-spike\`.
- That test Caddy had no API upstream. Its POST consequently returned 502;
  the page showed the expected generic failure. This is a UI/transport check,
  not an end-to-end sign-in or a trust-installation claim.
- A private-root Docker build reached the new page `COPY` layer and passed
  the Web TypeScript build, then stopped at asset materialization because
  this private checkout's older Web selection differs from the public
  OpenCV-5 collection. The full Docker build from the OSS intake with its
  matching collection **passed**. The three packaged page files have the
  same SHA-256 values as the OSS source (`b24661f7…`, `d3cd50b8…`,
  `549fa4de…`). A second disposable Caddy ran from that exact built image:
  HTTPS page 200 with validated chain and no-store/no-referrer headers;
  the same Chromium fragment, click and invalid-query checks passed.

Remaining A2 work: host-local administration, first-account bootstrap and
invitation issuance/revocation UI, installer activation and unattended CA
renewal, Android origin-specific trust, name-constraint platform tests,
WAN-blocked restart, backup/restore and owner phone acceptance. No online
route, release, production system or owner device was changed.
