# Account switching on shared devices (ADR-0224 phase 2): design review

> Amendment 2026-11-11 (owner decision, ADR-0224): administrators are now remembered on browser
> devices but listed and switched to only behind a PIN; the fifth wrong PIN on a device forgets the
> entry (migration 0086) and an entry unused there for 14 days is forgotten. Statements below that
> administrators are never remembered describe the earlier rule; the native app keeps it.

Status: reviewed 2026-11-10, judged safe with the design below; implemented on
`feat/a2-setup-experience-20261110`. Owner decisions of 2026-11-10 are binding:
a shared device remembers the accounts that signed in on it, "Switch account"
picks one with one tap, a Player account may turn on a 4-digit PIN that the
server checks with a rate limit, administrators are never in the list, the
browser holds labels only and never a script-readable session token, and the
identity rules are unchanged.

## Conclusion on Better Auth's multi-session plugin

Better Auth 1.7.15's `multiSession` plugin is **not used**. Reading
`better-auth/dist/plugins/multi-session/index.mjs` shows four properties that
conflict with the owner decisions:

1. Each remembered account is a *live session token* in its own cookie
   (`<session cookie>_multi-<token>`), signed exactly like the main session
   cookie. Anyone with access to the browser's cookie store (developer tools on
   a club PC) can copy one into the main cookie and become that account. A PIN
   checked in front of `set-active` would therefore be bypassable by the very
   people it is meant to stop.
2. `set-active` and `revoke` take the raw session token in the request body,
   and `list-device-sessions` returns session objects, so the page script would
   have to hold session tokens.
3. Its after-hook remembers every new session, administrators included; there
   is no filter.
4. Its sign-out hook deletes *every* remembered session on the device.

The same mechanics (signed cookies, `setSessionCookie`, `internalAdapter`) are
used instead by a small first-party plugin, `mk8dx-account-switch`, whose only
HTTP-reachable parts are hooks; its endpoints are declared with
`createAuthEndpoint.serverOnly`, which better-call never registers on the HTTP
router (verified: a direct `POST /api/auth/...` answers 404), and are called
from closed-schema Fastify routes under `/v1/session/...`.

## What a device remembers

- One cookie per browser: `mk8dx.account_device` (`__Secure-` prefixed in
  production), HttpOnly, Secure in production, **SameSite=Strict**, Path `/`,
  180 days. Its value is 32 random bytes (base64url). The server stores only
  `HMAC-SHA256(device key, value)`; the device key is derived from the current
  auth secret, so a secret rotation simply forgets remembered devices.
- Server rows (`account_switch_remembered_accounts`): device digest, Better
  Auth user id, an opaque random entry id, remembered/last-used times. At most
  six per device (least recently used is dropped); a row unused for 90 days is
  ignored and pruned.
- The page receives only `{ entryId, label, pinRequired, current }`. The label
  is computed on the server when listing: the offline host's display label for
  an offline account, else the account's verified Player display name, else no
  label (the page shows a neutral "account without a Player"). Nothing is
  written to `localStorage`/`sessionStorage`. The remembered cookie is not a
  session and cannot be replayed as one: it is only accepted by the switch
  endpoint, which applies the PIN and administrator rules.

Cookie count/size: one extra cookie of about 80 bytes whatever the number of
remembered accounts; far below the 4 KiB per-cookie and per-domain count limits.

## When an account is remembered, forgotten or wiped

- Remembered: in an *after* hook on the two browser sign-in paths that set a
  session cookie, `/magic-link/verify` and `/offline-invitation/redeem`
  (`ctx.context.newSession` is present there; verified). Sessions created by the
  offline invitation plugin therefore work unchanged. Native sign-in
  (`/device/token`, bearer) never matches, and a request carrying an
  `Authorization` header is never remembered, so Android/desktop bearer clients
  are unaffected and never receive the device cookie.
- Administrator exclusion: the hook asks the runtime (auth user -> active
  binding -> UserAccount -> active administrator grant) and does not remember an
  administrator; it also deletes any earlier row for that user. Listing and
  switching repeat the check (a grant can appear later): an administrator row is
  never listed, a switch to it is refused and the row deleted. Administrators
  therefore always sign in afresh.
- "Sign out": a *before* hook on `/sign-out` removes the signed-in account from
  this device's list, then Better Auth ends the session as before. Leaving a
  club PC means leaving it. The only exception is the explicit "Sign in with
  another account" choice in the switch dialog, which sends
  `X-MK8DX-Keep-Remembered: 1`: that sign-out keeps the account remembered so
  its owner can tap back in. Absence of the header is the safe default.
- "Sign out on all devices": a *before* hook on `/revoke-sessions` deletes every
  remembered row of the account on every device, then Better Auth revokes all
  sessions (bearer/app sessions included, as in phase 1). No device can tap back
  in afterwards. `/revoke-other-sessions` deletes the rows on other devices.
- Switching itself deletes the current session (audit `auth_session_revoked`)
  and creates a new one for the target (audit `auth_session_created`) through
  `internalAdapter`, so the existing database hooks and audit sink see every
  change. The account switched away from stays remembered.

## Switching and the PIN

`POST /v1/session/account-switch` with `{ entryId, pin? }`:

1. The `Origin` header must be one of the installation's trusted origins and
   the request must carry no `Authorization` header.
