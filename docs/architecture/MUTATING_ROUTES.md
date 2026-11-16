# Mutating API routes and their protection

This is the inventory of every API route in `backend/api/src` that changes stored data, with the protection that
applies to it. It exists so that a change to a route, or a new route, can be checked against the same list:
**who may call it, which object it may touch, how browser requests are bound to the site, how large a request may
be, how often an account may call it, how much it may store, how a retry behaves and when stored data goes away.**
The protection lives in the receiving server; a modified client gains nothing by skipping its own checks.

Recorded from the source of 0.2.9 (see the [changelog](../../CHANGELOG.md)).
When you add or change a mutating route, update its row in the same change.

## Shared mechanisms

| Mechanism | Where | What it does |
| --- | --- | --- |
| Actor | `composition/local-runtime.ts` (administrator-aware resolver) | One resolver for a Better Auth cookie or bearer session; administrator rights come from active database grants. |
| Same-origin proof ("CSRF") | `security/web-csrf-service.ts`, `GET /v1/session/csrf` | HMAC proof bound to the account, 15 minutes. Routes marked *proof* require it for cookie (browser) requests when the installation has the web product. Native apps use bearer tokens and send no cookies. |
| Body size | Fastify default 1 MiB; per-route `bodyLimit` where stated | All JSON routes run with `coerceTypes`, `removeAdditional` and `useDefaults` off. |
| Concurrency | `app.ts` | At most 100 requests in flight per API process (503 with Retry-After beyond). |
| Durable budget | `security/mysql-mutation-rate-limiter.ts` | Fixed-window counters in `api_mutation_rate_limits`, shared by all API processes. Each request receives its own count atomically. Rows older than 48 hours are removed in bounded batches, on use and by an hourly timer; cleanup and refusal counts are logged without subjects. Over budget: 429 with Retry-After. Every refusal is also counted, in process memory only (the refusal ledger, `security/refusal-ledger.ts`): the refusal path does no extra database work. See the administrator view below. |
| Budget before sign-in | `security/pre-auth-budget.ts` | For routes reachable before the caller is known: the client address (trusted-proxy rules in `security/client-address.ts`) is mapped with a server key onto a fixed number of slots (1024), so caller-chosen values can never create new rows. |
| Better Auth limiter | `authentication/embedded-passwordless-auth.ts` | Per-address limits for `/api/auth/*` (sign-in links, verification, device codes, change of e-mail). |
| General backstop | `app.ts` (`AbuseBudgets.mutation`) | Every signed-in `POST`/`PUT`/`PATCH`/`DELETE` under `/v1` (also one no route answers) first spends the caller's own budget: 600 per 10 minutes and 10,000 per day per account, 3,000 per 10 minutes and 30,000 per day per administrator (higher, never unlimited), then one installation-wide budget of 6,000 per minute. Counted before the body is read; reads are never counted. Route budgets and quotas below apply on top. |
| Installation budget | `security/abuse-budgets.ts` | One durable counter for the whole community per expensive or fan-out path (see [Installation budgets](#installation-budgets)), consumed after the caller's own budget, so a single account never drains it beyond its own allowance and many fresh accounts together are still bounded. |
| Target budget | `security/abuse-budgets.ts` (`targetSubject`, `recipientSubject`) | For actions that notify somebody else: one counter per target (a Player, a claim, an e-mail recipient), keyed by a digest, never the id or address itself, and created only after the account and installation budgets admitted the request, so invented targets cannot create unbounded rows. |
| Sign-in mail budgets | `authentication/auth-email-budgets.ts` | Before Better Auth or the app sign-in mail does any work: per address (pre-auth slots), installation and per recipient. |
| Notification fan-out | `notifications/notification-fan-out-budget.ts` | Every notification producer (request path and background worker) spends one unit of an installation budget; when it is spent the notification is skipped and the causing write still succeeds. |
| Fresh confirmation (step-up) | `security/step-up-*.ts`, `GET`/`POST /v1/session/step-up`, `GET`/`POST /v1/session/step-up/link` | Routes listed under [Fresh confirmation](#fresh-confirmation-step-up) answer 403 `step_up_required` (header `x-mk8dx-step-up: required`) until the calling session confirmed a new single-use link sent to its account's own verified address. |

Columns below: **Auth** (who), **Object** (server-side binding of the target to the actor), **Proof** (browser
same-origin proof), **Budget** (durable per-account or per-address budget), **Quota** (stored objects or bytes),
**Retry** (idempotency) and **Retention**. "-" means none; "n/a" means not applicable.

## Session and sign-in

| Route | Auth | Object | Proof | Budget | Quota | Retry | Retention |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/auth/*` (Better Auth: magic link, verify, sign-out, device flow, change e-mail, revoke sessions) | anonymous / session | Better Auth | Better Auth origin check | Better Auth per address; mail-sending paths (sign-in link, change of e-mail, verification mail) also 120/h per address slot, 6/h and 20/day per recipient, and the installation mail budget; `/device/code` also 240/h per address slot and 1,200/h per installation | new accounts only through a delivered link, so bounded by the mail budget | single-use tokens | sessions 7 days, links 15 min, device codes 10 min |
| `POST /v1/session/native-remember` | bearer + app device header | own session, verified first | n/a | per address (pre-auth), then account 30/h and device digest 30/h | 6 accounts per device | upsert | 90 days idle (administrators 14) |
| `POST /v1/session/native-account-switch`, `POST /v1/session/account-switch` | device value (app header / browser cookie) | remembered entry of that device; PIN on the server | browser: Origin must be the installation | per address (pre-auth); PIN attempts per account and device; new sessions 60/h per account, 120/h per device | - | - | - |
| `POST /v1/session/native-forget` | app device header | entry of that device | n/a | per address (pre-auth) | - | idempotent | delete |
| `PUT /v1/account/switch-pin`, `POST /v1/account/switch-pin/clear` | account | self | Origin + proof | 10/h | 1 per account | upsert | - |
| `POST /v1/session/native-invitation-redeem`, `POST /v1/session/native-invitation-preview` (offline-invitation installations only) | anonymous app: device header, no Origin, Cookie or Authorization | the card's own account; body `origin` must be this installation | n/a (a browser always sends Origin and is refused) | per address 60/min (pre-auth); then, shared with `/offline-invite`: a token that is no live card spends only a failure budget (600/min per installation, no row of its own); a live card 5 per card per 15 min and 120/min per installation, previews and redemptions in separate buckets | one Better Auth session per redeemed card; a session that cannot be handed over is ended at once | single use (atomic consume) | ticket 15 min, session 7 days |
| `POST /v1/session/device-invitations` | account | self | proof | 10/h | - | - | ticket 15 min |
| `POST /v1/native/device-authorization/email` (+ `/verify`, `/link`) | anonymous with a device code | that device code | n/a | durable per address slot, per recipient and the installation mail budget (shared with `/api/auth/*`); in-process per address and e-mail; durable per challenge | 3 sends per device code | single use | with the device code |

## Identity, Players, aliases and profile

| Route | Auth | Object | Proof | Budget | Quota | Retry | Retention |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `POST /v1/player-claims` | account | own account; Player active | proof | self-service 20/h and 60/day per account; installation 300/h and 1,500/day; per Player 5/day from all accounts together | one verified claim per Player and account; per account at most 5 waiting requests and 50 requests ever; per Player at most 5 waiting requests (counted under the Player and account row locks) | - | - |
| `POST /v1/player-claims/:id/replies`, `/disputes`, `/release` | own claim (dispute also administrator) | claim lifecycle service | proof | self-service budget as above; replies and disputes also the installation message budget (600/h, 3,000/day) and 20/day per claim towards its reviewers | 60 notes per claim (under the claim row lock); one open dispute | revision | - |
| `POST /v1/player-claims/:id/actions` | administrator or that Player's Director | claim lifecycle service | proof | 120/h per Director, 600/h per administrator; installation message budget; 20/day per claim towards the person asking (a separate counter from the other direction) | 60 notes per claim | revision | - |
| `POST /v1/aliases` | account (own verified Player, declarations only) or administrator | verified claim checked in the transaction | proof | 30/h per account, 300/h per administrator; installation 1,000/h and 5,000/day | per Player: 20 active declared, 100 declared in total, 200 active; 4 provenance items per declaration | - | retired aliases stay (history) |
| `POST /v1/aliases/:id/actions` | as above | as above | proof | as above | state machine | expected revision | - |
| `GET /v1/players/:id/aliases` (read) | anyone | public, active only | n/a | - | at most 100 per page; `limit`/`after` pages | n/a | n/a |
| `POST /v1/me/player` | account | self | proof | 20/day | one Player per account | - | - |
| `POST /v1/administrator/players`, `/identity-links` (+ unlink), `/tournament-identities/*` | administrator | service | proof | Player creation 100/day; all: the administrator backstop | - | unique names | - |
| `PUT /v1/account/player-avatar`, `/player-country`, `/time-trial-preferences`, `/appearance`, `/player-profile-preferences`, `POST /v1/notifications/read` | account / verified owner | self | proof | shared 120/h | one value | upsert | - |
| `PUT /v1/account/player-visibility`, `PUT /v1/administrator/players/:id/visibility` | verified owner / administrator | self / service | proof | the shared account-setting budget (120/h) | one value | upsert | - |

## Time Trials

| Route | Auth | Object | Proof | Budget | Quota | Retry | Retention |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `POST /v1/time-trial-submissions` | account with verified Player | new: own verified Player; revision: the stored owner's Player, a verified claim held now and the same source class, checked in the locked write (no owner: refused) | browser kinds | account 240/10 min and 1,000/day; installation 50/10 s, 300/min, 6,000/h and 40,000/day | - | submission id + revision | test scans purged |
| `POST /v1/time-trial-submissions/:id/completions` | bearer | service | n/a | 120/10 min, 500/day | per submission | - | - |
| `POST /v1/time-trials/:id/actions/*` (correct, video, retire, restore), administrator publish | owner or administrator | lifecycle service | proof | 60/h and 300/day per account, 600/h and 3,000/day per administrator | revisions bounded by that budget | expected revision | - |
| `PUT`/`DELETE /v1/time-trial-reactions` | account | service | proof | 600/h | one per account and result | upsert | - |
| `POST /v1/reference-ghost-readings` | bearer | service | n/a | 400/10 min, 2000/day | - | recorded/confirmed | - |

## Tournaments

| Route | Auth | Object | Proof | Budget | Quota | Retry | Retention |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `POST /v1/tournament-race-results` | administrator | - | proof | 240/h | 128 KiB body | - | - |
| `POST /v1/tournament-publications` (+ publish, retract) | administrator | service | proof | 20/h | - | revision | - |
| `POST /v1/tournaments`, `/v1/tournaments/:id/actions/*`, participants, groups, scores, incidents, roster aliases, workbook preview/export (web) | operator grant | Director of that Tournament, checked in the repository transaction | proof | the general backstop (a busy night stays far below it, see below) | per-request array limits; workbook preview 12 MB | expected revision | - |
| `/v1/native/tournaments/*`, native review and evidence actions | bearer + operator capability | active administrator grant, or that Tournament's Director with an active capability; read from the database on every route, review writes re-checked in their transaction | n/a | the general backstop | per-request limits | expected revision | - |
| `POST /v1/tournament-incoming-results` | bearer | operator capability / uploader | n/a | the general backstop | entries per record | client record id | - |
| `POST /v1/tournament-evidence-records` (+ stopping) | bearer | uploader; a roster match never opens a public live feed (administrator, the night's Director or a delegated account only) | n/a | 240 per account and 6000 per installation per 10 min; 200 new records per account per day | 100 unlinked records and 64 MiB per account, 1 GiB per installation, 1 MiB per record | client record id (a stored retry is never refused) | never-linked evidence after 90 days (hourly bounded job); linked evidence kept |
| `/v1/{administrator,native}/tournaments/:id/live-capture-delegations` (+ revoke), `.../evidence-records/:id/actions/withdraw-live` | Director of that Tournament / administrator | as above | proof (web) | the general backstop | delegation 12 h default, 7 days at most | - | audited with its authorization basis |
| `/v1/administrator/tournament-*` review, retraction, capabilities, reports | administrator / own Director / report capability | service | proof | the general backstop | service limits | expected revision | - |
| `POST /v1/tournaments/:id/signup*`, `/v1/native/tournaments/:id/signup*` | account (own verified Player) / Director | service | proof (web) | the general backstop; notifications through the fan-out budget | one entry per Player; Tournament capacity | - | - |
| `POST /v1/me/director-host-request`, `/v1/native/director-host-request`, administrator approve/decline | account / administrator | self | proof (web) | the general backstop; notifications to administrators through the fan-out budget | one open request per account | - | - |

## Notifications and push

| Route | Auth | Object | Proof | Budget | Quota | Retry | Retention |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `PUT /v1/notification-settings/preferences` | account | self | proof | the shared account-setting budget (120/h) | one value | upsert | - |
| `POST`/`DELETE /v1/web-push/subscriptions` | account | own endpoint; only the browsers' push services (plus `MK8DX_HOSTED_WEB_PUSH_EXTRA_PROVIDER_HOSTS`), port 443, public addresses checked at connect time | proof | 30/h per account (register and remove); new subscriptions also 1,000/h and 5,000/day per installation | 10 active per account (a new one retires the least recently registered) | endpoint hash | revoked on 404/410 or after 3 dead deliveries without success; revoked rows deleted after 30 days; producer jobs 90 days |

## Runtime, app downloads and client check-in

| Route | Auth | Object | Proof | Budget | Quota | Retry | Retention |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /v1/app-downloads/:id/file` (static-link mode creates a link) | account | manifest entry only | n/a | 60/h per account; 2,000/h and 10,000/day per installation | live links capped (default 2000), one reused link per account and download | reuse | link refused by the web server after its lifetime; folders removed at startup and about every minute ([B2 reference](../install/B2_WEBHOSTING_EN.md#app-downloads-on-hosts-that-limit-application-responses)) |
| `POST /v1/native/client-checkin` | account | self | n/a (no browser use) | 120 recorded per hour, further check-ins acknowledged but not written | 100 rows per account, newest kept | upsert | 18 months |

## Administration, rating and social

| Route | Auth | Object | Proof | Budget | Quota | Retry | Retention |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `POST /v1/administrator-grants` (+ revoke) | administrator | transactional check of the granting administrator | proof | 20/h | - | - | - |
| `POST /v1/administrator/installation-settings` (+ recompute) | administrator | - | proof | 60/h per administrator; rating recompute 10/h | one settings row | expected revision | - |
| `POST /v1/administrator/rating/*` (decisions, recalculate, apply publication) | administrator | - | proof | 300/h per administrator; full recalculation 10/h | - | expected revision | - |
| `POST /v1/players/:id/engagements`, `/v1/player-engagements/:id/reply` (pokes, games, challenges) | verified owner / participant | service | proof | 60/h each per account; installation 1,200/h and 6,000/day (429 + Retry-After) | 20 per recipient per window | one open game | - |
| `/v1/account/groups/*`, `PUT /v1/account/rank-scope` | account | membership and role | proof | 200/h shared | 20 groups in a rank scope | upsert | - |
| `PUT`/`DELETE /v1/account/rivals`, `/v1/account/follows` | verified account | self | proof | the general backstop | 10 rivals, 25 follows | upsert | - |
| Home bootstrap / comeback (`GET`, writes a snapshot) | account | self | n/a | - | two snapshots per account | n/a | rotated |

The offline host administration (`administration/offline-host-app.ts`) is a separate loopback-only server with its own
unlock limit and is not part of this API. Its one read that MK8DX beheer polls, `POST /api/invitations/status`
(administrator session, same Host/Origin rules, 30 per minute on top of the server's 60), answers only whether a
sign-in card is `open`, `used`, `revoked` or `expired`: never the token, account or times. "Add a phone or device"
shows **Done** when the card on screen is `used`, that is when a device signed in with it.

## Installation budgets

One durable counter per path for the whole community. Each has a setting in the hosted environment
(`api.env` on the Docker routes, `operator.json` on A3 and B2, then restart); a missing setting keeps the default, a present one must be a whole number
from 1 to 1,000,000 and an unknown `MK8DX_HOSTED_BUDGET_*` name stops the start (there is deliberately no
"unlimited"). Over budget the route answers 429 with `Retry-After` and writes nothing; offline clients keep their
queue and retry after the stated time. The limiter reports refusal counts per scope (fixed names, no subjects) in the
operational log as `rate_limit_refusals`.

**Administrator view.** `GET /v1/administrator/request-budgets` (administration page, section **Request limits**,
loaded when opened) shows, from the refusal ledger, the refusals per scope in about the last hour and day (5-minute
steps), how many distinct subjects were refused, and for account budgets the five most refused accounts by public id and
screen name; target, recipient, address-slot and device subjects are digests and are only counted. Quota refusals that do
not pass through the limiter (`*_quota_exceeded`, `*_too_large`, `*_recipient_limit`, `step_up_required`) are counted
by their response code under `quota.<code>`, without a subject. It also shows every `MK8DX_HOSTED_BUDGET_*` value with
its default and the use of each installation budget (and the built-in Tournament evidence budget) in its current
window. No migration. **The refusal ledger** counts in each API process's memory, in a bounded map (at most 4,096
keys between flushes; beyond that a refusal is counted under the scope `other`), so a refused request costs no
database write and a flood cannot grow it. Every 30 seconds, and on a graceful shutdown, the process writes its counts
as one batched upsert into `api_mutation_rate_limits` (keys `!refused|<scope>|*` per 5 minutes and
`!refused|<scope>|<subject>` per hour; `!` cannot occur in a budget scope), where the 48-hour cleanup removes them. The
report adds the counts of the answering process that are not flushed yet. A crash or kill loses at most one flush
interval of counts (the refusals themselves are unaffected), and another process's unflushed counts appear after its
next flush.

| Setting (`MK8DX_HOSTED_BUDGET_…`) | Default | Path |
| --- | --- | --- |
| `MUTATIONS_PER_MINUTE` | 6,000 | every signed-in `/v1` write (backstop) |
| `ACCOUNT_MUTATIONS_PER_10_MINUTES` / `_PER_DAY` | 600 / 10,000 | per account, every signed-in `/v1` write |
| `ADMINISTRATOR_MUTATIONS_PER_10_MINUTES` / `_PER_DAY` | 3,000 / 30,000 | per administrator, every signed-in `/v1` write |
| `AUTH_EMAILS_PER_HOUR` / `_PER_DAY` | 600 / 3,000 | sign-in, sign-up, change of e-mail, verification and app sign-in mail together |
| `AUTH_EMAILS_PER_RECIPIENT_PER_HOUR` / `_PER_DAY` | 6 / 20 | per e-mail recipient (server-keyed digest) |
| `AUTH_EMAILS_PER_ADDRESS_PER_HOUR` | 120 | per client-address slot |
| `DEVICE_CODES_PER_HOUR`, `DEVICE_CODES_PER_ADDRESS_PER_HOUR` | 1,200, 240 | app sign-in codes |
| `CLAIM_REQUESTS_PER_HOUR` / `_PER_DAY` | 300 / 1,500 | new Player claims |
| `CLAIM_REQUESTS_PER_PLAYER_PER_DAY` | 5 | claims on one Player, all accounts together |
| `CLAIM_MESSAGES_PER_HOUR` / `_PER_DAY` | 600 / 3,000 | claim replies, disputes and reviewer actions |
| `CLAIM_MESSAGES_PER_CLAIM_PER_DAY` | 20 | per claim and direction |
| `SUBMISSIONS_PER_HOUR` / `_PER_DAY` | 6,000 / 40,000 | Time Trial submissions |
| `NOTIFICATIONS_PER_HOUR` / `_PER_DAY` | 20,000 / 100,000 | notifications written for other people (one unit per producer call) |
| `DOWNLOADS_PER_HOUR` / `_PER_DAY` | 2,000 / 10,000 | app download file requests |
| `ALIASES_PER_HOUR` / `_PER_DAY` | 1,000 / 5,000 | alias writes |
| `PUSH_SUBSCRIPTIONS_PER_HOUR` / `_PER_DAY` | 1,000 / 5,000 | new Web Push subscriptions |
| `ENGAGEMENTS_PER_HOUR` / `_PER_DAY` | 1,200 / 6,000 | pokes, games, challenges and their replies |

Tournament evidence keeps its own built-in installation budget (6,000 per 10 minutes, 1 GiB) in
[`backend/api/README.md`](../../backend/api/README.md).

**Why these defaults.** They are sized for a community of a few hundred Players with room for the busiest legitimate
moments, and tested against them (`test/abuse-budgets.integration.test.ts`):

- *Launch or migration day*: a few hundred people sign in (each one or two mails) and claim one to three Players. 600
  mails and 300 claims per hour, 3,000 and 1,500 per day, let the whole community arrive in a day; a real person never
  needs more than 6 sign-in mails an hour or 5 waiting claims.
- *An offline phone* replaying a long queue: 400 writes in one burst stay below the 600-per-10-minutes account
  backstop; Time Trial submissions keep their own 240 per 10 minutes, and a refused part of the queue is retried after
  `Retry-After` without loss.
- *A busy Tournament night*: the Director's 500 writes and 40 helpers with 60 writes each within ten minutes (about
  2,900 writes) stay below the per-account backstop and the 6,000-per-minute installation backstop. Evidence uploads
  keep their own budgets (240 per account per 10 minutes).
- *Time Trials*: a very active community records a few thousand times on a peak day; 6,000 per hour and 40,000 per
  day leave a large margin while capping what fresh accounts can write.
- *Notifications*: one unit per producer call (one submission can notify several overtaken Players), so 20,000 per
  hour is far above ordinary use and still bounds the rows that a flood of cheap causes could create.

**What the budgets cannot do.** An installation budget is shared: while somebody with many accounts spends it, other
people on that path wait until the window ends (one minute for the backstop, one hour or one day for the path
budgets). That is deliberate, because the database and the mail server are protected first; the per-account and
per-target budgets make that take many accounts, and an administrator can lower or raise the settings. The
per-address slots of the pre-sign-in budgets are shared by the addresses that fall into the same slot. Notifications
written directly by social groups and the World Record import are bounded by their own per-account limits and by
the import itself, not by the fan-out budget.
## Fresh confirmation (step-up)

Owner decision 2026-11-15 (option B, audit section 4B): a session, browser cookie or native bearer, stands for the
whole account including its administrator rights. Actions that change who may do what, destroy or hide results,
change the whole installation or act on many records at once therefore need the session to have confirmed a fresh
e-mail link within the last 10 minutes (`MK8DX_HOSTED_STEP_UP_WINDOW_SECONDS`, 60 to 3600). The list lives in
`backend/api/src/security/step-up-policy.ts`; a test binds it to the routes the real composition registers. Request
order: the actor is resolved once, then this guard (at `onRequest`, before the body is read), then the general backstop
of [Installation budgets](#installation-budgets), then the route. A dangerous request refused for want of a
confirmation therefore spends no account or installation budget (its refusal audit has its own bound of 60 per hour
per account), while sending a link (`POST /v1/session/step-up`) is not guarded and passes the backstop and its own
budget. The guard never replaces a route's own checks: a signed-out caller, or a caller without administrator
rights on an administrator route, meets the refusal the route always gave. It is active wherever the installation
sends e-mail; an offline LAN installation (no e-mail) has no step-up.

| Route | Who is asked | Why dangerous |
| --- | --- | --- |
| `POST /v1/administrator-grants` (+ `/:userAccountId/actions/revoke`) | administrator | privilege |
| `POST /v1/administrator/tournament-operation-capabilities` (+ revoke) | administrator | privilege |
| `POST /v1/administrator/tournament-report-capabilities` (+ revoke) | administrator | privilege |
| `POST /v1/administrator/director-host-requests/:requestId/actions/approve` | administrator | privilege (grants Director rights) |
| `POST /v1{,/native}/administrator/identity-links/actions/link`, `/unlink` | administrator | privilege (account owns a Player, bypassing the claim review) |
| `GET /v1{,/native}/administrator/identity-links` (a read; HEAD too) | administrator | privacy (every account's e-mail address; the website loads it only when **Show accounts** is chosen) |
| `POST /v1/administrator/installation-settings` | administrator | installation-wide |
| `POST /v1/administrator/installation-settings/actions/recompute-ratings`, `/rating/actions/recalculate`, `/rating/actions/apply-publication`, `/rating/decisions` | administrator | bulk rating change |
| `POST /v1/administrator/time-trials/actions/resolve-carried-waiting` | administrator | bulk publish/refuse |
| `POST /v1/administrator/tournaments/:tournamentId/actions/remove`, `/reopen`, `/restore` | administrator | destructive (hides, retracts or restores a night and its rating) |
| `POST /v1/tournament-publications/:publicationId/actions/retract` | administrator | destructive |
| `POST /v1/tournaments/:tournamentId/actions/delete`, `/v1/native/tournaments/:tournamentId/actions/delete`, `/v1/native/tournaments/:tournamentId/actions/remove` | any signed-in caller (the Director) | destructive |

Routine, without step-up: every other read, including the request-budget report
(`GET /v1/administrator/request-budgets`: operational counts, fixed scope names and, for account budgets, account ids
and screen names an administrator already sees; no e-mail address, no reversible target; decided 2026-11-15) (the account list with addresses is the one read that asks, and the
administration pages load it only on request), claim decisions (a reviewed, user-initiated request with its own
dispute and revoke path), aliases, observed tournament identities, Player visibility, Time Trial correct/retire/restore
and publish of one result, Tournament publication, live-capture delegations and evidence review, and every action
that runs a night (participants, groups, races, scores, finalize, workflow steps).

| Step-up route | Auth | Proof | Budget | Retention |
| --- | --- | --- | --- | --- |
| `POST /v1/session/step-up` (send a link; the mail attempt is bounded by `MK8DX_HOSTED_SMTP_TIMEOUT_MS`, default 5 s; when it fails the link is kept and the answer is 503 `step_up_mail_unavailable` with `linkExpiresAtMs`, for the break-glass below) | session (cookie or bearer) | browser: Origin must be a trusted origin | 3 per 10 min and 10 per day per account; 429 with Retry-After | links: 10 min; rows removed one day after link and window ended |
| `GET /v1/session/step-up` (status, polled by the clients) | session | n/a | - | n/a |
| `GET /v1/session/step-up/link?token=` (what the link page shows) | anyone with the link | n/a | - | never confirms |
| `POST /v1/session/step-up/link` (Confirm button) | anyone with the link (single use, atomic) | n/a | per address (pre-auth) 30 per 10 min | audit `api_step_up_audit_events` 400 days (refusals at most 60/h per account) |

Break-glass when e-mail fails, not an HTTP route: `install.py step-up-link` (`backend/api/src/security/step-up-operator-main.ts`)
runs on the server with the private operator settings. It replaces the link of the named account's one pending
request (made by **Send the link**, stored even when the e-mail fails) with a new single-use link and prints it on
the operator's terminal; the person still confirms it on the link page, and the window opens only for the session
that asked. It refuses when nothing is pending or when sessions of more than one device are waiting, and records
`step_up_operator_link` in the audit. See [Operations](../OPERATIONS.md#when-e-mail-fails-confirm-a-dangerous-action-from-the-server).

## Checked by a test

`backend/api/test/request-budget-coverage.test.ts` (part of the API's ordinary `npm test`) composes the real hosted
runtime, with and without e-mail (offline LAN), and reads every registered route from
`security/request-budget-coverage.ts`. Every `POST`/`PUT`/`PATCH`/`DELETE` route and every step-up protected read
must be covered by the general signed-in backstop (the same predicate, `mutationBackstopCovers`, that `app.ts`
uses), by a budget the route declares next to the code that spends it (`config: { requestBudget: "pre-auth" }` or
`"route"`), or by an allowlist entry in the test whose reason points here (Better Auth's `/api/auth/*`, the
single-use native sign-in link, the two step-up protected reads of the account list). Routes reachable before
sign-in are listed in the test and never count as covered by the backstop, which counts signed-in callers only.
The test fails for a new unbudgeted route and for a stale list entry. It replaces CodeQL's
`js/missing-rate-limiting` heuristic, which cannot see this durable limiter and is the only rule excluded in
`.github/codeql/codeql-config.yml`. When you add a route reachable before sign-in, declare its budget and add it
to the test's list.

## Open items

No mutating route is without a budget. Routes whose only budget is the general backstop are listed with it above;
they are operator (Director or administrator) routes, own-account settings with a fixed small quota, or routes whose
rows are bounded by a uniqueness rule. Reads (`GET`) are not budgeted except where a read writes (the app download
link, the Home snapshot, which keeps at most two rows per account).
