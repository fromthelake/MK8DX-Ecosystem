// Which API routes are dangerous enough to need a fresh e-mail confirmation (step-up).
//
// Owner decision 2026-11-15 (option B, audit section 4B): a signed-in session, browser cookie or
// native bearer, represents the whole account including its administrator rights. Before an action
// that changes who may do what, destroys or hides results or changes the whole installation, that
// session must have confirmed a new e-mail link sent to the
// account's own verified address within the last few minutes. Everything else, including a
// Director's ordinary running of a night, is unchanged.
//
// docs/architecture/MUTATING_ROUTES.md lists the same routes with the reason for each; a test binds
// this list to the routes the real composition registers.

export type StepUpAudience =
  /** Only callers that hold administrator rights; anyone else meets the route's own refusal unchanged. */
  | "administrator"
  /** Any signed-in caller (a Director's destructive action on their own Tournament). */
  | "account";

export type StepUpRoutePolicy = Readonly<{
  method: "GET" | "POST";
  url: string;
  audience: StepUpAudience;
  reason: "privilege" | "destructive" | "installation" | "bulk" | "privacy";
}>;

const administrator = (
  method: StepUpRoutePolicy["method"], url: string, reason: StepUpRoutePolicy["reason"],
): StepUpRoutePolicy => ({ method, url, audience: "administrator", reason });
// Reads are routine, with one exception (owner decision 2026-11-15): the list of every account with
// its e-mail address. The administrator pages load it only when its section is opened, so asking
// there is rare and means something. Every other read stays protected by the administrator check alone.
const account = (url: string): StepUpRoutePolicy => ({ method: "POST", url, audience: "account", reason: "destructive" });

export const STEP_UP_ROUTES: readonly StepUpRoutePolicy[] = Object.freeze([
  // Who may administer, run Tournaments or write reports.
  administrator("POST", "/v1/administrator-grants", "privilege"),
  administrator("POST", "/v1/administrator-grants/:userAccountId/actions/revoke", "privilege"),
  administrator("POST", "/v1/administrator/tournament-operation-capabilities", "privilege"),
  administrator("POST", "/v1/administrator/tournament-operation-capabilities/:userAccountId/actions/revoke", "privilege"),
  administrator("POST", "/v1/administrator/tournament-report-capabilities", "privilege"),
  administrator("POST", "/v1/administrator/tournament-report-capabilities/:userAccountId/actions/revoke", "privilege"),
  administrator("POST", "/v1/administrator/director-host-requests/:requestId/actions/approve", "privilege"),
  // Which account owns which Player, set directly rather than through a claim request.
  administrator("POST", "/v1/administrator/identity-links/actions/link", "privilege"),
  administrator("POST", "/v1/administrator/identity-links/actions/unlink", "privilege"),
  administrator("POST", "/v1/native/administrator/identity-links/actions/link", "privilege"),
  administrator("POST", "/v1/native/administrator/identity-links/actions/unlink", "privilege"),
  // Every account's e-mail address (a read, browser and app).
  administrator("GET", "/v1/administrator/identity-links", "privacy"),
  administrator("GET", "/v1/native/administrator/identity-links", "privacy"),
  // Installation-wide settings and rating recomputation.
  administrator("POST", "/v1/administrator/installation-settings", "installation"),
  administrator("POST", "/v1/administrator/installation-settings/actions/recompute-ratings", "bulk"),
  administrator("POST", "/v1/administrator/rating/decisions", "bulk"),
  administrator("POST", "/v1/administrator/rating/actions/recalculate", "bulk"),
  administrator("POST", "/v1/administrator/rating/actions/apply-publication", "bulk"),
  administrator("POST", "/v1/administrator/time-trials/actions/resolve-carried-waiting", "bulk"),
  // Taking published nights away or bringing them back.
  administrator("POST", "/v1/administrator/tournaments/:tournamentId/actions/remove", "destructive"),
  administrator("POST", "/v1/administrator/tournaments/:tournamentId/actions/reopen", "destructive"),
  administrator("POST", "/v1/administrator/tournaments/:tournamentId/actions/restore", "destructive"),
  administrator("POST", "/v1/tournament-publications/:publicationId/actions/retract", "destructive"),
  // A Director deleting or removing their own Tournament (web and app).
  account("/v1/tournaments/:tournamentId/actions/delete"),
  account("/v1/native/tournaments/:tournamentId/actions/delete"),
  account("/v1/native/tournaments/:tournamentId/actions/remove"),
]);

const index = new Map(STEP_UP_ROUTES.map((policy) => [`${policy.method} ${policy.url}`, policy]));

/** The policy for a registered route pattern (Fastify's `routeOptions.url`), or null when routine. */
export function stepUpPolicyFor(method: string, routeUrl: string | undefined): StepUpRoutePolicy | null {
  if (routeUrl === undefined) { return null; }
  // Fastify answers HEAD with the GET route; it is guarded the same way.
  const verb = method.toUpperCase() === "HEAD" ? "GET" : method.toUpperCase();
  return index.get(`${verb} ${routeUrl}`) ?? null;
}

/** Answer header that tells any client, without reading the body, that a fresh confirmation is needed. */
export const STEP_UP_HEADER = "x-mk8dx-step-up";
export const STEP_UP_PATH = "/v1/session/step-up";
export const STEP_UP_LINK_PATH = "/v1/session/step-up/link";
export const STEP_UP_SCHEMA_VERSION = "mk8dx.step-up.v1";

export function stepUpRequiredBody(windowSeconds: number) {
  return {
    statusCode: 403,
    error: "Forbidden",
    code: "step_up_required",
    message: "Confirm this action with a new email link.",
    stepUp: {
      schemaVersion: STEP_UP_SCHEMA_VERSION,
      request: STEP_UP_PATH,
      status: STEP_UP_PATH,
      windowSeconds,
    },
  } as const;
}
