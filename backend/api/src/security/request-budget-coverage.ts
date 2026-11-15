import type { FastifyInstance } from "fastify";

// Which request budget covers each API route, in a form a test can inspect.
//
// docs/architecture/MUTATING_ROUTES.md lists every mutating route with its budget. The test
// test/request-budget-coverage.test.ts composes the real hosted runtime, reads the routes recorded
// here and fails when a mutating route (or a step-up protected read) is covered by none of:
//   - the general signed-in backstop of app.ts (`mutationBackstopCovers`, the same predicate the
//     backstop hook uses),
//   - a budget declared on the route itself (`config: { requestBudget: ... }`), or
//   - an entry with a reason in the test's explicit allowlist.
// It replaces CodeQL's js/missing-rate-limiting heuristic, which cannot see this durable limiter.

/**
 * A budget the route itself spends, declared next to the code that spends it:
 * - "pre-auth": the route is reachable before the caller is known and spends the client-address
 *   slot budget of `pre-auth-budget.ts` (directly or through `auth-email-budgets.ts`), so callers
 *   the signed-in backstop does not count are bounded too.
 * - "route": a durable budget of its own (per challenge, per account, per installation) that also
 *   applies where the signed-in backstop does not.
 */
export type RequestBudgetDeclaration = "pre-auth" | "route";

declare module "fastify" {
  interface FastifyContextConfig {
    requestBudget?: RequestBudgetDeclaration;
  }
}

const MUTATING_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isMutatingMethod(method: string): boolean {
  return MUTATING_METHODS.has(method.toUpperCase());
}

/**
 * Whether the general backstop (app.ts, `AbuseBudgets.mutation`) counts a request: every
 * `POST`/`PUT`/`PATCH`/`DELETE` under `/v1/`, for a signed-in caller. `path` is the request path
 * or a registered route pattern; the prefix is literal, so both give the same answer.
 */
export function mutationBackstopCovers(method: string, path: string): boolean {
  return isMutatingMethod(method) && path.startsWith("/v1/");
}

export type RegisteredRoute = Readonly<{
  method: string;
  url: string;
  requestBudget: RequestBudgetDeclaration | null;
}>;

const inventories = new WeakMap<FastifyInstance, RegisteredRoute[]>();

/** Records every route registered on `app` from now on (call before any route is added). */
export function recordRegisteredRoutes(app: FastifyInstance): void {
  const routes: RegisteredRoute[] = [];
  inventories.set(app, routes);
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const declared = (route.config as { requestBudget?: unknown } | undefined)?.requestBudget;
    const requestBudget = declared === "pre-auth" || declared === "route" ? declared : null;
    for (const method of methods) {
      routes.push({ method: String(method).toUpperCase(), url: route.url, requestBudget });
    }
  });
}

/** The routes recorded by `recordRegisteredRoutes` (empty when recording was never started). */
export function registeredRoutes(app: FastifyInstance): readonly RegisteredRoute[] {
  return [...(inventories.get(app) ?? [])];
}