2. The device cookie must resolve to a row with that entry id (SameSite=Strict
   means a cross-site form or fetch never carries it, which is the CSRF defence;
   no device cookie means nothing to switch to). Signed-out callers may switch;
   the remembered list is exactly what the device already offers.
3. The target must still be an active, non-administrator account.
4. When the target has a PIN, the request must carry four digits. Every attempt
   consumes the existing durable limiter (`api_mutation_rate_limits` through
   `MysqlMutationRateLimiter`): 5 per account per 15 minutes and 20 per device
   per hour; over the limit the answer is 429 with `Retry-After`. A wrong PIN is
   403 `account_switch_pin_invalid`; the plugin endpoint cannot be called from a
   browser, so there is no path around this check.
5. Success deletes the current session, creates the target session, sets the
   session cookie and returns `{ schemaVersion, switched: true }`. The page then
   clears `mk8dx.nav-identity.v1`, the response cache and the appearance sync and
   reloads, so the header can only ever show the new active account (the claims
   check still re-reads the truth).

PIN storage (`account_switch_pins`, keyed by UserAccount): `scrypt` from
`node:crypto` (N=2^14, r=8, p=1, 32-byte key, 16-byte random salt) over an
HMAC-SHA256 of the PIN with a key derived from the auth secret (a pepper; the
row stores its secret version). A four-digit PIN has 10,000 values, so the
pepper is what keeps a stolen database alone from revealing it; the rate limit
is what protects it online. Never stored or logged in plain text.

PIN management (`GET/PUT/DELETE /v1/account/switch-pin`, Player accounts only,
administrators 403): CSRF proof (`X-MK8DX-CSRF`, actor-bound, the existing
`WebCsrfService`) and a mutation rate limit. Turning a PIN on needs no PIN.
Changing or removing an existing PIN needs the current PIN, **or** a session that
was created by a real sign-in less than 15 minutes ago (Better Auth's
`freshAge`) and not by a switch (switch-created sessions are recorded in
`account_switch_sessions`, deleted with the session). That is the "forgot my PIN"
path: sign in afresh, then remove or change it.

## Native clients (amendment 2026-11-11: switching in the Android app)

Owner decision 2026-11-11: the app switches accounts too, and the **server** keeps the list (the
app holds only the active account's bearer token plus a device value), so the PIN cannot be
bypassed by reading the app's storage and "Sign out on all devices" also empties the app's list.

- **Device value:** the app creates 32 random bytes once and keeps them in app-private,
  Keystore-encrypted storage. It sends them as `X-MK8DX-Account-Device` (43 base64url
  characters). The server stores only `HMAC-SHA256(device key, "native:" + value)`: a separate
  namespace, so a browser's device cookie value can never stand in for an app device, or the
  reverse. The native routes refuse any request with an `Origin` or a `Cookie` header, so a
  browser cannot use them.
- **Remember:** `POST /v1/session/native-remember` with the bearer token and the device header,
  right after a native sign-in (and once per account the app already held before this change, after
  which the app forgets that token). Administrators are never remembered (`remembered: false`).
  Limited to 30 per device per hour.
- **List:** `GET /v1/session/native-remembered-accounts` with the device header (and the bearer
  token when signed in, for `current`): the same labels-only document as the browser list.
- **Switch:** `POST /v1/session/native-account-switch` `{ entryId, pin? }`: the same server-only
  switch endpoint with the same administrator, PIN and rate-limit rules; it ends the app's current
  session and answers `{ schemaVersion, token, expiresIn }` for the new bearer session (no cookie).
- **Sign out / sign out everywhere:** the app sends the device header on `/api/auth/sign-out`
  (with `X-MK8DX-Keep-Remembered: 1` only for "Sign in with another account"). The hooks find the
  signed-in user from the bearer token themselves (Better Auth's own bearer conversion is not
  guaranteed to have run in a *before* hook), so app sign-out forgets the account on that device
  and `/revoke-sessions` forgets it everywhere.
- **Player ids for the app only:** the native list also carries each account's verified Player id
  (`playerId`), so the app can show a remembered account next to the saved results that belong to
  that Player. The browser list stays labels-only.
- **Remove from this phone:** `POST /v1/session/native-forget` `{ entryId }` with the device header
  removes that entry from this app device's list without signing in as it.
- The browser routes are unchanged and still give a bearer caller an empty list.

## CSRF summary

- Better Auth's own origin check still guards `/api/auth/*`; browser switching needs a Strict
  cookie plus an exact trusted `Origin`; PIN management needs the actor-bound CSRF proof; native
  routes need the device header and refuse `Origin` and cookies.

## Residual risks accepted by the owner decisions

- A PIN-less remembered account is one tap away for anyone using that browser
  for up to 90 days; that is the requested default. "Sign out" and "Sign out on
  all devices" end it.
- Whoever copies the device cookie out of a browser can switch into its PIN-less
  accounts from elsewhere until the account signs out or signs out everywhere;
  PIN-protected accounts stay protected by the server check and rate limit.
- The list shows which accounts used the device; that is what a shared-device
  account picker is.

## Migration

`0085_account_switching`: `account_switch_remembered_accounts`,
`account_switch_sessions`, `account_switch_pins`; empty tables only, no
snapshot row maps into them. Down drops them (destructive).
