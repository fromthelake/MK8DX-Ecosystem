# API

Fastify owns identity, authentication, Time Trial submission and publication, Tournament operation, ratings, and persistence. Public entry point: `src/composition/passwordless-hosted-main.ts`; public contract: `/v1` plus readiness routes. It depends on the shared domain/rules/catalogue and MySQL adapters, never on Web internals. Configuration enters through composition adapters. Change a feature in its named `src/` module and add a focused `test/` case. Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`; opt-in MySQL tests require a disposable `_test` or `_contract` schema. Web is the reverse HTTP consumer.

## Budgets and quotas against floods

Every mutating route and its protection is listed in
[`docs/architecture/MUTATING_ROUTES.md`](../../docs/architecture/MUTATING_ROUTES.md). Shared pieces:
`src/security/mysql-mutation-rate-limiter.ts` (durable fixed-window counters, shared by API processes),
`src/security/pre-auth-budget.ts` (fixed address slots before sign-in) and `src/security/abuse-budgets.ts` (the general
per-account backstop for every signed-in `/v1` write, installation-wide budgets for expensive and fan-out paths, and
per-target budgets for actions that notify somebody else). Installation budgets are configured with the
`MK8DX_HOSTED_BUDGET_*` settings listed there; claim quotas are `CLAIM_QUOTAS` in
`src/identity/claim-lifecycle-service.ts`.

## Fresh confirmation (step-up) for dangerous actions

`src/security/step-up-policy.ts` lists the dangerous routes; `step-up-service.ts`, `step-up-routes.ts` and
`mysql-step-up-store.ts` (migration 0095) implement the single-use e-mail link that confirms one session for
`MK8DX_HOSTED_STEP_UP_WINDOW_SECONDS` (60 to 3600, default 600). The guard runs at `onRequest`, before the general
budget backstop. `src/security/step-up-operator-main.ts` (`npm run admin:step-up-link`, `install.py step-up-link`) is
the server-only fallback when e-mail fails: it replaces the link of the named account's one pending request and
prints it. See [`docs/architecture/MUTATING_ROUTES.md`](../../docs/architecture/MUTATING_ROUTES.md#fresh-confirmation-step-up).

## Tournament review authority and evidence limits

Every Tournament review read or write (incoming results, evidence records, live feeds, capture delegations) checks
the database each time: an active administrator grant, or the Tournament's own director while that account holds
an active `tournament.operation` capability. The native operator routes only gate on that capability; they pass the
actor on as resolved. Revoking a capability ends the director's review rights on their own nights too.

A roster match never authorizes a live feed. It opens the public live view only for a feed uploaded by an
administrator, the night's director, or an account the director delegated live capture to
(`POST /v1/{administrator,native}/tournaments/:id/live-capture-delegations`, default 12 hours, at most 7 days,
revocable with `.../:delegationId/actions/revoke`). Revoking a delegation returns that account's public feeds to the
director's list; `.../evidence-records/:recordId/actions/withdraw-live` does the same for one feed. Every live
mapping change is audited with its authorization basis.

`POST /v1/tournament-evidence-records` accepts any signed-in account but within these built-in limits (constructor
option `evidenceLimits` of `TournamentConnectedService`):

| Limit | Default | Refusal |
| --- | --- | --- |
| Upload requests per account / per installation | 240 / 6000 per 10 minutes (shared durable limiter) | 429 + `Retry-After` |
| New records per account | 200 per 24 hours | 429 + `Retry-After` |
| Unlinked records per account | 100 | 409 `tournament_evidence_quota_exceeded` |
| Unlinked bytes per account / per installation | 64 MiB / 1 GiB | 409 `tournament_evidence_quota_exceeded` |
| Bytes per record | 1 MiB (also the request body limit) | 413 |

Account quotas are checked in the upload transaction under the uploader's account lock; the installation byte budget
may be overshot by at most the concurrent requests in flight. A retry of an already stored record is never refused
by a quota. An hourly bounded job removes evidence that was never linked, has no pending results, is not a running
live feed, is not suggested for a night that is still being run and was not changed for 90 days; a record with a
live-mapping audit keeps its row and audit but loses its entries. Linked evidence is never removed. Lists are bounded:
`GET /v1/tournament-evidence-records/own` returns at most 200 records, newest-written first, with `?limit=` and
`?before=<nextCursor>`; a night's evidence list returns at most 500.
